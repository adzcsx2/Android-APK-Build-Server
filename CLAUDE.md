# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Android APK Online Build Platform — Node.js/Express web app for building Android/Flutter APKs via browser. UI and docs in Chinese. Windows-only.

## AI Working Principles

**Single Source of Truth:**
- Build/config: `config.json`, `package.json`, actual Gradle/Flutter files
- Module lists: `settings.gradle`, workspace configs, actual project scans
- Project rules: This file (CLAUDE.md) + AGENT.md (for Copilot)
- Directory structure: Actual source code scan results
- Default commands: npm scripts in `package.json`

**Mandatory Reuse Rules:**
- Before modifying: Search target file directory and similar implementations
- Prioritize: Reuse existing implementations > Minimal changes > Local consistency
- Do NOT introduce new architectures, abstractions, or libraries unless explicitly requested
- Follow target directory patterns, adjacent code style, existing naming conventions

**AI Vibe Coding Constraints:**
- Source files: Prefer <=500 lines; split when approaching limit into clear components/services/helpers
- Single responsibility: One file = one clear purpose
- Exceptions: Generated files, lockfiles, migrations, vendor, third-party code, framework-forced entries, existing large legacy files
- Legacy large files: Minimal changes only; refactor only when user requests or clear benefit exists
- Do NOT proactively refactor untouched code to satisfy 500-line preference

**Touched-File Discipline:**
- Modify only files directly related to current requirement/bug/request
- No batch formatting, import reordering, or lint fixes unless explicitly requested
- Preserve existing uncommitted changes; do not overwrite or revert user edits
- Large files: Touch only necessary fragments

**Plan-First Triggers:**
Before executing, confirm/plan when:
- Modifying >3 source files
- Cross-module, cross-package, cross-service, or cross-platform changes
- Adding dependencies, build configs, scripts, CI, or runtime configs
- Changing public APIs, data models, routes, permissions, persistence formats, or migrations
- Refactoring, moving files, splitting modules, or changing directory boundaries
- Requirements, acceptance criteria, or impact scope are unclear

**Minimum Verification:**
- After changes: Run minimum relevant test/lint/typecheck/build/smoke verification
- Default verification commands: `npx jest` (Jest not installed; run via npx)
- If no verification commands: Explicitly state "not verified"
- Documentation-only changes: Check links, paths, categories, rule file consistency

## Commands

```bash
npm install          # Install dependencies
npm start            # Start server (node server.js)
npm run dev          # Start with --watch (Node.js 18+)
npm stop             # Kill node processes on Windows
npx jest             # Run tests (Jest via npx)
npx jest src/services/buildQueue.test.js  # Single test file
pm2 start server.js --name build-server   # Production
```

**Verification:** Not verified (no automated verification configured)

## Architecture

### Entry Point
- `server.js` — Express entry. Reads `config.json`, mounts routes under `basePath` and root, auto-detects local IP, starts cleanup scheduler.
- `config.json` — Server config: port/host/basePath, JDK/SDK paths, build concurrency, APK retention, per-project JDK assignments.

### Routes (`src/routes/`)
Mounted under `config.server.basePath` (default `/build`), except `/init` at root.
- `index.js` — Static files, serves `index.html`, aggregates `/api` routes
- `projects.js` — Project listing, branches, modules, variants. Routes by `project.type`
- `build.js` — Build lifecycle (create/status/cancel/list), APK management, SSE log streaming
- `config.js` — Per-project build config CRUD, JDK version listing
- `init.js` — Password-protected workplace directory management

### Services (`src/services/`)
- `workplaceService.js` — Multi-workplace scanning. Android via `settings.gradle`, Flutter via `pubspec.yaml`. 5s cache.
- `projectService.js` — Thin wrapper over `workplaceService`
- `gitService.js` — Branch listing (with fetch), repo sync (reset+clean+pull), commit logs
- `gradleService.js` — Parses `settings.gradle`/`build.gradle` for modules/flavors (incl. Kotlin DSL, multi-dimensional), runs `gradlew.bat assembleVariant`
- `flutterBuildService.js` — Flutter equivalent: parses `android/build.gradle`, runs `flutter build apk`, reads/writes `pubspec.yaml`
- `buildQueue.js` — In-memory concurrent queue (Map, UUID). Max 3 concurrent. Lifecycle: pending -> building -> completed/failed/cancelled
- `apkService.js` / `configService.js` / `branchCacheService.js` / `buildHistoryService.js` — JSON persistence in `data/`
- `buildLogService.js` — Dual-mode log storage with path traversal protection
- `jdkService.js` — JDK configuration management

