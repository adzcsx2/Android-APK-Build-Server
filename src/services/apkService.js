const fs = require('fs');
const path = require('path');
const config = require('../../config.json');

const apkDir = path.isAbsolute(config.apk.outputDir)
  ? config.apk.outputDir
  : path.resolve(__dirname, '../../', config.apk.outputDir);

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
 * Copy APK to output directory with a pre-generated filename
 * @returns {{ filename, path, url }} — same shape as copyApk()
 */
function copyApkWithFilename(sourcePath, filename) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`APK not found: ${sourcePath}`);
  }

  const destPath = path.join(apkDir, filename);

  fs.copyFileSync(sourcePath, destPath);

  return {
    filename,
    path: destPath,
    url: `${config.server.basePath}/apk/${filename}`
  };
}

module.exports = {
  generateFilename,
  copyApk,
  copyApkWithFilename,
  listApks,
  deleteApk
};
