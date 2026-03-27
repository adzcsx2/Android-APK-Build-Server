const workplaceService = require('./workplaceService');

/**
 * Get all Android projects from all configured workplaces
 */
function getProjects() {
  return workplaceService.getAllProjects();
}

/**
 * Get project by name
 */
function getProjectByName(name) {
  return workplaceService.getProjectByName(name);
}

module.exports = {
  getProjects,
  getProjectByName
};
