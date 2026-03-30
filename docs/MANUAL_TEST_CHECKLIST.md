# Feature Implementation - Manual Test Checklist

## Phase 1: Configuration Auto-Save

### Setup
1. Start the server: `npm start`
2. Open browser to `http://localhost:3000/build`
3. Open browser DevTools > Application > Local Storage

### Tests

#### Test 1.1: Branch Change Auto-Save
- [ ] Select a project
- [ ] Click "获取所有分支"
- [ ] Select a branch from dropdown
- [ ] **Verify**: Check console for "Auto-saved config:" message
- [ ] **Verify**: Check localStorage for updated config with new branch
- [ ] **Verify**: Config saves after 500ms debounce (not immediately)

#### Test 1.2: Module Change Auto-Save
- [ ] Select branch and sync code
- [ ] Select different module
- [ ] **Verify**: Config auto-saves with new moduleName

#### Test 1.3: Variant Change Auto-Save
- [ ] Select different variant
- [ ] **Verify**: Config auto-saves with new variant

#### Test 1.4: Version Code Auto-Save
- [ ] Change version code input
- [ ] **Verify**: Config auto-saves after 500ms
- [ ] **Verify**: Rapid changes only save once (debounce works)

#### Test 1.5: Version Name Auto-Save
- [ ] Change version name input
- [ ] **Verify**: Config auto-saves after 500ms

#### Test 1.6: Config Persistence
- [ ] Refresh the page
- [ ] Select same project
- [ ] **Verify**: All saved fields are restored

#### Test 1.7: No Save Without Project
- [ ] Before selecting project, change fields
- [ ] **Verify**: No save occurs (check console - should not see "Auto-saved config:")

## Phase 2: Backend Cancel Build

### Tests

#### Test 2.1: Cancel Pending Build
- [ ] Start a build
- [ ] Quickly check active builds: GET http://localhost:3000/build/api/builds/active
- [ ] Cancel the build: DELETE http://localhost:3000/build/api/build/{buildId}
- [ ] **Verify**: Response shows success: true
- [ ] **Verify**: Build status is "cancelled"

#### Test 2.2: Cancel Running Build
- [ ] Start a build that will take time (release build)
- [ ] Click "取消" button in APK list
- [ ] **Verify**: Build stops
- [ ] **Verify**: Process is killed
- [ ] **Verify**: "编译中" item disappears from APK list

#### Test 2.3: Cannot Cancel Completed Build
- [ ] Wait for a build to complete
- [ ] Try to cancel it via API
- [ ] **Verify**: Returns error "Cannot cancel build"

#### Test 2.4: Get Active Builds
- [ ] Start 2 builds (if maxConcurrent allows)
- [ ] GET http://localhost:3000/build/api/builds/active
- [ ] **Verify**: Returns array with 2 active builds
- [ ] **Verify**: Each build has: id, projectName, moduleName, variant, status, startTime

## Phase 3: Frontend APK List Improvements

### Tests

#### Test 3.1: Show Active Builds in APK List
- [ ] Start a build
- [ ] **Verify**: "编译中" item appears at top of APK list
- [ ] **Verify**: Item shows project, module, variant names
- [ ] **Verify**: Item has yellow background with pulse animation
- [ ] **Verify**: Item has "取消" button (NOT download/delete)

#### Test 3.2: Cancel Button Works
- [ ] Click "取消" button on active build
- [ ] **Verify**: Build is cancelled
- [ ] **Verify**: "编译中" item disappears from list

#### Test 3.3: Completed APKs Show Correct Buttons
- [ ] Look at a completed APK in the list
- [ ] **Verify**: Has "下载" button
- [ ] **Verify**: Has "删除" button
- [ ] **Verify**: NO "取消" button

#### Test 3.4: Active Builds Refresh Automatically
- [ ] Start a build
- [ ] Wait 5 seconds
- [ ] **Verify**: List refreshes (check Network tab for /builds/active request)

#### Test 3.5: SSE Complete Refreshes List
- [ ] Start a build
- [ ] Wait for completion
- [ ] **Verify**: APK list refreshes
- [ ] **Verify**: New APK appears in list
- [ ] **Verify**: "编译中" item disappears

#### Test 3.6: SSE Error Refreshes List
- [ ] Start a build that will fail (if possible)
- [ ] **Verify**: On error, active builds list refreshes
- [ ] **Verify**: "编译中" item disappears

## Edge Cases

### Test 4.1: Multiple Rapid Config Changes
- [ ] Change version code rapidly: 1, 2, 3, 4, 5
- [ ] **Verify**: Only one save occurs after debounce period
- [ ] **Verify**: Final saved value is 5

### Test 4.2: Cancel Non-Existent Build
- [ ] DELETE http://localhost:3000/build/api/build/invalid-id
- [ ] **Verify**: Returns success: false with error message

### Test 4.3: Active Builds Empty State
- [ ] Ensure no builds are running
- [ ] **Verify**: APK list shows only completed APKs
- [ ] **Verify**: No "编译中" items

### Test 4.4: No APKs State
- [ ] Delete all APKs
- [ ] Ensure no active builds
- [ ] **Verify**: Shows "暂无 APK" message

## API Endpoint Tests

Use Postman or curl to test:

```bash
# Get active builds
curl http://localhost:3000/build/api/builds/active

# Get all builds
curl http://localhost:3000/build/api/builds

# Cancel a build
curl -X DELETE http://localhost:3000/build/api/build/{buildId}

# Create a build
curl -X POST http://localhost:3000/build/api/build \
  -H "Content-Type: application/json" \
  -d '{"projectName":"YourProject","branch":"master","moduleName":"app","variant":"debug","versionCode":1,"versionName":"1.0.0"}'
```

## Success Criteria Checklist

- [ ] Configuration fields auto-save within 500ms
- [ ] Debounce prevents excessive saves
- [ ] Manual save removed from startBuild()
- [ ] APK list shows active builds at top
- [ ] Active builds have "取消" button
- [ ] Completed APKs have "下载" and "删除" buttons
- [ ] Cancel build endpoint works (DELETE /build/:id)
- [ ] Get active builds endpoint works (GET /builds/active)
- [ ] Process is killed when build cancelled
- [ ] Active builds refresh every 5 seconds
- [ ] SSE complete/error events refresh active builds
- [ ] All edge cases handled gracefully
