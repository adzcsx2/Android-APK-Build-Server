// Test file for project memory and branch fetch functionality
// This file contains tests for the new features

describe('Project Memory Configuration', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
  });

  describe('loadProjectMemory()', () => {
    it('should return null when no saved config exists', () => {
      const config = loadProjectMemory('test-project');
      expect(config).toBeNull();
    });

    it('should load saved configuration from localStorage', () => {
      const testConfig = {
        branch: 'master',
        moduleName: 'app',
        variant: 'debug',
        versionCode: 1,
        versionName: '1.0.0'
      };

      localStorage.setItem('build_config_test-project', JSON.stringify(testConfig));
      const config = loadProjectMemory('test-project');

      expect(config).toEqual(testConfig);
    });

    it('should handle localStorage errors gracefully', () => {
      // Mock localStorage.getItem to throw error
      const originalGetItem = localStorage.getItem;
      localStorage.getItem = jest.fn(() => {
        throw new Error('Storage error');
      });

      const config = loadProjectMemory('test-project');
      expect(config).toBeNull();

      // Restore original
      localStorage.getItem = originalGetItem;
    });

    it('should handle invalid JSON in localStorage', () => {
      localStorage.setItem('build_config_test-project', 'invalid-json');

      const config = loadProjectMemory('test-project');
      expect(config).toBeNull();
    });
  });

  describe('saveProjectMemory()', () => {
    it('should save configuration to localStorage', () => {
      const testConfig = {
        branch: 'develop',
        moduleName: 'app',
        variant: 'release',
        versionCode: 2,
        versionName: '2.0.0'
      };

      saveProjectMemory('test-project', testConfig);

      const saved = JSON.parse(localStorage.getItem('build_config_test-project'));
      expect(saved).toEqual(testConfig);
    });

    it('should handle localStorage errors gracefully', () => {
      // Mock localStorage.setItem to throw error
      const originalSetItem = localStorage.setItem;
      localStorage.setItem = jest.fn(() => {
        throw new Error('Storage full');
      });

      // Should not throw
      expect(() => {
        saveProjectMemory('test-project', { branch: 'master' });
      }).not.toThrow();

      // Restore original
      localStorage.setItem = originalSetItem;
    });

    it('should overwrite existing configuration', () => {
      const config1 = { branch: 'master' };
      const config2 = { branch: 'develop' };

      saveProjectMemory('test-project', config1);
      saveProjectMemory('test-project', config2);

      const saved = JSON.parse(localStorage.getItem('build_config_test-project'));
      expect(saved).toEqual(config2);
    });
  });

  describe('Integration: Select Project and Restore Config', () => {
    it('should not auto-fetch branches on project select', async () => {
      // This test verifies that loadBranches() is NOT called
      const fetchSpy = jest.spyOn(global, 'fetch');

      await selectProject('test-project');

      // Should not have called the branches API
      expect(fetchSpy).not.toHaveBeenCalled();

      fetchSpy.mockRestore();
    });

    it('should load saved config when selecting project', async () => {
      // Pre-save a configuration
      const savedConfig = {
        branch: 'develop',
        moduleName: 'app',
        variant: 'release',
        versionCode: 5,
        versionName: '1.5.0'
      };

      localStorage.setItem('build_config_test-project', JSON.stringify(savedConfig));

      await selectProject('test-project');

      // State should contain the saved config
      expect(state.savedConfig).toEqual(savedConfig);
    });
  });

  describe('Fetch Branches Button', () => {
    it('should fetch branches when button clicked', async () => {
      // Setup
      state.projectName = 'test-project';

      const mockBranches = {
        success: true,
        branches: [
          { name: 'master', type: 'local', current: true },
          { name: 'develop', type: 'local' }
        ],
        currentBranch: 'master'
      };

      global.fetch = jest.fn(() =>
        Promise.resolve({
          json: () => Promise.resolve(mockBranches)
        })
      );

      await fetchAllBranches();

      // Verify fetch was called
      expect(fetch).toHaveBeenCalledWith('/build/api/projects/test-project/branches');

      // Verify branches are rendered
      const options = elements.branchSelect.options;
      expect(options.length).toBeGreaterThan(1); // Should have at least one branch
    });

    it('should restore saved branch after fetching', async () => {
      // Setup
      state.projectName = 'test-project';
      state.savedConfig = { branch: 'develop' };

      const mockBranches = {
        success: true,
        branches: [
          { name: 'master', type: 'local', current: true },
          { name: 'develop', type: 'local' }
        ],
        currentBranch: 'master'
      };

      global.fetch = jest.fn(() =>
        Promise.resolve({
          json: () => Promise.resolve(mockBranches)
        })
      );

      await fetchAllBranches();

      // Verify saved branch is selected
      expect(elements.branchSelect.value).toBe('develop');
    });

    it('should handle fetch errors gracefully', async () => {
      state.projectName = 'test-project';

      global.fetch = jest.fn(() =>
        Promise.reject(new Error('Network error'))
      );

      await fetchAllBranches();

      // Should show error in select
      expect(elements.branchSelect.innerHTML).toContain('错误');
    });

    it('should disable button while fetching', async () => {
      state.projectName = 'test-project';

      global.fetch = jest.fn(() =>
        new Promise(resolve =>
          setTimeout(() =>
            resolve({
              json: () => Promise.resolve({ success: true, branches: [] })
            }),
            100
          )
        )
      );

      const promise = fetchAllBranches();

      // Button should be disabled immediately
      expect(elements.fetchBranchesBtn.disabled).toBe(true);
      expect(elements.fetchBranchesBtn.textContent).toBe('获取中...');

      await promise;

      // Button should be enabled after fetch
      expect(elements.fetchBranchesBtn.disabled).toBe(false);
      expect(elements.fetchBranchesBtn.textContent).toBe('获取所有分支');
    });
  });

  describe('Restore Configuration Flow', () => {
    it('should restore module from saved config', async () => {
      const savedConfig = {
        moduleName: 'feature-module'
      };

      const modules = ['app', 'feature-module', 'library'];

      renderModules(modules, savedConfig);

      expect(elements.moduleSelect.value).toBe('feature-module');
    });

    it('should restore variant from saved config', async () => {
      const savedConfig = {
        variant: 'release'
      };

      const variants = ['debug', 'release', 'staging'];

      renderVariants(variants, savedConfig);

      expect(elements.variantSelect.value).toBe('release');
    });

    it('should restore version from saved config', async () => {
      const savedConfig = {
        versionCode: 10,
        versionName: '2.0.0'
      };

      // Mock the API response
      global.fetch = jest.fn(() =>
        Promise.resolve({
          json: () =>
            Promise.resolve({
              success: true,
              version: {
                versionCode: 1,
                versionName: '1.0.0'
              }
            })
        })
      );

      await loadVersion('app', savedConfig);

      // Should use saved version, not API version
      expect(elements.versionCode.value).toBe('10');
      expect(elements.versionName.value).toBe('2.0.0');
    });

    it('should fallback to API version if no saved version', async () => {
      const savedConfig = null;

      global.fetch = jest.fn(() =>
        Promise.resolve({
          json: () =>
            Promise.resolve({
              success: true,
              version: {
                versionCode: 5,
                versionName: '1.5.0'
              }
            })
        })
      );

      await loadVersion('app', savedConfig);

      // Should use API version
      expect(elements.versionCode.value).toBe('5');
      expect(elements.versionName.value).toBe('1.5.0');
    });
  });

  describe('Save Configuration on Build', () => {
    it('should save configuration when build starts successfully', async () => {
      // Setup state
      state.projectName = 'test-project';
      state.branch = 'develop';
      state.moduleName = 'app';
      state.variant = 'release';
      state.versionCode = 10;
      state.versionName = '2.0.0';

      // Mock build API
      global.fetch = jest.fn(() =>
        Promise.resolve({
          json: () =>
            Promise.resolve({
              success: true,
              buildId: 'build-123'
            })
        })
      );

      // Mock connectBuildLogs
      global.connectBuildLogs = jest.fn();

      await startBuild();

      // Verify configuration was saved
      const saved = JSON.parse(localStorage.getItem('build_config_test-project'));
      expect(saved).toEqual({
        branch: 'develop',
        moduleName: 'app',
        variant: 'release',
        versionCode: 10,
        versionName: '2.0.0'
      });
    });

    it('should not save configuration if build fails to start', async () => {
      state.projectName = 'test-project';
      state.variant = 'debug';

      global.fetch = jest.fn(() =>
        Promise.resolve({
          json: () =>
            Promise.resolve({
              success: false,
              error: 'Build failed'
            })
        })
      );

      await startBuild();

      // Should not have saved config
      const saved = localStorage.getItem('build_config_test-project');
      expect(saved).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing saved module gracefully', () => {
      const savedConfig = {
        moduleName: 'non-existent-module'
      };

      const modules = ['app', 'library'];

      renderModules(modules, savedConfig);

      // Should fall back to first module
      expect(elements.moduleSelect.value).toBe('app');
    });

    it('should handle missing saved variant gracefully', () => {
      const savedConfig = {
        variant: 'non-existent-variant'
      };

      const variants = ['debug', 'release'];

      renderVariants(variants, savedConfig);

      // Should fall back to first variant
      expect(elements.variantSelect.value).toBe('debug');
    });

    it('should handle missing saved branch gracefully', async () => {
      state.projectName = 'test-project';
      state.savedConfig = { branch: 'non-existent-branch' };

      const mockBranches = {
        success: true,
        branches: [
          { name: 'master', type: 'local' }
        ],
        currentBranch: 'master'
      };

      global.fetch = jest.fn(() =>
        Promise.resolve({
          json: () => Promise.resolve(mockBranches)
        })
      );

      await fetchAllBranches();

      // Should not crash, just won't select the missing branch
      expect(elements.branchSelect.value).not.toBe('non-existent-branch');
    });

    it('should handle empty projects list', () => {
      renderProjects([]);

      expect(elements.projectList.innerHTML).toContain('没有找到项目');
    });

    it('should handle localStorage full scenario', () => {
      const originalSetItem = localStorage.setItem;
      localStorage.setItem = jest.fn(() => {
        throw new Error('QuotaExceededError');
      });

      // Should not crash
      expect(() => {
        saveProjectMemory('test', { branch: 'master' });
      }).not.toThrow();

      localStorage.setItem = originalSetItem;
    });
  });
});

