const fs = require('fs');
const path = require('path');
const config = require('../../config.json');

const apkDir = config.apk.outputDir;

// Ensure APK directory exists
if (!fs.existsSync(apkDir)) {
  fs.mkdirSync(apkDir, { recursive: true });
}

/**
 * Generate APK filename
 */
function generateFilename(projectName, moduleName, variant, versionName) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const safeVariant = variant.replace(/[^a-zA-Z0-9]/g, '');
  const safeVersion = versionName.replace(/[^a-zA-Z0-9.]/g, '_');
  return `${projectName}_${moduleName}_${safeVariant}_v${safeVersion}_${timestamp}.apk`;
}

/**
 * Copy APK to output directory
 */
function copyApk(sourcePath, projectName, moduleName, variant, versionName) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`APK not found: ${sourcePath}`);
  }

  const filename = generateFilename(projectName, moduleName, variant, versionName);
  const destPath = path.join(apkDir, filename);

  fs.copyFileSync(sourcePath, destPath);

  return {
    filename,
    path: destPath,
    url: `${config.server.basePath}/apk/${filename}`
  };
}

/**
 * List all APKs
 */
function listApks() {
  if (!fs.existsSync(apkDir)) {
    return [];
  }

  const files = fs.readdirSync(apkDir);
  return files
    .filter(f => f.endsWith('.apk'))
    .map(f => {
      const filePath = path.join(apkDir, f);
      const stats = fs.statSync(filePath);
      return {
        filename: f,
        size: stats.size,
        created: stats.birthtime,
        url: `${config.server.basePath}/apk/${f}`
      };
    })
    .sort((a, b) => b.created - a.created);
}

/**
 * Delete APK
 */
function deleteApk(filename) {
  const filePath = path.join(apkDir, filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Clean up old APKs
 */
function cleanupOldApks() {
  const retentionDays = config.apk.retentionDays || 3;
  const now = Date.now();
  const maxAge = retentionDays * 24 * 60 * 60 * 1000;

  const apks = listApks();
  let deleted = 0;

  for (const apk of apks) {
    const age = now - apk.created.getTime();
    if (age > maxAge) {
      try {
        deleteApk(apk.filename);
        deleted++;
        console.log(`[APK Cleanup] Deleted: ${apk.filename}`);
      } catch (err) {
        console.error(`[APK Cleanup] Failed to delete ${apk.filename}:`, err.message);
      }
    }
  }

  console.log(`[APK Cleanup] Completed. Deleted ${deleted} APKs older than ${retentionDays} days.`);
  return deleted;
}

/**
 * Start cleanup scheduler
 */
function startCleanupScheduler() {
  const cleanupTime = config.apk.cleanupTime || '02:00';
  const [hours, minutes] = cleanupTime.split(':').map(Number);

  // Calculate next cleanup time
  function scheduleNext() {
    const now = new Date();
    let next = new Date();
    next.setHours(hours, minutes, 0, 0);

    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    const delay = next - now;
    console.log(`[APK Cleanup] Next cleanup scheduled at: ${next.toLocaleString()}`);

    setTimeout(() => {
      cleanupOldApks();
      scheduleNext();
    }, delay);
  }

  scheduleNext();

  // Also run cleanup on startup
  setTimeout(() => cleanupOldApks(), 5000);
}

module.exports = {
  generateFilename,
  copyApk,
  listApks,
  deleteApk,
  cleanupOldApks,
  startCleanupScheduler
};
