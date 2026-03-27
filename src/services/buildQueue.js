const { v4: uuidv4 } = require('uuid');
const config = require('../../config.json');
const buildLogService = require('./buildLogService');
const buildHistoryService = require('./buildHistoryService');

// Build queue and status storage
const builds = new Map();
const activeBuilds = [];
const buildProcesses = new Map(); // Store child processes for cancellation
const maxConcurrent = config.build?.maxConcurrent || 3;
// Callbacks registered by the route handler to start pending builds
let onSlotAvailable = null;

/**
 * Register a callback to be invoked when a build slot becomes available
 * @param {Function} callback - Called with the next pending buildId
 */
function setOnSlotAvailable(callback) {
  onSlotAvailable = callback;
}

/**
 * Try to start the next pending build (called after a slot frees up)
 */
function processQueue() {
  if (!canStartBuild()) return;

  // Find the oldest pending build
  const pendingBuilds = Array.from(builds.values())
    .filter(b => b.status === 'pending')
    .sort((a, b) => (a.startTime || 0) - (b.startTime || 0));

  if (pendingBuilds.length > 0 && onSlotAvailable) {
    onSlotAvailable(pendingBuilds[0].id);
  }
}

/**
 * Create a new build task
 */
function createBuild(projectName, branch, moduleName, variant, versionCode, versionName, jdkVersion, useCache = true) {
  const buildId = uuidv4().substring(0, 8);

  const build = {
    id: buildId,
    projectName,
    branch,
    moduleName,
    variant,
    versionCode,
    versionName,
    jdkVersion: jdkVersion ?? null,
    useCache: useCache,
    status: 'pending',
    progress: 0,
    logs: [],
    startTime: null,
    endTime: null,
    apkUrl: null,
    error: null
  };

  builds.set(buildId, build);
  return buildId;
}

/**
 * Get build by ID
 */
function getBuild(buildId) {
  return builds.get(buildId);
}

/**
 * Get all builds
 */
function getAllBuilds() {
  return Array.from(builds.values()).sort((a, b) => {
    return (b.startTime || 0) - (a.startTime || 0);
  });
}

/**
 * Update build status
 */
function updateBuild(buildId, updates) {
  const build = builds.get(buildId);
  if (build) {
    Object.assign(build, updates);
  }
  return build;
}

/**
 * Add log to build
 */
function addLog(buildId, log) {
  const build = builds.get(buildId);
  if (build) {
    build.logs.push({
      time: new Date().toISOString(),
      message: log
    });
    // Also persist to disk
    buildLogService.appendLog(build.projectName, buildId, log);
  }
}

/**
 * Check if can start new build
 */
function canStartBuild() {
  return activeBuilds.length < maxConcurrent;
}

/**
 * Mark build as started
 */
function startBuild(buildId) {
  const build = builds.get(buildId);
  if (build && canStartBuild()) {
    build.status = 'building';
    build.startTime = new Date();
    activeBuilds.push(buildId);
    // Write build header to persistent log
    buildLogService.appendBuildHeader(build.projectName, buildId, build);
    return true;
  }
  return false;
}

/**
 * Atomically check and start a pending build (prevents race conditions)
 * @param {string} buildId - Build ID to start
 * @returns {boolean} - True if build was started
 */
function tryStartBuild(buildId) {
  const build = builds.get(buildId);
  if (!build || build.status !== 'pending') return false;
  if (!canStartBuild()) return false;
  return startBuild(buildId);
}

/**
 * Mark build as completed
 */
function completeBuild(buildId, apkUrl) {
  const build = builds.get(buildId);
  if (build) {
    // Don't overwrite cancelled status
    if (build.status === 'cancelled') return false;

    build.status = 'completed';
    build.endTime = new Date();
    build.apkUrl = apkUrl;
    build.progress = 100;

    buildLogService.appendBuildFooter(build.projectName, buildId, 'completed');

    const index = activeBuilds.indexOf(buildId);
    if (index > -1) {
      activeBuilds.splice(index, 1);
    }

    // Clean up process reference
    buildProcesses.delete(buildId);

    // Persist to build history
    buildHistoryService.addBuildRecord(build);
    cleanupOldBuilds();
    processQueue();
    return true;
  }
  return false;
}

/**
 * Mark build as failed
 */
function failBuild(buildId, error) {
  const build = builds.get(buildId);
  if (build) {
    // Don't overwrite cancelled status
    if (build.status === 'cancelled') return false;

    build.status = 'failed';
    build.endTime = new Date();
    build.error = error;

    buildLogService.appendBuildFooter(build.projectName, buildId, 'failed', error);

    const index = activeBuilds.indexOf(buildId);
    if (index > -1) {
      activeBuilds.splice(index, 1);
    }

    // Clean up process reference
    buildProcesses.delete(buildId);

    // Persist to build history
    buildHistoryService.addBuildRecord(build);
    cleanupOldBuilds();
    processQueue();
    return true;
  }
  return false;
}