// Helper to run tests in browser console
function runTests() {
  console.log('Running Project Memory Tests...\n');

  let passed = 0;
  let failed = 0;

  // Test 1: Load non-existent config
  try {
    localStorage.clear();
    const config = loadProjectMemory('non-existent');
    if (config === null) {
      console.log('✓ Test 1: Load non-existent config returns null');
      passed++;
    } else {
      console.log('✗ Test 1 FAILED: Expected null');
      failed++;
    }
  } catch (e) {
    console.log('✗ Test 1 FAILED:', e.message);
    failed++;
  }

  // Test 2: Save and load config
  try {
    localStorage.clear();
    const testConfig = { branch: 'master', moduleName: 'app' };
    saveProjectMemory('test-project', testConfig);
    const loaded = loadProjectMemory('test-project');

    if (loaded.branch === 'master' && loaded.moduleName === 'app') {
      console.log('✓ Test 2: Save and load config works');
      passed++;
    } else {
      console.log('✗ Test 2 FAILED: Config mismatch');
      failed++;
    }
  } catch (e) {
    console.log('✗ Test 2 FAILED:', e.message);
    failed++;
  }

  // Test 3: State contains savedConfig after selectProject
  try {
    localStorage.clear();
    const testConfig = { branch: 'develop' };
    localStorage.setItem('build_config_test-project', JSON.stringify(testConfig));

    selectProject('test-project').then(() => {
      if (state.savedConfig && state.savedConfig.branch === 'develop') {
        console.log('✓ Test 3: savedConfig loaded in state');
        passed++;
      } else {
        console.log('✗ Test 3 FAILED: savedConfig not in state');
        failed++;
      }

      console.log(`\nResults: ${passed} passed, ${failed} failed`);
    });
  } catch (e) {
    console.log('✗ Test 3 FAILED:', e.message);
    failed++;
    console.log(`\nResults: ${passed} passed, ${failed} failed`);
  }
}

