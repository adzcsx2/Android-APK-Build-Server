const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const CONFIG_FILE = path.join(__dirname, '../../data/jdk-configs.json');
const ROOT_CONFIG = path.join(__dirname, '../../config.json');

/**
 * Ensure data directory and config file exist.
 * Auto-migrate from config.json jdk section on first run.
 */
function ensureConfigFileExists() {
  const dataDir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (fs.existsSync(CONFIG_FILE)) {
    return;
  }

  // Auto-migrate from config.json
  let jdks = [];
  let defaultJdkId = null;
  try {
    const rootConfig = JSON.parse(fs.readFileSync(ROOT_CONFIG, 'utf8'));
    const jdkConfig = rootConfig.jdk || {};
    const versionMap = {
      'jdk8': 8,
      'jdk11': 11,
      'jdk17': 17,
      'jdk21': 21
    };

    // Migrate entries with non-null paths, sorted by version
    const entries = [];
    for (const [key, jdkPath] of Object.entries(jdkConfig)) {
      if (jdkPath && typeof jdkPath === 'string' && jdkPath.trim() !== '') {
        const version = versionMap[key];
        if (version) {
          entries.push({ version, path: jdkPath.trim() });
        }
      }
    }

    entries.sort((a, b) => a.version - b.version);

    for (const entry of entries) {
      const id = uuidv4();
      jdks.push({
        id,
        name: 'JDK ' + entry.version,
        version: entry.version,
        path: entry.path,
        isDefault: false
      });
      // Prefer JDK 17 as default, fallback to first available
      if (entry.version === 17) {
        defaultJdkId = id;
      }
    }

    // Set isDefault on the chosen default JDK
    if (defaultJdkId) {
      const defaultJdk = jdks.find(j => j.id === defaultJdkId);
      if (defaultJdk) defaultJdk.isDefault = true;
    } else if (jdks.length > 0) {
      defaultJdkId = jdks[0].id;
      jdks[0].isDefault = true;
    }
  } catch (e) {
    // ignore migration errors
  }

  saveJdks(jdks, defaultJdkId);
}

/**
 * Read and parse the config file
 */
