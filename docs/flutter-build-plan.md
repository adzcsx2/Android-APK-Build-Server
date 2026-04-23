# Flutter 通用编译脚本与 Web 端优化 - 实施方案（已确认）

## 需求重述

1. **编译前自动执行 getx-cli 国际化文件生成**，不支持则跳过
2. **通过参数指定 debug/release 变体、VersionCode、VersionName、env(dev/prod)**（已实现）
3. **APK 输出目录不变** — 保持原有统一 apk 目录逻辑
4. **Web 首页区分 Android 和 Flutter 项目**（视觉增强）
5. **Flutter 项目不显示 JDK 版本选择**，且后端不设置 JAVA_HOME
6. **所有项目构建时校验当前分支**：所选分支不是当前分支则拒绝构建

---

## Phase 1: 后端 - Flutter 构建流程增强

### 1.1 flutterBuildService.js - 增加 getx-cli 国际化生成步骤

在 `runBuild()` 的 `flutter pub get` 之后、`flutter build apk` 之前，新增步骤：

```javascript
// Step 5.5: 检查并生成国际化文件 (getx-cli)
const pubspecContent = fs.readFileSync(path.join(projectPath, 'pubspec.yaml'), 'utf8');
if (pubspecContent.includes('get:') || pubspecContent.match(/get:/)) {
  onLog('[I18N] 检测到 getx 依赖，开始生成国际化文件...');
  // 先检查 get_cli 是否安装
  // 未安装则自动 flutter pub global activate get_cli
  // 执行 flutter pub global run get_cli:get generate locales
} else {
  onLog('[I18N] 未检测到 getx 依赖，跳过国际化生成');
}
```

检测方式：检查 `pubspec.yaml` 中是否包含 `get:` 依赖。如果检测到，执行 `get_cli generate locales`，如果 `get_cli` 未安装则自动安装。如果未检测到 getx 依赖，跳过此步骤并记录日志。异常不阻断构建流程。

### 1.2 flutterBuildService.js - 构建参数确认（无需修改）

当前已实现的参数：
- `--debug` / `--release` (buildType 参数) ✅
- `--dart-define=env=${env}` ✅
- `--build-name=${versionName}` ✅
- `--build-number=${versionCode}` ✅

版本写入 `pubspec.yaml` 格式：`version: {versionName}+{versionCode}` ✅

### 1.3 APK 输出目录（无需修改）

保持原有逻辑：APK 构建后由 `apkService.copyApk()` 复制到 `D:\WebWorkplace\android-build\apk` 统一目录。

### 1.4 flutterBuildService.js - 移除 JDK 环境变量设置

在 `runBuild()` 中，不再设置 `JAVA_HOME` 和 `PATH` 中的 JDK 路径。让 Flutter/Gradle 自行处理 JDK。

修改点：
- 移除 `const jdkPath = gradleService.getJdkPath(...)` 调用
- 移除 `buildEnv.JAVA_HOME = jdkPath` 设置
- 移除 `buildEnv.PATH` 中 JDK bin 目录的添加
- 保留 `ANDROID_HOME` 和 `ANDROID_SDK_ROOT` 设置
- 保留 `System32` PATH 设置

### 1.5 build.js - 所有项目构建时校验当前分支

在 `POST /api/build` 中，获取项目后统一增加分支校验：

```javascript
// 校验当前分支
const currentBranch = gitService.getCurrentBranch(project.path);
if (currentBranch !== branch) {
  return res.status(400).json({
    success: false,
    error: `当前分支 (${currentBranch}) 与所选分支 (${branch}) 不一致，请先切换分支`
  });
}
```

对 Android 和 Flutter 项目均生效。

### 1.6 build.js - Flutter 项目跳过 JDK 校验

在 `POST /api/build` 中，当 `project.type === 'flutter'` 时：
- 不校验 `jdkVersion` 参数
- `jdkVersion` 传 null 到 runBuild

---

## Phase 2: 前端 - UI 优化

### 2.1 index.html - JDK 版本行添加 id

给 JDK 版本的 form-group 添加 `id="jdk-version-group"`，方便 JS 控制显隐。

### 2.2 app.js - Flutter 项目隐藏 JDK 选择

在 `onModuleChange()` 中：
- `state.projectType === 'flutter'` → 隐藏 `#jdk-version-group`
- `state.projectType === 'android'` → 显示 `#jdk-version-group`

### 2.3 app.js - 构建时分支校验错误提示

在 `startBuild()` 中，当后端返回分支不一致的错误时：
- 使用 `showToast()` 提示用户
- 错误信息明确指出需要先点击"切换分支"按钮

### 2.4 首页项目列表 - Flutter 视觉区分

当前已实现文字标签区分。优化：
- Flutter 项目卡片添加 `.flutter` CSS class
- CSS 样式：Flutter 卡片使用蓝色调边框/背景，Android 使用绿色调
- 项目列表增加筛选功能：全部 / Android / Flutter（可选）

---

## Phase 3: 后端 - 新增 API

### 3.1 GET /api/projects/:name/current-branch

返回当前工作目录的 git 分支名，前端可主动检查分支一致性：
```json
{ "success": true, "currentBranch": "main" }
```

---

## 涉及修改的文件清单

| 文件 | 修改内容 |
|------|----------|
| `src/services/flutterBuildService.js` | 增加 getx 国际化步骤、移除 JDK 设置 |
| `src/routes/build.js` | 所有项目分支校验、Flutter 跳过 JDK 校验 |
| `src/routes/projects.js` | 新增 current-branch API |
| `public/index.html` | JDK 行添加 id |
| `public/js/app.js` | Flutter 隐藏 JDK、分支错误提示、项目类型样式 |
| `public/css/style.css` | Flutter 项目卡片样式 |