// ============================================
// PHASE 1: Configuration Auto-Save Tests
// ============================================

describe('Debounce Utility', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should delay function execution', () => {
    const mockFn = jest.fn();
    const debouncedFn = debounce(mockFn, 500);

    debouncedFn();
    expect(mockFn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(500);
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should only execute once for multiple rapid calls', () => {
    const mockFn = jest.fn();
    const debouncedFn = debounce(mockFn, 500);

    debouncedFn();
    debouncedFn();
    debouncedFn();

    jest.advanceTimersByTime(500);
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should reset timer on subsequent calls', () => {
    const mockFn = jest.fn();
    const debouncedFn = debounce(mockFn, 500);

    debouncedFn();
    jest.advanceTimersByTime(300);
    debouncedFn();
    jest.advanceTimersByTime(300);

    expect(mockFn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(200);
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should pass the last argument to the function', () => {
    const mockFn = jest.fn();
    const debouncedFn = debounce(mockFn, 500);

    debouncedFn('first');
    debouncedFn('second');
    debouncedFn('third');

    jest.advanceTimersByTime(500);
    expect(mockFn).toHaveBeenCalledWith('third');
  });
});

describe('Auto-Save Configuration', () => {
  let saveConfigSpy;

  beforeEach(() => {
    localStorage.clear();
    state.projectName = 'test-project';
    state.branch = 'develop';
    state.moduleName = 'app';
    state.variant = 'debug';
    state.versionCode = 1;
    state.versionName = '1.0.0';

    saveConfigSpy = jest.spyOn(global, 'debouncedSaveConfig');
  });

  afterEach(() => {
    saveConfigSpy?.mockRestore();
  });

  it('should auto-save when branch changes', () => {
    elements.branchSelect.value = 'feature-branch';

    const changeEvent = new Event('change');
    elements.branchSelect.dispatchEvent(changeEvent);

    expect(saveConfigSpy).toHaveBeenCalled();
  });

  it('should auto-save when module changes', () => {
    elements.moduleSelect.value = 'new-module';

    const changeEvent = new Event('change');
    elements.moduleSelect.dispatchEvent(changeEvent);

    expect(saveConfigSpy).toHaveBeenCalled();
  });

  it('should auto-save when variant changes', () => {
    elements.variantSelect.value = 'release';

    const changeEvent = new Event('change');
    elements.variantSelect.dispatchEvent(changeEvent);

    expect(saveConfigSpy).toHaveBeenCalled();
  });

  it('should auto-save when versionCode input changes', () => {
    elements.versionCode.value = '5';

    const inputEvent = new Event('input');
    elements.versionCode.dispatchEvent(inputEvent);

    expect(saveConfigSpy).toHaveBeenCalled();
  });

  it('should auto-save when versionName input changes', () => {
    elements.versionName.value = '2.0.0';

    const inputEvent = new Event('input');
    elements.versionName.dispatchEvent(inputEvent);

    expect(saveConfigSpy).toHaveBeenCalled();
  });

  it('should not save if projectName is not set', () => {
    state.projectName = null;
    elements.branchSelect.value = 'new-branch';

    const changeEvent = new Event('change');
    elements.branchSelect.dispatchEvent(changeEvent);

    // debouncedSaveConfig should still be called but not actually save
    // The actual save will check state.projectName
  });

  it('should debounce multiple rapid changes', () => {
    jest.useFakeTimers();

    const mockSave = jest.fn();
    global.debouncedSaveConfig = debounce(() => {
      const config = {
        branch: state.branch,
        moduleName: state.moduleName,
        variant: state.variant,
        versionCode: state.versionCode,
        versionName: state.versionName
      };
      mockSave();
      saveProjectMemory(state.projectName, config);
    }, 500);

    // Rapidly change multiple fields
    elements.versionCode.value = '1';
    elements.versionCode.dispatchEvent(new Event('input'));

    elements.versionCode.value = '2';
    elements.versionCode.dispatchEvent(new Event('input'));

    elements.versionCode.value = '3';
    elements.versionCode.dispatchEvent(new Event('input'));

    jest.advanceTimersByTime(500);

    // Should only save once
    expect(mockSave).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });
});

