import Docker from 'dockerode';
import { PassThrough } from 'stream';
import fs from 'fs';
import path from 'path';

// Connect to the local Docker engine using Windows named pipe or Linux socket
// On Linux/macOS Docker listens on: /var/run/docker.sock   On Windows :  //./pipe/docker_engine
// process.platform  win32   → Windows,  linux   → Linux,   darwin  → macOS....
export const docker = new Docker({ socketPath: process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock' });

// Fork-Bombs are stopped by capping the container process count to 20 (PidsLimit).
// Disk-Exhaustion is stopped by locking the container files (ReadonlyRootfs) and routing necessary scratch files to a 10MB in-memory buffer (Tmpfs).
// Print-Bombs are stopped by truncating the network logs stream at 50KB in Node.js before it loads into RAM.


/**
 * Capture stdout and stderr streams from a docker container and convert to strings
 */
export const readContainerLogs = async (container) => {
  const logsStream = await container.logs({ stdout: true, stderr: true, follow: true });
  return new Promise((resolve) => {
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    let stdout = '';
    let stderr = '';
    let resolved = false;

    // --- Problem: Print/Log Bomb OOM Protection ---
    // We restrict the total accumulated stdout and stderr log size to 50KB.
    // If a malicious program outputs an infinite loop of print commands, this threshold
    // stops log collection early, preventing the Host Node.js Evaluator Service from running out of memory (OOM).
    const MAX_LOG_SIZE = 50 * 1024; // 50 KB

    const handleData = (streamType, chunk, appendFn) => {
      if (resolved) return;
      const currentLength = stdout.length + stderr.length;
      if (currentLength + chunk.length > MAX_LOG_SIZE) {
        // Slice the chunk to fit exactly within the limit, append the truncation warning,
        // destroy the network stream to stop Docker from sending more data, and resolve immediately.
        const remainingSpace = MAX_LOG_SIZE - currentLength;
        if (remainingSpace > 0) {
          appendFn(chunk.slice(0, remainingSpace).toString());
        }
        if (streamType === 'stdout') {
          stdout += '\n...[Output Truncated due to size limit (Print Bomb / Log Flood Protection)]';
        } else {
          stderr += '\n...[Output Truncated due to size limit (Print Bomb / Log Flood Protection)]';
        }
        resolved = true;
        try {
          logsStream.destroy(); // Halts the stream transfer from Docker
        } catch (e) {
          // Stream might already be closed
        }
        try {
          container.kill(); // Kill the container instantly to stop the print bomb
        } catch (e) {
          // Container might already be stopped
        }
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), limitExceeded: true });
      } else {
        appendFn(chunk.toString());
      }
    };

    stdoutStream.on('data', (chunk) => {
      handleData('stdout', chunk, (val) => { stdout += val; });
    });
    
    stderrStream.on('data', (chunk) => {
      handleData('stderr', chunk, (val) => { stderr += val; });
    });

    container.modem.demuxStream(logsStream, stdoutStream, stderrStream);

    logsStream.on('end', () => {
      if (!resolved) {
        resolved = true;
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), limitExceeded: false });
      }
    });

    logsStream.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), limitExceeded: false });
      }
    });
  });
};

/**
 * Checks if a docker image exists locally, and if not, pulls it.
 */
export const ensureImageExists = async (imageName) => {
  try {
    await docker.getImage(imageName).inspect();
  } catch (err) {
    if (err.statusCode === 404) {
      console.log(`[Docker] Image ${imageName} not found locally. Pulling it now...`);
      await new Promise((resolve, reject) => {
        docker.pull(imageName, (pullErr, stream) => {
          if (pullErr) return reject(pullErr);
          docker.modem.followProgress(stream, (finishedErr) => {
            if (finishedErr) return reject(finishedErr);
            resolve();
          });
        });
      });
      console.log(`[Docker] Successfully pulled image ${imageName}`);
    } else {
      throw err;
    }
  }
};

/**
 * Compiles source files inside a temporary Docker container
 */
