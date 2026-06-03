const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../../config.json');
const gitService = require('./gitService');

/**
 * Get modules - Flutter projects always have a single 'app' module
 */
function getModules(projectPath) {
  return ['app'];
}

/**
 * Get build variants from android/<module>/build.gradle(.kts)
 * Combines productFlavors x buildTypes as flavorBuildType (e.g. mainlandDebug)
 */
function getVariants(projectPath, moduleName) {
  const variants = ['debug', 'release'];

  // Flutter projects have Android build files under android/ subdirectory
  const modulePath = path.join(projectPath, 'android', moduleName);
  const buildGradle = path.join(modulePath, 'build.gradle');
  const buildGradleKts = path.join(modulePath, 'build.gradle.kts');

  let content = '';
  if (fs.existsSync(buildGradle)) {
    content = fs.readFileSync(buildGradle, 'utf8');
  } else if (fs.existsSync(buildGradleKts)) {
    content = fs.readFileSync(buildGradleKts, 'utf8');
  } else {
    return variants;
  }

  const flavorsContent = extractBlock(content, 'productFlavors');
  if (!flavorsContent) {
    return variants;
  }

  const flavorNames = [];
  const flavorDimensions = new Map();
  const RESERVED = new Set(['create', 'if', 'else', 'when']);

  // Groovy-style: name { ... }
  const flavorBlockPattern = /(\w+)\s*\{/g;
  let blockMatch;
  while ((blockMatch = flavorBlockPattern.exec(flavorsContent)) !== null) {
    const name = blockMatch[1];
    if (RESERVED.has(name)) continue;

    const openBracePos = blockMatch.index + blockMatch[0].length - 1;
    const body = extractBlockFromPos(flavorsContent, openBracePos);
    if (body === null) continue;

    flavorNames.push(name);

    if (body) {
      const dimMatch = body.match(/dimension\s*[=]?\s*["'](\w+)["']/);
      if (dimMatch) {
        const dim = dimMatch[1];
        if (!flavorDimensions.has(dim)) {
          flavorDimensions.set(dim, []);
        }
        flavorDimensions.get(dim).push(name);
      }
    }
  }

  // Kotlin DSL: create("name") { ... }
  const kotlinCreatePattern = /create\s*\(\s*["'](\w+)["']\s*\)\s*\{/g;
  while ((blockMatch = kotlinCreatePattern.exec(flavorsContent)) !== null) {
    const name = blockMatch[1];
    if (flavorNames.includes(name)) continue;

    const openBracePos = blockMatch.index + blockMatch[0].length - 1;
    const body = extractBlockFromPos(flavorsContent, openBracePos);
    if (body === null) continue;

    flavorNames.push(name);
    if (body) {
      const dimMatch = body.match(/dimension\s*[=]?\s*["'](\w+)["']/);
      if (dimMatch) {
        const dim = dimMatch[1];
        if (!flavorDimensions.has(dim)) {
          flavorDimensions.set(dim, []);
        }
        flavorDimensions.get(dim).push(name);
      }
    }
  }

  if (flavorNames.length === 0) {
    return variants;
  }

  // Parse buildTypes
  let buildTypes = ['debug', 'release'];
  const typesContent = extractBlock(content, 'buildTypes');
  if (typesContent) {
    const parsedTypes = [];
    const typePattern = /(\w+)\s*\{/g;
    let typeMatch;
    while ((typeMatch = typePattern.exec(typesContent)) !== null) {
      const name = typeMatch[1];
      if (RESERVED.has(name) || name === 'getByName') continue;
      parsedTypes.push(name);
    }
    const kotlinTypePattern = /(?:getByName|create)\s*\(\s*["'](\w+)["']\s*\)/g;
    while ((typeMatch = kotlinTypePattern.exec(typesContent)) !== null) {
      if (!parsedTypes.includes(typeMatch[1])) {
        parsedTypes.push(typeMatch[1]);
      }
    }
    if (parsedTypes.length > 0) {
      buildTypes = parsedTypes;
    }
  }

  // Determine dimension order
  let dimensionOrder = [];
  // Match: flavorDimensions "dim1", "dim2" or flavorDimensions ["dim1", "dim2"] or flavorDimensions += "dim1"
  const dimDeclMatch = content.match(/flavorDimensions\s+(?:\+=|\[)?\s*((?:["'][^"']+["']\s*,?\s*)+)/);
  if (dimDeclMatch) {
    const dimNames = dimDeclMatch[1].match(/["']([^"']+)["']/g);
    if (dimNames) {
      dimensionOrder = dimNames.map(d => d.replace(/["']/g, ''));
    }
  }
  if (dimensionOrder.length === 0 && flavorDimensions.size > 0) {
    dimensionOrder = Array.from(flavorDimensions.keys());
  }

  // Auto-assign flavors without explicit dimension to the single declared dimension.
  // In Gradle, when only one flavorDimensions is declared, all flavors are automatically
  // assigned to that dimension even without an explicit `dimension "xxx"` in each block.
  if (dimensionOrder.length === 1) {
    const soleDim = dimensionOrder[0];
    if (!flavorDimensions.has(soleDim)) {
      flavorDimensions.set(soleDim, []);
    }
    const assigned = new Set(flavorDimensions.get(soleDim));
    for (const name of flavorNames) {
      if (!assigned.has(name)) {
        flavorDimensions.get(soleDim).push(name);
      }
    }
  }

  // Combine flavors x buildTypes
  if (dimensionOrder.length > 0) {
    const dimArrays = dimensionOrder.map(dim => flavorDimensions.get(dim) || []);
    if (dimArrays.some(arr => arr.length === 0)) {
      return variants;
    }
    const product = cartesianProduct(dimArrays);
    const result = [];
    for (const combo of product) {
      for (const type of buildTypes) {
        let name = combo[0];
        for (let i = 1; i < combo.length; i++) {
          name += combo[i].charAt(0).toUpperCase() + combo[i].slice(1);
        }
        name += type.charAt(0).toUpperCase() + type.slice(1);
        result.push(name);
      }
    }
    return result.length > 0 ? result : variants;
  } else {
    const result = [];
    for (const flavor of flavorNames) {
      for (const type of buildTypes) {
        result.push(`${flavor}${type.charAt(0).toUpperCase() + type.slice(1)}`);
      }
    }
    return result.length > 0 ? result : variants;
  }
}

/**
 * Get version info from pubspec.yaml
 * Parses version: 1.0.0+1 format
 */
function getVersion(projectPath) {
  const pubspecPath = path.join(projectPath, 'pubspec.yaml');

  if (!fs.existsSync(pubspecPath)) {
    return { versionCode: 1, versionName: '1.0.0' };
  }

  const content = fs.readFileSync(pubspecPath, 'utf8');

  const versionMatch = content.match(/^version:\s*(.+)$/m);
  if (!versionMatch) {
    return { versionCode: 1, versionName: '1.0.0' };
  }

  const versionStr = versionMatch[1].trim();
  const parts = versionStr.split('+');

  const versionName = parts[0];
  const versionCode = parts.length > 1 ? parseInt(parts[1], 10) : 1;

  return { versionCode: isNaN(versionCode) ? 1 : versionCode, versionName };
}

/**
 * Update version in pubspec.yaml
 * Writes version: 1.2.3+45 format
 */
function updateVersion(projectPath, versionCode, versionName, onLog) {
  const pubspecPath = path.join(projectPath, 'pubspec.yaml');

  if (!fs.existsSync(pubspecPath)) {
    onLog('[VERSION] pubspec.yaml not found');
    return false;
  }

  const content = fs.readFileSync(pubspecPath, 'utf8');

  onLog('[VERSION] ========================================');
  onLog('[VERSION] Updating version info...');
  onLog('[VERSION] ========================================');

  const lines = content.split('\n');
  let modified = false;

  const newLines = lines.map(line => {
    if (/^version:\s*.+/.test(line.trim())) {
      const oldVersion = line.trim();
      const newVersion = `version: ${versionName}+${versionCode}`;
      onLog(`[VERSION] ${oldVersion} -> ${newVersion}`);
      modified = true;
      return line.replace(/^(\s*version:\s*).+/, `$1${versionName}+${versionCode}`);
    }
    return line;
  });

  if (modified) {
    fs.writeFileSync(pubspecPath, newLines.join('\n'), 'utf8');
    onLog('[VERSION] Version updated successfully!');
    onLog('[VERSION] ========================================');
    return true;
  } else {
    onLog('[VERSION] No version line found, skipping update');
    onLog('[VERSION] ========================================');
    return true;
  }
}

/**
 * Run Flutter build with real-time output
 */
function runBuild(projectPath, branch, flavor, buildType, env, versionCode, versionName, useCache, onLog, onProcessCreated, isCancelled) {
  return new Promise(async (resolve, reject) => {
    const logs = [];

    try {
      // Initialize cleanup as no-op (will be replaced after gradle.properties is modified)
      let restoreGradleProps = () => {};

      // Step 1: Git sync
      onLog('[BUILD] ========================================');
      onLog('[BUILD] Starting build process...');
      onLog('[BUILD] ========================================');

      await gitService.syncForBuild(projectPath, branch, onLog);

      if (isCancelled && isCancelled()) {
        onLog('[BUILD] Build cancelled after git sync');
        return reject(new Error('Build cancelled'));
      }

      // Step 2: Update version
      updateVersion(projectPath, versionCode, versionName, onLog);

      if (isCancelled && isCancelled()) {
        onLog('[BUILD] Build cancelled after version update');
        return reject(new Error('Build cancelled'));
      }

      // Step 3: Switch env file (.env.dev / .env.prod -> .env)
      if (env) {
        if (typeof env !== 'string' || !/^[\w-]+$/.test(env)) {
          onLog('[ENV] Invalid env parameter format, skipping env switch');
        } else {
          onLog('[ENV] ========================================');
          onLog('[ENV] Switching environment file...');
          onLog('[ENV] ========================================');
          const envFromFile = path.join(projectPath, `.env.${env}`);
          const envToFile = path.join(projectPath, '.env');
          if (fs.existsSync(envFromFile)) {
            try {
              fs.copyFileSync(envFromFile, envToFile);
              onLog(`[ENV] Copied .env.${env} -> .env`);
              onLog('[ENV] ========================================');
            } catch (err) {
              onLog(`[ENV] Failed to copy env file: ${err.message}`);
              onLog('[ENV] ========================================');
            }
          } else {
            onLog(`[ENV] .env.${env} not found, skipping env switch`);
            onLog('[ENV] ========================================');
          }
        }
      }

      // Step 4: Prepare environment
      const buildEnv = { ...process.env };
      // Ensure System32 is in PATH (Flutter uses WHERE command internally which needs it)
      const system32 = 'C:\\Windows\\System32';
      const currentPath = buildEnv.PATH || buildEnv.Path || '';
      if (!currentPath.includes(system32)) {
        buildEnv.PATH = `${system32}${path.delimiter}${currentPath}`;
      }
      if (config.androidSdk) {
        buildEnv.ANDROID_HOME = config.androidSdk;
        buildEnv.ANDROID_SDK_ROOT = config.androidSdk;
      }

      // Step 4.2: Temporarily disable Android lint to prevent Windows file-lock issues
      // (antivirus or background processes may lock lint-cache jar files during Flutter's internal Gradle build)
      const gradlePropsPath = path.join(projectPath, 'android', 'gradle.properties');
      let origGradleProps = null;
      try {
        if (fs.existsSync(gradlePropsPath)) {
          origGradleProps = fs.readFileSync(gradlePropsPath, 'utf8');
        }
        fs.writeFileSync(gradlePropsPath, (origGradleProps || '') + '\nandroid.enableLint=false\n', 'utf8');
      } catch (e) {
        onLog(`[BUILD] Warning: Cannot update gradle.properties: ${e.message}`);
      }

      restoreGradleProps = () => {
        try {
          if (origGradleProps !== null) {
            fs.writeFileSync(gradlePropsPath, origGradleProps, 'utf8');
          } else if (fs.existsSync(gradlePropsPath)) {
            fs.unlinkSync(gradlePropsPath);
          }
        } catch (_) {
          // Ignore cleanup errors
        }
      };

      // Step 4.5: Clean build cache when useCache is false
      const isWindows = process.platform === 'win32';
      const flutterCmd = config.flutterSdk
        ? path.join(config.flutterSdk, 'bin', isWindows ? 'flutter.bat' : 'flutter')
        : 'flutter';

      if (useCache === false) {
        onLog('[BUILD] ========================================');
        onLog('[BUILD] Skipping cache (useCache=false), running flutter clean...');
        onLog('[BUILD] ========================================');

        const cleanResult = await spawnAsync(flutterCmd, ['clean'], projectPath, buildEnv, onLog);

        if (isCancelled && isCancelled()) {
          onLog('[BUILD] Build cancelled after clean');
          restoreGradleProps();
          return reject(new Error('Build cancelled'));
        }

        if (cleanResult !== 0) {
          onLog('[BUILD] flutter clean failed, continuing anyway...');
        } else {
          onLog('[BUILD] flutter clean completed successfully');
        }
      }

      // Step 5: Run flutter pub get to ensure dependencies are up to date after git sync
      onLog('[BUILD] ========================================');
      onLog('[BUILD] Running flutter pub get...');
      onLog('[BUILD] ========================================');

      const pubGetResult = await spawnAsync(flutterCmd, ['pub', 'get'], projectPath, buildEnv, onLog);

      if (isCancelled && isCancelled()) {
        onLog('[BUILD] Build cancelled after pub get');
        restoreGradleProps();
        return reject(new Error('Build cancelled'));
      }

      if (pubGetResult !== 0) {
        onLog('[BUILD] flutter pub get failed, attempting build anyway...');
      } else {
        onLog('[BUILD] flutter pub get completed successfully');
      }

      // Step 5.5: Check and generate i18n files (getx-cli)
      try {
        const pubspecPath = path.join(projectPath, 'pubspec.yaml');
        const pubspecContent = fs.readFileSync(pubspecPath, 'utf8');
        // Check if project uses getx (has 'get:' dependency)
        if (/\bget\s*:/.test(pubspecContent)) {
          onLog('[I18N] ========================================');
          onLog('[I18N] 检测到 getx 依赖，开始生成国际化文件...');
          onLog('[I18N] ========================================');

          // Try running the generate command directly; if get_cli is not installed, activate it first
          const generateResult = await spawnAsync(
            flutterCmd,
            ['pub', 'global', 'run', 'get_cli:get', 'generate', 'locales'],
            projectPath, buildEnv, onLog
          );

          if (generateResult !== 0) {
            onLog('[I18N] get_cli 可能未安装，尝试自动安装...');
            const activateResult = await spawnAsync(
              flutterCmd,
              ['pub', 'global', 'activate', 'get_cli'],
              projectPath, buildEnv, onLog
            );

            if (activateResult === 0) {
              onLog('[I18N] get_cli 安装成功，重新生成国际化文件...');
              await spawnAsync(
                flutterCmd,
                ['pub', 'global', 'run', 'get_cli:get', 'generate', 'locales'],
                projectPath, buildEnv, onLog
              );
            } else {
              onLog('[I18N] get_cli 安装失败，跳过国际化生成');
            }
          }

          onLog('[I18N] 国际化文件处理完毕');
        } else {
          onLog('[I18N] 未检测到 getx 依赖，跳过国际化生成');
        }
      } catch (i18nError) {
        onLog(`[I18N] 国际化生成过程出错: ${i18nError.message}，继续构建...`);
      }

      if (isCancelled && isCancelled()) {
        onLog('[BUILD] Build cancelled after i18n generation');
        restoreGradleProps();
        return reject(new Error('Build cancelled'));
      }

      // Step 6: Run flutter build
      onLog('[BUILD] ========================================');
      onLog('[BUILD] Starting Flutter build...');
      onLog('[BUILD] ========================================');

      onLog(`[BUILD] Flavor: ${flavor}, BuildType: ${buildType}`);
      onLog(`[BUILD] Version: ${versionName} (${versionCode})`);

      const flutterArgs = [
        'build',
        'apk',
      ];

      // Only pass --flavor when the project has productFlavors defined
      if (flavor) {
        flutterArgs.push(`--flavor=${flavor}`);
      }
      flutterArgs.push(
        `--${buildType}`,
        `--dart-define=env=${env}`,
        `--build-name=${versionName}`,
        `--build-number=${versionCode}`,
      );

      const proc = spawn(flutterCmd, flutterArgs, {
        cwd: projectPath,
        env: buildEnv,
        shell: true,
        windowsHide: true,
      });

      if (onProcessCreated) {
        onProcessCreated(proc);
      }

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        logs.push(text);
        if (onLog) onLog(text);
      });

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        logs.push(text);
        if (onLog) onLog(text);
      });

      proc.on('close', (code) => {
        restoreGradleProps();
        if (code === null) {
          logs.push('[WARN] Build cancelled');
          reject(new Error('Build cancelled'));
          return;
        }

        if (code !== 0) {
          logs.push(`[ERROR] Build failed with exit code: ${code}`);
          reject(new Error(`Build failed, exit code: ${code}`));
          return;
        }

        // Find APK
        let apkPath = null;

        // Try exact path first: app-<flavor>-<buildType>.apk or app-<buildType>.apk (no flavor)
        const apkFileName = flavor
          ? `app-${flavor}-${buildType}.apk`
          : `app-${buildType}.apk`;
        const exactApkPath = path.join(
          projectPath, 'build', 'app', 'outputs', 'flutter-apk',
          apkFileName
        );

        if (fs.existsSync(exactApkPath)) {
          apkPath = exactApkPath;
        }

        // Fall back to recursive search
        if (!apkPath) {
          const buildDir = path.join(projectPath, 'build', 'app', 'outputs', 'flutter-apk');
          if (fs.existsSync(buildDir)) {
            apkPath = findLatestApk(buildDir);
          }
        }

        if (!apkPath) {
          apkPath = findRecentApkInProject(projectPath, 5 * 60 * 1000);
        }

        if (!apkPath) {
          onLog('[WARN] APK file not found');
        }

        resolve({ success: true, logs, apkPath });
      });

      proc.on('error', (err) => {
        restoreGradleProps();
        logs.push(`[ERROR] ${err.message}`);
        reject(err);
      });

    } catch (error) {
      restoreGradleProps();
      onLog(`[BUILD] Build failed: ${error.message}`);
      reject(error);
    }
  });
}

// =============================================================================
// Helper functions (copied from gradleService.js)
// =============================================================================

/**
 * Extract a named block's content using brace-counting.
 */
function extractBlock(content, blockName) {
  const pattern = new RegExp(`(?:^|\\n)\\s*${blockName}\\s*\\{`);
  const match = pattern.exec(content);
  if (!match) return null;

  const openBracePos = match.index + match[0].length - 1;
  return extractBlockFromPos(content, openBracePos);
}

/**
 * Extract block content starting from an opening brace position.
 */
function extractBlockFromPos(content, openBracePos) {
  if (content[openBracePos] !== '{') return null;

  let depth = 0;
  let inString = false;
  let stringChar = '';

  for (let i = openBracePos; i < content.length; i++) {
    const ch = content[i];

    if (inString) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === stringChar) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return content.substring(openBracePos + 1, i);
      }
    }
  }

  return null;
}

/**
 * Compute Cartesian product of arrays
 */
function cartesianProduct(arrays) {
  return arrays.reduce((acc, arr) => {
    const result = [];
    for (const a of acc) {
      for (const b of arr) {
        result.push([...a, b]);
      }
    }
    return result;
  }, [[]]);
}

/**
 * Recursively find the most recently modified APK in a directory
 */
function findLatestApk(dir) {
  if (!fs.existsSync(dir)) return null;
  try {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) return null;
  } catch {
    return null;
  }

  let latestApk = null;
  let latestMtime = 0;

  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      const found = findLatestApk(fullPath);
      if (found) {
        const mtime = fs.statSync(found).mtimeMs;
        if (mtime > latestMtime) {
          latestApk = found;
          latestMtime = mtime;
        }
      }
    } else if (item.isFile() && item.name.endsWith('.apk')) {
      const mtime = item.mtimeMs;
      if (mtime > latestMtime) {
        latestApk = fullPath;
        latestMtime = mtime;
      }
    }
  }

  return latestApk;
}

/**
 * Find APK files modified within the specified time window anywhere in the project.
 */
function findRecentApkInProject(projectPath, maxAgeMs = 5 * 60 * 1000) {
  const now = Date.now();
  const cutoff = now - maxAgeMs;
  let latestApk = null;
  let latestMtime = 0;

  try {
    _findRecentApkRecursive(projectPath, cutoff, (apkPath, mtime) => {
      if (mtime > latestMtime) {
        latestApk = apkPath;
        latestMtime = mtime;
      }
    });
  } catch {
    // Ignore errors during recursive search
  }

  return latestApk;
}

function _findRecentApkRecursive(dir, cutoffMs, callback, depth = 0) {
  if (depth > 10 || !fs.existsSync(dir)) return;
  try {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) return;
  } catch {
    return;
  }

  const skipDirs = new Set([
    '.git', '.gradle', '.idea', 'gradle', 'buildSrc', 'node_modules',
    '.cxx', 'captures', '.externalNativeBuild', 'workspace', '.repo'
  ]);
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    if (items.length > 500) return;
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        if (skipDirs.has(item.name)) continue;
        _findRecentApkRecursive(fullPath, cutoffMs, callback, depth + 1);
      } else if (item.isFile() && item.name.endsWith('.apk')) {
        try {
          const mtime = fs.statSync(fullPath).mtimeMs;
          if (mtime >= cutoffMs) {
            callback(fullPath, mtime);
          }
        } catch {
          // Skip files we can't stat
        }
      }
    }
  } catch {
    // Ignore readdir errors
  }
}

