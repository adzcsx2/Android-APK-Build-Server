# Testing Guide: Project Memory & Branch Fetch

## Overview
This guide provides step-by-step instructions for manually testing the two new features:
1. **Project Memory Configuration** - Saves/restores project configuration
2. **Branch Fetch Optimization** - Manual branch fetching instead of auto-fetch

## Prerequisites
- Start the server: `npm start` or `node server.js`
- Open browser to: `http://localhost:3000/build/`
- Open browser Developer Tools (F12) - Console tab

---

## Feature 1: Branch Fetch Optimization

### Test Case 1.1: No Auto-Fetch on Project Selection
**Purpose:** Verify that selecting a project does NOT automatically fetch branches

**Steps:**
1. Open the application
2. Click on any project in the project list
3. Observe the branch select dropdown

**Expected Result:**
- Branch select shows "请先获取分支" (Please fetch branches first)
- No network request to `/api/projects/{name}/branches` in Network tab
- Branch step is visible immediately (no delay)

**Pass/Fail:** [ ]

---

### Test Case 1.2: Manual Branch Fetch
**Purpose:** Verify the "获取所有分支" button works correctly

**Steps:**
1. Select a project (e.g., "MyAndroidApp")
2. Click the "获取所有分支" button
3. Observe the button state and branch select

**Expected Result:**
- Button text changes to "获取中..." while loading
- Button is disabled during fetch
- Branch select shows "加载中..." while loading
- After fetch completes, branches are populated in dropdown
- Button text returns to "获取所有分支"
- Button is enabled again

**Pass/Fail:** [ ]

---

### Test Case 1.3: Error Handling for Branch Fetch
**Purpose:** Verify error handling when fetch fails

**Steps:**
1. Stop the server (to simulate network error)
2. Select a project
3. Click "获取所有分支" button
4. Observe the branch select and console

**Expected Result:**
- Branch select shows error message
- Button returns to normal state
- Error logged in console
- No JavaScript crashes

**Pass/Fail:** [ ]

---

## Feature 2: Project Memory Configuration

### Test Case 2.1: Save Configuration on Build
**Purpose:** Verify configuration is saved when build starts

**Steps:**
1. Start server
2. Open application
3. Select a project
4. Click "获取所有分支"
5. Select branch: `develop`
6. Click "同步代码"
7. Select module: `app` (or any available)
8. Select variant: `release`
9. Set version code: `10`
10. Set version name: `2.0.0`
11. Click "开始构建"
12. Open Console and check for "Saved config for project" message
13. Open Application tab > Local Storage > your domain
14. Look for key `build_config_{projectName}`

**Expected Result:**
- Console shows: "Saved config for project: {name}"
- LocalStorage contains key with saved configuration
- Configuration includes: branch, moduleName, variant, versionCode, versionName

**Pass/Fail:** [ ]

---

### Test Case 2.2: Restore Branch Configuration
**Purpose:** Verify saved branch is restored after manual fetch

**Steps:**
1. (Continuing from Test 2.1 - configuration already saved)
2. Refresh the page (F5)
3. Select the SAME project again
4. Click "获取所有分支"
5. Observe the branch select

**Expected Result:**
- After fetch completes, branch select automatically selects `develop` (saved branch)
- Console shows: "Restored saved branch: develop"

**Pass/Fail:** [ ]

---

### Test Case 2.3: Restore Module Configuration
**Purpose:** Verify saved module is restored after sync

**Steps:**
1. (Continuing from Test 2.2)
2. Select the restored branch
3. Click "同步代码"
4. Wait for sync to complete
5. Observe the module select

**Expected Result:**
- Module select automatically selects the saved module
- If saved module is `app`, it should be selected (not defaulting to first)

**Pass/Fail:** [ ]

---

### Test Case 2.4: Restore Variant Configuration
**Purpose:** Verify saved variant is restored

**Steps:**
1. (Continuing from Test 2.3)
2. After modules load, observe variant select

**Expected Result:**
- Variant select automatically selects the saved variant
- If saved variant is `release`, it should be selected

**Pass/Fail:** [ ]

---

### Test Case 2.5: Restore Version Configuration
**Purpose:** Verify saved version values are restored

**Steps:**
1. (Continuing from Test 2.4)
2. Check Version Code input field
3. Check Version Name input field

**Expected Result:**
- Version Code shows `10` (saved value, not API default)
- Version Name shows `2.0.0` (saved value, not API default)

**Pass/Fail:** [ ]

---

### Test Case 2.6: Multiple Projects Memory
**Purpose:** Verify memory works independently for different projects

**Steps:**
1. Configure and build Project A with:
   - Branch: `master`
   - Module: `app`
   - Variant: `debug`
   - Version Code: `1`
   - Version Name: `1.0.0`
