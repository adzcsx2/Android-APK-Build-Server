# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Android APK Online Build Platform — a Node.js/Express web app that lets users select Android or Flutter projects, branches, modules, and build variants via a browser, then build and download APKs without Android Studio. The UI and documentation are in Chinese.

## AI Working Principles

**Single Source of Truth:**
- Build/config: `config.json`, `package.json`, actual Gradle/Flutter files
- Module lists: `settings.gradle`, `workspace configs`, actual project scans
- Project rules: This file (CLAUDE.md) + AGENT.md (for Copilot)
- Directory structure: Actual source code scan results
- Default commands: npm scripts in `package.json`, actual build tools

**Mandatory Reuse Rules:**
- Before modifying: Search target file directory and similar implementations
- Prioritize: Reuse existing implementations → Minimal changes → Local consistency
- Do NOT: Introduce new architectures, abstractions, or libraries unless explicitly requested
- Follow: Target directory patterns, adjacent code style, existing naming conventions

**AI Vibe Coding Constraints:**
- Source files: Prefer ≤500 lines; split when approaching limit into clear components/services/helpers
- Single responsibility: One file = one clear purpose
- Exceptions to 500-line preference: Generated files, lockfiles, migrations, vendor, third-party code, protocol buffers, framework-forced entries, existing large legacy files
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
- If default verification commands exist: Record in this file
- If no verification commands: Explicitly state "not verified"
- Documentation-only changes: Check links, paths, categories, rule file consistency

## Commands

```bash
npm install          # Install dependencies
npm start            # Start server (node server.js)
npm run dev          # Start with --watch (Node.js 18+)
npm stop             # Kill node processes on Windows
```

**Testing:** Jest test files exist but Jest is not installed. Run with:
```bash
npx jest                              # All tests
npx jest src/services/buildQueue.test.js  # Single file
npx jest --testPathPattern=flutterBuildService  # By pattern
```

**Production (PM2):**
```bash
pm2 start server.js --name build-server
```

**Verification:** Not verified (no automated verification configured)

## Architecture

### Entry Point & Configuration

- `server.js` — Express entry point. Reads `config.json`, mounts routes, auto-detects local IP, starts build history cleanup scheduler.
- `config.json` — Server config: port/host/basePath, JDK paths, SDK paths, build concurrency, APK retention, per-project JDK assignments.

### Routes (`src/routes/`)

Mounted under `config.server.basePath` (default `/build`), except `/init` at root.
- `index.js` — Static files (CSS, JS, APKs), serves `index.html`, aggregates `/api` routes
- `projects.js` — Project listing, branches, modules, variants. Delegates to `gradleService` or `flutterBuildService` by `project.type`
- `build.js` — Build lifecycle (create/status/cancel/list), APK management, SSE log streaming. Contains `executeBuild()` pipeline orchestrator.
- `config.js` — Per-project build config CRUD, JDK version listing.
- `init.js` — Password-protected workplace directory management.

### Services (`src/services/`)

- `workplaceService.js` — Multi-workplace project scanning. Android via `settings.gradle`, Flutter via `pubspec.yaml`. 5-second in-memory cache.
- `projectService.js` — Thin wrapper over `workplaceService`.
- `gitService.js` — Branch listing (with fetch), repo sync (reset+clean+pull), commit logs.
- `gradleService.js` — Parses `settings.gradle` for modules, `build.gradle` for flavors/build types (incl. Kotlin DSL, multi-dimensional flavors), runs `gradlew.bat assembleVariant`, discovers output APK.
- `flutterBuildService.js` — Flutter equivalent: parses Android `build.gradle` under `android/`, runs `flutter build apk`, reads/writes `pubspec.yaml` versioning. Duplicates some helpers from `gradleService`.
- `buildQueue.js` — In-memory concurrent build queue (Map, UUID keys). Max 3 concurrent. Lifecycle: pending → building → completed/failed/cancelled. Process killing via `taskkill /T /F`.
- `apkService.js` — APK copy, list, delete with standardized naming.
- `configService.js` / `branchCacheService.js` / `buildHistoryService.js` — JSON-file persistence in `data/`.
- `buildLogService.js` — Dual-mode log storage: legacy per-project + per-build logs. Path traversal protection via name sanitization. Offset-based polling.
- `jdkService.js` — JDK configuration management.

### Frontend (`public/`)

- `index.html` + `js/app.js` — Single-page app with 5-step build wizard. State in single `state` object. SSE real-time logs with 1-second polling fallback. 500ms debounce auto-save.
- `init.html` + `js/init.js` — Workplace config UI.
- `css/style.css` — All styles in one file.
- No framework, no bundler — raw HTML/CSS/JS served by Express.

