const express = require('express');
const path = require('path');
const fs = require('fs');
const workplaceService = require('../services/workplaceService');
const config = require('../../config.json');

const router = express.Router();

const INIT_PASSWORD = config.initPassword || '1231231';

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

module.exports = router;
