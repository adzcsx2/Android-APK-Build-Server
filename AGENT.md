# AGENT.md

General guidance for all AI tools working with this repository.

## Project Overview

Android APK Online Build Platform — A Node.js/Express web application for building Android and Flutter APKs via browser. Users select projects, branches, modules, and build variants through a web UI. Windows-only, no database, JSON file persistence.

**Tech Stack:** Node.js 16+, Express 4.18, vanilla HTML/CSS/JS (no framework, no bundler), Server-Sent Events (SSE), Gradle (gradlew.bat), Flutter CLI.

**Directory Structure:**
- `server.js` — Express entry point
- `config.json` — Server configuration
- `src/routes/` — API routes (projects, build, config, init)
- `src/services/` — Business logic (build queue, gradle/flutter services, git, workplace scanning)
- `src/utils/` — Utilities (SSE, async spawn)
- `public/` — Frontend SPA (index.html, app.js, init.html, init.js, style.css)
- `data/` — JSON file persistence
- `docs/` — Documentation root with standard taxonomy

## Coding Standards

### File Organization
- Source files: Prefer under 500 lines; split when approaching limit into focused components/services/helpers
- One responsibility per file
- Exceptions: Generated files, lockfiles, migrations, vendor code, framework entries, existing large legacy files
- Legacy large files: Minimal changes only; refactor only when requested

### Naming Conventions
- JavaScript files: camelCase (e.g., `buildQueue.js`, `gradleService.js`)
- Documentation: lowercase with hyphens (e.g., `TESTING_GUIDE.md`)
- Test files: Source name + `.test.js` suffix (e.g., `buildQueue.test.js`)

### Code Style
- Semicolons, double quotes, 2-space indentation
- Prefer const over let, avoid var
- async/await for asynchronous code

### Touched-File Discipline
- Modify only files directly related to the current task
- No batch formatting, import reordering, or global lint fixes unless requested
- Preserve existing uncommitted changes
- Large files: touch only necessary fragments

### Plan-First Triggers
Plan or confirm before executing when:
- Modifying more than 3 source files
- Cross-module or cross-service changes
- Adding dependencies or changing build configurations
- Changing public APIs, data models, routes, or persistence formats
- Refactoring, moving files, or changing directory boundaries
- Requirements or impact scope are unclear

### Testing
- Test files exist but Jest is not installed; run via `npx jest`
- Place test files alongside source or in `__tests__/` directories

### Commit Messages
- Format: `type: description` (feat, fix, docs, style, refactor, test, chore)
- Include Co-Authored-By for AI contributions

## Reuse-First Principles

1. Search before modifying: Check target directory and similar implementations
2. Prioritize reuse: Use existing implementations over creating new ones
3. Minimal changes: Make the smallest change that solves the problem
4. Local consistency: Follow patterns in the target directory and adjacent code
5. No new architectures: Do not introduce new frameworks or abstractions unless requested

## Key Path Index

**Entry Points:** `server.js`, `config.json`, `public/index.html`, `public/js/app.js`

**Routes:** `src/routes/index.js` (aggregation), `projects.js`, `build.js`, `config.js`, `init.js`

**Services:** `buildQueue.js` (concurrent queue), `gradleService.js` (Android), `flutterBuildService.js` (Flutter), `gitService.js`, `workplaceService.js` (scanning)

**Utilities:** `src/utils/sse.js`, `src/utils/spawnAsync.js`

**Data:** `data/` — JSON files for configs, branches, history, logs

**Documentation:** `/docs` with categories: plan, product, design, guide, modules, references, checklist, reports

## Common Commands

```bash
npm install          # Install dependencies
npm start            # Start server
npm run dev          # Start with --watch (Node.js 18+)
npm stop             # Stop server (Windows)
npx jest             # Run tests
pm2 start server.js --name build-server  # Production
```

## Verification

- After changes: Run relevant tests if available
- For documentation: Check links, paths, and consistency
- If no automated tests: Manual verification required
- Explicitly state verification status (verified/not verified)
