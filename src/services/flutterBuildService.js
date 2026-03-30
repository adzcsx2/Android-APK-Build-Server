const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../../config.json');
const gitService = require('./gitService');
const gradleService = require('./gradleService');

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
function runBuild(projectPath, branch, flavor, buildType, env, versionCode, versionName, jdkVersion, onLog, onProcessCreated, isCancelled) {
  return new Promise(async (resolve, reject) => {
    const logs = [];

    try {
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

      // Step 3: Do NOT delete local.properties (Flutter Gradle plugin needs it)

      // Step 4: Prepare environment
      const projectName = path.basename(projectPath);
      const jdkPath = gradleService.getJdkPath(projectName, jdkVersion);

      const buildEnv = { ...process.env };
      // Ensure System32 is in PATH (Flutter uses WHERE command internally which needs it)
      const system32 = 'C:\\Windows\\System32';
      const currentPath = buildEnv.PATH || buildEnv.Path || '';
      if (!currentPath.includes(system32)) {
        buildEnv.PATH = `${system32}${path.delimiter}${currentPath}`;
      }
      if (jdkPath) {
        buildEnv.JAVA_HOME = jdkPath;
        buildEnv.PATH = `${path.join(jdkPath, 'bin')}${path.delimiter}${buildEnv.PATH || ''}`;
      }
      if (config.androidSdk) {
        buildEnv.ANDROID_HOME = config.androidSdk;
        buildEnv.ANDROID_SDK_ROOT = config.androidSdk;
      }

      // Step 5: Run build_runner to generate config.gen.dart (if needed)
      const configGenPath = path.join(projectPath, 'lib', 'config', 'config.gen.dart');
      if (!fs.existsSync(configGenPath)) {
        onLog('[BUILD] ========================================');
        onLog('[BUILD] config.gen.dart not found, running build_runner...');
        onLog('[BUILD] ========================================');

        const isWindows = process.platform === 'win32';
        const flutterCmd = config.flutterSdk
          ? path.join(config.flutterSdk, 'bin', isWindows ? 'flutter.bat' : 'flutter')
          : 'flutter';

        const runnerArgs = ['pub', 'run', 'build_runner', 'build', '--delete-conflicting-outputs'];
        const buildRunnerResult = await spawnAsync(flutterCmd, runnerArgs, projectPath, buildEnv, onLog);

        if (isCancelled && isCancelled()) {
          onLog('[BUILD] Build cancelled after build_runner');
          return reject(new Error('Build cancelled'));
        }

        if (buildRunnerResult !== 0) {
          onLog('[BUILD] build_runner failed, skipping...');
        } else {
          onLog('[BUILD] build_runner completed successfully');
        }
      }

      // Step 6: Run flutter build
      onLog('[BUILD] ========================================');
      onLog('[BUILD] Starting Flutter build...');
      onLog('[BUILD] ========================================');

      onLog(`[BUILD] JAVA_HOME: ${jdkPath || 'default'}`);
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
        logs.push(`[ERROR] ${err.message}`);
        reject(err);
      });

    } catch (error) {
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

module.exports = {
  getModules,
  getVariants,
  getVersion,
  updateVersion,
  runBuild,
};