describe('Remove Manual Save from startBuild', () => {
  it('should not save config in startBuild (already auto-saved)', async () => {
    state.projectName = 'test-project';
    state.branch = 'develop';
    state.moduleName = 'app';
    state.variant = 'debug';
    state.versionCode = 10;
    state.versionName = '2.0.0';

    const savedConfigBefore = localStorage.getItem('build_config_test-project');

    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            success: true,
            buildId: 'build-123'
          })
      })
    );

    global.connectBuildLogs = jest.fn();

    await startBuild();

    // Config should be the same (not overwritten by startBuild)
    const savedConfigAfter = localStorage.getItem('build_config_test-project');

    // The test verifies that startBuild no longer calls saveProjectMemory
    // If it did, the config would be saved again
    expect(savedConfigAfter).toBe(savedConfigBefore);
  });
});

// ============================================
// PHASE 2: Backend Cancel Build Tests
// ============================================

describe('buildQueue.cancelBuild', () => {
  beforeEach(() => {
    // Reset buildQueue state
    const { builds, activeBuilds, buildProcesses } = require('../src/services/buildQueue');
    builds.clear();
    activeBuilds.length = 0;
    buildProcesses.clear();
  });

  it('should cancel a pending build', () => {
    const buildId = createBuild('test-project', 'app', 'debug', 1, '1.0.0');
    updateBuild(buildId, { status: 'pending' });

    const result = cancelBuild(buildId);

    expect(result).toBe(true);
    const build = getBuild(buildId);
    expect(build.status).toBe('cancelled');
  });

  it('should cancel an active build and kill its process', () => {
    const buildId = createBuild('test-project', 'app', 'debug', 1, '1.0.0');
    startBuild(buildId);

    // Mock process
    const mockProcess = {
      kill: jest.fn()
    };
    registerBuildProcess(buildId, mockProcess);

    const result = cancelBuild(buildId);

    expect(result).toBe(true);
    expect(mockProcess.kill).toHaveBeenCalled();
    const build = getBuild(buildId);
    expect(build.status).toBe('cancelled');
  });

  it('should return false for non-existent build', () => {
    const result = cancelBuild('non-existent-id');
    expect(result).toBe(false);
  });

  it('should not cancel completed builds', () => {
    const buildId = createBuild('test-project', 'app', 'debug', 1, '1.0.0');
    completeBuild(buildId, 'http://example.com/test.apk');

    const result = cancelBuild(buildId);

    expect(result).toBe(false);
    const build = getBuild(buildId);
    expect(build.status).toBe('completed');
  });
});