### Utilities (`src/utils/`)
- `sse.js` — Server-Sent Events utility
- `spawnAsync.js` — Async process spawning

### Frontend (`public/`)
- `index.html` + `js/app.js` — SPA with 5-step build wizard. Single `state` object. SSE + 1s polling fallback. 500ms debounce auto-save.
- `init.html` + `js/init.js` — Workplace config UI
- `css/style.css` — All styles. No framework, no bundler.

### Data Storage (`data/`)
JSON file persistence: `workplace-configs.json`, `project-configs.json`, `project-branches.json`, `build-history.json`, `jdk-configs.json`, `build-logs/`

## Key Patterns

- **Project type routing:** Branch on `project.type` ('android' vs 'flutter')
- **SSE + polling fallback:** Real-time logs via `src/utils/sse.js`, 1s disk polling fallback
- **Build queue concurrency:** Map-based queue. `build.js` coordinates SSE with `waitingSSE` map
- **Auto-save debounce:** Frontend saves config with 500ms debounce
- **Input validation:** Branch regex `/^[a-zA-Z0-9_\-./#@]+$/`, path traversal protection, prototype pollution prevention

## Platform Constraints

- **Windows-only** — `gradlew.bat`, `taskkill /T /F`, `shell: true`, Windows paths
- **No database** — JSON file persistence only
- **No bundler/linter** — No ESLint, Prettier, Webpack configured
- **Minimal dependencies** — Only `express` and `uuid`

## Local Consistency Rules

**Node.js/Express:** Follow existing middleware/error handling. Reuse `sse.js`, `spawnAsync.js`. Maintain basePath+root mounting. JSON-file persistence for new data. Existing validation patterns.

**Frontend:** Vanilla JS only (no framework). Single-state-object. SSE + polling fallback. Existing CSS conventions. 500ms debounce.

**Windows:** `gradlew.bat`, `taskkill /T /F`, `shell: true`, Windows paths, Chinese network interface names.

## Documentation Structure

**Docs root:** `/docs` — Standard taxonomy with category mapping:

| Category | Directory | Purpose |
|----------|-----------|---------|
| plan | `/docs/plan/` | Plans, roadmaps, TODOs |
| product | `/docs/product/` | PRDs, requirements, user stories |
| design | `/docs/design/` | Architecture, ADRs, specs |
| guide | `/docs/guide/` | Setup, usage, operations, runbooks |
| modules | `/docs/modules/` | Module docs, directory boundaries |
| references | `/docs/references/` | References, terminology, indexes |
| checklist | `/docs/checklist/` | Checklists, audit lists |
| reports | `/docs/reports/` | Test reports, audits, post-mortems |

**Existing docs mapping:** `PLAN.md`, `flutter-build-plan.md` -> design/; `QUICK_REFERENCE.md` -> references/; `HANDOFF_CHECKLIST.md`, `MANUAL_TEST_CHECKLIST.md` -> checklist/; `TESTING_GUIDE.md` -> guide/; `IMPLEMENTATION_SUMMARY*.md`, `FEATURES_README.md` -> reports/; `silent-background-operations.md` -> guide/

**Rules:**
- New docs go to `/docs` under appropriate category
- Check existing categories for semantic equivalence before creating new directories
- Reuse existing semantically-equivalent directories
- No new loose `.md` files in project root (only `README.md` and `CLAUDE.md`)
- If categorization unclear: Search existing structure first

## Upgrade Notes

This CLAUDE.md has been upgraded to current init skill standards (v1.1.5):
- AI working principles (single source of truth, reuse rules, vibe coding constraints)
- Touched-file discipline, plan-first triggers, minimum verification
- Standard `/docs` taxonomy with category mapping and semantic equivalence rules
- Local consistency rules for Node.js/Express, vanilla JS frontend, Windows platform
- Current standards constrain future AI coding; no proactive refactoring of untouched source code required