export const compileCode = async (submissionId, submissionDir, config) => {
  const hostPath = submissionDir.replace(/\\/g, '/'); 
  await ensureImageExists(config.image);
  // Windows path: temp-submissions\123  =>  becomes: temp-submissions/123
  // Docker bind mounts prefer forward slashes.
  // HOSTPATH = Path on your computer where the source code is stored.  (temp-submissions/123)

  const container = await docker.createContainer({
    Image: config.image,
    Cmd: config.compileCmd, // Container Runs the command inside the /app folder...
    Labels: {
      owner: 'codexis',
    },
    HostConfig: {
       NetworkMode: 'none',
      Binds: [`${hostPath}:/app`],
      // Mount a size-limited temporary memory tmpfs (/tmp) for compiler scratch files (g++, javac, etc.)
      // to ensure standard compilation processes don't get blocked by permissions or readonly settings
      Tmpfs: { '/tmp': 'size=50M,rw' }
    },
    WorkingDir: '/app',
  });

  await container.start();
  const status = await container.wait(); // Wait Until Compilation Finishes
      // Exit Code 0 → Success
      // Exit Code 1 → Error

  // Fetch compiler diagnostics logs
  const logsStream = await container.logs({ stdout: true, stderr: true, follow: true }); 
  // Gets compiler output.. ( Give me everything written to stdout and stderr. )
  // While Compliling => Normal messages go to stdout..  Errors/warnings go to stderr...
  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();
  let stdout = '';
  let stderr = '';
  stdoutStream.on('data', (chunk) => { stdout += chunk.toString(); });
  stderrStream.on('data', (chunk) => { stderr += chunk.toString(); });
  // Both are identical.

  container.modem.demuxStream(logsStream, stdoutStream, stderrStream);
  //demuxStream() decides where to send the data by treating the second argument as stdout and the third argument as stderr.
  // Before demuxStream() runs:  There is no connection yet.   The listeners are just waiting..

  await new Promise((r) => logsStream.on('end', r)); 
  // When logsStream ends, the listeners will be notified and the promise resolves.. Then remove container...
  await container.remove();

  if (status.StatusCode !== 0) {
    return {
      success: false,
      errorDetails: stderr || stdout || 'Compilation failed with unknown error',
    };
  }

  return { success: true };
};
/**
 * Spawns a persistent, long-running sandbox container in the background
 */
export const createPersistentContainer = async (submissionId, submissionDir, config, memoryLimitMb = 256) => {
  const hostPath = submissionDir.replace(/\\/g, '/');
  await ensureImageExists(config.image);

  const container = await docker.createContainer({
    Image: config.image,
    Cmd: ['sleep', 'infinity'], // Keeps the container alive indefinitely until stopped/killed
    Labels: {
      owner: 'codexis',
    },
    HostConfig: {
      Binds: [`${hostPath}:/app:ro`],
      NetworkMode: 'none',  
      Memory: memoryLimitMb * 1024 * 1024,
      NanoCpus: 500000000, // 0.5 cores CPU limit
      PidsLimit: 20, // Fork bomb protection
      ReadonlyRootfs: true, // Hardened read-only container files
      Tmpfs: { '/tmp': 'size=10M,rw' } // 10MB memory disk for scratch writing
    },
    WorkingDir: '/app',
  });

  await container.start();
  return container;
};

/**
 * Capture stdout and stderr streams from a docker exec execution and convert to strings
 */
export const readExecLogs = async (container, execStream) => {
  return new Promise((resolve) => {
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    let stdout = '';
    let stderr = '';
    let resolved = false;

    // --- Print/Log Bomb OOM Protection ---
    const MAX_LOG_SIZE = 50 * 1024; // 50 KB

    const handleData = (streamType, chunk, appendFn) => {
      if (resolved) return;
      const currentLength = stdout.length + stderr.length;
      if (currentLength + chunk.length > MAX_LOG_SIZE) {
        const remainingSpace = MAX_LOG_SIZE - currentLength;
        if (remainingSpace > 0) {
          appendFn(chunk.slice(0, remainingSpace).toString());
        }
        if (streamType === 'stdout') {
          stdout += '\n...[Output Truncated due to size limit (Print Bomb / Log Flood Protection)]';
        } else {
          stderr += '\n...[Output Truncated due to size limit (Print Bomb / Log Flood Protection)]';
        }
        resolved = true;
        try {
          execStream.destroy();
        } catch (e) {}
        try {
          container.kill(); // Kill container to stop execution
        } catch (e) {}
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), limitExceeded: true });
      } else {
        appendFn(chunk.toString());
      }
    };

    stdoutStream.on('data', (chunk) => {
      handleData('stdout', chunk, (val) => { stdout += val; });
    });
    
    stderrStream.on('data', (chunk) => {
      handleData('stderr', chunk, (val) => { stderr += val; });
    });

    container.modem.demuxStream(execStream, stdoutStream, stderrStream);

    execStream.on('end', () => {
      if (!resolved) {
        resolved = true;
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), limitExceeded: false });
      }
    });

    execStream.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), limitExceeded: false });
      }
    });
  });
};

