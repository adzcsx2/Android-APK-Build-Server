const {
  createBuild,
  getBuild,
  getActiveBuilds,
  updateBuild,
  startBuild,
  completeBuild,
  cancelBuild,
  registerBuildProcess,
  builds,
  activeBuilds,
  buildProcesses
} = require('./buildQueue');

describe('buildQueue', () => {
  beforeEach(() => {
    // Clear all state before each test
    builds.clear();
    activeBuilds.length = 0;
    buildProcesses.clear();
  });

  describe('cancelBuild', () => {
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
      startBuild(buildId);
      completeBuild(buildId, 'http://example.com/test.apk');

      const result = cancelBuild(buildId);

      expect(result).toBe(false);
      const build = getBuild(buildId);
      expect(build.status).toBe('completed');
    });

    it('should not cancel failed builds', () => {
      const buildId = createBuild('test-project', 'app', 'debug', 1, '1.0.0');
      startBuild(buildId);
      const { failBuild } = require('./buildQueue');
      failBuild(buildId, 'Build error');

      const result = cancelBuild(buildId);

      expect(result).toBe(false);
      const build = getBuild(buildId);
      expect(build.status).toBe('failed');
    });

    it('should remove build from activeBuilds array', () => {
      const buildId = createBuild('test-project', 'app', 'debug', 1, '1.0.0');
      startBuild(buildId);

      expect(activeBuilds).toContain(buildId);

      cancelBuild(buildId);

      expect(activeBuilds).not.toContain(buildId);
    });

    it('should clean up process reference', () => {
      const buildId = createBuild('test-project', 'app', 'debug', 1, '1.0.0');
      startBuild(buildId);

      const mockProcess = { kill: jest.fn() };
      registerBuildProcess(buildId, mockProcess);

      expect(buildProcesses.has(buildId)).toBe(true);

      cancelBuild(buildId);

      expect(buildProcesses.has(buildId)).toBe(false);
    });
  });

  describe('getActiveBuilds', () => {
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

    it('should include build metadata', () => {
      const buildId = createBuild('test-project', 'app', 'debug', 1, '1.0.0');
      startBuild(buildId);

      const active = getActiveBuilds();

      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({
        id: buildId,
        projectName: 'test-project',
        moduleName: 'app',
        variant: 'debug',
        status: 'building'
      });
    });

    it('should not include completed builds after completion', () => {
      const buildId = createBuild('test-project', 'app', 'debug', 1, '1.0.0');
      startBuild(buildId);
      completeBuild(buildId, 'http://example.com/test.apk');

      const active = getActiveBuilds();
      expect(active).toHaveLength(0);
    });
  });

  describe('registerBuildProcess', () => {
    it('should store process reference', () => {
      const buildId = 'test-build-id';
      const mockProcess = { pid: 12345 };

      registerBuildProcess(buildId, mockProcess);

      expect(buildProcesses.get(buildId)).toBe(mockProcess);
    });

    it('should overwrite existing process', () => {
      const buildId = 'test-build-id';
      const process1 = { pid: 11111 };
      const process2 = { pid: 22222 };

      registerBuildProcess(buildId, process1);
      registerBuildProcess(buildId, process2);

      expect(buildProcesses.get(buildId)).toBe(process2);
    });
  });
});