/**
 * Clean up old builds (keep last 100)
 */
function cleanupOldBuilds() {
  const allBuilds = Array.from(builds.entries())
    .sort((a, b) => (b[1].startTime || 0) - (a[1].startTime || 0));

  if (allBuilds.length > 100) {
    const toDelete = allBuilds.slice(100);
    for (const [id] of toDelete) {
      builds.delete(id);
    }
  }
}

/**
 * Register a build process for cancellation support
 */
function registerBuildProcess(buildId, process) {
  buildProcesses.set(buildId, process);
}

/**
 * Check if a build has been cancelled
 * @param {string} buildId - Build ID to check
 * @returns {boolean} - True if the build is in cancelled state
 */
function isBuildCancelled(buildId) {
  const build = builds.get(buildId);
  return build ? build.status === 'cancelled' : true;
}

/**
 * Cancel a build
 * @param {string} buildId - Build ID to cancel
 * @returns {boolean} - True if cancelled successfully
 */
function cancelBuild(buildId) {
  const build = builds.get(buildId);

  if (!build) {
    return false;
  }

  // Can only cancel pending or building builds
  if (build.status !== 'pending' && build.status !== 'building') {
    return false;
  }

  // Kill the process if it exists
  const proc = buildProcesses.get(buildId);
  if (proc) {
    try {
      if (process.platform === 'win32') {
        // On Windows with shell: true, process.kill('SIGTERM') only kills cmd.exe,
        // not the gradlew.bat -> java.exe child process tree.
        // Use taskkill /T /F to kill the entire process tree.
        const { execSync } = require('child_process');
        try {
          execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
          console.log(`Killed process tree for build ${buildId}, pid: ${proc.pid}`);
        } catch (killErr) {
          // Process may have already exited, try direct kill as fallback
          try {
            proc.kill('SIGTERM');
          } catch (e) {
            // Ignore
          }
        }
      } else {
        proc.kill('SIGTERM');
      }
      buildProcesses.delete(buildId);
    } catch (err) {
      console.error(`Failed to kill process for build ${buildId}:`, err.message);
    }
  }

  // Update build status
  build.status = 'cancelled';
  build.endTime = new Date();
  build.error = 'Build cancelled by user';

  buildLogService.appendBuildFooter(build.projectName, buildId, 'cancelled', 'Build cancelled by user');

  // Remove from active builds
  const index = activeBuilds.indexOf(buildId);
  if (index > -1) {
    activeBuilds.splice(index, 1);
  }

  // Persist to build history
  buildHistoryService.addBuildRecord(build);

  processQueue();

  return true;
}

/**
 * Get all active (building) and pending (queued) builds
 * @returns {Array} - Array of active/pending build objects
 */
function getActiveBuilds() {
  return Array.from(builds.values())
    .filter(build => build.status === 'building' || build.status === 'pending')
    .map(build => ({
      id: build.id,
      projectName: build.projectName,
      moduleName: build.moduleName,
      variant: build.variant,
      versionCode: build.versionCode,
      versionName: build.versionName,
      status: build.status,
      startTime: build.startTime,
      progress: build.progress
    }));
}

/**
 * Get build history from persistent storage (all projects, all finished builds)
 * @returns {Array} - Array of build record objects, newest first
 */
function getRecentBuilds() {
  return buildHistoryService.getAllHistory();
}

/**
 * Delete a build record from history
 * @param {string} buildId - Build ID to delete
 * @returns {boolean} - True if deleted successfully
 */
function deleteBuild(buildId) {
  const build = builds.get(buildId);
  if (!build) {
    // Try deleting from persistent history
    return buildHistoryService.deleteBuildRecord(buildId);
  }

  // Can only delete non-active builds
  if (build.status === 'pending' || build.status === 'building') {
    return false;
  }

  builds.delete(buildId);
  buildHistoryService.deleteBuildRecord(buildId);
  return true;
}

module.exports = {
  createBuild,
  getBuild,
  getAllBuilds,
  getActiveBuilds,
  getRecentBuilds,
  deleteBuild,
  updateBuild,
  addLog,
  canStartBuild,
  startBuild,
  tryStartBuild,
  completeBuild,
  failBuild,
  cancelBuild,
  registerBuildProcess,
  isBuildCancelled,
  cleanupOldBuilds,
  setOnSlotAvailable,
  processQueue,
  // Export for testing
  builds,
  activeBuilds,
  buildProcesses
};
