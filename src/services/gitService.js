const { spawn } = require('child_process');
const path = require('path');
const spawnAsync = require('../utils/spawnAsync');

/**
 * Get all branches of a git repository
 */
async function getBranches(projectPath) {
  try {
    // Fetch first to get latest remote branches
    try {
      await spawnAsync('git', ['fetch', '--prune'], {
        cwd: projectPath,
        timeout: 60000
      });
    } catch (e) {
      // Ignore fetch errors
    }

    // Get local branches
    const localResult = await spawnAsync('git', ['branch', '--list'], {
      cwd: projectPath,
      timeout: 30000
    });
    if (localResult.code !== 0) {
      console.error('git branch --list failed:', localResult.stderr);
      return [];
    }
    const output = localResult.stdout;

    const localBranches = output
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        const current = line.startsWith('* ');
        const name = line.replace(/^\* /, '').replace(/^  /, '');
        return { name, current, type: 'local' };
      });

    // Get remote branches
    const remoteResult = await spawnAsync('git', ['branch', '-r'], {
      cwd: projectPath,
      timeout: 30000
    });
    if (remoteResult.code !== 0) {
      console.error('git branch -r failed:', remoteResult.stderr);
      return localBranches; // Return local branches only
    }
    const remoteOutput = remoteResult.stdout;

    const remoteBranches = remoteOutput
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .filter(line => !line.includes('->')) // Skip HEAD references
      .map(line => {
        // Remove origin/ prefix
        const name = line.replace(/^origin\//, '');
        return { name, type: 'remote' };
      });

    // Merge: local branches first, then unique remote branches
    const result = [...localBranches];
    const localNames = new Set(localBranches.map(b => b.name));

    for (const rb of remoteBranches) {
      if (!localNames.has(rb.name)) {
        result.push(rb);
      }
    }

    return result;
  } catch (error) {
    console.error('Error getting branches:', error.message);
    return [];
  }
}

/**
 * Get current branch
 */
async function getCurrentBranch(projectPath) {
  try {
    const { stdout, code } = await spawnAsync('git', ['branch', '--show-current'], {
      cwd: projectPath,
      timeout: 30000
    });
    if (code !== 0) return null;
    return stdout.trim();
  } catch (error) {
    return null;
  }
}

/**
 * Sync repository: reset, clean, checkout, pull
 * Returns Promise that resolves with logs array
 */
function syncRepository(projectPath, branchName) {
  return new Promise((resolve, reject) => {
    const logs = [];

    const commands = [
      { cmd: 'git', args: ['reset', '--hard', 'HEAD'], desc: '重置所有本地修改（包括暂存区）...' },
      { cmd: 'git', args: ['clean', '-fd'], desc: '清理未跟踪文件...' },
      { cmd: 'git', args: ['checkout', branchName], desc: `切换到分支 ${branchName}...` },
      { cmd: 'git', args: ['pull', 'origin', branchName], desc: '拉取最新代码...' }
    ];

    let currentIndex = 0;

    function runNext() {
      if (currentIndex >= commands.length) {
        resolve({ success: true, logs });
        return;
      }

      const { cmd, args, desc } = commands[currentIndex];
      currentIndex++;

      logs.push(`[INFO] ${desc}`);

      const proc = spawn(cmd, args, {
        cwd: projectPath,
        shell: true,
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (stdout) logs.push(stdout);
        if (stderr) logs.push(stderr);

        // git reset and git clean may fail if no changes, that's ok
        // git checkout may "fail" if already on branch
        if (code !== 0 && currentIndex > 2) {
          // Only reject on checkout/pull failures
          if (!stderr.includes('Already on') && !stdout.includes('Already on')) {
            logs.push(`[ERROR] 命令执行失败: ${cmd} ${args.join(' ')}`);
            reject(new Error(`命令执行失败: ${cmd} ${args.join(' ')}\n${stderr}`));
            return;
          }
        }

        runNext();
      });

      proc.on('error', (err) => {
        logs.push(`[ERROR] ${err.message}`);
        reject(err);
      });
    }

    runNext();
  });
}

/**
 * Sync repository for build with streaming logs
 * Executes: git reset --hard HEAD -> git clean -fd -> git checkout <branch> -> git pull origin <branch>
 * @param {string} projectPath - Path to project
 * @param {string} branchName - Branch name to checkout
 * @param {Function} onLog - Callback for streaming logs
 * @returns {Promise<{success: boolean, error?: string}>}
 */
