const express = require('express');
const projectService = require('../services/projectService');
const gradleService = require('../services/gradleService');
const flutterBuildService = require('../services/flutterBuildService');
const buildQueue = require('../services/buildQueue');
const apkService = require('../services/apkService');
const buildLogService = require('../services/buildLogService');
const sse = require('../utils/sse');

const router = express.Router();

// Map of buildId -> res for SSE connections waiting in queue
const waitingSSE = new Map();

/**
 * Execute a build and stream results via SSE
 * @param {string} buildId - Build ID
 * @param {express.Response|null} res - SSE response object, or null for background execution
 */
async function executeBuild(buildId, res) {
  const build = buildQueue.getBuild(buildId);
  if (!build) return;

  const project = projectService.getProjectByName(build.projectName);
  if (!project) {
    buildQueue.failBuild(buildId, '项目不存在');
    if (res && !res.writableEnded) {
      sse.sendError(res, '项目不存在');
      res.end();
    }
    return;
  }

  try {
    let result;
    if (project.type === 'flutter') {
      result = await flutterBuildService.runBuild(
        project.path,
        build.branch,
        build.flavor,
        build.buildType,
        build.env,
        build.versionCode,
        build.versionName,
        build.jdkVersion,
        (log) => {
          buildQueue.addLog(buildId, log);
          if (res && !res.writableEnded) {
            sse.sendLog(res, log);
          }
        },
        (proc) => {
          buildQueue.registerBuildProcess(buildId, proc);
        },
        () => buildQueue.isBuildCancelled(buildId)
      );
    } else {
      result = await gradleService.runBuild(
        project.path,
        build.branch,
        build.moduleName,
        build.variant,
        build.versionCode,
        build.versionName,
        build.jdkVersion,
        build.useCache,
        (log) => {
          buildQueue.addLog(buildId, log);
          if (res && !res.writableEnded) {
            sse.sendLog(res, log);
          }
        },
        (proc) => {
          buildQueue.registerBuildProcess(buildId, proc);
        },
        () => buildQueue.isBuildCancelled(buildId)
      );
    }

    const currentBuild = buildQueue.getBuild(buildId);
    if (currentBuild && currentBuild.status === 'cancelled') {
      if (res && !res.writableEnded) {
        sse.sendError(res, '构建已取消');
        res.end();
      }
      return;
    }

    if (result.success && result.apkPath) {
      const apkInfo = apkService.copyApk(
        result.apkPath,
        build.projectName,
        build.moduleName,
        build.variant,
        build.versionName
      );

      buildQueue.completeBuild(buildId, apkInfo.url);
      if (res && !res.writableEnded) {
        sse.sendComplete(res, { apkUrl: apkInfo.url, filename: apkInfo.filename });
        res.end();
      }
    } else {
      buildQueue.failBuild(buildId, '构建失败');
      if (res && !res.writableEnded) {
        sse.sendError(res, '构建失败');
        res.end();
      }
    }
  } catch (error) {
    const currentBuild = buildQueue.getBuild(buildId);
    if (currentBuild && currentBuild.status === 'cancelled') {
      if (res && !res.writableEnded) {
        sse.sendError(res, '构建已取消');
        res.end();
      }
    } else {
      buildQueue.failBuild(buildId, error.message);
      if (res && !res.writableEnded) {
        sse.sendError(res, error.message);
        res.end();
      }
    }
  }
}

// Register callback to start pending builds when a slot opens
buildQueue.setOnSlotAvailable((nextBuildId) => {
  // Atomic check-and-start to prevent race conditions
  if (!buildQueue.tryStartBuild(nextBuildId)) return;

  // If there's a waiting SSE connection for this build, use it
  const waitingRes = waitingSSE.get(nextBuildId);
  if (waitingRes && !waitingRes.writableEnded) {
    waitingSSE.delete(nextBuildId);
    sse.sendStatus(waitingRes, 'building', { message: '开始构建...' });
    executeBuild(nextBuildId, waitingRes).catch(err => {
      console.error('Background build execution error:', err);
    });
  } else {
    waitingSSE.delete(nextBuildId);
    // No waiting SSE connection - execute in background (client can reconnect later)
    executeBuild(nextBuildId, null).catch(err => {
      console.error('Background build execution error:', err);
    });
  }
});

/**
 * POST /api/build - Start a new build
 */
