const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const config = require('../../config.json');
const gitService = require('./gitService');
const jdkService = require('./jdkService');

/**
 * Get modules from settings.gradle or settings.gradle.kts
 */
function getModules(projectPath) {
  const modules = ['app']; // Default module

  const settingsGradle = path.join(projectPath, 'settings.gradle');
  const settingsGradleKts = path.join(projectPath, 'settings.gradle.kts');

  let content = '';
  if (fs.existsSync(settingsGradle)) {
    content = fs.readFileSync(settingsGradle, 'utf8');
  } else if (fs.existsSync(settingsGradleKts)) {
    content = fs.readFileSync(settingsGradleKts, 'utf8');
  } else {
    return modules;
  }

  const foundModules = new Set();

  // Match each include statement line-by-line to avoid cross-line matching.
  const includeLineRegex = /^[\s]*include[\s]*[\(]?\s*(.+?)\s*\)?\s*$/gim;
  let lineMatch;
  while ((lineMatch = includeLineRegex.exec(content)) !== null) {
    const args = lineMatch[1];
    let hasColonModule = false;
    const moduleRegex = /['":\s]+:([\w-]+)['":\s,)]*/g;
    let modMatch;
    while ((modMatch = moduleRegex.exec(args)) !== null) {
      if (modMatch[1]) {
        foundModules.add(modMatch[1]);
        hasColonModule = true;
      }
    }
    if (!hasColonModule) {
      const quotedRegex = /['"]([\w-]+)['"]/g;
      while ((modMatch = quotedRegex.exec(args)) !== null) {
        if (modMatch[1]) foundModules.add(modMatch[1]);
      }
    }
  }

  if (foundModules.size > 0) {
    return Array.from(foundModules);
  }

  return modules;
}

/**
 * Get build variants from module's build.gradle
 * Supports multi-dimensional product flavors (flavorDimensions)
 */
function getVariants(projectPath, moduleName) {
  const variants = ['debug', 'release']; // Default variants

  const modulePath = path.join(projectPath, moduleName);
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

  const flavorBlockPattern = /(\w+)\s*\{/g;
  let blockMatch;
  while ((blockMatch = flavorBlockPattern.exec(flavorsContent)) !== null) {
    const name = blockMatch[1];
    if (RESERVED.has(name)) continue;

    const openBracePos = blockMatch.index + blockMatch[0].length - 1;
    const body = extractBlockFromPos(flavorsContent, openBracePos);
    if (!body) continue;

    flavorNames.push(name);

    const dimMatch = body.match(/dimension\s*[=]?\s*["'](\w+)["']/);
    if (dimMatch) {
      const dim = dimMatch[1];
      if (!flavorDimensions.has(dim)) {
        flavorDimensions.set(dim, []);
      }
      flavorDimensions.get(dim).push(name);
    }
  }

  const kotlinCreatePattern = /create\s*\(\s*["'](\w+)["']\s*\)\s*\{/g;
  while ((blockMatch = kotlinCreatePattern.exec(flavorsContent)) !== null) {
    const name = blockMatch[1];
    if (flavorNames.includes(name)) continue;

    const openBracePos = blockMatch.index + blockMatch[0].length - 1;
    const body = extractBlockFromPos(flavorsContent, openBracePos);
    if (!body) continue;

    flavorNames.push(name);
    const dimMatch = body.match(/dimension\s*[=]?\s*["'](\w+)["']/);
    if (dimMatch) {
      const dim = dimMatch[1];
      if (!flavorDimensions.has(dim)) {
        flavorDimensions.set(dim, []);
      }
      flavorDimensions.get(dim).push(name);
    }
  }

  if (flavorNames.length === 0) {
    return variants;
  }

  let dimensionOrder = [];
  const dimDeclMatch = content.match(/flavorDimensions\s+(?:\[)?\s*((?:["'][^"']+["']\s*,?\s*)+)/);
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
 * Get version info from module's build.gradle
 */
function getVersion(projectPath, moduleName) {
  const modulePath = path.join(projectPath, moduleName);
  const buildGradle = path.join(modulePath, 'build.gradle');
  const buildGradleKts = path.join(modulePath, 'build.gradle.kts');

  let content = '';
  if (fs.existsSync(buildGradle)) {
    content = fs.readFileSync(buildGradle, 'utf8');
  } else if (fs.existsSync(buildGradleKts)) {
    content = fs.readFileSync(buildGradleKts, 'utf8');
  } else {
    return { versionCode: 1, versionName: '1.0.0' };
  }

  let versionCode = 1;
  let versionName = '1.0.0';

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (versionCode === 1 && trimmed.startsWith('versionCode')) {
      const vcMatch = trimmed.match(/^versionCode[ \t]*(?:=)?[ \t]*(\d+)/) || trimmed.match(/^versionCode[ \t]*\((\d+)\)/);
      if (vcMatch) {
        versionCode = parseInt(vcMatch[1], 10);
      }
    }
    if (versionName === '1.0.0' && trimmed.startsWith('versionName')) {
      const vnMatch = trimmed.match(/^versionName[ \t]*(?:=)?[ \t]*["']([^"']+)["']/) || trimmed.match(/^versionName[ \t]*\(["']([^"']+)["']\)/);
      if (vnMatch) {
        versionName = vnMatch[1];
      }
    }
  }

  return { versionCode, versionName };
}

/**
 * Update version info in module's build.gradle
 */
function updateVersion(projectPath, moduleName, versionCode, versionName, onLog) {
  const modulePath = path.join(projectPath, moduleName);
  const buildGradle = path.join(modulePath, 'build.gradle');
  const buildGradleKts = path.join(modulePath, 'build.gradle.kts');

  let filePath = null;
  let content = '';
  let isKotlinDsl = false;

  if (fs.existsSync(buildGradle)) {
    filePath = buildGradle;
    content = fs.readFileSync(buildGradle, 'utf8');
  } else if (fs.existsSync(buildGradleKts)) {
    filePath = buildGradleKts;
    content = fs.readFileSync(buildGradleKts, 'utf8');
    isKotlinDsl = true;
  } else {
    onLog('[VERSION] ❌ 未找到 build.gradle 文件');
    return false;
  }

  onLog('[VERSION] ========================================');
  onLog('[VERSION] 开始修改版本信息...');
  if (isKotlinDsl) onLog('[VERSION] 检测到 Kotlin DSL (.kts)');
  onLog('[VERSION] ========================================');

  let modified = false;

  const lines = content.split('\n');
  const newLines = lines.map(line => {
    const trimmed = line.trimStart();

    if (trimmed.startsWith('versionCode')) {
      let vcMatch = trimmed.match(/^versionCode[ \t]*(?:=)?[ \t]*\d+/);
      if (!vcMatch) vcMatch = trimmed.match(/^versionCode[ \t]*\(\d+\)/);
      if (vcMatch) {
        const replacement = isKotlinDsl ? `versionCode = ${versionCode}` : `versionCode ${versionCode}`;
        onLog(`[VERSION] versionCode: ${vcMatch[0]} -> ${replacement}`);
        modified = true;
        return line.replace(vcMatch[0], replacement);
      }
    }

    if (trimmed.startsWith('versionName')) {
      let vnMatch = trimmed.match(/^versionName[ \t]*(?:=)?[ \t]*["'][^"']+["']/);
      if (!vnMatch) vnMatch = trimmed.match(/^versionName[ \t]*\(["'][^"']+["']\)/);
      if (vnMatch) {
        const replacement = isKotlinDsl ? `versionName = "${versionName}"` : `versionName "${versionName}"`;
        onLog(`[VERSION] versionName: ${vnMatch[0]} -> ${replacement}`);
        modified = true;
        return line.replace(vnMatch[0], replacement);
      }
    }

    return line;
  });

  if (modified) {
    fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
    onLog('[VERSION] ✓ 版本修改完成!');
    onLog('[VERSION] ========================================');
    return true;
  } else {
    onLog('[VERSION] ⚠ 未找到版本信息，跳过修改');
    onLog('[VERSION] ========================================');
    return true;
  }
}

/**
 * Get JDK path for project
 */
function getJdkPath(projectName, explicitVersion) {
  // If explicit version provided, try to find matching JDK
  if (explicitVersion != null) {
    const jdk = jdkService.getJdkByVersion(explicitVersion);
    if (jdk) return jdk.path;
  }

  // Try project-specific default from config.json projectJdk
  const projectDefaultVersion = config.projectJdk?.[projectName];
  if (projectDefaultVersion != null) {
    const jdk = jdkService.getJdkByVersion(projectDefaultVersion);
    if (jdk) return jdk.path;
  }

  // Fall back to global default JDK
  const defaultJdk = jdkService.getDefaultJdk();
  return defaultJdk ? defaultJdk.path : null;
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
 * Try to extract APK path from Gradle build output logs
 */
function findApkInLogs(logs, projectPath) {
  const logText = logs.join('');
  const patterns = [
    /APK\s*(?:输出|output|placed?)[^\n]*?:\s*([^\s\n]+\.apk)/i,
    /Output\s*:\s*([^\s\n]+\.apk)/i,
    /(?:putting|placing|outputting)\s+APK\s+to\s+([^\s\n]+\.apk)/i,
    /APK[^:]*:\s*([A-Za-z]:[\\/][^\s\n]+\.apk)/i
  ];

  const normalizedProject = projectPath ? path.normalize(projectPath) : null;

  for (const pattern of patterns) {
    const match = logText.match(pattern);
    if (match && match[1]) {
      let apkPath = match[1].trim();
      if (apkPath.length > 500) continue;
      if (!path.isAbsolute(apkPath) && projectPath) {
        apkPath = path.resolve(projectPath, apkPath);
      }
      if (normalizedProject) {
        const normalizedPath = path.normalize(apkPath);
        if (!normalizedPath.startsWith(normalizedProject + path.sep)) {
          continue;
        }
      }
      if (fs.existsSync(apkPath)) {
        return apkPath;
      }
    }
  }

  return null;
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
 * Run Gradle build with real-time output
 * Executes: git restore -> git pull -> update version -> gradle build
 */
function runBuild(projectPath, branch, moduleName, variant, versionCode, versionName, jdkVersion, useCache, onLog, onProcessCreated, isCancelled) {
  return new Promise(async (resolve, reject) => {
    const logs = [];

    // Get JDK path
    const projectName = path.basename(projectPath);
    const jdkPath = getJdkPath(projectName, jdkVersion);

    // Prepare environment
    const env = { ...process.env };
    if (jdkPath) {
      env.JAVA_HOME = jdkPath;
      env.PATH = `${path.join(jdkPath, 'bin')}${path.delimiter}${env.PATH}`;
    }
    if (config.androidSdk) {
      env.ANDROID_HOME = config.androidSdk;
      env.ANDROID_SDK_ROOT = config.androidSdk;
    }
    if (config.pythonPath) {
      env.PATH = `${config.pythonPath}${path.delimiter}${env.PATH}`;
    }

    try {
      // Step 1: Git sync (restore + checkout + pull)
      onLog('[BUILD] ========================================');
      onLog('[BUILD] 开始构建流程...');
      onLog('[BUILD] ========================================');

      await gitService.syncForBuild(projectPath, branch, onLog);

      if (isCancelled && isCancelled()) {
        onLog('[BUILD] 构建已在 Git 同步后被取消');
        return reject(new Error('构建已取消'));
      }

      // Step 2: Update version
      updateVersion(projectPath, moduleName, versionCode, versionName, onLog);

      if (isCancelled && isCancelled()) {
        onLog('[BUILD] 构建已在版本更新后被取消');
        return reject(new Error('构建已取消'));
      }

      // Step 3: Clean intermediates to prevent stale resource merge errors
      // AGP 7.x has a known issue where merged-not-compiled-resources can become
      // corrupted/stale after git reset/switch, causing "Unable to locate resourceFile" errors
      const intermediatesDir = path.join(projectPath, moduleName, 'build', 'intermediates');
      if (fs.existsSync(intermediatesDir)) {
        try {
          fs.rmSync(intermediatesDir, { recursive: true, force: true });
          onLog('[BUILD] 已清理 build/intermediates 缓存');
        } catch (e) {
          onLog(`[BUILD] 清理 intermediates 失败: ${e.message}`);
        }
      }

      // Step 4: Delete local.properties to avoid SDK path conflicts
      const localPropsPath = path.join(projectPath, 'local.properties');
      if (fs.existsSync(localPropsPath)) {
        try {
          fs.unlinkSync(localPropsPath);
          onLog('[BUILD] 已删除 local.properties');
        } catch (e) {
          onLog(`[BUILD] 删除 local.properties 失败: ${e.message}`);
        }
      }

      // Step 5: Run Gradle build
      onLog('[BUILD] ========================================');
      onLog('[BUILD] 开始 Gradle 构建...');
      onLog('[BUILD] ========================================');

      const isWindows = process.platform === 'win32';
      const variantCap = variant.charAt(0).toUpperCase() + variant.slice(1);
      const task = `:${moduleName}:assemble${variantCap}`;

      onLog(`[BUILD] JAVA_HOME: ${jdkPath || 'default'}`);
      onLog(`[BUILD] 执行任务: ${task}`);
      onLog(`[BUILD] 版本: ${versionName} (${versionCode})`);

      const gradlewCmd = isWindows
        ? path.resolve(projectPath, 'gradlew.bat')
        : './gradlew';

      // Add JVM args for compatibility with annotation processors (e.g. ButterKnife)
      // that access internal JDK APIs (jdk.compiler) which are encapsulated in JDK 17+
      const gradleArgs = [task, '--no-daemon'];
      if (useCache === false) {
        gradleArgs.push('--refresh-dependencies');
      }
      if (jdkVersion >= 17 || (jdkVersion == null && (config.projectJdk?.[projectName] || 17) >= 17)) {
        const jvmArgs = [
          '--add-opens=jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED',
          '--add-opens=jdk.compiler/com.sun.tools.javac.code=ALL-UNNAMED',
          '--add-opens=jdk.compiler/com.sun.tools.javac.comp=ALL-UNNAMED',
          '--add-opens=jdk.compiler/com.sun.tools.javac.file=ALL-UNNAMED',
          '--add-opens=jdk.compiler/com.sun.tools.javac.jvm=ALL-UNNAMED',
          '--add-opens=jdk.compiler/com.sun.tools.javac.main=ALL-UNNAMED',
          '--add-opens=jdk.compiler/com.sun.tools.javac.model=ALL-UNNAMED',
          '--add-opens=jdk.compiler/com.sun.tools.javac.parser=ALL-UNNAMED',
          '--add-opens=jdk.compiler/com.sun.tools.javac.processing=ALL-UNNAMED',
          '--add-opens=jdk.compiler/com.sun.tools.javac.tree=ALL-UNNAMED',
          '--add-opens=jdk.compiler/com.sun.tools.javac.util=ALL-UNNAMED',
          '--add-opens=jdk.compiler/com.sun.tools.javac.launcher=ALL-UNNAMED'
        ].join(' ');
        // Use GRADLE_OPTS environment variable instead of -D command-line flag
        // to avoid shell splitting issues when shell: true is used with spawn
        env.GRADLE_OPTS = (env.GRADLE_OPTS || '') + ' ' + jvmArgs;
      }

      const proc = spawn(gradlewCmd, gradleArgs, {
        cwd: projectPath,
        env: env,
        shell: true,
        windowsHide: true
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
        const buildSuccessPattern = /BUILD SUCCESSFUL/i;
        const buildSuccessful = logs.some(l => buildSuccessPattern.test(l));

        if (code === null) {
          logs.push(`[WARN] 构建已取消`);
          reject(new Error('构建已取消'));
        } else if (code === 0 || buildSuccessful) {
          if (code !== 0 && buildSuccessful) {
            onLog(`[WARN] Gradle 报告 BUILD SUCCESSFUL，但进程退出码为 ${code}，视为构建成功`);
          }

          let apkPath = null;

          apkPath = findApkInLogs(logs, projectPath);

          if (!apkPath) {
            const buildOutputDir = path.join(projectPath, moduleName, 'build', 'outputs', 'apk');
            if (fs.existsSync(buildOutputDir)) {
              apkPath = findLatestApk(buildOutputDir);
            }
          }

          if (!apkPath) {
            const fullBuildDir = path.join(projectPath, moduleName, 'build');
            if (fs.existsSync(fullBuildDir)) {
              apkPath = findLatestApk(fullBuildDir);
            }
          }

          if (!apkPath) {
            apkPath = findRecentApkInProject(projectPath, 5 * 60 * 1000);
          }

          if (!apkPath) {
            onLog('[WARN] APK 文件未找到');
          }

          resolve({ success: true, logs, apkPath });
        } else {
          logs.push(`[ERROR] 构建失败，退出码: ${code}`);
          reject(new Error(`构建失败，退出码: ${code}`));
        }
      });

      proc.on('error', (err) => {
        logs.push(`[ERROR] ${err.message}`);
        reject(err);
      });

    } catch (error) {
      onLog(`[BUILD] ❌ 构建失败: ${error.message}`);
      reject(error);
    }
  });
}

module.exports = {
  getModules,
  getVariants,
  getVersion,
  updateVersion,
  runBuild,
  getJdkPath
};
