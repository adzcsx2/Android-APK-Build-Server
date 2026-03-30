const fs = require('fs');
const path = require('path');
const config = require('../../config.json');
const apkService = require('./apkService');
const buildLogService = require('./buildLogService');

const HISTORY_FILE = path.join(__dirname, '../../data/build-history.json');
const MAX_RECORDS_PER_PROJECT = (config.apk && config.apk.maxRecordsPerProject) || 5;

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
 * Triggers cleanup after adding to enforce max records per project
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

  // Cleanup after adding to enforce max records per project
  cleanupOldRecords();

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

  // Delete associated APK file if exists
  const record = history[index];
  if (record && record.apkUrl) {
    const filename = record.apkUrl.split('/').pop();
    apkService.deleteApk(filename);
  }
  // Delete associated per-build log file
  if (record) {
    try {
      buildLogService.clearBuildLog(record.projectName, record.id);
    } catch (err) {
      console.error(`[BuildHistory] Failed to delete build log:`, err.message);
    }
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
 * Cleanup old build records, keeping only the newest MAX_RECORDS_PER_PROJECT per project.
 * If old records have associated APK files, those files are also deleted.
 * @returns {number} - Number of records removed
 */
function cleanupOldRecords() {
  const history = loadHistory();
  const before = history.length;

  // Group records by projectName
  const grouped = {};
  for (const record of history) {
    const key = record.projectName || 'unknown';
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(record);
  }

  const toRemove = new Set();

  for (const [project, records] of Object.entries(grouped)) {
    // Sort by startTime descending (newest first)
    records.sort((a, b) => {
      const ta = a.startTime ? new Date(a.startTime).getTime() : 0;
      const tb = b.startTime ? new Date(b.startTime).getTime() : 0;
      return tb - ta;
    });

    // Keep only the newest MAX_RECORDS_PER_PROJECT records
    if (records.length > MAX_RECORDS_PER_PROJECT) {
      const excess = records.slice(MAX_RECORDS_PER_PROJECT);
      for (const record of excess) {
        toRemove.add(record.id);
        // Delete associated APK file if exists
        if (record.apkUrl) {
          const filename = record.apkUrl.split('/').pop();
          try {
            apkService.deleteApk(filename);
            console.log(`[BuildHistory] Deleted APK: ${filename}`);
          } catch (err) {
            console.error(`[BuildHistory] Failed to delete APK ${filename}:`, err.message);
          }
        }
        // Delete associated per-build log file
        try {
          buildLogService.clearBuildLog(record.projectName, record.id);
          console.log(`[BuildHistory] Deleted build log: ${record.projectName}/${record.id}`);
        } catch (err) {
          console.error(`[BuildHistory] Failed to delete build log ${record.id}:`, err.message);
        }
      }
    }
  }

  if (toRemove.size > 0) {
    const remaining = history.filter(b => !toRemove.has(b.id));
    saveHistory(remaining);
    console.log(`[BuildHistory] Cleaned up ${toRemove.size} record(s), keeping max ${MAX_RECORDS_PER_PROJECT} per project`);
  }

  return toRemove.size;
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
