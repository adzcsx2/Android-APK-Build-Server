# Copilot Project Instructions

This file provides guidance to GitHub Copilot when working with code in this repository.

## Project

Android APK Online Build Platform — Node.js/Express web app for building Android/Flutter APKs via browser. Windows-only, no database, JSON file persistence, vanilla JS frontend.

## Key Rules

### Reuse First
- Search target directory and similar implementations before modifying
- Reuse existing implementations, utilities, and patterns
- Make minimal changes; follow local code style
- Do not introduce new frameworks, architectures, or abstractions unless requested

### File Size
- Source files: Prefer <=500 lines; split when approaching limit
- Single responsibility per file
- Exceptions: Generated files, lockfiles, migrations, vendor, framework entries, existing large legacy files
- Do not proactively refactor untouched code to satisfy this preference

### Touched-File Discipline
- Modify only files directly related to the current task
- No batch formatting, import reordering, or lint fixes unless requested
- Preserve existing uncommitted changes

### Plan Before Executing
Plan or confirm when:
- Modifying >3 source files
- Cross-module or cross-service changes
- Adding dependencies or changing build configs
- Changing APIs, data models, routes, or persistence formats
- Refactoring or moving files

### Verification
- Run relevant tests after changes (`npx jest`)
- State verification status explicitly (verified/not verified)
- For docs: Check links, paths, and consistency

## Key Paths

- **Entry:** `server.js`, `config.json`
- **Routes:** `src/routes/` — projects, build, config, init
- **Services:** `src/services/` — buildQueue, gradleService, flutterBuildService, gitService
- **Utilities:** `src/utils/` — sse.js, spawnAsync.js
- **Frontend:** `public/` — index.html, js/app.js, js/init.js, css/style.css
- **Data:** `data/` — JSON file persistence

## Conventions

- Code style: Semicolons, double quotes, 2-space indent, const preferred
- Async: async/await pattern
- Frontend: Vanilla JS only, no framework, single state object, SSE + polling fallback
- Windows: `gradlew.bat`, `taskkill /T /F`, `shell: true`
- Commits: `type: description` (feat, fix, docs, refactor, etc.)
- Tests: `.test.js` suffix, run via `npx jest`

## Documentation

- Docs root: `/docs` with categories: plan, product, design, guide, modules, references, checklist, reports
- New docs: Check existing categories for semantic equivalence first
- Reuse existing directories; do not create duplicates
- No loose `.md` files in project root (only README.md and CLAUDE.md)

## Commands

```bash
npm install && npm start    # Install and run
npm run dev                  # Dev with --watch
npm stop                     # Stop (Windows)
npx jest                     # Run tests
```