/**
 * Spawn a process and return a promise that resolves with the exit code.
 */
function spawnAsync(cmd, args, cwd, env, onLog) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd,
      env,
      shell: true,
      windowsHide: true,
    });

    proc.stdout.on('data', (data) => {
      if (onLog) onLog(data.toString());
    });

    proc.stderr.on('data', (data) => {
      if (onLog) onLog(data.toString());
    });

    proc.on('close', (code) => {
      resolve(code);
    });

    proc.on('error', (err) => {
      if (onLog) onLog(`[ERROR] ${err.message}`);
      resolve(1);
    });
  });
}

/**
 * Get app name from pubspec.yaml or fall back to directory name
 */
function getAppName(projectPath) {
  const pubspecPath = path.join(projectPath, 'pubspec.yaml');
  if (!fs.existsSync(pubspecPath)) {
    return path.basename(projectPath);
  }
  try {
    const content = fs.readFileSync(pubspecPath, 'utf8');
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    if (!nameMatch) {
      return path.basename(projectPath);
    }
    return nameMatch[1].trim();
  } catch {
    return path.basename(projectPath);
  }
}

/**
 * Generate Flutter APK filename in unified format:
 *   {appName}_{env}_v{versionName}_{versionCode}_{buildType}_{yyyyMMddHHmm}.apk
 */
function generateFlutterFilename(appName, env, versionName, versionCode, buildType) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const HH = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const timestamp = `${yyyy}${MM}${dd}${HH}${mm}`;

  const safeAppName = String(appName || '').replace(/[^a-zA-Z0-9]/g, '');
  const safeEnv = (env && /^[\w-]+$/.test(env)) ? env : 'unknown';
  const safeVersionName = String(versionName || '').replace(/[^a-zA-Z0-9.]/g, '_');
  const safeVersionCode = String(versionCode || 0).replace(/[^a-zA-Z0-9]/g, '');
  const safeBuildType = (buildType && /^(debug|release)$/i.test(buildType)) ? buildType.toLowerCase() : 'release';

  return `${safeAppName}_${safeEnv}_v${safeVersionName}_${safeVersionCode}_${safeBuildType}_${timestamp}.apk`;
}

module.exports = {
  getModules,
  getVariants,
  getVersion,
  updateVersion,
  runBuild,
  getAppName,
  generateFlutterFilename,
};