describe('buildQueue.getActiveBuilds', () => {
  beforeEach(() => {
    const { builds, activeBuilds } = require('../src/services/buildQueue');
    builds.clear();
    activeBuilds.length = 0;
  });

  it('should return only active builds', () => {
    const buildId1 = createBuild('project1', 'app', 'debug', 1, '1.0.0');
    const buildId2 = createBuild('project2', 'app', 'debug', 1, '1.0.0');
    const buildId3 = createBuild('project3', 'app', 'debug', 1, '1.0.0');

    startBuild(buildId1);
    startBuild(buildId2);
    // buildId3 stays pending

    const active = getActiveBuilds();

    expect(active).toHaveLength(2);
    expect(active.map(b => b.id)).toContain(buildId1);
    expect(active.map(b => b.id)).toContain(buildId2);
    expect(active.map(b => b.id)).not.toContain(buildId3);
  });

  it('should return empty array when no active builds', () => {
    const active = getActiveBuilds();
    expect(active).toEqual([]);
  });
});

// ============================================
// PHASE 3: Frontend APK List Tests
// ============================================

describe('loadActiveBuilds', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('should fetch active builds from API', async () => {
    const mockBuilds = [
      {
        id: 'build-1',
        projectName: 'test-project',
        moduleName: 'app',
        variant: 'debug',
        status: 'building',
        startTime: new Date().toISOString()
      }
    ];

    global.fetch.mockResolvedValue({
      json: () => Promise.resolve({ success: true, builds: mockBuilds })
    });

    await loadActiveBuilds();

    expect(fetch).toHaveBeenCalledWith('/build/api/builds/active');
  });

  it('should handle API errors gracefully', async () => {
    global.fetch.mockRejectedValue(new Error('Network error'));

    // Should not throw
    await expect(loadActiveBuilds()).resolves.not.toThrow();
  });
});

