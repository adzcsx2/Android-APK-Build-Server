/**
 * Build Log Service
 * Persists build logs to disk per project, with automatic size-based cleanup.
 *
 * Log files: data/build-logs/<projectName>.log
 * Max size: 5MB per project
 * Auto-trim: when exceeding 5MB, trim to 2MB by removing oldest logs
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../../data/build-logs');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB
const TRIM_LOG_SIZE = 2 * 1024 * 1024; // 2MB

/**
 * Ensure log directory exists
 */
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Get the log file path for a project
 */
function getLogFilePath(projectName) {
  return path.join(LOG_DIR, `${projectName}.log`);
}

/**
 * Sanitize project name for use as filename (prevent path traversal)
 */
function sanitizeProjectName(projectName) {
  let safeName = projectName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  safeName = safeName.replace(/\.\./g, '');
  // Verify the resolved path stays within LOG_DIR
  const resolved = path.resolve(LOG_DIR, `${safeName}.log`);
  if (!resolved.startsWith(path.resolve(LOG_DIR))) {
    throw new Error('Invalid project name');
  }
  return safeName;
}

/**
 * Append a log entry to a project's log file
 * @param {string} projectName - Project name
 * @param {string} buildId - Build ID
 * @param {string} message - Log message
 */
function appendLog(projectName, buildId, message) {
  try {
    ensureLogDir();
    const safeName = sanitizeProjectName(projectName);
    const logFile = getLogFilePath(safeName);
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [${buildId}] ${message}\n`;

    fs.appendFileSync(logFile, entry, 'utf8');

    // Check size and trim if needed
    trimIfNeeded(logFile);
  } catch (error) {
    console.error(`Failed to write log for ${projectName}:`, error.message);
  }
}

/**
 * Append a build separator/header to the log
 */
function appendBuildHeader(projectName, buildId, buildInfo) {
  const header = [
    '',
    '========================================',
    `BUILD START: ${buildId}`,
    `Project: ${buildInfo.projectName}`,
    `Branch: ${buildInfo.branch}`,
    `Module: ${buildInfo.moduleName}`,
    `Variant: ${buildInfo.variant}`,
    `Version: ${buildInfo.versionName} (${buildInfo.versionCode})`,
    `JDK: ${buildInfo.jdkVersion || 'default'}`,
    `Time: ${new Date().toLocaleString()}`,
    '========================================',
    ''
  ].join('\n');
  appendLog(projectName, buildId, header);
}

/**
 * Append a build result footer to the log
 */
function appendBuildFooter(projectName, buildId, status, error) {
  const timestamp = new Date().toLocaleString();
  const footer = [
    '',
    '========================================',
    `BUILD END: ${buildId}`,
    `Status: ${status.toUpperCase()}`,
    `Time: ${timestamp}`,
    ...(error ? [`Error: ${error}`] : []),
    '========================================',
    ''
  ].join('\n');
  appendLog(projectName, buildId, footer);
}

/**
 * Read log file content (last N bytes for performance)
 * @param {string} projectName - Project name
 * @param {number} maxBytes - Max bytes to read (default 512KB)
 * @returns {{ content: string, totalSize: number, trimmed: boolean }}
 */
function readLog(projectName, maxBytes = 512 * 1024) {
  try {
    const safeName = sanitizeProjectName(projectName);
    const logFile = getLogFilePath(safeName);

    if (!fs.existsSync(logFile)) {
      return { content: '', totalSize: 0, trimmed: false };
    }

    const stats = fs.statSync(logFile);
    const totalSize = stats.size;

    if (totalSize === 0) {
      return { content: '', totalSize: 0, trimmed: false };
    }

    // If file fits in maxBytes, read all
    if (totalSize <= maxBytes) {
      const content = fs.readFileSync(logFile, 'utf8');
      return { content, totalSize, trimmed: false };
    }

    // Read last maxBytes, but start from a line boundary
    let fd;
    let buffer;
    try {
      fd = fs.openSync(logFile, 'r');
      buffer = Buffer.alloc(maxBytes);
      fs.readSync(fd, buffer, 0, maxBytes, totalSize - maxBytes);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }

    let content = buffer.toString('utf8');
    // Trim to first complete line
    const firstNewline = content.indexOf('\n');
    if (firstNewline > 0) {
      content = content.substring(firstNewline + 1);
    }

    return { content, totalSize, trimmed: true };
  } catch (error) {
    console.error(`Failed to read log for ${projectName}:`, error.message);
    return { content: '', totalSize: 0, trimmed: false };
  }
}

/**
 * Read log content starting from a byte offset (for real-time polling)
 * @param {string} projectName - Project name
 * @param {number} fromOffset - Start reading from this byte offset
 * @param {number} maxBytes - Max bytes to read (default 256KB for polling)
 * @returns {{ content: string, totalSize: number, offset: number, eof: boolean }}
 */
function readLogFromOffset(projectName, fromOffset = 0, maxBytes = 256 * 1024) {
  try {
    const safeName = sanitizeProjectName(projectName);
    const logFile = getLogFilePath(safeName);

    if (!fs.existsSync(logFile)) {
      return { content: '', totalSize: 0, offset: 0, eof: true };
    }

    const stats = fs.statSync(logFile);
    const totalSize = stats.size;

    if (fromOffset >= totalSize) {
      return { content: '', totalSize, offset: fromOffset, eof: true };
    }

    const remaining = totalSize - fromOffset;
    const readSize = Math.min(remaining, maxBytes);

    let buffer;
    const fd = fs.openSync(logFile, 'r');
    try {
      buffer = Buffer.alloc(readSize);
      fs.readSync(fd, buffer, 0, readSize, fromOffset);
    } finally {
      fs.closeSync(fd);
    }

    return {
      content: buffer.toString('utf8'),
      totalSize,
      offset: fromOffset + readSize,
      eof: fromOffset + readSize >= totalSize
    };
  } catch (error) {
    console.error(`Failed to read log offset for ${projectName}:`, error.message);
    return { content: '', totalSize: 0, offset: fromOffset, eof: true };
  }
}

/**
 * Get the size of a project's log file
 */
function getLogSize(projectName) {
  try {
    const safeName = sanitizeProjectName(projectName);
    const logFile = getLogFilePath(safeName);
    if (!fs.existsSync(logFile)) return 0;
    return fs.statSync(logFile).size;
  } catch (error) {
    console.error(`Failed to get log size for ${projectName}:`, error.message);
    return 0;
  }
}

/**
 * Get all project names that have log files
 */
function getLoggedProjects() {
  try {
    ensureLogDir();
    const files = fs.readdirSync(LOG_DIR);
    return files
      .filter(f => f.endsWith('.log'))
      .map(f => f.replace('.log', ''));
  } catch {
    return [];
  }
}

/**
 * Clear all logs for a specific project
 */
function clearProjectLogs(projectName) {
  try {
    const safeName = sanitizeProjectName(projectName);
    const logFile = getLogFilePath(safeName);
    if (fs.existsSync(logFile)) {
      fs.unlinkSync(logFile);
    }
    return true;
  } catch (error) {
    console.error(`Failed to clear logs for ${projectName}:`, error.message);
    return false;
  }
}

/**
 * Clear ALL logs for ALL projects
 */
function clearAllLogs() {
  try {
    ensureLogDir();
    const files = fs.readdirSync(LOG_DIR);
    for (const file of files) {
      if (file.endsWith('.log')) {
        fs.unlinkSync(path.join(LOG_DIR, file));
      }
    }
    return true;
  } catch (error) {
    console.error('Failed to clear all logs:', error.message);
    return false;
  }
}

/**
 * Trim log file if it exceeds MAX_LOG_SIZE
 * Removes oldest content until file is under TRIM_LOG_SIZE
 */
function trimIfNeeded(logFile) {
  try {
    const stats = fs.statSync(logFile);
    if (stats.size <= MAX_LOG_SIZE) return;

    // Read entire file, find where to cut to get under TRIM_LOG_SIZE
    const content = fs.readFileSync(logFile, 'utf8');
    const targetLength = Math.floor(content.length * (TRIM_LOG_SIZE / stats.size));

    // Find the next newline after the target cut point
    let cutPoint = content.indexOf('\n', targetLength);
    if (cutPoint === -1 || cutPoint > content.length - 100) {
      cutPoint = targetLength;
    }

    const trimmed = content.substring(cutPoint + 1);
    const trimHeader = `\n--- Log trimmed at ${new Date().toISOString()} (exceeded ${formatBytes(MAX_LOG_SIZE)}) ---\n\n`;

    fs.writeFileSync(logFile, trimHeader + trimmed, 'utf8');
    console.log(`Trimmed log file: ${path.basename(logFile)} (${formatBytes(stats.size)} -> ${formatBytes(TRIM_LOG_SIZE + trimHeader.length)})`);
  } catch (error) {
    console.error(`Failed to trim log ${logFile}:`, error.message);
  }
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

module.exports = {
  appendLog,
  appendBuildHeader,
  appendBuildFooter,
  readLog,
  readLogFromOffset,
  getLogSize,
  getLoggedProjects,
  clearProjectLogs,
  clearAllLogs,
  formatBytes
};
