const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../../data/workplace-configs.json');
const ROOT_CONFIG = path.join(__dirname, '../../config.json');

// In-memory cache for project list to avoid repeated filesystem scans
const PROJECT_CACHE = {
  data: null,
  timestamp: 0,
  ttl: 5000 // 5 seconds
};

/**
 * Ensure data directory and config file exist.
 * Auto-migrate from config.json workplace.path on first run.
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
  let initialPaths = [];
  try {
    const rootConfig = JSON.parse(fs.readFileSync(ROOT_CONFIG, 'utf8'));
    if (rootConfig.workplace && rootConfig.workplace.path) {
      initialPaths = [rootConfig.workplace.path];
    }
  } catch (e) {
    // ignore
  }

  saveWorkplacePaths(initialPaths);
}

/**
 * Get configured workplace paths
 */
function getWorkplacePaths() {
  ensureConfigFileExists();
  const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  return data.paths || [];
}

/**
 * Save workplace paths to disk and invalidate project cache
 */
function saveWorkplacePaths(paths) {
  PROJECT_CACHE.data = null;
  PROJECT_CACHE.timestamp = 0;
  const data = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    paths: paths
  };
  const dataDir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Check if directory is an Android project (exclude Flutter)
 */
function isAndroidProject(dirPath) {
  const settingsGradle = path.join(dirPath, 'settings.gradle');
  const settingsGradleKts = path.join(dirPath, 'settings.gradle.kts');
  const pubspecYaml = path.join(dirPath, 'pubspec.yaml');

  const hasSettings = fs.existsSync(settingsGradle) || fs.existsSync(settingsGradleKts);
  const isFlutter = fs.existsSync(pubspecYaml);

  return hasSettings && !isFlutter;
}

/**
 * Scan one directory for Android projects
 */
function scanPath(dirPath) {
  const projects = [];

  if (!fs.existsSync(dirPath)) {
    return projects;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const projectPath = path.join(dirPath, entry.name);

    if (isAndroidProject(projectPath)) {
      projects.push({
        name: entry.name,
        path: projectPath,
        type: 'android',
        workplacePath: dirPath
      });
    }
  }

  return projects;
}

/**
 * Get all Android projects from all configured paths (with cache)
 */
function getAllProjects() {
  const now = Date.now();
  if (PROJECT_CACHE.data && (now - PROJECT_CACHE.timestamp) < PROJECT_CACHE.ttl) {
    return PROJECT_CACHE.data;
  }

  ensureConfigFileExists();
  const paths = getWorkplacePaths();
  let allProjects = [];

  for (const p of paths) {
    const projects = scanPath(p);
    allProjects = allProjects.concat(projects);
  }

  PROJECT_CACHE.data = allProjects;
  PROJECT_CACHE.timestamp = now;
  return allProjects;
}

/**
 * Get project by name (search across all paths)
 */
function getProjectByName(name) {
  const projects = getAllProjects();
  return projects.find(p => p.name === name);
}

module.exports = {
  getWorkplacePaths,
  saveWorkplacePaths,
  isAndroidProject,
  scanPath,
  getAllProjects,
  getProjectByName,
  ensureConfigFileExists
};
