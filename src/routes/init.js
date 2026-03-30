const express = require('express');
const path = require('path');
const fs = require('fs');
const workplaceService = require('../services/workplaceService');
const jdkService = require('../services/jdkService');
const config = require('../../config.json');

const router = express.Router();

const INIT_PASSWORD = config.initPassword || '1231231';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(req, res, next) {
  if (!UUID_REGEX.test(req.params.id)) {
    return res.status(400).json({ success: false, error: '无效的 ID 格式' });
  }
  next();
}

// Serve static files for init page
router.use('/css', express.static(path.join(__dirname, '../../public/css')));
router.use('/js', express.static(path.join(__dirname, '../../public/js')));

// Serve init page
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/init.html'));
});

/**
 * POST /api/verify-password - Verify password to access init page
 */
router.post('/api/verify-password', (req, res) => {
  const { password } = req.body;
  if (password === INIT_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(403).json({ success: false, error: '密码错误' });
  }
});

/**
 * GET /api/workplaces - List configured workplace paths
 */
router.get('/api/workplaces', (req, res) => {
  try {
    const paths = workplaceService.getWorkplacePaths();
    res.json({ success: true, paths });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/workplaces/scan - Scan a path for Android projects (preview)
 */
router.post('/api/workplaces/scan', (req, res) => {
  try {
    const { path: dirPath } = req.body;
    if (!dirPath) {
      return res.status(400).json({ success: false, error: '请提供路径' });
    }

    const projects = workplaceService.scanPath(dirPath);
    res.json({ success: true, path: dirPath, projects });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/workplaces/save - Save all configured paths
 */
router.post('/api/workplaces/save', (req, res) => {
  try {
    const { paths } = req.body;
    if (!Array.isArray(paths)) {
      return res.status(400).json({ success: false, error: 'paths 必须是数组' });
    }

    // Validate all paths exist
    const invalidPaths = paths.filter(p => {
      try {
        return !fs.existsSync(p);
      } catch (e) {
        return true;
      }
    });

    if (invalidPaths.length > 0) {
      return res.status(400).json({
        success: false,
        error: '以下路径不存在: ' + invalidPaths.join(', ')
      });
    }

    workplaceService.saveWorkplacePaths(paths);
    res.json({ success: true, message: '保存成功' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/workplaces/:index - Remove a path by index
 */
router.delete('/api/workplaces/:index', (req, res) => {
  try {
    const index = parseInt(req.params.index, 10);
    const paths = workplaceService.getWorkplacePaths();

    if (index < 0 || index >= paths.length) {
      return res.status(400).json({ success: false, error: '无效的索引' });
    }

    paths.splice(index, 1);
    workplaceService.saveWorkplacePaths(paths);
    res.json({ success: true, message: '删除成功', paths });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/jdks - List all configured JDKs
 */
router.get('/api/jdks', (req, res) => {
  try {
    const jdks = jdkService.getAllJdks();
    const defaultJdk = jdkService.getDefaultJdk();
    res.json({
      success: true,
      jdks,
      defaultId: defaultJdk ? defaultJdk.id : null
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/jdks/validate-path - Validate a JDK path before adding
 */
router.post('/api/jdks/validate-path', (req, res) => {
  try {
    const { jdkPath } = req.body;
    const result = jdkService.validateJdkPath(jdkPath);
    res.json(result);
  } catch (error) {
    res.status(500).json({ valid: false, error: error.message });
  }
});

/**
 * POST /api/jdks - Add a new JDK
 */
router.post('/api/jdks', (req, res) => {
  try {
    const { name, version, jdkPath } = req.body;
    const jdk = jdkService.addJdk({ name, version, jdkPath });
    res.json({ success: true, jdk });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/jdks/:id - Update an existing JDK
 */
router.put('/api/jdks/:id', validateUuid, (req, res) => {
  try {
    const { id } = req.params;
    const { name, version, jdkPath } = req.body;
    const jdk = jdkService.updateJdk(id, { name, version, jdkPath });
    res.json({ success: true, jdk });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/jdks/:id - Delete a JDK
 */
router.delete('/api/jdks/:id', validateUuid, (req, res) => {
  try {
    const { id } = req.params;
    jdkService.deleteJdk(id);
    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/jdks/:id/default - Set a JDK as default
 */
router.put('/api/jdks/:id/default', validateUuid, (req, res) => {
  try {
    const { id } = req.params;
    jdkService.setDefaultJdk(id);
    res.json({ success: true, message: '已设为默认' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

module.exports = router;
