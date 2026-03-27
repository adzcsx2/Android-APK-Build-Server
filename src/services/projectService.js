const fs = require('fs');
const path = require('path');
const config = require('../../config.json');

const workplacePath = config.workplace.path;

/**
 * Check if directory is an Android project
 */
function isAndroidProject(dirPath) {
  const settingsGradle = path.join(dirPath, 'settings.gradle');
  const settingsGradleKts = path.join(dirPath, 'settings.gradle.kts');
  return fs.existsSync(settingsGradle) || fs.existsSync(settingsGradleKts);
}

/**
 * Get all Android projects from workplace (Flutter projects are excluded)
 */
function getProjects() {
  const projects = [];

  if (!fs.existsSync(workplacePath)) {
    return projects;
  }

  const entries = fs.readdirSync(workplacePath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const projectPath = path.join(workplacePath, entry.name);

    if (isAndroidProject(projectPath)) {
      projects.push({
        name: entry.name,
        path: projectPath,
        type: 'android'
      });
    }
  }

  return projects;
}

/**
 * Get project by name
 */
function getProjectByName(name) {
  const projects = getProjects();
  return projects.find(p => p.name === name);
}

module.exports = {
  getProjects,
  getProjectByName
};