/**
 * Runs a single testcase inside a running persistent sandbox container using Docker Exec API
 */
export const runExecTestcase = async (container, submissionDir, config, testcaseInput, timeLimitMs) => {
  const inputPath = path.join(submissionDir, 'input.txt');
  await fs.promises.writeFile(inputPath, testcaseInput);

  const startTime = Date.now();
  let killed = false;
  let execInstance;

  try {
    execInstance = await container.exec({
      Cmd: ['sh', '-c', `${config.runCmd.join(' ')} < input.txt`],
      AttachStdout: true,
      AttachStderr: true,
    });
  } catch (err) {
    // Clean up input file
    try {
      if (fs.existsSync(inputPath)) {
        await fs.promises.unlink(inputPath);
      }
    } catch (e) {}

    return {
      status: 'RUNTIME_ERROR',
      executionTime: Date.now() - startTime,
      errorDetails: `Failed to create exec instance: ${err.message}`,
    };
  }

  let execStream;
  try {
    execStream = await execInstance.start({ hijack: true });
  } catch (err) {
    try {
      if (fs.existsSync(inputPath)) {
        await fs.promises.unlink(inputPath);
      }
    } catch (e) {}

    return {
      status: 'RUNTIME_ERROR',
      executionTime: Date.now() - startTime,
      errorDetails: `Failed to start exec instance: ${err.message}`,
    };
  }

  // Read logs in parallel
  const logsPromise = readExecLogs(container, execStream);

  // Setup watchdog timeout
  const timeoutId = setTimeout(async () => {
    killed = true;
    try {
      await container.kill();
    } catch (e) {}
  }, timeLimitMs);

  const { stdout, stderr, limitExceeded } = await logsPromise;
  clearTimeout(timeoutId);

  // Clean up input file
  try {
    if (fs.existsSync(inputPath)) {
      await fs.promises.unlink(inputPath);
    }
  } catch (err) {}

  const executionTime = Date.now() - startTime;

  if (limitExceeded) {
    return {
      status: 'OUTPUT_LIMIT_EXCEEDED',
      executionTime,
      errorDetails: 'Output Limit Exceeded (Print Bomb / Log Flood Protection)',
    };
  }

  if (killed) {
    return {
      status: 'TIME_LIMIT_EXCEEDED',
      executionTime,
      errorDetails: 'Time Limit Exceeded',
    };
  }

  let inspectData;
  try {
    inspectData = await execInstance.inspect();
  } catch (err) {
    inspectData = { ExitCode: -1 };
  }

  if (inspectData.ExitCode === 137) {
    return {
      status: 'MEMORY_LIMIT_EXCEEDED',
      executionTime,
      errorDetails: 'Memory Limit Exceeded (Out of Memory)',
    };
  }

  if (inspectData.ExitCode !== 0) {
    return {
      status: 'RUNTIME_ERROR',
      executionTime,
      errorDetails: stderr || `Runtime Error: Exit code ${inspectData.ExitCode}`,
    };
  }

  return {
    status: 'SUCCESS',
    executionTime,
    stdout,
  };
};

/**
 * Scans the local Docker daemon on startup and prunes any dangling sandbox
 * containers that were left running from previous crashed runs (identified by the owner=codexis label).
 */
export const sweepOrphansOnBoot = async () => {
  console.log('[System Recovery] Scanning for orphan sandbox containers on boot...');
  try {
    const containers = await docker.listContainers({
      all: true,
      filters: JSON.stringify({ label: ['owner=codexis'] })
    });

    if (containers.length === 0) {
      console.log('[System Recovery] No orphan sandbox containers found. System is clean.');
      return;
    }

    console.log(`[System Recovery] Found ${containers.length} orphan container(s). Pruning now...`);
    for (const containerInfo of containers) {
      try {
        const container = docker.getContainer(containerInfo.Id);
        // Force stop/kill if running, then remove
        console.log(`[System Recovery] Killing and removing orphan container: ${containerInfo.Id}`);
        await container.kill().catch(() => {}); // ignore error if already stopped
        await container.remove().catch(() => {}); // ignore error if already deleted
      } catch (e) {
        console.error(`[System Recovery] Failed to prune container ${containerInfo.Id}:`, e.message || e);
      }
    }
    console.log('[System Recovery] Orphan container prune complete.');
  } catch (err) {
    console.error('[System Recovery] Failed to list or prune orphan containers:', err.message || err);
  }
};
