import fs from 'fs';
import path from 'path';
import { LANG_CONFIGS } from './language.config.js';
import { compileCode, createPersistentContainer, runExecTestcase } from './docker.js';

// Ensure temp directory exists in the workspace
const tempRoot = path.join(process.cwd(), 'temp-submissions');
if (!fs.existsSync(tempRoot)) {
  fs.mkdirSync(tempRoot, { recursive: true });
}

/**
 * Delete folders recursively
 */
const cleanup = async (dirPath) => {
  try {
    if (fs.existsSync(dirPath)) {
      await fs.promises.rm(dirPath, { recursive: true, force: true });
    }
  } catch (err) {
    console.error(`[Sandbox] Failed to clean up folder ${dirPath}:`, err);
  }
};

/**
 * Helper to perform professional online judge-style whitespace cleaning:
 * 1. Splits output into lines
 * 2. Trims only the right-side (trailing spaces and carriage returns)
 * 3. Removes any trailing empty lines at the end of the program output
 */
const cleanOutputString = (str) => {
  if (!str) return ''; // If output is: null or undefined, "" => return empty string
  return str
    .split('\n')
    .map(line => line.trimEnd())
    .filter((line, index, arr) => {
      // Find the last index containing actual characters
      const lastNonEmptyIndex = arr.findLastIndex(l => l.trim() !== '');
      return index <= lastNonEmptyIndex;
    })
    .join('\n');
};

/**
 * Main evaluation entry point
 */
export const evaluateSubmission = async (submissionId, code, language, testcases, timeLimitMs = 2000, memoryLimitMb = 256) => {
  const baseConfig = LANG_CONFIGS[language];
  if (!baseConfig) {
    return {
      status: 'COMPILATION_ERROR',
      errorDetails: `Unsupported language: ${language}`,
    };
  }

  // Create a copy of the config to allow dynamic modification (e.g. Java class names)
  const config = { ...baseConfig };

  if (language === 'java') {
    let match = code.match(/public\s+class\s+(\w+)/);
    if (!match) {
      match = code.match(/class\s+(\w+)/);
    }
    if (match) {
      const className = match[1];
      config.fileName = `${className}.java`;
      config.compileCmd = ['javac', config.fileName];
      config.runCmd = ['java', className];
    }
  }

  const submissionDir = path.join(tempRoot, submissionId);

  let container = null;
  try {
    // 1. Create temporary workspace and write solution file
    await fs.promises.mkdir(submissionDir, { recursive: true });
    const codePath = path.join(submissionDir, config.fileName);
    await fs.promises.writeFile(codePath, code);

    // 2. Compilation (only for compiled languages)
    if (config.compileCmd) {
      console.log(`[Sandbox] Compiling submission ${submissionId} (${language})...`);
      const compileResult = await compileCode(submissionId, submissionDir, config);
      if (!compileResult.success) {
        return {
          status: 'COMPILATION_ERROR',
          errorDetails: compileResult.errorDetails,
        };
      }
    }

    // 3. Start the single persistent container
    // Intially we did one contanier for one testcase but now one container for all testcases 
    // This is Fast.. creation of a container is Cold start..
    console.log(`[Sandbox] Starting persistent container for submission ${submissionId}...`);
    container = await createPersistentContainer(submissionId, submissionDir, config, memoryLimitMb);

    // 4. Run all testcases sequentially
    console.log(`[Sandbox] Running ${testcases.length} test cases for ${submissionId}...`);
    let maxTime = 0;

    for (let i = 0; i < testcases.length; i++) {
      const tc = testcases[i];
      const runResult = await runExecTestcase(container, submissionDir, config, tc.input, timeLimitMs);

      // If one of the test cases fails constraints, abort immediately
      if (runResult.status !== 'SUCCESS') {
        return {
          status: runResult.status,
          executionTime: runResult.executionTime,
          errorDetails: runResult.errorDetails,
        };
      }

      maxTime = Math.max(maxTime, runResult.executionTime);

      // Clean expected and program outputs line-by-line (right-trim only)
      const cleanExpected = cleanOutputString(tc.expectedOutput);
      const cleanStdout = cleanOutputString(runResult.stdout);

      // Compare outputs exactly
      if (cleanStdout !== cleanExpected) {
        return {
          status: 'WRONG_ANSWER',
          executionTime: runResult.executionTime,
          errorDetails: `Test case ${i + 1} failed.\nInput:\n${tc.input}\nExpected:\n${cleanExpected}\nGot:\n${cleanStdout}`,
        };
      }
    }

    // All test cases passed successfully!
    return {
      status: 'ACCEPTED',
      executionTime: maxTime,
      executionMemory: Math.floor(Math.random() * 10000) + 15000, // mock memory usage in KB (15-25 MB)
    };

  } catch (err) {
    console.error(`[Sandbox] Critical error during evaluation of ${submissionId}:`, err);
    return {
      status: 'RUNTIME_ERROR',
      errorDetails: err.message,
    };
  } finally {
    // 5. Always clean up container and submission directory
    if (container) {
      try {
        await container.kill();
      } catch (e) {}
      try {
        await container.remove();
      } catch (e) {}
    }
    await cleanup(submissionDir);
  }
};
