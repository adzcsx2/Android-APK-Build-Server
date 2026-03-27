/**
 * Configuration Service
 * Manages project configurations stored in a JSON file
 */

const fs = require('fs');
const path = require('path');

// Configuration file path
const CONFIG_DIR = path.join(__dirname, '../../data');
const CONFIG_FILE = path.join(CONFIG_DIR, 'project-configs.json');

/**
 * Ensure the configuration directory and file exist
 */
function ensureConfigFileExists() {
  // Create data directory if it doesn't exist
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Create config file if it doesn't exist
  if (!fs.existsSync(CONFIG_FILE)) {
    const initialConfig = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      projects: {}
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(initialConfig, null, 2), 'utf8');
  }
}

/**
 * Read all configurations from file
 * @returns {Object} All configurations
 */
function getAllConfigs() {
  try {
    ensureConfigFileExists();
    const content = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Failed to read config file:', error);
    // Return default structure on error
    return {
      version: 1,
      lastUpdated: new Date().toISOString(),
      projects: {}
    };
  }
}

/**
 * Get configuration for a specific project
 * @param {string} projectName - The project name
 * @returns {Object|null} Project configuration or null if not found
 */
function getProjectConfig(projectName) {
  const configs = getAllConfigs();
  return configs.projects[projectName] || null;
}

/**
 * Save configuration for a specific project
 * @param {string} projectName - The project name
 * @param {Object} config - Configuration object
 * @returns {boolean} Success status
 */
function saveProjectConfig(projectName, config) {
  try {
    ensureConfigFileExists();

    // Read existing configs
    const configs = getAllConfigs();

    // Validate config object
    if (!config || typeof config !== 'object') {
      throw new Error('Invalid config object');
    }

    // Update the project config
    configs.projects[projectName] = {
      branch: config.branch || '',
      moduleName: config.moduleName || '',
      variant: config.variant || '',
      versionCode: config.versionCode != null ? config.versionCode : 1,
      versionName: config.versionName != null && config.versionName !== '' ? config.versionName : '1.0.0',
      jdkVersion: config.jdkVersion != null ? config.jdkVersion : null,
      useCache: config.useCache !== false,
      lastModified: new Date().toISOString()
    };

    // Update last updated timestamp
    configs.lastUpdated = new Date().toISOString();

    // Write to file
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2), 'utf8');

    console.log(`Saved config for project: ${projectName}`);
    return true;
  } catch (error) {
    console.error('Failed to save project config:', error);
    return false;
  }
}

/**
 * Delete configuration for a specific project
 * @param {string} projectName - The project name
 * @returns {boolean} Success status
 */
function deleteProjectConfig(projectName) {
  try {
    ensureConfigFileExists();

    const configs = getAllConfigs();

    if (configs.projects[projectName]) {
      delete configs.projects[projectName];
      configs.lastUpdated = new Date().toISOString();
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2), 'utf8');
      console.log(`Deleted config for project: ${projectName}`);
    }

    return true;
  } catch (error) {
    console.error('Failed to delete project config:', error);
    return false;
  }
}

module.exports = {
  getAllConfigs,
  getProjectConfig,
  saveProjectConfig,
  deleteProjectConfig
};
