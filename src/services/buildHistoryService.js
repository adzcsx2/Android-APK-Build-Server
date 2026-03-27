const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '../../data/build-history.json');
const RETENTION_DAYS = 3;

/**
 * Ensure history file exists
 */
function ensureFile() {
  const dir = path.dirname(HISTORY_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(HISTORY_FILE, '[]', 'utf8');
  }
}

/**
 * Load build history from disk
 * @returns {Array} - Array of build record objects
 */
function loadHistory() {
  ensureFile();
  try {
    const data = fs.readFileSync(HISTORY_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[BuildHistory] Failed to load history:', error.message);
    return [];
  }
}

/**
 * Save build history to disk
 * @param {Array} history - Array of build record objects
 */
function saveHistory(history) {
  ensureFile();
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  } catch (error) {
    console.error('[BuildHistory] Failed to save history:', error.message);
  }
}

/**
 * Add a completed build record to history
 * @param {Object} build - Build object from buildQueue
 */
function addBuildRecord(build) {
  const history = loadHistory();
  const record = {
    id: build.id,
    projectName: build.projectName,
    branch: build.branch,
    moduleName: build.moduleName,
    variant: build.variant,
    versionCode: build.versionCode,
    versionName: build.versionName,
    jdkVersion: build.jdkVersion,
    status: build.status,
    startTime: build.startTime ? new Date(build.startTime).toISOString() : null,
    endTime: build.endTime ? new Date(build.endTime).toISOString() : null,
    error: build.error || null,
    apkUrl: build.apkUrl || null
  };
  history.push(record);
  saveHistory(history);
  return record;
}

/**
 * Delete a build record from history
 * @param {string} buildId - Build ID to delete
 * @returns {boolean} - True if deleted
 */
function deleteBuildRecord(buildId) {
  const history = loadHistory();
  const index = history.findIndex(b => b.id === buildId);
  if (index === -1) {
    return false;
  }
  history.splice(index, 1);
  saveHistory(history);
  return true;
}

/**
 * Get all build history, sorted by startTime newest first
 * @returns {Array} - Array of build record objects
 */
function getAllHistory() {
  const history = loadHistory();
  return history.sort((a, b) => {
    const ta = a.startTime ? new Date(a.startTime).getTime() : 0;
    const tb = b.startTime ? new Date(b.startTime).getTime() : 0;
    return tb - ta;
  });
}

/**
 * Cleanup records older than retention days (individual cleanup, not bulk)
 * Only removes records whose endTime is older than the threshold
 * @returns {number} - Number of records removed
 */
function cleanupOldRecords() {
  const history = loadHistory();
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const before = history.length;

  // Filter out records older than retention period
  const remaining = history.filter(build => {
    // Keep if no endTime (shouldn't happen, but safety check)
    if (!build.endTime) return true;
    const endTime = new Date(build.endTime).getTime();
    return endTime > cutoff;
  });

  const removed = before - remaining.length;
  if (removed > 0) {
    saveHistory(remaining);
    console.log(`[BuildHistory] Cleaned up ${removed} record(s) older than ${RETENTION_DAYS} days`);
  }
  return removed;
}

/**
 * Start periodic cleanup scheduler (runs every hour)
 */
function startCleanupScheduler() {
  // Run cleanup immediately on startup
  setTimeout(() => cleanupOldRecords(), 3000);

  // Run every hour
  setInterval(() => {
    cleanupOldRecords();
  }, 60 * 60 * 1000);
}

module.exports = {
  loadHistory,
  saveHistory,
  addBuildRecord,
  deleteBuildRecord,
  getAllHistory,
  cleanupOldRecords,
  startCleanupScheduler
};
