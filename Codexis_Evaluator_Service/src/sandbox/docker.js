import Docker from 'dockerode';
import { PassThrough } from 'stream';
import fs from 'fs';
import path from 'path';

// Connect to the local Docker engine using Windows named pipe or Linux socket
// On Linux/macOS Docker listens on: /var/run/docker.sock   On Windows :  //./pipe/docker_engine
// process.platform  win32   → Windows,  linux   → Linux,   darwin  → macOS....
export const docker = new Docker({ socketPath: process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock' });

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

    stdoutStream.on('data', (chunk) => { stdout += chunk.toString(); });
    stderrStream.on('data', (chunk) => { stderr += chunk.toString(); });

    container.modem.demuxStream(logsStream, stdoutStream, stderrStream);

    logsStream.on('end', () => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
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
    },
    // Lets Say hostPath = "temp-submissions/123".. 
    // Then Docker is told:ker is told: "Connect my host folder temp-submissions/123 to the folder /app inside the container."
    // ${hostPath}:/app =>  It creates a link between the host folder and the /app directory inside the container.
     // The container and hostPath are independent. Docker simply gives the container access to that folder through /app.
    WorkingDir: '/app',
    // Now all commands run inside:  /app
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
  export const runTestcase = async (submissionId, submissionDir, config, testcaseInput, timeLimitMs) => {
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
        Memory: 1000000000,            // 1GB Memory limit
        NanoCpus: 500000000,           // 0.5 Cores CPU limit
      },
      WorkingDir: '/app',
    });

    const startTime = Date.now();
    await container.start();

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

    // Retrieve stdout/stderr logs
    const { stdout, stderr } = await readContainerLogs(container);
    await container.remove();

    // Clean up input file for this testcase
    try {
      if (fs.existsSync(inputPath)) {
        await fs.promises.unlink(inputPath);
      }
    } catch (err) {
      // Ignore cleanup error
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