router.post('/build', async (req, res) => {
  try {
    const { projectName, branch, moduleName, variant, versionCode, versionName, jdkVersion, useCache, env } = req.body;

    if (!projectName || !branch || !moduleName || !variant) {
      return res.status(400).json({ success: false, error: '缺少必要参数' });
    }

    // Validate jdkVersion if provided
    const VALID_JDK_VERSIONS = [8, 11, 17, 21];
    let validatedJdkVersion = null;
    if (jdkVersion != null) {
      const parsed = parseInt(jdkVersion, 10);
      if (isNaN(parsed) || !VALID_JDK_VERSIONS.includes(parsed)) {
        return res.status(400).json({ success: false, error: '无效的 JDK 版本' });
      }
      validatedJdkVersion = parsed;
    }

    const project = projectService.getProjectByName(projectName);
    if (!project) {
      return res.status(404).json({ success: false, error: '项目不存在' });
    }

    let buildId;
    if (project.type === 'flutter') {
      // Flutter projects require env parameter
      if (!env) {
        return res.status(400).json({ success: false, error: 'Flutter 项目需要指定 env 参数' });
      }
      if (!/^[\w-]+$/.test(env)) {
        return res.status(400).json({ success: false, error: 'env 参数格式无效' });
      }

      // Validate variant using flutterBuildService
      const availableVariants = flutterBuildService.getVariants(project.path, moduleName);
      const validVariant = availableVariants.find(v =>
        v.toLowerCase() === variant.toLowerCase()
      );
      if (!validVariant) {
        return res.status(400).json({
          success: false,
          error: `变体 "${variant}" 不存在，可用变体: ${availableVariants.join(', ')}`
        });
      }

      // Parse flavor+buildType from variant (e.g. "mainlandRelease" -> flavor="mainland", buildType="release")
      const buildTypeMatch = validVariant.match(/(debug|release)$/i);
      const buildType = buildTypeMatch ? buildTypeMatch[1].toLowerCase() : 'release';
      const flavor = buildTypeMatch ? validVariant.substring(0, validVariant.length - buildTypeMatch[1].length) : validVariant;

      buildId = buildQueue.createBuild(projectName, branch, moduleName, validVariant, versionCode, versionName, validatedJdkVersion, useCache !== false, env);

      // Store parsed flavor and buildType on the build object for executeBuild
      buildQueue.updateBuild(buildId, { flavor, buildType });
    } else {
      // Validate variant exists in the project
      const availableVariants = gradleService.getVariants(project.path, moduleName);
      const validVariant = availableVariants.find(v =>
        v.toLowerCase() === variant.toLowerCase()
      );
      if (!validVariant) {
        return res.status(400).json({
          success: false,
          error: `变体 "${variant}" 不存在，可用变体: ${availableVariants.join(', ')}`
        });
      }

      // Create build task (include branch and jdkVersion, use canonical variant casing)
      buildId = buildQueue.createBuild(projectName, branch, moduleName, validVariant, versionCode, versionName, validatedJdkVersion, useCache !== false, null);
    }

    res.json({ success: true, buildId });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/build/:id/logs - SSE stream for build logs
 */
router.get('/build/:id/logs', async (req, res) => {
  const buildId = req.params.id;
  const build = buildQueue.getBuild(buildId);

  if (!build) {
    return res.status(404).json({ success: false, error: '构建任务不存在' });
  }

  // Setup SSE
  sse.setupSSE(res);

  // Send initial status
  sse.sendStatus(res, build.status, { build });

  // If already completed
  if (build.status === 'completed') {
    sse.sendComplete(res, { apkUrl: build.apkUrl });
    return res.end();
  }

  // If already failed
  if (build.status === 'failed') {
    sse.sendError(res, build.error || '构建失败');
    return res.end();
  }

  // If already building, just wait for completion via polling
  if (build.status === 'building') {
    let pollInterval = setInterval(() => {
      const currentBuild = buildQueue.getBuild(buildId);
      if (!currentBuild || ['completed', 'failed', 'cancelled'].includes(currentBuild.status)) {
        clearInterval(pollInterval);
        pollInterval = null;
        if (currentBuild && !res.writableEnded) {
          if (currentBuild.status === 'completed') {
            sse.sendComplete(res, { apkUrl: currentBuild.apkUrl });
          } else if (currentBuild.status === 'cancelled') {
            sse.sendError(res, '构建已取消');
          } else {
            sse.sendError(res, currentBuild.error || '构建失败');
          }
          res.end();
        }
      }
    }, 2000);

    req.on('close', () => {
      if (pollInterval) clearInterval(pollInterval);
      waitingSSE.delete(buildId);
    });
    return;
  }

  // Build is pending
  if (build.status === 'pending') {
    // Atomically try to start the build (prevents race with onSlotAvailable)
    if (buildQueue.tryStartBuild(buildId)) {
      sse.sendStatus(res, 'building', { message: '开始构建...' });
      await executeBuild(buildId, res);
    } else {
      // No slot available - queue and wait
      sse.sendStatus(res, 'queued', { message: '等待队列中...' });
      waitingSSE.set(buildId, res);

      let pollInterval = setInterval(() => {
        const currentBuild = buildQueue.getBuild(buildId);
        if (!currentBuild) {
          clearInterval(pollInterval);
          pollInterval = null;
          waitingSSE.delete(buildId);
          if (!res.writableEnded) {
            sse.sendError(res, '构建任务不存在');
            res.end();
          }
          return;
        }

        // If the onSlotAvailable callback already started this build
        if (currentBuild.status === 'building') {
          clearInterval(pollInterval);
          pollInterval = null;
          waitingSSE.delete(buildId);
          // Poll for completion
          let completionPoll = setInterval(() => {
            const cb = buildQueue.getBuild(buildId);
            if (!cb || ['completed', 'failed', 'cancelled'].includes(cb.status)) {
              clearInterval(completionPoll);
              completionPoll = null;
              if (cb && !res.writableEnded) {
                if (cb.status === 'completed') {
                  sse.sendComplete(res, { apkUrl: cb.apkUrl });
                } else if (cb.status === 'cancelled') {
                  sse.sendError(res, '构建已取消');
                } else {
                  sse.sendError(res, cb.error || '构建失败');
                }
                res.end();
              }
            }
          }, 2000);
          req.on('close', () => {
            if (completionPoll) clearInterval(completionPoll);
          });
          return;
        }

        if (['completed', 'failed', 'cancelled'].includes(currentBuild.status)) {
          clearInterval(pollInterval);
          pollInterval = null;
          waitingSSE.delete(buildId);
          if (!res.writableEnded) {
            if (currentBuild.status === 'completed') {
              sse.sendComplete(res, { apkUrl: currentBuild.apkUrl });
            } else if (currentBuild.status === 'cancelled') {
              sse.sendError(res, '构建已取消');
            } else {
              sse.sendError(res, currentBuild.error || '构建失败');
            }
            res.end();
          }
        }
      }, 2000);

      req.on('close', () => {
        if (pollInterval) clearInterval(pollInterval);
        waitingSSE.delete(buildId);
      });
    }
  }
});

/**
 * GET /api/build/:id/status - Get build status
 */
router.get('/build/:id/status', (req, res) => {
  const build = buildQueue.getBuild(req.params.id);

  if (!build) {
    return res.status(404).json({ success: false, error: '构建任务不存在' });
  }

  res.json({ success: true, build });
});

/**
 * GET /api/builds - List all builds
 */
router.get('/builds', (req, res) => {
  const builds = buildQueue.getAllBuilds();
  res.json({ success: true, builds });
});

/**
 * GET /api/builds/active - Get active builds
 */
router.get('/builds/active', (req, res) => {
  try {
    const activeBuilds = buildQueue.getActiveBuilds();
    res.json({ success: true, builds: activeBuilds });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/builds/history - Get all build history from persistent storage
 */
router.get('/builds/history', (req, res) => {
  try {
    const history = buildQueue.getRecentBuilds();
    res.json({ success: true, builds: history });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/build/:id - Cancel a build
 */
router.delete('/build/:id', (req, res) => {
  try {
    const buildId = req.params.id;
    const cancelled = buildQueue.cancelBuild(buildId);

    if (cancelled) {
      res.json({ success: true, message: 'Build cancelled' });
    } else {
      res.status(400).json({
        success: false,
        error: 'Cannot cancel build (not found or already completed)'
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/builds/:id - Delete a build record from history
 */
router.delete('/builds/:id', (req, res) => {
  try {
    const buildId = req.params.id;
    const deleted = buildQueue.deleteBuild(buildId);

    if (deleted) {
      res.json({ success: true, message: 'Build record deleted' });
    } else {
      res.status(404).json({ success: false, error: '构建记录不存在' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/apks - List all APKs
 */
router.get('/apks', (req, res) => {
  const apks = apkService.listApks();
  res.json({ success: true, apks });
});

/**
 * DELETE /api/apks/:filename - Delete an APK
 */
router.delete('/apks/:filename', (req, res) => {
  const deleted = apkService.deleteApk(req.params.filename);
  if (deleted) {
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: 'APK不存在' });
  }
});

/**
 * GET /api/build-logs/:projectName - Get build log for a project (legacy)
 */
router.get('/build-logs/:projectName', (req, res) => {
  try {
    const { projectName } = req.params;
    const decodedName = decodeURIComponent(projectName);

    const project = projectService.getProjectByName(decodedName);
    if (!project) {
      return res.status(404).json({ success: false, error: '项目不存在' });
    }

    const result = buildLogService.readLog(decodedName);
    res.json({
      success: true,
      content: result.content,
      totalSize: result.totalSize,
      trimmed: result.trimmed,
      sizeDisplay: buildLogService.formatBytes(result.totalSize)
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/build-logs/:projectName/poll - Poll new log content from disk (for real-time updates, legacy)
 */
router.get('/build-logs/:projectName/poll', (req, res) => {
  try {
    const { projectName } = req.params;
    const decodedName = decodeURIComponent(projectName);
    const offset = parseInt(req.query.offset, 10) || 0;

    const project = projectService.getProjectByName(decodedName);
    if (!project) {
      return res.status(404).json({ success: false, error: '项目不存在' });
    }

    const result = buildLogService.readLogFromOffset(decodedName, offset);
    res.json({
      success: true,
      content: result.content,
      totalSize: result.totalSize,
      offset: result.offset,
      eof: result.eof
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/build-logs/:projectName/:buildId - Get log for a specific build
 */
router.get('/build-logs/:projectName/:buildId', (req, res) => {
  try {
    const { projectName, buildId } = req.params;
    const decodedName = decodeURIComponent(projectName);

    const project = projectService.getProjectByName(decodedName);
    if (!project) {
      return res.status(404).json({ success: false, error: '项目不存在' });
    }

    const result = buildLogService.readBuildLog(decodedName, buildId);
    res.json({
      success: true,
      content: result.content,
      totalSize: result.totalSize,
      trimmed: result.trimmed
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/build-logs/:projectName/:buildId/poll - Poll new log content for a specific build
 */
router.get('/build-logs/:projectName/:buildId/poll', (req, res) => {
  try {
    const { projectName, buildId } = req.params;
    const decodedName = decodeURIComponent(projectName);
    const offset = parseInt(req.query.offset, 10) || 0;

    const project = projectService.getProjectByName(decodedName);
    if (!project) {
      return res.status(404).json({ success: false, error: '项目不存在' });
    }

    const result = buildLogService.readBuildLogFromOffset(decodedName, buildId, offset);
    res.json({
      success: true,
      content: result.content,
      totalSize: result.totalSize,
      offset: result.offset,
      eof: result.eof
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/build-logs-size - Get log sizes for all projects
 */
router.get('/build-logs-size', (req, res) => {
  try {
    const projects = buildLogService.getLoggedProjects();
    const sizes = {};
    for (const p of projects) {
      sizes[p] = buildLogService.getLogSize(p);
    }
    res.json({ success: true, projects: sizes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/build-logs/:projectName - Clear logs for a specific project
 */
router.delete('/build-logs/:projectName', (req, res) => {
  try {
    const { projectName } = req.params;
    const decodedName = decodeURIComponent(projectName);

    const project = projectService.getProjectByName(decodedName);
    if (!project) {
      return res.status(404).json({ success: false, error: '项目不存在' });
    }

    const success = buildLogService.clearProjectLogs(decodedName);
    if (success) {
      res.json({ success: true, message: '日志已清除' });
    } else {
      res.status(500).json({ success: false, error: '清除失败' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/build-logs - Clear ALL logs
 */
router.delete('/build-logs', (req, res) => {
  try {
    const success = buildLogService.clearAllLogs();
    if (success) {
      res.json({ success: true, message: '所有日志已清除' });
    } else {
      res.status(500).json({ success: false, error: '清除失败' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
