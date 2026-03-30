const fs = require('fs');
const path = require('path');

// Mock config.json - path must be relative to this test file
jest.mock('../../../config.json', () => ({
  androidSdk: 'C:\\Users\\test\\AppData\\Local\\Android\\Sdk',
  jdk: {
    jdk11: 'C:\\JDK\\11',
    jdk17: 'C:\\JDK\\17',
  },
  projectJdk: {},
}));

// Mock gitService
const mockSyncForBuild = jest.fn().mockResolvedValue({ success: true });
jest.mock('../gitService', () => ({
  syncForBuild: mockSyncForBuild,
}));

// Mock gradleService - only getJdkPath is imported
const mockGetJdkPath = jest.fn().mockReturnValue('C:\\JDK\\17');
jest.mock('../gradleService', () => ({
  getJdkPath: mockGetJdkPath,
}));

// Dynamic mock fs data store
const mockFsData = {};

jest.mock('fs', () => ({
  existsSync: jest.fn((p) => {
    const normalized = p.replace(/\\/g, '/');
    return !!mockFsData[normalized] || !!mockFsData[p];
  }),
  readFileSync: jest.fn((p, encoding) => {
    const normalized = p.replace(/\\/g, '/');
    const content = mockFsData[normalized] || mockFsData[p];
    if (content === undefined) {
      throw new Error(`ENOENT: no such file, ${p}`);
    }
    return content;
  }),
  writeFileSync: jest.fn((p, data) => {
    const normalized = p.replace(/\\/g, '/');
    mockFsData[normalized] = data;
    mockFsData[p] = data;
  }),
  unlinkSync: jest.fn(),
  statSync: jest.fn(),
  readdirSync: jest.fn(),
}));

// Mock child_process - use jest.fn() inside the factory to avoid hoisting issues
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

// Import after mocks are set up
const childProcess = require('child_process');
const {
  getModules,
  getVariants,
  getVersion,
  updateVersion,
  runBuild,
} = require('../flutterBuildService');

// Now we can reference the mocked spawn
const mockSpawn = childProcess.spawn;