function readConfig() {
  ensureConfigFileExists();
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

/**
 * Save JDK list to disk
 */
function saveJdks(jdks, defaultJdkId) {
  const data = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    defaultJdkId: defaultJdkId || null,
    jdks: jdks || []
  };
  const dataDir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Get all configured JDKs
 */
function getAllJdks() {
  const data = readConfig();
  return data.jdks || [];
}

/**
 * Get a single JDK by ID
 */
function getJdkById(id) {
  const jdks = getAllJdks();
  return jdks.find(j => j.id === id) || null;
}

/**
 * Get a JDK by version number
 */
function getJdkByVersion(version) {
  const jdks = getAllJdks();
  return jdks.find(j => j.version === version) || null;
}

/**
 * Get the default JDK
 */
function getDefaultJdk() {
  const data = readConfig();
  if (data.defaultJdkId) {
    const jdk = (data.jdks || []).find(j => j.id === data.defaultJdkId);
    if (jdk) return jdk;
  }
  // Fallback to first available
  const jdks = data.jdks || [];
  return jdks.length > 0 ? jdks[0] : null;
}

/**
 * Get list of available version numbers
 */
function getAvailableVersions() {
  return getAllJdks().map(j => j.version);
}

/**
 * Add a new JDK
 */
function addJdk({ name, version, jdkPath }) {
  if (!name || !name.trim()) {
    throw new Error('JDK 名称不能为空');
  }
  if (version == null) {
    throw new Error('JDK 版本号不能为空');
  }
  const parsedVersion = parseInt(version, 10);
  if (isNaN(parsedVersion) || parsedVersion < 1 || parsedVersion > 99) {
    throw new Error('JDK 版本号无效');
  }
  if (!jdkPath || !jdkPath.trim()) {
    throw new Error('JDK 路径不能为空');
  }
  const normalizedPath = path.normalize(jdkPath.trim());
  if (!fs.existsSync(normalizedPath)) {
    throw new Error('JDK 路径不存在: ' + normalizedPath);
  }

  // Check for duplicate version
  const existing = getAllJdks();
  if (existing.find(j => j.version === parsedVersion)) {
    throw new Error('JDK 版本 ' + parsedVersion + ' 已存在');
  }

  const data = readConfig();
  const id = uuidv4();
  const newJdk = {
    id,
    name: name.trim(),
    version: parsedVersion,
    path: normalizedPath,
    isDefault: data.jdks.length === 0
  };

  data.jdks.push(newJdk);
  if (newJdk.isDefault) {
    data.defaultJdkId = id;
  }

  saveJdks(data.jdks, data.defaultJdkId);
  return newJdk;
}

/**
 * Update an existing JDK
 */
function updateJdk(id, { name, version, jdkPath }) {
  const data = readConfig();
  const index = data.jdks.findIndex(j => j.id === id);
  if (index === -1) {
    throw new Error('JDK 不存在');
  }

  if (name != null) {
    if (!name.trim()) {
      throw new Error('JDK 名称不能为空');
    }
    data.jdks[index].name = name.trim();
  }

  if (version != null) {
    const parsedVersion = parseInt(version, 10);
    if (isNaN(parsedVersion) || parsedVersion < 1 || parsedVersion > 99) {
      throw new Error('JDK 版本号无效');
    }
    // Check duplicate version (excluding self)
    if (data.jdks.find(j => j.version === parsedVersion && j.id !== id)) {
      throw new Error('JDK 版本 ' + parsedVersion + ' 已存在');
    }
    data.jdks[index].version = parsedVersion;
  }

  if (jdkPath != null) {
    if (!jdkPath.trim()) {
      throw new Error('JDK 路径不能为空');
    }
    const normalizedPath = path.normalize(jdkPath.trim());
    if (!fs.existsSync(normalizedPath)) {
      throw new Error('JDK 路径不存在: ' + normalizedPath);
    }
    data.jdks[index].path = normalizedPath;
  }

  saveJdks(data.jdks, data.defaultJdkId);
  return data.jdks[index];
}

/**
 * Delete a JDK by ID
 */
function deleteJdk(id) {
  const data = readConfig();
  const index = data.jdks.findIndex(j => j.id === id);
  if (index === -1) {
    throw new Error('JDK 不存在');
  }

  const wasDefault = data.jdks[index].id === data.defaultJdkId;
  data.jdks.splice(index, 1);

  // If deleted JDK was default, assign default to first remaining
  if (wasDefault && data.jdks.length > 0) {
    data.jdks.forEach(j => { j.isDefault = false; });
    data.defaultJdkId = data.jdks[0].id;
    data.jdks[0].isDefault = true;
  } else if (data.jdks.length === 0) {
    data.defaultJdkId = null;
  }

  saveJdks(data.jdks, data.defaultJdkId);
}

/**
 * Set a JDK as the default
 */
function setDefaultJdk(id) {
  const data = readConfig();
  const jdk = data.jdks.find(j => j.id === id);
  if (!jdk) {
    throw new Error('JDK 不存在');
  }

  // Clear all defaults
  data.jdks.forEach(j => { j.isDefault = false; });
  jdk.isDefault = true;
  data.defaultJdkId = id;

  saveJdks(data.jdks, data.defaultJdkId);
}

/**
 * Validate a JDK path (check existence and basic structure)
 */
function validateJdkPath(jdkPath) {
  if (!jdkPath || !jdkPath.trim()) {
    return { valid: false, error: '路径不能为空' };
  }

  const trimmedPath = jdkPath.trim();
  if (!fs.existsSync(trimmedPath)) {
    return { valid: false, error: '路径不存在' };
  }

  // Check for java executable
  const javaExe = path.join(trimmedPath, 'bin', 'java.exe');
  const javaUnix = path.join(trimmedPath, 'bin', 'java');
  if (!fs.existsSync(javaExe) && !fs.existsSync(javaUnix)) {
    return { valid: false, error: '未找到 java 可执行文件，请确认路径正确' };
  }

  return { valid: true };
}

module.exports = {
  ensureConfigFileExists,
  getAllJdks,
  getJdkById,
  getJdkByVersion,
  getDefaultJdk,
  getAvailableVersions,
  addJdk,
  updateJdk,
  deleteJdk,
  setDefaultJdk,
  validateJdkPath
};
