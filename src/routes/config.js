/**
 * Configuration API Routes
 * Handles project configuration CRUD operations
 */

const express = require('express');
const router = express.Router();
const configService = require('../services/configService');
const jdkService = require('../services/jdkService');
const serverConfig = require('../../config.json');

/**
 * GET /api/config/:projectName
 * Get configuration for a specific project
 */
router.get('/config/:projectName', (req, res) => {
  const { projectName } = req.params;

  if (!projectName) {
    return res.status(400).json({
      success: false,
      error: 'Project name is required'
    });
  }

  try {
    const config = configService.getProjectConfig(decodeURIComponent(projectName));

    res.json({
      success: true,
      config: config
    });
  } catch (error) {
    console.error('Failed to get project config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load configuration'
    });
  }
});

/**
 * POST /api/config/:projectName
 * Save configuration for a specific project
 */
router.post('/config/:projectName', (req, res) => {
  const { projectName } = req.params;
  const config = req.body;

  if (!projectName) {
    return res.status(400).json({
      success: false,
      error: 'Project name is required'
    });
  }

  if (!config || typeof config !== 'object') {
    return res.status(400).json({
      success: false,
      error: 'Invalid configuration data'
    });
  }

  try {
    const success = configService.saveProjectConfig(
      decodeURIComponent(projectName),
      config
    );

    if (success) {
      res.json({
        success: true,
        message: 'Configuration saved successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to save configuration'
      });
    }
  } catch (error) {
    console.error('Failed to save project config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save configuration'
    });
  }
});

/**
 * DELETE /api/config/:projectName
 * Delete configuration for a specific project
 */
router.delete('/config/:projectName', (req, res) => {
  const { projectName } = req.params;

  if (!projectName) {
    return res.status(400).json({
      success: false,
      error: 'Project name is required'
    });
  }

  try {
    const success = configService.deleteProjectConfig(decodeURIComponent(projectName));

    if (success) {
      res.json({
        success: true,
        message: 'Configuration deleted successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to delete configuration'
      });
    }
  } catch (error) {
    console.error('Failed to delete project config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete configuration'
    });
  }
});

/**
 * GET /api/jdk-versions
 * Get available JDK versions from config
 */
router.get('/jdk-versions', (req, res) => {
  try {
    const jdks = jdkService.getAllJdks();
    const defaultJdk = jdkService.getDefaultJdk();
    const availableVersions = jdks.map(j => ({
      version: j.version,
      label: j.name
    }));
    availableVersions.sort((a, b) => a.version - b.version);

    res.json({
      success: true,
      versions: availableVersions,
      defaultVersion: defaultJdk ? defaultJdk.version : null
    });
  } catch (error) {
    console.error('Failed to get JDK versions:', error);
    res.status(500).json({ success: false, error: 'Failed to get JDK versions' });
  }
});

module.exports = router;