### Data Storage

All persistence via JSON files in `data/`:
- `workplace-configs.json` — Workplace directory paths
- `project-configs.json` — Per-project build configurations
- `project-branches.json` — Cached branch lists
- `build-history.json` — Persistent build history (max N per project)
- `build-logs/` — Per-project and per-build log files
- `jdk-configs.json` — JDK configurations

## Platform & Stack Constraints

- **Windows-only** — `gradlew.bat`, `taskkill /T /F`, `shell: true`, Windows paths
- **No database** — JSON file persistence only
- **No bundler/linter** — No ESLint, Prettier, Webpack configured
- **Minimal dependencies** — Only `express` and `uuid`
- **Node.js 16+** required for `--watch` mode

## Key Patterns

- **Project type routing:** Branch on `project.type` ('android' vs 'flutter') to select build service
- **SSE + polling fallback:** Real-time logs via Server-Sent Events (`src/utils/sse.js`), 1-second disk polling fallback if disconnected
- **Build queue concurrency:** Map-based queue with max concurrent builds. `build.js` coordinates SSE with `waitingSSE` map
- **Auto-save debounce:** Frontend saves config with 500ms debounce; restores on project switch
- **Input validation:** Branch name regex `/^[a-zA-Z0-9_\-./#@]+$/`, path traversal protection, prototype pollution prevention

## Repository Conventions

- **Root files only:** `README.md` and `CLAUDE.md` only allowed in project root
- **Docs location:** All other documentation (plans, checklists, guides, etc.) in `docs/`
- **No loose files:** Verification scripts, test harnesses, tooling in `docs/`, not root or `public/`

## Documentation Structure

**Standard docs taxonomy at `/docs`:**
- `plan/` — Plans, roadmaps, TODOs (e.g., flutter-build-plan.md → plan/)
- `product/` — PRDs, requirements, user stories, acceptance criteria
- `design/` — Architecture, ADRs, specs (e.g., PLAN.md → design/)
- `guide/` — Setup, usage, operations, runbooks
- `modules/` — Module documentation, directory boundaries, component overviews
- `references/` — References, terminology, indexes (e.g., QUICK_REFERENCE.md → references/)
- `checklist/` — Checklists, audit lists (e.g., HANDOFF_CHECKLIST.md → checklist/, MANUAL_TEST_CHECKLIST.md → checklist/)
- `reports/` — Test reports, audits, performance, post-mortems

**Existing docs mapping (semantic equivalence):**
- `PLAN.md`, `flutter-build-plan.md` → design/ (or move to plan/)
- `QUICK_REFERENCE.md` → references/
- `HANDOFF_CHECKLIST.md`, `MANUAL_TEST_CHECKLIST.md` → checklist/
- `TESTING_GUIDE.md` → guide/
- `IMPLEMENTATION_SUMMARY*.md`, `FEATURES_README.md` → reports/
- `silent-background-operations.md` → guide/
- `test-features.js`, `verify-implementation*.js` → reports/ (test tools)

**New documentation rules:**
- Default location: `/docs` under appropriate category
- Before creating new doc: Check existing `/docs` categories for semantic equivalence
- Reuse existing semantically-equivalent directories; do not create duplicate directories
- No new loose `.md` files in project root
- If categorization unclear: Search existing structure first

## Upgrade Notes

This CLAUDE.md has been upgraded to current init skill standards:
- Added AI working principles (single source of truth, reuse rules, vibe coding)
- Added touched-file discipline, plan-first triggers, minimum verification
- Added standard `/docs` taxonomy with category mapping
- Added new documentation placement rules
- Current standards constrain future AI coding; no proactive refactoring of untouched source code required

## Local Consistency Rules

**Node.js/Express:**
- Follow existing middleware pattern, error handling style
- Reuse existing utility functions (sse.js, spawnAsync.js)
- Maintain route mounting pattern (basePath + root)
- Follow JSON-file persistence pattern for new data
- Use existing validation patterns (regex, sanitization)

**Frontend:**
- Continue vanilla JS (no framework) pattern
- Follow single-state-object pattern
- Maintain SSE + polling fallback pattern
- Reuse existing CSS conventions
- Follow 500ms debounce pattern for auto-save

**Windows-specific:**
- Use `gradlew.bat`, not `gradlew`
- Use `taskkill /T /F` for process termination
- Use `shell: true` for child_process spawn
- Maintain Windows path handling
- Handle Chinese network interface names
