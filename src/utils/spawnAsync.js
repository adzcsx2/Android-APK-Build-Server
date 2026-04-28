const { spawn } = require('child_process');

/**
 * Spawn a child process asynchronously with windowsHide: true.
 * Returns a Promise that resolves to { stdout, stderr, code } or rejects on error.
 *
 * @param {string} cmd - Command to run
 * @param {string[]} args - Arguments array
 * @param {object} options - Spawn options (cwd, env, timeout, shell, etc.)
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
function spawnAsync(cmd, args = [], options = {}) {
  const { timeout, ...spawnOptions } = options;

  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      windowsHide: true,
      shell: true,
      ...spawnOptions
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timeoutTimer = null;

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    if (timeout) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, timeout);
    }

    proc.on('close', (code) => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      if (timedOut) {
        reject(new Error(`Process timed out after ${timeout}ms`));
      } else {
        resolve({ stdout, stderr, code: code ?? 1 });
      }
    });

    proc.on('error', (err) => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      reject(err);
    });
  });
}

module.exports = spawnAsync;