describe('flutterBuildService', () => {
  let mockSpawnInstance;

  beforeEach(() => {
    // Clear all mock data
    Object.keys(mockFsData).forEach((key) => delete mockFsData[key]);
    mockSyncForBuild.mockClear().mockResolvedValue({ success: true });
    mockSpawn.mockClear();
    fs.writeFileSync.mockClear();
    fs.existsSync.mockClear();
    fs.readFileSync.mockClear();
    fs.unlinkSync.mockClear();

    // Default: create a mock spawn instance that exits with code 0
    mockSpawnInstance = createMockProcess(0);
    mockSpawn.mockReturnValue(mockSpawnInstance);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // getModules
  // =========================================================================
  describe('getModules', () => {
    it('should always return ["app"]', () => {
      const result = getModules('/any/project');
      expect(result).toEqual(['app']);
    });

    it('should return ["app"] even if no files exist', () => {
      const result = getModules('/nonexistent/project');
      expect(result).toEqual(['app']);
    });
  });

  // =========================================================================
  // getVariants
  // =========================================================================
  describe('getVariants', () => {
    const projectPath = 'D:/Projects/myflutter';
    const moduleName = 'app';
    const ktsPath = path.join(projectPath, 'android', moduleName, 'build.gradle.kts').replace(/\\/g, '/');

    it('should return default variants ["debug", "release"] when no build.gradle exists', () => {
      const result = getVariants(projectPath, moduleName);
      expect(result).toEqual(['debug', 'release']);
    });

    it('should return default variants when productFlavors block is missing', () => {
      mockFsData[ktsPath] = `
        android {
          buildTypes {
            release {
              minifyEnabled false
            }
          }
        }
      `;
      const result = getVariants(projectPath, moduleName);
      expect(result).toEqual(['debug', 'release']);
    });

    it('should combine Groovy-style flavors with buildTypes', () => {
      mockFsData[ktsPath] = `
        android {
          productFlavors {
            mainland {
              dimension = "env"
            }
            overseas {
              dimension = "env"
            }
          }
          buildTypes {
            debug {}
            release {}
          }
        }
      `;
      const result = getVariants(projectPath, moduleName);
      expect(result).toContain('mainlandDebug');
      expect(result).toContain('mainlandRelease');
      expect(result).toContain('overseasDebug');
      expect(result).toContain('overseasRelease');
      expect(result).toHaveLength(4);
    });

    it('should support Kotlin DSL create("name") syntax for flavors', () => {
      mockFsData[ktsPath] = `
        android {
          productFlavors {
            create("mainland") {
              dimension = "env"
            }
            create("overseas") {
              dimension = "env"
            }
          }
          buildTypes {
            release {}
            debug {}
          }
        }
      `;
      const result = getVariants(projectPath, moduleName);
      expect(result).toContain('mainlandDebug');
      expect(result).toContain('mainlandRelease');
      expect(result).toContain('overseasDebug');
      expect(result).toContain('overseasRelease');
      expect(result).toHaveLength(4); // No duplicates from Kotlin DSL parsing
    });

    it('should support mixed Groovy and Kotlin DSL flavor syntax', () => {
      mockFsData[ktsPath] = `
        android {
          productFlavors {
            mainland {
              dimension = "env"
            }
            create("overseas") {
              dimension = "env"
            }
          }
          buildTypes {
            debug {}
            release {}
          }
        }
      `;
      const result = getVariants(projectPath, moduleName);
      expect(result).toContain('mainlandDebug');
      expect(result).toContain('mainlandRelease');
      expect(result).toContain('overseasDebug');
      expect(result).toContain('overseasRelease');
    });

    it('should support Kotlin DSL flavorDimensions += syntax', () => {
      mockFsData[ktsPath] = `
        android {
          flavorDimensions += "dist"
          productFlavors {
            create("mainland") {
              dimension = "dist"
            }
            create("play") {
              dimension = "dist"
            }
          }
          buildTypes {
            release {}
            debug {}
          }
        }
      `;
      const result = getVariants(projectPath, moduleName);
      expect(result).toEqual([
        'mainlandRelease',
        'mainlandDebug',
        'playRelease',
        'playDebug'
      ]);
      expect(result).toHaveLength(4);
    });

    it('should capitalize buildType when combining with flavor', () => {
      mockFsData[ktsPath] = `
        android {
          productFlavors {
            dev {}
          }
          buildTypes {
            debug {}
            release {}
          }
        }
      `;
      const result = getVariants(projectPath, moduleName);
      expect(result).toContain('devDebug');
      expect(result).toContain('devRelease');
      expect(result).toHaveLength(2);
    });

    it('should fall back to build.gradle.kts if build.gradle does not exist', () => {
      mockFsData[ktsPath] = `
        android {
          productFlavors {
            staging {}
          }
          buildTypes {
            debug {}
            release {}
          }
        }
      `;
      const result = getVariants(projectPath, moduleName);
      expect(result).toContain('stagingDebug');
      expect(result).toContain('stagingRelease');
    });

    it('should prefer build.gradle over build.gradle.kts', () => {
      const gradlePath = path.join(projectPath, 'android', moduleName, 'build.gradle').replace(/\\/g, '/');
      mockFsData[gradlePath] = `
        android {
          productFlavors {
            production {}
          }
          buildTypes {
            debug {}
            release {}
          }
        }
      `;
      mockFsData[ktsPath] = `
        android {
          productFlavors {
            staging {}
          }
          buildTypes {
            debug {}
            release {}
          }
        }
      `;
      const result = getVariants(projectPath, moduleName);
      expect(result).toContain('productionDebug');
      expect(result).toContain('productionRelease');
      expect(result).not.toContain('stagingDebug');
    });
  });

  // =========================================================================
  // getVersion
  // =========================================================================
  describe('getVersion', () => {
    const projectPath = 'D:/Projects/myflutter';
    const pubspecPath = path.join(projectPath, 'pubspec.yaml').replace(/\\/g, '/');

    it('should parse version with build number', () => {
      mockFsData[pubspecPath] = `
name: myapp
version: 1.0.0+1
dependencies:
  flutter:
    sdk: flutter
      `;
      const result = getVersion(projectPath);
      expect(result).toEqual({ versionCode: 1, versionName: '1.0.0' });
    });

    it('should handle version without build number', () => {
      mockFsData[pubspecPath] = `
name: myapp
version: 2.3.4
      `;
      const result = getVersion(projectPath);
      expect(result).toEqual({ versionCode: 1, versionName: '2.3.4' });
    });

    it('should return defaults when no version line exists', () => {
      mockFsData[pubspecPath] = `
name: myapp
description: A test app
      `;
      const result = getVersion(projectPath);
      expect(result).toEqual({ versionCode: 1, versionName: '1.0.0' });
    });

    it('should handle version with larger build number', () => {
      mockFsData[pubspecPath] = `
version: 3.2.1+42
      `;
      const result = getVersion(projectPath);
      expect(result).toEqual({ versionCode: 42, versionName: '3.2.1' });
    });

    it('should return defaults when pubspec.yaml does not exist', () => {
      const result = getVersion('/nonexistent/project');
      expect(result).toEqual({ versionCode: 1, versionName: '1.0.0' });
    });
  });

  // =========================================================================
  // updateVersion
  // =========================================================================
  describe('updateVersion', () => {
    const projectPath = 'D:/Projects/myflutter';
    const pubspecPath = path.join(projectPath, 'pubspec.yaml').replace(/\\/g, '/');
    let mockOnLog;

    beforeEach(() => {
      mockOnLog = jest.fn();
    });

    it('should replace existing version line in pubspec.yaml', () => {
      const original = `name: myapp
version: 1.0.0+1
dependencies:
  flutter:
    sdk: flutter`;
      mockFsData[pubspecPath] = original;

      updateVersion(projectPath, 45, '1.2.3', mockOnLog);

      const written = mockFsData[pubspecPath];
      expect(written).toContain('version: 1.2.3+45');
      expect(written).not.toContain('version: 1.0.0+1');
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should call onLog with version update messages', () => {
      mockFsData[pubspecPath] = `version: 1.0.0+1\n`;

      updateVersion(projectPath, 10, '2.0.0', mockOnLog);

      const logCalls = mockOnLog.mock.calls.map((c) => c[0]);
      expect(logCalls.some((l) => l.includes('version:'))).toBe(true);
    });

    it('should log error when pubspec.yaml not found', () => {
      updateVersion('/nonexistent/project', 1, '1.0.0', mockOnLog);

      const logCalls = mockOnLog.mock.calls.map((c) => c[0]);
      expect(logCalls.some((l) => l.includes('pubspec.yaml') || l.includes('not found') || l.includes('\u2716'))).toBe(true);
    });
  });

  // =========================================================================
  // runBuild
  // =========================================================================
  describe('runBuild', () => {
    const projectPath = 'D:/Projects/myflutter';
    const pubspecPath = path.join(projectPath, 'pubspec.yaml').replace(/\\/g, '/');
    let mockOnLog;
    let mockOnProcessCreated;

    beforeEach(() => {
      mockOnLog = jest.fn();
      mockOnProcessCreated = jest.fn();

      // Set up pubspec.yaml so updateVersion works
      mockFsData[pubspecPath] = `name: myapp\nversion: 1.0.0+1\n`;
    });

    it('should call gitService.syncForBuild', async () => {
      const resultPromise = runBuild(
        projectPath, 'develop', 'mainland', 'release', 'production',
        10, '1.0.0', 17, mockOnLog, mockOnProcessCreated, null
      );

      // Wait for syncForBuild to be called
      await flushPromises();
      expect(mockSyncForBuild).toHaveBeenCalledWith(projectPath, 'develop', mockOnLog);

      // Let the rest complete
      finishMockProcess(mockSpawnInstance, 0);
      const result = await resultPromise;
      expect(result.success).toBe(true);
    });

    it('should call updateVersion with correct parameters', async () => {
      const resultPromise = runBuild(
        projectPath, 'main', 'mainland', 'debug', 'staging',
        99, '2.5.0', 17, mockOnLog, mockOnProcessCreated, null
      );

      await flushPromises();
      expect(mockSyncForBuild).toHaveBeenCalled();
      // After sync, updateVersion is called
      finishMockProcess(mockSpawnInstance, 0);
      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('version: 2.5.0+99'),
        'utf8'
      );
    });

    it('should NOT delete local.properties', async () => {
      // Set up local.properties to exist
      const localPropsPath = path.join(projectPath, 'local.properties').replace(/\\/g, '/');
      mockFsData[localPropsPath] = 'sdk.dir=C:\\Sdk';

      const resultPromise = runBuild(
        projectPath, 'main', 'mainland', 'release', 'production',
        1, '1.0.0', 17, mockOnLog, mockOnProcessCreated, null
      );

      await flushPromises();
      finishMockProcess(mockSpawnInstance, 0);
      const result = await resultPromise;
      expect(result.success).toBe(true);

      // Verify unlinkSync was NOT called on local.properties
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it('should spawn flutter build apk with correct args', async () => {
      const resultPromise = runBuild(
        projectPath, 'develop', 'mainland', 'release', 'production',
        50, '3.0.0', 17, mockOnLog, mockOnProcessCreated, null
      );

      await flushPromises();

      expect(mockSpawn).toHaveBeenCalledWith(
        'flutter',
        [
          'build',
          'apk',
          '--flavor=mainland',
          '--release',
          '--dart-define=env=production',
          '--build-name=3.0.0',
          '--build-number=50',
        ],
        expect.objectContaining({
          cwd: projectPath,
          env: expect.objectContaining({
            JAVA_HOME: 'C:\\JDK\\17',
            ANDROID_HOME: 'C:\\Users\\test\\AppData\\Local\\Android\\Sdk',
            ANDROID_SDK_ROOT: 'C:\\Users\\test\\AppData\\Local\\Android\\Sdk',
          }),
        })
      );

      finishMockProcess(mockSpawnInstance, 0);
      const result = await resultPromise;
      expect(result.success).toBe(true);
    });

    it('should set JAVA_HOME, ANDROID_HOME, ANDROID_SDK_ROOT env vars', async () => {
      const resultPromise = runBuild(
        projectPath, 'main', 'mainland', 'debug', 'dev',
        1, '1.0.0', 17, mockOnLog, mockOnProcessCreated, null
      );

      await flushPromises();

      const spawnCall = mockSpawn.mock.calls[0];
      const env = spawnCall[2].env;

      expect(env.JAVA_HOME).toBe('C:\\JDK\\17');
      expect(env.ANDROID_HOME).toBe('C:\\Users\\test\\AppData\\Local\\Android\\Sdk');
      expect(env.ANDROID_SDK_ROOT).toBe('C:\\Users\\test\\AppData\\Local\\Android\\Sdk');

      finishMockProcess(mockSpawnInstance, 0);
      const result = await resultPromise;
      expect(result.success).toBe(true);
    });

    it('should find APK at expected path on success', async () => {
      const expectedApkPath = path.join(projectPath, 'build', 'app', 'outputs', 'flutter-apk', 'app-mainland-release.apk').replace(/\\/g, '/');

      // Make the APK "exist" in mockFsData
      mockFsData[expectedApkPath] = 'fake-apk-content';

      const resultPromise = runBuild(
        projectPath, 'main', 'mainland', 'release', 'production',
        1, '1.0.0', 17, mockOnLog, mockOnProcessCreated, null
      );

      await flushPromises();
      finishMockProcess(mockSpawnInstance, 0);
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.apkPath).toBeDefined();
    });

    it('should return { success: true, logs, apkPath } on successful build', async () => {
      const resultPromise = runBuild(
        projectPath, 'main', 'mainland', 'release', 'production',
        1, '1.0.0', 17, mockOnLog, mockOnProcessCreated, null
      );

      await flushPromises();
      finishMockProcess(mockSpawnInstance, 0);
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.logs).toBeDefined();
      expect(Array.isArray(result.logs)).toBe(true);
    });

    it('should reject when build process exits with non-zero code', async () => {
      const resultPromise = runBuild(
        projectPath, 'main', 'mainland', 'release', 'production',
        1, '1.0.0', 17, mockOnLog, mockOnProcessCreated, null
      );

      await flushPromises();
      finishMockProcess(mockSpawnInstance, 1);

      await expect(resultPromise).rejects.toThrow();
    });

    it('should call onProcessCreated with the spawned process', async () => {
      const resultPromise = runBuild(
        projectPath, 'main', 'mainland', 'release', 'production',
        1, '1.0.0', 17, mockOnLog, mockOnProcessCreated, null
      );

      await flushPromises();
      expect(mockOnProcessCreated).toHaveBeenCalledWith(mockSpawnInstance);

      finishMockProcess(mockSpawnInstance, 0);
      await resultPromise;
    });

    it('should use --debug flag when buildType is debug', async () => {
      const resultPromise = runBuild(
        projectPath, 'main', 'mainland', 'debug', 'dev',
        1, '1.0.0', 17, mockOnLog, mockOnProcessCreated, null
      );

      await flushPromises();

      const spawnArgs = mockSpawn.mock.calls[0][1];
      expect(spawnArgs).toContain('--debug');
      expect(spawnArgs).not.toContain('--release');

      finishMockProcess(mockSpawnInstance, 0);
      const result = await resultPromise;
      expect(result.success).toBe(true);
    });
  });
});

// =============================================================================
// Helper: create a mock child_process object
// =============================================================================
function createMockProcess() {
  const handlers = {};
  const proc = {
    stdout: {
      on: jest.fn((event, handler) => {
        handlers['stdout:' + event] = handler;
      }),
    },
    stderr: {
      on: jest.fn((event, handler) => {
        handlers['stderr:' + event] = handler;
      }),
    },
    on: jest.fn((event, handler) => {
      handlers['process:' + event] = handler;
    }),
    kill: jest.fn(),
    _handlers: handlers,
  };
  return proc;
}

function finishMockProcess(proc, exitCode) {
  const handlers = proc._handlers;
  if (handlers['stdout:data']) {
    handlers['stdout:data'](Buffer.from('Running Flutter build...\n'));
  }
  if (handlers['process:close']) {
    handlers['process:close'](exitCode);
  }
}

// Helper to flush microtask queue (for async/await inside Promises)
function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}
