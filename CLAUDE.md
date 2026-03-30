# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Android APK Online Build Platform — a Node.js/Express web app that lets users select Android or Flutter projects, branches, modules, and build variants via a browser, then build and download APKs without Android Studio. The UI and documentation are in Chinese.

## Commands

```bash
npm install          # Install dependencies
npm start            # Start server (node server.js)
npm run dev          # Start with --watch (Node.js 18+)
npm stop             # Kill node processes on Windows
```

**Testing:** Jest test files exist but Jest is not installed as a dependency. To run tests:
```bash
npx jest                              # Run all tests
npx jest src/services/buildQueue.test.js              # Single test file
npx jest --testPathPattern=flutterBuildService         # By name pattern
```

**Production (PM2):**
```bash
pm2 start server.js --name build-server
```

## Architecture

### Entry Point & Configuration

- `server.js` — Express entry point. Reads `config.json`, mounts routes, auto-detects local IP, starts build history cleanup scheduler.
- `config.json` — All server config: server port/host/basePath, JDK paths, Android/Flutter SDK paths, build concurrency, APK retention rules, per-project JDK assignments.

### Routes (`src/routes/`)

Routes are mounted under `config.server.basePath` (default `/build`), except `/init` which is at root level.

- `index.js` — Static file serving (CSS, JS, APK downloads) and route aggregation. All API routes are under `/api`.
- `projects.js` — Project listing, branch management, module/variant discovery. Delegates to `gradleService` or `flutterBuildService` based on `project.type`.
- `build.js` — Build lifecycle (create, status, cancel, list), APK management, and build log streaming (SSE + polling). Contains `executeBuild()` which orchestrates the full build pipeline.
- `config.js` — Per-project build config CRUD and JDK version listing.
- `init.js` — Password-protected workplace directory management.

### Services (`src/services/`)

- `workplaceService.js` — Multi-workplace project scanning. Discovers Android projects (via `settings.gradle`) and Flutter projects (via `pubspec.yaml`). 5-second in-memory cache.
- `projectService.js` — Thin wrapper that delegates to `workplaceService`.
- `gitService.js` — Branch listing (with fetch), repository sync (reset+clean+pull), branch commit logs.
- `gradleService.js` — Parses `settings.gradle` for modules, `build.gradle` for product flavors and build types (supports multi-dimensional flavors and Kotlin DSL), runs `gradlew.bat assembleVariant`, discovers output APK.
- `flutterBuildService.js` — Flutter equivalent: parses Android `build.gradle` under `android/`, runs `flutter build apk`, reads/writes `pubspec.yaml` versioning. Note: duplicates some helper functions from gradleService.
- `buildQueue.js` — In-memory concurrent build queue (Map with UUID-based IDs). Max 3 concurrent builds. Lifecycle: pending → building → completed/failed/cancelled. Process tree killed via `taskkill /T /F` on Windows.
- `apkService.js` — APK file copy, listing, deletion with standardized naming.
- `configService.js` / `branchCacheService.js` / `buildHistoryService.js` — JSON-file-based persistence in `data/`.
- `buildLogService.js` — Dual-mode log storage: legacy per-project logs and per-build logs. Path traversal protection via name sanitization. Offset-based polling for real-time reading.

### Frontend (`public/`)

- `index.html` + `js/app.js` (1713 lines) — Single-page app with 5-step build wizard. State managed in a single `state` object. Real-time logs via SSE with 1-second disk polling fallback. Auto-saves config with 500ms debounce.
- `init.html` + `js/init.js` — Workplace directory configuration UI.
- `css/style.css` — All styles in one file.
- No frontend framework or build tooling — raw HTML/CSS/JS served by Express.

### Data Storage

All persistence is via JSON files in `data/`:
- `workplace-configs.json` — configured workplace directory paths
- `project-configs.json` — per-project saved build configurations
- `project-branches.json` — cached branch lists
- `build-history.json` — persistent build history (max N records per project)
- `build-logs/` — per-project and per-build log files

## Platform Constraints

- **Windows-only** — uses `gradlew.bat`, `taskkill /T /F`, `shell: true` for child_process spawn, Windows-specific path handling throughout.
- **No database** — all persistence is JSON files.
- **No bundler/linter** — no ESLint, Prettier, Webpack, or similar tools configured.
- **Minimal dependencies** — only `express` and `uuid`.

## Key Patterns

- **Project type routing:** Routes and services branch on `project.type` (`'android'` vs `'flutter'`) to select the appropriate build service.
- **SSE + polling fallback:** Build logs stream via Server-Sent Events (`src/utils/sse.js`). If SSE disconnects, the frontend falls back to polling `build-logs/` on disk at 1-second intervals.
- **Build queue concurrency:** `buildQueue.js` manages a Map of builds. New builds are enqueued as `pending`; up to `maxConcurrent` (default 3) run simultaneously. The route handler in `build.js` coordinates SSE connections with queued builds via a `waitingSSE` map.
- **Auto-save debounce:** Frontend saves project config to server with 500ms debounce. Config is restored when switching back to a previously configured project.
- **Input validation:** Branch names validated with regex (`/^[a-zA-Z0-9_\-./#@]+$/`). Path traversal prevention in `buildLogService`. Prototype pollution prevention in `branchCacheService`.
