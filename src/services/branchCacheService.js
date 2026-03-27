/**
 * Branch Cache Service
 * Manages cached branch lists for projects stored in a JSON file
 * so that switching between projects preserves fetched branch lists.
 */

const fs = require('fs');
const path = require('path');

// Cache file path
const CACHE_DIR = path.join(__dirname, '../../data');
const CACHE_FILE = path.join(CACHE_DIR, 'project-branches.json');

/**
 * Validate project name to prevent prototype pollution
 * @param {string} name - The project name to validate
 * @returns {boolean} True if the name is valid
 */
function isValidProjectName(name) {
  return name && typeof name === 'string' && name !== '__proto__' && name !== 'constructor' && name !== 'prototype';
}

/**
 * Ensure the cache directory and file exist
 */
function ensureCacheFileExists() {
  // Create data directory if it doesn't exist
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  // Create cache file if it doesn't exist
  if (!fs.existsSync(CACHE_FILE)) {
    const initialCache = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      projects: {}
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(initialCache, null, 2), 'utf8');
  }
}

/**
 * Read all cached data from file
 * @returns {Object} All cached data
 */
function getAllCache() {
  try {
    ensureCacheFileExists();
    const content = fs.readFileSync(CACHE_FILE, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Failed to read branch cache file:', error);
    // Return default structure on error
    return {
      version: 1,
      lastUpdated: new Date().toISOString(),
      projects: {}
    };
  }
}

/**
 * Get cached branches for a specific project
 * @param {string} projectName - The project name
 * @returns {Object|null} Cached branch data { branches, currentBranch, lastUpdated } or null if not cached
 */
function getCachedBranches(projectName) {
  if (!isValidProjectName(projectName)) return null;
  try {
    const cache = getAllCache();
    const projectData = cache.projects[projectName];

    if (!projectData) {
      return null;
    }

    return {
      branches: projectData.branches || [],
      currentBranch: projectData.currentBranch || null,
      lastUpdated: projectData.lastUpdated || null
    };
  } catch (error) {
    console.error('Failed to get cached branches:', error);
    return null;
  }
}

/**
 * Save branches to cache for a specific project
 * @param {string} projectName - The project name
 * @param {Array} branches - Array of branch objects [{ name, current, type }]
 * @param {string} currentBranch - The current branch name
 * @returns {boolean} Success status
 */
function saveCachedBranches(projectName, branches, currentBranch) {
  if (!isValidProjectName(projectName)) return false;
  try {
    ensureCacheFileExists();

    // Read existing cache
    const cache = getAllCache();

    // Update the project's branch cache
    cache.projects[projectName] = {
      branches: branches || [],
      currentBranch: currentBranch || null,
      lastUpdated: new Date().toISOString()
    };

    // Update last updated timestamp
    cache.lastUpdated = new Date().toISOString();

    // Write to file
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');

    console.log(`Cached branches for project: ${projectName} (${(branches || []).length} branches)`);
    return true;
  } catch (error) {
    console.error('Failed to save cached branches:', error);
    return false;
  }
}

/**
 * Clear cached branches for a specific project
 * @param {string} projectName - The project name
 * @returns {boolean} Success status
 */
function clearCachedBranches(projectName) {
  if (!isValidProjectName(projectName)) return false;
  try {
    ensureCacheFileExists();

    const cache = getAllCache();

    if (cache.projects[projectName]) {
      delete cache.projects[projectName];
      cache.lastUpdated = new Date().toISOString();
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
      console.log(`Cleared branch cache for project: ${projectName}`);
    }

    return true;
  } catch (error) {
    console.error('Failed to clear cached branches:', error);
    return false;
  }
}

module.exports = {
  getCachedBranches,
  saveCachedBranches,
  clearCachedBranches
};