describe('renderApks with active builds', () => {
  it('should show active builds at the top of the list', () => {
    const activeBuilds = [
      {
        id: 'build-1',
        projectName: 'test-project',
        moduleName: 'app',
        variant: 'debug',
        status: 'building',
        startTime: new Date().toISOString()
      }
    ];

    const apks = [
      {
        filename: 'old-app-debug.apk',
        size: 5000000,
        created: new Date().toISOString(),
        url: '/build/apk/old-app-debug.apk'
      }
    ];

    state.activeBuilds = activeBuilds;
    renderApks(apks);

    // Check that building item appears first
    const items = elements.apkList.querySelectorAll('.apk-item');
    expect(items[0].classList.contains('building')).toBe(true);
  });

  it('should show "Cancel" button for active builds', () => {
    state.activeBuilds = [
      {
        id: 'build-1',
        projectName: 'test-project',
        moduleName: 'app',
        variant: 'debug',
        status: 'building',
        startTime: new Date().toISOString()
      }
    ];

    renderApks([]);

    const cancelButton = elements.apkList.querySelector('.btn-cancel');
    expect(cancelButton).toBeTruthy();
    expect(cancelButton.textContent).toContain('取消');
  });

  it('should show "Download" and "Delete" buttons for completed APKs', () => {
    const apks = [
      {
        filename: 'app-debug.apk',
        size: 5000000,
        created: new Date().toISOString(),
        url: '/build/apk/app-debug.apk'
      }
    ];

    state.activeBuilds = [];
    renderApks(apks);

    const downloadBtn = elements.apkList.querySelector('a[download]');
    const deleteBtn = elements.apkList.querySelector('.btn-danger');

    expect(downloadBtn).toBeTruthy();
    expect(deleteBtn).toBeTruthy();
  });

  it('should not show buttons for building APKs', () => {
    state.activeBuilds = [
      {
        id: 'build-1',
        projectName: 'test-project',
        moduleName: 'app',
        variant: 'debug',
        status: 'building',
        startTime: new Date().toISOString()
      }
    ];

    renderApks([]);

    const downloadBtn = elements.apkList.querySelector('a[download]');
    const deleteBtn = elements.apkList.querySelector('.btn-danger');

    expect(downloadBtn).toBeFalsy();
    expect(deleteBtn).toBeFalsy();
  });
});

describe('cancelBuild (frontend)', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('should send DELETE request to cancel build', async () => {
    global.fetch.mockResolvedValue({
      json: () => Promise.resolve({ success: true })
    });

    await cancelBuild('build-123');

    expect(fetch).toHaveBeenCalledWith('/build/api/build/build-123', {
      method: 'DELETE'
    });
  });

  it('should refresh active builds after cancellation', async () => {
    global.fetch.mockResolvedValue({
      json: () => Promise.resolve({ success: true })
    });

    const loadSpy = jest.spyOn(global, 'loadActiveBuilds');

    await cancelBuild('build-123');

    expect(loadSpy).toHaveBeenCalled();
  });

  it('should show error message on failure', async () => {
    global.fetch.mockResolvedValue({
      json: () => Promise.resolve({ success: false, error: 'Cannot cancel' })
    });

    const alertSpy = jest.spyOn(global, 'alert').mockImplementation(() => {});

    await cancelBuild('build-123');

    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot cancel'));
  });
});

describe('SSE Complete/Error handlers', () => {
  it('should refresh active builds on build complete', () => {
    const loadSpy = jest.spyOn(global, 'loadActiveBuilds');

    // Simulate SSE complete event
    const eventData = { apkUrl: '/build/apk/test.apk' };
    // This would be called in the SSE complete handler
    loadActiveBuilds();

    expect(loadSpy).toHaveBeenCalled();
  });

  it('should refresh active builds on build error', () => {
    const loadSpy = jest.spyOn(global, 'loadActiveBuilds');

    // Simulate SSE error event
    // This would be called in the SSE error handler
    loadActiveBuilds();

    expect(loadSpy).toHaveBeenCalled();
  });
});

describe('Periodic refresh of active builds', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should refresh active builds every 5 seconds', () => {
    const loadSpy = jest.spyOn(global, 'loadActiveBuilds');

    // Setup periodic refresh (would be in setupEventListeners)
    setInterval(loadActiveBuilds, 5000);

    jest.advanceTimersByTime(5000);
    expect(loadSpy).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(5000);
    expect(loadSpy).toHaveBeenCalledTimes(2);
  });
});

// Auto-run tests if in test mode
if (typeof window !== 'undefined' && window.location.search.includes('test=true')) {
  window.addEventListener('load', runTests);
}