function syncForBuild(projectPath, branchName, onLog) {
  return new Promise((resolve, reject) => {
    const log = (message) => {
      if (onLog) onLog(message);
    };

    log('[SYNC] ========================================');
    log('[SYNC] 开始代码同步...');
    log(`[SYNC] 分支: ${branchName}`);
    log('[SYNC] ========================================');

    const commands = [
      {
        cmd: 'git',
        args: ['reset', '--hard', 'HEAD'],
        step: 1,
        total: 4,
        desc: 'git reset --hard HEAD'
      },
      {
        cmd: 'git',
        args: ['clean', '-fd'],
        step: 2,
        total: 4,
        desc: 'git clean -fd'
      },
      {
        cmd: 'git',
        args: ['checkout', branchName],
        step: 3,
        total: 4,
        desc: `git checkout ${branchName}`
      },
      {
        cmd: 'git',
        args: ['pull', 'origin', branchName],
        step: 4,
        total: 4,
        desc: `git pull origin ${branchName}`
      }
    ];

    let currentIndex = 0;

    function runNext() {
      if (currentIndex >= commands.length) {
        log('[SYNC] ========================================');
        log('[SYNC] 代码同步完成!');
        log('[SYNC] ========================================');
        resolve({ success: true });
        return;
      }

      const { cmd, args, step, total, desc } = commands[currentIndex];
      currentIndex++;

      log(`[SYNC] 步骤 ${step}/${total}: 执行 ${desc}`);

      const proc = spawn(cmd, args, {
        cwd: projectPath,
        shell: true,
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        const text = data.toString().trim();
        if (text) {
          stdout += text;
          log(`[SYNC]   ${text}`);
        }
      });

      proc.stderr.on('data', (data) => {
        const text = data.toString().trim();
        if (text) {
          stderr += text;
          // Don't log "Already on" as error
          if (!text.includes('Already on') && !text.includes('From ')) {
            log(`[SYNC]   ${text}`);
          }
        }
      });

      proc.on('close', (code) => {
        // git reset and git clean may "fail" if no changes, that's ok
        // git checkout may "fail" if already on branch
        if (code !== 0 && step > 2) {
          if (!stderr.includes('Already on') && !stdout.includes('Already on')) {
            log(`[SYNC] ❌ ${desc} 失败`);
            reject(new Error(`${desc} 失败: ${stderr || stdout}`));
            return;
          }
        }

        log(`[SYNC] ✓ ${desc} - 完成`);
        runNext();
      });

      proc.on('error', (err) => {
        log(`[SYNC] ❌ 执行错误: ${err.message}`);
        reject(err);
      });
    }

    runNext();
  });
}

/**
 * Checkout a branch (without reset/clean/pull)
 * For remote branches, creates a local tracking branch
 * @param {string} projectPath - Path to project
 * @param {string} branchName - Branch name to checkout
 * @param {boolean} isRemote - Whether this is a remote branch
 * @returns {Promise<{success: boolean, wasRemote: boolean, logs?: string[]}>}
 */
function checkoutBranch(projectPath, branchName, isRemote = false) {
  return new Promise((resolve, reject) => {
    // Validate branch name (prevent path traversal and control characters)
    if (!branchName || branchName.length > 200 || /\.\./.test(branchName) || /[\x00-\x1f\x7f]/.test(branchName) || branchName.endsWith('.lock') || branchName.includes('\\')) {
      reject(new Error('分支名无效'));
      return;
    }

    const commands = [
      { args: ['stash', '-u', '-m', 'auto-stash-before-checkout'], desc: '暂存本地修改...' },
      { args: isRemote
        ? ['checkout', '-b', branchName, `origin/${branchName}`]
        : ['checkout', branchName],
        desc: `切换到分支 ${branchName}...` }
    ];

    let currentIndex = 0;

    function runNext() {
      if (currentIndex >= commands.length) {
        resolve({ success: true, wasRemote: isRemote });
        return;
      }

      const { args, desc } = commands[currentIndex];
      currentIndex++;

      const proc = spawn('git', args, {
        cwd: projectPath,
        shell: true,
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        // git stash may have nothing to stash (exit code 0 but "No local changes")
        // git checkout may "fail" if already on branch
        if (code !== 0 && currentIndex > 1) {
          if (!stderr.includes('Already on') && !stdout.includes('Already on')) {
            reject(new Error(`切换分支失败: ${stderr || stdout}`));
            return;
          }
        }
        runNext();
      });

      proc.on('error', (err) => {
        reject(err);
      });
    }

    runNext();
  });
}

/**
 * Get recent commit logs for a branch
 * @param {string} projectPath - Path to the git repository
 * @param {string} branchName - Branch name to get logs for
 * @param {number} count - Number of commits to retrieve (default 3)
 * @returns {Promise<Array<{hash: string, author: string, date: string, message: string}>>}
 */
async function getBranchLog(projectPath, branchName, count = 3) {
  function parseLog(output) {
    return output
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        const [hash, author, date, ...messageParts] = line.split('|');
        return {
          hash: hash ? hash.substring(0, 8) : '',
          author: author || '',
          date: date || '',
          message: messageParts.join('|') || ''
        };
      });
  }

  // Try remote branch first (origin/<branch>), then local branch
  const refs = [`origin/${branchName}`, branchName];
  for (const ref of refs) {
    try {
      const { stdout, code } = await spawnAsync(
        'git',
        ['log', ref, `-${count}`, '--format=%H|%an|%ai|%s'],
        {
          cwd: projectPath,
          timeout: 15000,
          shell: false // Use shell: false to preserve pipe characters in format string
        }
      );
      if (code === 0 && stdout.trim()) {
        return parseLog(stdout);
      }
    } catch (e) {
      // Try next ref
    }
  }

  return [];
}

module.exports = {
  getBranches,
  getCurrentBranch,
  syncRepository,
  syncForBuild,
  checkoutBranch,
  getBranchLog
};
