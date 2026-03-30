# Implementation Plan: 隐藏 Flutter 项目 + 编译状态即时获取

## Requirements Restatement

1. **隐藏 Flutter 项目**: 从项目列表中完全隐藏 Flutter 类型的项目（如 `vemory-flutter`），不再显示。
2. **Android 项目编译状态即时获取**: 页面刷新后，第一时间就能看到编译状态（构建指示器），而不是等几秒才显示。

## Root Cause Analysis

### 需求 1: 隐藏 Flutter 项目
- `projectService.js:getProjects()` 同时返回 `type: 'android'` 和 `type: 'flutter'` 的项目
- 前端 `renderProjects()` 直接渲染所有返回的项目，不做类型过滤
- 当前只有 `vemory-flutter` 一个 Flutter 项目

### 需求 2: 编译状态获取慢
- 页面初始化时 (`DOMContentLoaded`)，`loadProjects()` 和 `loadActiveBuilds()` 是**并行独立调用**的（app.js 第 213-214 行）
- **竞态条件**：`loadProjects()` 可能在 `loadActiveBuilds()` 完成之前就执行完毕并调用 `renderProjects()`，此时 `state.activeBuilds` 为空数组，所以构建指示器不会显示
- 虽然后续 5 秒定时器会更新指示器，但首次渲染时已经丢失了状态信息

## Implementation Phases

### Phase 1: 隐藏 Flutter 项目

**修改文件**: `src/services/projectService.js`

- 在 `getProjects()` 函数中，移除 Flutter 项目的检测和返回逻辑（第 52-62 行）
- 删除 `isFlutterProject` 函数（第 19-22 行），因为不再需要
- 只保留纯 Android 项目的检测和返回

### Phase 2: 编译状态即时获取

**修改文件**: `public/js/app.js`

- 修改 `DOMContentLoaded` 初始化逻辑（第 211-217 行）
- 改为：先并行请求项目列表和活跃构建状态，两者都完成后再渲染项目列表
- 使用 `Promise.all` 确保 `renderProjects()` 被调用时 `state.activeBuilds` 已有数据
- `loadProjects()` 需要返回 Promise 以支持 `Promise.all` 等待

## Risks

- **LOW**: 隐藏 Flutter 项目后，`config.json` 中 `projectJdk` 的 `vemory-flutter` 映射仍保留，不影响其他逻辑。如需恢复只需改回代码。
- **LOW**: `Promise.all` 中任一请求失败，另一个仍能正常执行（需用 `finally` 或分别处理），`renderProjects` 本身已处理 `activeBuilds` 为空的情况。

## Complexity: LOW

两个改动都很小，各只涉及 1 个文件，改动行数极少。
