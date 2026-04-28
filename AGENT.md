# AGENT.md

This file provides general guidance for all AI tools working with code in this repository.

## Project Overview

Android APK Online Build Platform — A Node.js/Express web application that provides a browser-based interface for building Android and Flutter APKs without requiring Android Studio. Users can select projects, branches, modules, and build variants through a web UI. The application is Windows-only and uses no database.

## Technology Stack

- Runtime: Node.js 16+
- Backend: Express 4.18
- Frontend: Vanilla HTML/CSS/JavaScript (no framework, no build tooling)
- Real-time: Server-Sent Events (SSE) with polling fallback
- Persistence: JSON files (no database)
- Build tools: Gradle (gradlew.bat), Flutter CLI
- Platform: Windows-only (uses taskkill, gradlew.bat, shell: true)
- Process management: PM2 (optional for production)

## General Coding Standards

### File Organization
- Source files: Prefer keeping under 500 lines; split when approaching limit
- One responsibility per file
- Exceptions: Generated files, lockfiles, migrations, vendor code, framework entries
- For large legacy files: Make minimal changes; refactor only when requested

### File Naming
- JavaScript: camelCase for files (e.g., `buildQueue.js`, `gradleService.js`)
- All documentation: lowercase with hyphens (e.g., `TESTING_GUIDE.md`)
- Test files: Same name as source with `.test.js` suffix (e.g., `buildQueue.test.js`)

### Code Style
- Use semicolons
- Double quotes for strings
- 2-space indentation
- Prefer const over let, avoid var
- Use async/await for asynchronous code

### Touched-File Discipline
- Modify only files directly related to the current task
- Do not batch format, reorder imports, or fix lint globally unless requested
- Preserve existing uncommitted changes
- For large files, touch only necessary fragments

### Plan-First Triggers
Before executing, plan or confirm when:
- Modifying more than 3 source files
- Making cross-module or cross-service changes
- Adding dependencies or changing build configurations
- Changing public APIs, data models, routes, or persistence formats
- Refactoring, moving files, or changing directory boundaries
- Requirements or impact scope are unclear

### Testing
- Test files exist but Jest is not installed; run via `npx jest`
- Place test files alongside source files or in `__tests__/` directories
- Name test files: `source.test.js` or `source.test.js`

### Commit Messages
- Use conventional commit format: `type: description`
- Types: feat, fix, docs, style, refactor, test, chore
- Example: `feat: add Flutter build support`
- Include Co-Authored-By for AI contributions

## Reuse-First Principles

1. Search before modifying: Check target directory and similar implementations
2. Prioritize reuse: Use existing implementations over creating new ones
3. Minimal changes: Make the smallest change that solves the problem
4. Local consistency: Follow patterns in the target directory and adjacent code
5. No new architectures: Do not introduce new frameworks or abstractions unless requested

## Key Path Index

### Entry Points
- `server.js` — Express application entry point
- `config.json` — Server configuration
- `public/index.html` — Main web UI
- `public/js/app.js` — Frontend SPA (main client logic)

### Routes
- `src/routes/index.js` — Route aggregation and static files
- `src/routes/projects.js` — Project discovery and management
- `src/routes/build.js` — Build lifecycle and execution
- `src/routes/config.js` — Build configuration management
- `src/routes/init.js` — Workplace configuration

### Services
- `src/services/buildQueue.js` — Concurrent build queue management
- `src/services/gradleService.js` — Android/Gradle build operations
- `src/services/flutterBuildService.js` — Flutter build operations
- `src/services/gitService.js` — Git operations (branches, sync, logs)
- `src/services/workplaceService.js` — Project scanning and discovery

### Utilities
- `src/utils/sse.js` — Server-Sent Events utility
- `src/utils/spawnAsync.js` — Async process spawning

### Documentation
- `/docs` — Standard documentation root with taxonomy
  - `plan/` — Plans and roadmaps
  - `design/` — Architecture and specs
  - `guide/` — Setup and usage guides
  - `checklist/` — Checklists and audit lists
  - `references/` — References and indexes
  - `reports/` — Test and audit reports

### Data
- `data/` — JSON file persistence
  - `build-history.json` — Build history records
  - `project-configs.json` — Per-project configurations
  - `build-logs/` — Build log files

## Common Commands

```bash
# Install dependencies
npm install

# Start development server
npm start
npm run dev  # With --watch (Node.js 18+)

# Stop server (Windows)
npm stop

# Run tests (Jest via npx)
npx jest
npx jest src/services/buildQueue.test.js

# Production with PM2
pm2 start server.js --name build-server
```

## Platform-Specific Notes

### Windows Constraints
- Use `gradlew.bat` not `gradlew`
- Use `taskkill /T /F` for process termination
- Use `shell: true` for child_process.spawn
- Handle Windows-specific paths
- Support Chinese network interface names

### Project Type Routing
- Check `project.type` to determine if 'android' or 'flutter'
- Route to appropriate service: `gradleService` or `flutterBuildService`

### State Management
- Frontend uses single global `state` object
- No framework — vanilla JavaScript only
- SSE for real-time updates with 1-second polling fallback
- 500ms debounce for auto-save

## Documentation Rules

- Default location: `/docs` under appropriate category
- Before creating new docs: Check for existing semantically-equivalent categories
- Reuse existing directories; do not create duplicates
- No new loose `.md` files in project root
- Only `README.md` and `CLAUDE.md` allowed in root
- All other documentation goes in `/docs`

## Verification

After making changes:
- Run relevant tests if available
- For documentation: Check links, paths, and consistency
- If no automated tests: Manual verification required
- Explicitly state verification status (verified/not verified)
