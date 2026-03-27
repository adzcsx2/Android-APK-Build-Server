const express = require('express');
const projectService = require('../services/projectService');
const gitService = require('../services/gitService');
const gradleService = require('../services/gradleService');
const branchCacheService = require('../services/branchCacheService');

const router = express.Router();

/**
 * GET /api/projects - List all Android projects
 */
router.get('/projects', (req, res) => {
  try {
    const projects = projectService.getProjects();
    res.json({ success: true, projects });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/projects/:name/branches - List branches for a project
 */
router.get('/projects/:name/branches', (req, res) => {
  try {
    const project = projectService.getProjectByName(req.params.name);
    if (!project) {
      return res.status(404).json({ success: false, error: '项目不存在' });
    }

    const branches = gitService.getBranches(project.path);
    const currentBranch = gitService.getCurrentBranch(project.path);

    // Cache the fetched branches for fast project switching
    branchCacheService.saveCachedBranches(req.params.name, branches, currentBranch);

    res.json({ success: true, branches, currentBranch });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/projects/:name/branches/cached - Get cached branches for a project (no git operation)
 */
router.get('/projects/:name/branches/cached', (req, res) => {
  try {
    const project = projectService.getProjectByName(req.params.name);
    if (!project) {
      return res.status(404).json({ success: false, error: '项目不存在' });
    }

    const cached = branchCacheService.getCachedBranches(req.params.name);

    if (!cached) {
      return res.json({ success: true, branches: [], currentBranch: null, cached: false });
    }

    res.json({
      success: true,
      branches: cached.branches,
      currentBranch: cached.currentBranch,
      cached: true,
      lastUpdated: cached.lastUpdated
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/projects/:name/branch-log - Get recent commit logs for a branch
 */
router.get('/projects/:name/branch-log', (req, res) => {
  try {
    const { branch } = req.query;
    if (!branch) {
      return res.status(400).json({ success: false, error: '请指定分支' });
    }

    // Validate branch name format (defense-in-depth)
    if (!/^[a-zA-Z0-9_\-./#@]+$/.test(branch) || branch.length > 200) {
      return res.status(400).json({ success: false, error: '分支名包含非法字符' });
    }

    const project = projectService.getProjectByName(req.params.name);
    if (!project) {
      return res.status(404).json({ success: false, error: '项目不存在' });
    }

    let count = parseInt(req.query.count, 10) || 3;
    count = Math.max(1, Math.min(count, 10));
    const logs = gitService.getBranchLog(project.path, branch, count);
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/projects/:name/git/sync - Sync repository
 */
router.post('/projects/:name/git/sync', async (req, res) => {
  try {
    const { branch } = req.body;
    if (!branch) {
      return res.status(400).json({ success: false, error: '请指定分支' });
    }

    const project = projectService.getProjectByName(req.params.name);
    if (!project) {
      return res.status(404).json({ success: false, error: '项目不存在' });
    }

    const result = await gitService.syncRepository(project.path, branch);
    res.json({ success: true, logs: result.logs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/projects/:name/modules - List modules for a project
 */
router.get('/projects/:name/modules', (req, res) => {
  try {
    const project = projectService.getProjectByName(req.params.name);
    if (!project) {
      return res.status(404).json({ success: false, error: '项目不存在' });
    }

    const modules = gradleService.getModules(project.path);
    res.json({ success: true, modules });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/projects/:name/modules/:module/variants - List variants for a module
 */
router.get('/projects/:name/modules/:module/variants', (req, res) => {
  try {
    const project = projectService.getProjectByName(req.params.name);
    if (!project) {
      return res.status(404).json({ success: false, error: '项目不存在' });
    }

    const variants = gradleService.getVariants(project.path, req.params.module);
    res.json({ success: true, variants });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/projects/:name/modules/:module/version - Get version info
 */
router.get('/projects/:name/modules/:module/version', (req, res) => {
  try {
    const project = projectService.getProjectByName(req.params.name);
    if (!project) {
      return res.status(404).json({ success: false, error: '项目不存在' });
    }

    const version = gradleService.getVersion(project.path, req.params.module);
    res.json({ success: true, version });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