2. Configure and build Project B with:
   - Branch: `develop`
   - Module: `feature-module`
   - Variant: `release`
   - Version Code: `5`
   - Version Name: `2.5.0`
3. Refresh page
4. Select Project A and fetch branches
5. Observe restored config
6. Select Project B and fetch branches
7. Observe restored config

**Expected Result:**
- Project A restores: master, app, debug, 1, 1.0.0
- Project B restores: develop, feature-module, release, 5, 2.5.0
- Configurations are independent per project

**Pass/Fail:** [ ]

---

### Test Case 2.7: Handle Missing Saved Branch
**Purpose:** Verify graceful handling when saved branch no longer exists

**Steps:**
1. Manually edit localStorage to set a non-existent branch:
   ```javascript
   localStorage.setItem('build_config_MyAndroidApp',
     JSON.stringify({branch: 'deleted-branch'}));
   ```
2. Refresh page
3. Select the project
4. Click "获取所有分支"
5. Observe branch select

**Expected Result:**
- No JavaScript errors
- Branch select shows current branch or first available
- Application continues to work normally

**Pass/Fail:** [ ]

---

### Test Case 2.8: Handle Missing Saved Module
**Purpose:** Verify graceful handling when saved module no longer exists

**Steps:**
1. Manually edit localStorage:
   ```javascript
   localStorage.setItem('build_config_MyAndroidApp',
     JSON.stringify({branch: 'master', moduleName: 'deleted-module'}));
   ```
2. Select project, fetch branches, select branch, sync
3. Observe module select

**Expected Result:**
- No JavaScript errors
- Module select falls back to first available module
- Application continues to work normally

**Pass/Fail:** [ ]

---

### Test Case 2.9: Handle Missing Saved Variant
**Purpose:** Verify graceful handling when saved variant no longer exists

**Steps:**
1. Manually edit localStorage:
   ```javascript
   localStorage.setItem('build_config_MyAndroidApp',
     JSON.stringify({branch: 'master', moduleName: 'app', variant: 'deleted-variant'}));
   ```
2. Complete project selection and sync
3. Observe variant select

**Expected Result:**
- No JavaScript errors
- Variant select falls back to first available variant
- Application continues to work normally

**Pass/Fail:** [ ]

---

### Test Case 2.10: LocalStorage Error Handling
**Purpose:** Verify application handles localStorage errors gracefully

**Steps:**
1. Open Console
2. Override localStorage to simulate error:
   ```javascript
   const original = localStorage.setItem;
   localStorage.setItem = () => { throw new Error('Storage full'); };
   ```
3. Start a build
4. Observe console (should show error but not crash)
5. Restore localStorage:
   ```javascript
   localStorage.setItem = original;
   ```

**Expected Result:**
- Console shows error: "Failed to save project memory"
- Build continues normally
- No JavaScript crashes
- Application remains functional

**Pass/Fail:** [ ]

---

## Automated Tests

### Running Browser-Based Tests
1. Start the server
2. Open: `http://localhost:3000/build/test.html`
3. Click "Run Tests" button
4. Review test results

**Expected Result:**
- All tests should pass (green checkmarks)
- Summary shows 100% success rate
- No JavaScript errors in console

**Pass/Fail:** [ ]

---

## Integration Tests

### Test Case I.1: Full Workflow
**Purpose:** Test complete workflow with memory

**Steps:**
1. Fresh start (clear localStorage)
2. Select project
3. Fetch branches manually
4. Select branch: `feature/test`
5. Sync code
6. Select module: `feature-module`
7. Select variant: `debug`
8. Set version: `15` / `3.0.0`
9. Build successfully
10. Refresh page (F5)
11. Select same project
12. Fetch branches
13. Click through without changing anything
14. Build again

**Expected Result:**
- Second time, all selections are automatically restored
- User can build immediately without re-configuring
- Build succeeds with same configuration

**Pass/Fail:** [ ]

---

## Performance Tests

### Test Case P.1: No Delay on Project Selection
**Purpose:** Verify immediate response when selecting project

**Steps:**
1. Open application
2. Click on a project
3. Measure time until branch step appears

**Expected Result:**
- Branch step appears immediately (< 100ms)
- No network activity
- No loading spinner/delay

**Pass/Fail:** [ ]

---

## Browser Compatibility

Test in multiple browsers:
- [ ] Chrome/Edge (Chromium)
- [ ] Firefox
- [ ] Safari

---

## Test Summary

| Category | Tests | Passed | Failed |
|----------|-------|--------|--------|
| Branch Fetch | 3 | | |
| Memory Config | 10 | | |
| Integration | 1 | | |
| Performance | 1 | | |
| **TOTAL** | **15** | | |

**Overall Result:** [ ] PASS / [ ] FAIL

**Tester:** _______________

**Date:** _______________

**Notes:**
_______________________________________
_______________________________________
_______________________________________
