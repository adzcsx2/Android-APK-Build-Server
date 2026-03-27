/**
 * Configuration API Routes
 * Handles project configuration CRUD operations
 */

const express = require('express');
const router = express.Router();
const configService = require('../services/configService');
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
    const jdkConfig = serverConfig.jdk || {};
    const availableVersions = [];

    const versionMap = {
      'jdk8': 8,
      'jdk11': 11,
      'jdk17': 17,
      'jdk21': 21
    };

    for (const [key, jdkPath] of Object.entries(jdkConfig)) {
      if (jdkPath && typeof jdkPath === 'string' && jdkPath.trim() !== '') {
        const version = versionMap[key];
        if (version) {
          availableVersions.push({ version, key, label: `Java ${version}` });
        }
      }
    }

    availableVersions.sort((a, b) => a.version - b.version);

    res.json({ success: true, versions: availableVersions });
  } catch (error) {
    console.error('Failed to get JDK versions:', error);
    res.status(500).json({ success: false, error: 'Failed to get JDK versions' });
  }
});

module.exports = router;
