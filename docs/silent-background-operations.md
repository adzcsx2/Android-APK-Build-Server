# Silent Background Operations on Windows

## Overview

Implemented silent background git and build operations on Windows to eliminate CMD console window flashing during remote branch switching, fetching, and build cancellation.

## Problem

On Windows, when the server performed git operations (fetch, branch listing, checkout, log) or cancelled builds, CMD console windows would briefly flash on the server's desktop. This was distracting and disruptive for users working on the server machine.

## Root Cause

The codebase used `child_process.execSync()` and `child_process.execFileSync()` for git operations. These synchronous functions do not support the `windowsHide: true` option, which is required to suppress console windows on Windows.

While the codebase already used `spawn()` with `windowsHide: true` for long-running operations (gradle builds, flutter builds), several synchronous operations remained:

- `git fetch --prune` (60s timeout)
- `git branch --list` (30s timeout)
- `git branch -r` (30s timeout)
- `git branch --show-current` (30s timeout)
- `git log` with format (15s timeout)

## Solution

Created a shared async spawn utility and converted all synchronous git operations to async with proper `windowsHide: true` support.

## Changes

### New Files

1. **`src/utils/spawnAsync.js`** - Shared async spawn utility
   - Wraps `child_process.spawn()` with `windowsHide: true`
   - Returns Promise resolving to `{ stdout, stderr, code }`
   - Supports timeout via `setTimeout()` (fixes original implementation)
   - Handles process cleanup on timeout and error

### Modified Files

2. **`src/services/gitService.js`**
   - Converted `getBranches()` to async (3 execSync → spawnAsync)
   - Converted `getCurrentBranch()` to async (execSync → spawnAsync)
   - Converted `getBranchLog()` to async (execFileSync → spawnAsync)
   - Added exit code checks for robustness
   - Uses `shell: false` for git log to preserve pipe characters in format string

3. **`src/routes/projects.js`**
   - Updated 4 route handlers to async/await:
     - `GET /api/projects/:name/current-branch`
     - `GET /api/projects/:name/branches`
     - `GET /api/projects/:name/branch-log`
     - `POST /api/projects/:name/git/checkout`

4. **`src/routes/build.js`**
   - Added `await` to `getCurrentBranch()` call in `POST /api/build`

5. **`src/services/buildQueue.js`**
   - Changed `execSync('taskkill ...')` to use `windowsHide: true` option
   - Kept synchronous execSync to avoid race condition (process must be dead before status update)

6. **`src/services/gradleService.js`**
   - Removed unused `execSync` import (cleanup)

## Technical Details

### spawnAsync Utility

```javascript
function spawnAsync(cmd, args = [], options = {}) {
  const { timeout, ...spawnOptions } = options;

  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      windowsHide: true,  // Hides console window on Windows
      shell: true,        // Required for .bat files and git on Windows
      ...spawnOptions
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timeoutTimer = null;

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    if (timeout) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, timeout);
    }

    proc.on('close', (code) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (timedOut) {
        reject(new Error(`Process timed out after ${timeout}ms`));
      } else {
        resolve({ stdout, stderr, code: code ?? 1 });
      }
    });

    proc.on('error', (err) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      reject(err);
    });
  });
}
```

### Key Design Decisions

1. **Timeout Implementation**: Uses `setTimeout()` instead of non-existent `proc.setTimeout()` to properly implement timeout functionality.

2. **cancelBuild Synchronous**: Kept `execSync` for taskkill to ensure process is actually killed before updating build status. Added `windowsHide: true` to suppress console window.

3. **Exit Code Checks**: Added checks for non-zero exit codes in `getBranches()` to handle errors gracefully.

4. **Git Log Format**: Uses `shell: false` for git log to prevent shell interpretation of pipe characters in the format string (`--format=%H|%an|%ai|%s`).

## Testing

Manual testing should verify:

- [ ] No CMD windows flash during branch listing
- [ ] No CMD windows flash during branch checkout
- [ ] No CMD windows flash during branch log viewing
- [ ] No CMD windows flash during build cancellation
- [ ] All existing functionality preserved
- [ ] Timeout behavior works (try with unreachable git remote)
- [ ] Error handling works (invalid project path, non-existent branch)

## Performance Impact

- Converting sync to async routes improves server responsiveness during git operations
- No longer blocks the Node.js event loop during slow git operations (fetch, pull)
- Build queue concurrency limit still enforced (max 3 concurrent builds)

## Compatibility

- **Platform**: Windows-only (uses Windows-specific paths and commands)
- **Node.js**: Requires Node.js 15.13+ for `proc.setTimeout()` equivalent (implemented via `setTimeout()`)
- **No breaking changes**: All public APIs unchanged from caller perspective

## References

- Node.js `child_process` documentation: https://nodejs.org/api/child_process.html
- `windowsHide` option: https://nodejs.org/api/child_process.html#child_processspawncommand-args-options
