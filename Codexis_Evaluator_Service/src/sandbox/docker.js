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
    HostConfig: {
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
 * Runs a single testcase inside a restricted Docker container
  */
  export const runTestcase = async (submissionId, submissionDir, config, testcaseInput, timeLimitMs, memoryLimitMb = 256) => {
    const hostPath = submissionDir.replace(/\\/g, '/');

    // Write testcase input to a file in the submission directory
    const inputPath = path.join(submissionDir, 'input.txt');
    await fs.promises.writeFile(inputPath, testcaseInput);

    await ensureImageExists(config.image);

    const container = await docker.createContainer({
      Image: config.image,
      Cmd: ['sh', '-c', `${config.runCmd.join(' ')} < input.txt`], // sh -c "python solution.py < input.txt"
      HostConfig: {
        Binds: [`${hostPath}:/app:ro`], // Mount read-only
        NetworkMode: 'none',  
        // The program can only use what it already has — nothing from outside.. For Security, we disable network access.  The program cannot make any network requests (Malicious code OR Prevent cheating)..
        // If internet is there any some users use it to fetch answers from online sources. ( OR CHATGPT )  So we disable network access.
        //   So we disable network access.
        Memory: memoryLimitMb * 1024 * 1024, // Dynamic memory limit from database
        NanoCpus: 500000000,           // 0.5 Cores CPU limit

        // --- Sandbox Hardening Constraints ---
        
        // Problem: Fork Bomb Protection
        // We limit the maximum number of processes/threads the container can spawn to 20.
        // If a program attempts a fork bomb (while(true) { fork(); }), the OS blocks any 
        // process creation past 20, keeping the Host CPU scheduler and PID table responsive.
        PidsLimit: 20,

        // Problem: Hardening local container directories against write loops
        // Prevents modifications or writes to internal filesystem paths (like /var, /usr)
        ReadonlyRootfs: true,
        // without this ReadonlyRootfs: true Compter hardware may full due to malcios code right  

        // Problem: Disk Space / Writing exhaustion
        // Mounts a size-limited temporary memory-based filesystem (tmpfs) on /tmp
        // Programs can write small scratch files to /tmp up to 10MB in RAM, but cannot exhaust physical host disk space.
        Tmpfs: { '/tmp': 'size=10M,rw' }
        // Experienced programmers know that /tmp is the standard directory for temporary files.
      },
      WorkingDir: '/app',
    });

    const startTime = Date.now();
    await container.start();

    // Start reading container logs in parallel to detect print bombs early
    const logsPromise = readContainerLogs(container);

    // Setup watchdog timeout
    let killed = false;
    const timeoutId = setTimeout(async () => {
      killed = true;
      try {
        // WHY NOT container.remove() To delete container completely...
        // By default, Docker does not allow you to delete a container that is still actively running. If you attempt to run container.remove() on a running container, Docker will throw an HTTP 409 Conflict error:
        await container.kill(); // forcefully stops a running Docker container immediately.
        // IF container.stop() = So it’s “polite first, force later” 
        // Container.stop() =>  Docker sends SIGTERM The process is allowed to: finish current work THEN STOP.  If it doesn’t stop in 10 seconds, Docker sends SIGKILL to forcefully terminate it. 
        //  WASTE OF THAT TIME SO WE USE container.kill() INSTEAD.  It sends SIGKILL immediately, terminating the process without any chance to clean up.
      } catch (e) {
        // Container may have already terminated
      }
    }, timeLimitMs);

    let status;
    try {
      status = await container.wait();
      // Docker waits until:  Program exits normally , Program crashes ,  Program gets killed..
    } catch (err) {
      status = { StatusCode: -1 };
    }
    clearTimeout(timeoutId);

    const endTime = Date.now();
    const executionTime = endTime - startTime;

    // Retrieve stdout/stderr logs (waits for logsPromise to complete)
    const { stdout, stderr, limitExceeded } = await logsPromise;
    await container.remove();

    // Clean up input file for this testcase
    try {
      if (fs.existsSync(inputPath)) {
        await fs.promises.unlink(inputPath);
      }
    } catch (err) {
      // Ignore cleanup error
    }

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

    if (status.StatusCode === 137) {
      return {
        status: 'MEMORY_LIMIT_EXCEEDED',
        executionTime,
        errorDetails: 'Memory Limit Exceeded (Out of Memory)',
      };
    }

    if (status.StatusCode !== 0) {
      return {
        status: 'RUNTIME_ERROR',
        executionTime,
        errorDetails: stderr || `Runtime Error: Exit code ${status.StatusCode}`,
      };
    }

    return {
      status: 'SUCCESS',
      executionTime,
      stdout,
    };
  };
