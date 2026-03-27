// State
const state = {
  projectName: null,
  branch: null,
  moduleName: null,
  variant: null,
  versionCode: null,
  versionName: null,
  jdkVersion: null,
  useCache: true,
  buildId: null,
  savedConfig: null, // Store saved configuration for current project
  activeBuilds: [], // Store active builds for display
  recentBuilds: [], // Store recent completed/failed builds for current project
  cachedApks: [], // Cache APKs to avoid redundant API calls
  availableJdkVersions: [] // Cache available JDK versions
};

// Interval ID for active builds refresh (for cleanup)
let activeBuildsIntervalId = null;
// Log polling state
let logPollIntervalId = null;
let logPollOffset = 0;
// Track whether SSE is actively delivering logs (to avoid duplicates with polling)
let sseLogActive = false;
// Track current EventSource for cleanup
let currentEventSource = null;

// Build button cooldown tracking
let buildButtonLastClickTime = 0;
const BUILD_BUTTON_COOLDOWN = 5000; // 5 seconds

// API Base URL
const API_BASE = '/build/api';

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Debounce function - delays execution until after wait milliseconds
 * have elapsed since the last time the debounced function was invoked
 * @param {Function} func - Function to debounce
 * @param {number} wait - Milliseconds to delay
 * @returns {Function} - Debounced function
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Get current configuration from state and form inputs
 * @returns {Object} - Current configuration object
 */
function getCurrentConfig() {
  const vcInput = elements.versionCode.value;
  const vnInput = elements.versionName.value;
  const jdkInput = elements.jdkVersionSelect ? elements.jdkVersionSelect.value : '';
  return {
    branch: state.branch,
    moduleName: elements.moduleSelect.value || state.moduleName,
    variant: elements.variantSelect.value || state.variant,
    versionCode: vcInput !== '' ? parseInt(vcInput, 10) : state.versionCode,
    versionName: vnInput !== '' ? vnInput : state.versionName,
    jdkVersion: jdkInput !== '' ? parseInt(jdkInput, 10) : null,
    useCache: elements.useCacheCheckbox.checked
  };
}

/**
 * Auto-save configuration with debounce (500ms)
 */
const debouncedSaveConfig = debounce(async () => {
  if (!state.projectName) return;

  const config = getCurrentConfig();
  await saveProjectConfig(state.projectName, config);
  console.log('Auto-saved config to server:', config);
}, 500);

// ============================================
// CONFIG API FUNCTIONS (Server-side storage)
// ============================================

/**
 * Load project configuration from server
 * @param {string} projectName - The project name
 * @returns {Object|null} Configuration object or null
 */
async function loadProjectConfig(projectName) {
  try {
    const res = await fetch(`${API_BASE}/config/${encodeURIComponent(projectName)}`);
    const data = await res.json();

    if (data.success) {
      return data.config;
    }
    console.error('Failed to load config:', data.error);
    return null;
  } catch (error) {
    console.error('Network error loading config:', error);
    return null;
  }
}

/**
 * Save project configuration to server
 * @param {string} projectName - The project name
 * @param {Object} config - Configuration object
 * @returns {boolean} Success status
 */
async function saveProjectConfig(projectName, config) {
  try {
    const res = await fetch(`${API_BASE}/config/${encodeURIComponent(projectName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    const data = await res.json();

    if (!data.success) {
      console.error('Failed to save config:', data.error);
    }
    return data.success;
  } catch (error) {
    console.error('Network error saving config:', error);
    return false;
  }
}

/**
 * Load available JDK versions from server
 */
async function loadJdkVersions() {
  if (state.availableJdkVersions.length > 0) {
    return state.availableJdkVersions;
  }

  try {
    const res = await fetch(`${API_BASE}/jdk-versions`);
    const data = await res.json();

    if (data.success && data.versions) {
      state.availableJdkVersions = data.versions;
      return data.versions;
    }
    console.error('Failed to load JDK versions:', data.error);
    return [];
  } catch (error) {
    console.error('Network error loading JDK versions:', error);
    return [];
  }
}

/**
 * Render JDK version dropdown
 */
function renderJdkVersions(versions, savedVersion) {
  let html = '<option value="">使用默认</option>';

  versions.forEach(v => {
    const selected = savedVersion != null && v.version === savedVersion ? 'selected' : '';
    html += `<option value="${v.version}" ${selected}>${v.label}</option>`;
  });

  if (elements.jdkVersionSelect) {
    elements.jdkVersionSelect.innerHTML = html;
  }
}

// DOM Elements
const elements = {
  projectList: document.getElementById('project-list'),
  branchSelect: document.getElementById('branch-select'),
  fetchBranchesBtn: document.getElementById('fetch-branches-btn'),
  branchLog: document.getElementById('branch-log'),
  branchLogList: document.getElementById('branch-log-list'),
  syncBtn: document.getElementById('sync-btn'),
  syncLog: document.getElementById('sync-log'),
  moduleSelect: document.getElementById('module-select'),
  variantSelect: document.getElementById('variant-select'),
  jdkVersionSelect: document.getElementById('jdk-version-select'),
  versionCode: document.getElementById('version-code'),
  versionName: document.getElementById('version-name'),
  useCacheCheckbox: document.getElementById('use-cache-checkbox'),
  buildBtn: document.getElementById('build-btn'),
  buildStatus: document.getElementById('build-status'),
  buildLog: document.getElementById('build-log'),
  apkList: document.getElementById('apk-list'),
  clearLogsBtn: document.getElementById('clear-logs-btn'),
  refreshLogsBtn: document.getElementById('refresh-logs-btn'),
  logInfo: document.getElementById('log-info'),
  steps: {
    project: document.getElementById('step-project'),
    branch: document.getElementById('step-branch'),
    module: document.getElementById('step-module'),
    config: document.getElementById('step-config'),
    build: document.getElementById('step-build')
  }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  console.log('App initialized, API_BASE:', API_BASE);
  setupEventListeners();
  loadJdkVersions(); // Load available JDK versions

  // Fetch projects and active builds in parallel, then render together
  // This ensures build indicators are available on first render
  const projectsPromise = fetch(`${API_BASE}/projects`).then(r => r.json());
  const activeBuildsPromise = loadActiveBuilds();

  Promise.all([projectsPromise, activeBuildsPromise]).then(([data]) => {
    if (data && data.success) {
      renderProjects(data.projects);
    } else {
      elements.projectList.innerHTML = `<div class="error">${data ? data.error : '加载失败'}</div>`;
    }
  }).catch(error => {
    console.error('Load projects error:', error);
    elements.projectList.innerHTML = `<div class="error">加载失败: ${error.message}</div>`;
  });
});

// Event Listeners
function setupEventListeners() {
  elements.fetchBranchesBtn.addEventListener('click', fetchAllBranches);
  elements.buildBtn.addEventListener('click', startBuild);

  // Module change - combines original handler with auto-save
  elements.moduleSelect.addEventListener('change', (e) => {
    onModuleChange();
    debouncedSaveConfig();
  });

  // Auto-save listeners for configuration fields
  // Branch selection - immediate save and auto load modules
  elements.branchSelect.addEventListener('change', async () => {
    state.branch = elements.branchSelect.value;

    if (!state.branch) {
      // User selected "请选择分支" - reset to initial state
      state.moduleName = null;
      state.variant = null;
      state.versionCode = null;
      state.versionName = null;
      state.jdkVersion = null;
      elements.steps.module.classList.add('hidden');
      elements.steps.config.classList.add('hidden');
      elements.steps.build.classList.add('hidden');
      elements.moduleSelect.innerHTML = '<option value="">请选择模块</option>';
      elements.variantSelect.innerHTML = '';
      elements.versionCode.value = '';
      elements.versionName.value = '';
      if (elements.jdkVersionSelect) {
        elements.jdkVersionSelect.innerHTML = '<option value="">使用默认</option>';
      }
      renderBranchLog([]);
      return;
    }

    // Fetch and display branch log
    fetchBranchLog(state.projectName, state.branch);

    // Immediately save config when branch changes
    if (state.projectName && state.branch) {
      const config = getCurrentConfig();
      await saveProjectConfig(state.projectName, config);
      console.log('Immediately saved config after branch selection');

      // Auto load modules after branch selection (no sync needed)
      await loadModules(state.savedConfig);
    }
  });

  elements.variantSelect.addEventListener('change', () => {
    state.variant = elements.variantSelect.value;
    debouncedSaveConfig();
  });

  elements.versionCode.addEventListener('input', () => {
    state.versionCode = parseInt(elements.versionCode.value, 10);
    debouncedSaveConfig();
  });

  elements.versionName.addEventListener('input', () => {
    state.versionName = elements.versionName.value;
    debouncedSaveConfig();
  });

  // JDK version change - auto-save
  if (elements.jdkVersionSelect) {
    elements.jdkVersionSelect.addEventListener('change', () => {
      const val = elements.jdkVersionSelect.value;
      state.jdkVersion = val !== '' ? parseInt(val, 10) : null;
      debouncedSaveConfig();
    });
  }

  // Use cache checkbox change - auto-save
  elements.useCacheCheckbox.addEventListener('change', () => {
    state.useCache = elements.useCacheCheckbox.checked;
    debouncedSaveConfig();
  });

  // Periodic refresh of active builds (every 5 seconds)
  activeBuildsIntervalId = setInterval(loadActiveBuilds, 5000);

  // Build log buttons
  elements.refreshLogsBtn.addEventListener('click', () => {
    if (state.projectName) {
      loadBuildLog(state.projectName);
    }
  });
  elements.clearLogsBtn.addEventListener('click', clearCurrentLogs);
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (activeBuildsIntervalId) {
    clearInterval(activeBuildsIntervalId);
    activeBuildsIntervalId = null;
  }
});

// Load Projects
async function loadProjects() {
  console.log('Loading projects from:', `${API_BASE}/projects`);
  try {
    const res = await fetch(`${API_BASE}/projects`);
    console.log('Response status:', res.status);
    const data = await res.json();
    console.log('Data:', data);

    if (data.success) {
      renderProjects(data.projects);
    } else {
      elements.projectList.innerHTML = `<div class="error">${data.error}</div>`;
    }
  } catch (error) {
    console.error('Load projects error:', error);
    elements.projectList.innerHTML = `<div class="error">加载失败: ${error.message}</div>`;
  }
}

// Get the latest build status for each project (building > failed > completed > none)
function getProjectBuildStatuses() {
  const statuses = {};

  // Active builds (building + pending) take highest priority
  (state.activeBuilds || []).forEach(b => {
    if (b.status === 'building' || b.status === 'pending') {
      statuses[b.projectName] = 'building';
    }
  });

  // Recent builds fill in completed/failed status (only if not currently building/pending)
  (state.recentBuilds || []).forEach(b => {
    if (!statuses[b.projectName]) {
      if (b.status === 'completed' || b.status === 'failed') {
        statuses[b.projectName] = b.status;
      }
    }
  });

  return statuses;
}

// Render Projects
function renderProjects(projects) {
  if (projects.length === 0) {
    elements.projectList.innerHTML = '<div class="loading">没有找到项目</div>';
    return;
  }

  const projectStatuses = getProjectBuildStatuses();

  elements.projectList.innerHTML = projects.map(p => {
    const status = projectStatuses[p.name];
    const safeName = escapeHtml(p.name);
    const safeType = escapeHtml(p.type);
    const indicatorHtml = status
      ? `<div class="build-indicator ${escapeHtml(status)}"></div>`
      : '';
    return `
    <div class="project-item" data-name="${safeName}" data-type="${safeType}">
      ${indicatorHtml}
      <div class="name">${safeName}</div>
      <div class="type">${safeType === 'flutter' ? 'Flutter' : 'Android'}</div>
    </div>
  `;
  }).join('');

  // Add click handlers
  document.querySelectorAll('.project-item').forEach(item => {
    item.addEventListener('click', () => selectProject(item.dataset.name));
  });
}

// Update project item build indicators without full re-render
function updateProjectBuildIndicators() {
  const projectStatuses = getProjectBuildStatuses();

  document.querySelectorAll('.project-item').forEach(item => {
    const name = item.dataset.name;
    const status = projectStatuses[name];
    const existing = item.querySelector('.build-indicator');

    if (status) {
      if (existing) {
        // Update class to reflect current status
        existing.className = `build-indicator ${status}`;
      } else {
        // Create new indicator
        const dot = document.createElement('div');
        dot.className = `build-indicator ${status}`;
        item.appendChild(dot);
      }
    } else if (existing) {
      // No build status, remove indicator
      existing.remove();
    }
  });
}

// Select Project
async function selectProject(name) {
  // Update UI
  document.querySelectorAll('.project-item').forEach(item => {
    item.classList.toggle('selected', item.dataset.name === name);
  });

  state.projectName = name;
  state.branch = null;
  state.moduleName = null;
  state.variant = null;
  state.jdkVersion = null;
  state.buildId = null;

  // Clear branch log when switching projects
  renderBranchLog([]);

  // Show branch step, hide downstream steps
  elements.steps.branch.classList.remove('hidden');
  elements.steps.module.classList.add('hidden');
  elements.steps.config.classList.add('hidden');
  elements.steps.build.classList.add('hidden');

  // Load build logs for this project from disk and always show build progress
  // Close any existing SSE connection from a previous project's build
  if (currentEventSource) {
    currentEventSource.close();
    currentEventSource = null;
  }
  stopLogPolling();
  logPollOffset = 0;
  elements.buildLog.textContent = '加载中...';
  elements.logInfo.textContent = '';
  elements.steps.build.classList.remove('hidden');
  elements.buildStatus.className = 'build-status';
  elements.buildStatus.querySelector('.status-text').textContent = '准备中...';
  loadBuildLog(name);

  // Fire-and-forget tasks
  document.getElementById('step-apk-list').classList.remove('hidden');
  loadApks();

  // Parallel: load config, active builds, and cached branches
  const [savedConfig, , cachedData] = await Promise.all([
    loadProjectConfig(name),
    loadActiveBuilds(),
    (async () => {
      try {
        elements.branchSelect.innerHTML = '<option value="">加载中...</option>';
        const cachedRes = await fetch(`${API_BASE}/projects/${name}/branches/cached`);
        return await cachedRes.json();
      } catch (error) {
        console.error('Failed to load cached branches:', error);
        return null;
      }
    })()
  ]);

  state.savedConfig = savedConfig;

  // Update build button based on whether this project has an active build
  updateBuildButtonState();

  // If there's an active or pending build for this project, reconnect SSE
  const activeForProject = state.activeBuilds.find(b => b.projectName === name);
  if (activeForProject) {
    state.buildId = activeForProject.id;
    if (activeForProject.status === 'pending') {
      elements.buildStatus.className = 'build-status queued';
      elements.buildStatus.querySelector('.status-text').textContent = '排队中... (等待构建)';
    } else {
      elements.buildStatus.className = 'build-status building';
      elements.buildStatus.querySelector('.status-text').textContent = '构建中... (重新连接)';
    }
    // Reconnect to SSE to resume receiving logs/status
    connectBuildLogs(activeForProject.id);
  }

  // Process cached branches result (from parallel fetch above)
  if (cachedData && cachedData.success && cachedData.cached && cachedData.branches.length > 0) {
    // Populate branch dropdown from cache
    renderBranches(cachedData.branches, cachedData.currentBranch);

    // Auto-select the saved branch if it exists in the cached list
    if (state.savedConfig && state.savedConfig.branch) {
      const savedBranch = state.savedConfig.branch;
      const optionExists = Array.from(elements.branchSelect.options)
        .some(opt => opt.value === savedBranch);

      if (optionExists) {
        elements.branchSelect.value = savedBranch;
        state.branch = savedBranch;
        console.log('Restored saved branch from cache:', savedBranch);

        // Fetch and display branch log for restored branch
        fetchBranchLog(name, savedBranch);

        // Auto load modules after branch restore (no sync needed)
        await loadModules(state.savedConfig);
      }
    }
    return; // Branches loaded from cache, done
  }

  // No cached branches available, show placeholder
  elements.branchSelect.innerHTML = '<option value="">请先获取分支</option>';
}

// Load Branches
async function loadBranches(projectName) {
  try {
    elements.branchSelect.innerHTML = '<option value="">加载中...</option>';

    const res = await fetch(`${API_BASE}/projects/${projectName}/branches`);
    const data = await res.json();

    if (data.success) {
      renderBranches(data.branches, data.currentBranch);
    } else {
      elements.branchSelect.innerHTML = `<option value="">加载失败</option>`;
    }
  } catch (error) {
    elements.branchSelect.innerHTML = `<option value="">错误: ${error.message}</option>`;
  }
}

// Render Branches
function renderBranches(branches, currentBranch) {
  const localBranches = branches.filter(b => b.type === 'local');
  const remoteBranches = branches.filter(b => b.type === 'remote');

  let html = '<option value="">请选择分支</option>';

  if (localBranches.length > 0) {
    html += '<optgroup label="本地分支">';
    localBranches.forEach(b => {
      const selected = b.name === currentBranch ? 'selected' : '';
      html += `<option value="${b.name}" ${selected}>${b.name}${b.current ? ' (当前)' : ''}</option>`;
    });
    html += '</optgroup>';
  }

  if (remoteBranches.length > 0) {
    html += '<optgroup label="远程分支">';
    remoteBranches.forEach(b => {
      html += `<option value="${b.name}">${b.name}</option>`;
    });
    html += '</optgroup>';
  }

  elements.branchSelect.innerHTML = html;
}

// Fetch All Branches (manual trigger)
async function fetchAllBranches() {
  const projectName = state.projectName;
  if (!projectName) {
    alert('请先选择项目');
    return;
  }

  elements.fetchBranchesBtn.disabled = true;
  elements.fetchBranchesBtn.textContent = '获取中...';
  elements.branchSelect.innerHTML = '<option value="">加载中...</option>';

  try {
    const res = await fetch(`${API_BASE}/projects/${projectName}/branches`);
    const data = await res.json();

    if (data.success) {
      renderBranches(data.branches, data.currentBranch);

      // Restore saved branch if exists
      if (state.savedConfig && state.savedConfig.branch) {
        const savedBranch = state.savedConfig.branch;
        const optionExists = Array.from(elements.branchSelect.options)
          .some(opt => opt.value === savedBranch);

        if (optionExists) {
          elements.branchSelect.value = savedBranch;
          state.branch = savedBranch;
          console.log('Restored saved branch:', savedBranch);

          // Fetch and display branch log for restored branch
          fetchBranchLog(state.projectName, savedBranch);

          // Immediately save config after branch restore
          const config = getCurrentConfig();
          await saveProjectConfig(state.projectName, config);
          console.log('Immediately saved config after branch restore');

          // Auto load modules after branch restore (same as manual selection)
          try {
            await loadModules(state.savedConfig);
          } catch (error) {
            console.error('Failed to load modules after branch restore:', error);
          }
        }
      }
    } else {
      elements.branchSelect.innerHTML = `<option value="">获取失败</option>`;
    }
  } catch (error) {
    elements.branchSelect.innerHTML = `<option value="">错误: ${error.message}</option>`;
  } finally {
    elements.fetchBranchesBtn.disabled = false;
    elements.fetchBranchesBtn.textContent = '获取所有分支';
  }
}

// Fetch Branch Log
async function fetchBranchLog(projectName, branchName) {
  if (!projectName || !branchName) {
    renderBranchLog([]);
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/projects/${projectName}/branch-log?branch=${encodeURIComponent(branchName)}`);
    const data = await res.json();

    if (data.success) {
      renderBranchLog(data.logs);
    } else {
      renderBranchLog([]);
    }
  } catch (error) {
    console.error('Failed to fetch branch log:', error);
    renderBranchLog([]);
  }
}

// Render Branch Log
function renderBranchLog(logs) {
  if (!logs || logs.length === 0) {
    elements.branchLog.classList.add('hidden');
    elements.branchLogList.innerHTML = '';
    return;
  }

  elements.branchLog.classList.remove('hidden');
  elements.branchLogList.innerHTML = logs.map(log => {
    const hash = escapeHtml(log.hash);
    const author = escapeHtml(log.author);
    const date = escapeHtml(log.date);
    const message = escapeHtml(log.message);
    return `
      <div class="branch-log-item">
        <div class="log-header">
          <span class="log-hash">${hash}</span>
          <span class="log-author">${author}</span>
          <span class="log-date">${date}</span>
        </div>
        <div class="log-message">${message}</div>
      </div>
    `;
  }).join('');
}

// Escape HTML entities to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Sync Repository
async function syncRepository() {
  const branch = elements.branchSelect.value;
  if (!branch) {
    alert('请选择分支');
    return;
  }

  state.branch = branch;

  elements.syncBtn.disabled = true;
  elements.syncBtn.textContent = '同步中...';
  elements.syncLog.classList.remove('hidden');
  elements.syncLog.textContent = '正在同步...\n';

  try {
    const res = await fetch(`${API_BASE}/projects/${state.projectName}/git/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch })
    });

    const data = await res.json();

    if (data.success) {
      elements.syncLog.textContent = data.logs.join('\n');

      // Load modules with saved config
      await loadModules(state.savedConfig);
    } else {
      elements.syncLog.textContent += `\n错误: ${data.error}`;
    }
  } catch (error) {
    elements.syncLog.textContent += `\n错误: ${error.message}`;
  } finally {
    elements.syncBtn.disabled = false;
    elements.syncBtn.textContent = '同步代码';
  }
}

// Load Modules
async function loadModules(savedConfig = null) {
  try {
    elements.moduleSelect.innerHTML = '<option value="">加载中...</option>';

    const res = await fetch(`${API_BASE}/projects/${state.projectName}/modules`);
    const data = await res.json();

    if (data.success) {
      renderModules(data.modules, savedConfig);
      elements.steps.module.classList.remove('hidden');
    } else {
      elements.moduleSelect.innerHTML = `<option value="">加载失败</option>`;
    }
  } catch (error) {
    elements.moduleSelect.innerHTML = `<option value="">错误: ${error.message}</option>`;
  }
}

// Render Modules
function renderModules(modules, savedConfig = null) {
  let html = '<option value="">请选择模块</option>';

  // Determine which module to select
  let moduleToSelect = modules[0]; // default to first

  if (savedConfig && savedConfig.moduleName) {
    const savedModule = savedConfig.moduleName;
    if (modules.includes(savedModule)) {
      moduleToSelect = savedModule;
    }
  }

  modules.forEach(m => {
    const selected = m === moduleToSelect ? 'selected' : '';
    html += `<option value="${m}" ${selected}>${m}</option>`;
  });

  elements.moduleSelect.innerHTML = html;

  // Auto-select module
  if (modules.length > 0) {
    onModuleChange(savedConfig);
  }
}

// On Module Change
async function onModuleChange(savedConfig = null) {
  const moduleName = elements.moduleSelect.value;
  if (!moduleName) return;

  state.moduleName = moduleName;

  // Load variants and version in parallel
  await Promise.all([
    loadVariants(moduleName, savedConfig),
    loadVersion(moduleName, savedConfig)
  ]);

  // Render JDK versions and restore selection
  const versions = state.availableJdkVersions.length > 0
    ? state.availableJdkVersions
    : await loadJdkVersions();
  const savedJdkVersion = savedConfig?.jdkVersion != null ? savedConfig.jdkVersion : null;
  renderJdkVersions(versions, savedJdkVersion);
  state.jdkVersion = savedJdkVersion;

  // Restore useCache checkbox state
  if (savedConfig && savedConfig.useCache !== undefined) {
    elements.useCacheCheckbox.checked = savedConfig.useCache;
    state.useCache = savedConfig.useCache;
  }

  // Show config step
  elements.steps.config.classList.remove('hidden');
}

// Load Variants
async function loadVariants(moduleName, savedConfig = null) {
  try {
    elements.variantSelect.innerHTML = '<option value="">加载中...</option>';

    const res = await fetch(`${API_BASE}/projects/${state.projectName}/modules/${moduleName}/variants`);
    const data = await res.json();

    if (data.success) {
      renderVariants(data.variants, savedConfig);
    } else {
      elements.variantSelect.innerHTML = `<option value="">加载失败</option>`;
    }
  } catch (error) {
    elements.variantSelect.innerHTML = `<option value="">错误: ${error.message}</option>`;
  }
}

// Render Variants
function renderVariants(variants, savedConfig = null) {
  // Determine which variant to select
  let variantToSelect = variants[0]; // default to first
  let savedVariantInvalid = false;

  if (savedConfig && savedConfig.variant) {
    const savedVariant = savedConfig.variant;
    if (variants.includes(savedVariant)) {
      variantToSelect = savedVariant;
    } else {
      savedVariantInvalid = true;
    }
  }

  let html = '';
  variants.forEach(v => {
    const selected = v === variantToSelect ? 'selected' : '';
    html += `<option value="${v}" ${selected}>${v}</option>`;
  });

  elements.variantSelect.innerHTML = html;
  state.variant = variantToSelect;

  // If saved variant is no longer valid, auto-save corrected variant to server
  if (savedVariantInvalid && state.projectName) {
    saveProjectConfig(state.projectName, getCurrentConfig());
    console.log(`Saved variant "${savedConfig.variant}" is no longer valid, auto-corrected to "${variantToSelect}"`);
  }
}

// Load Version
async function loadVersion(moduleName, savedConfig = null) {
  try {
    const res = await fetch(`${API_BASE}/projects/${state.projectName}/modules/${moduleName}/version`);
    const data = await res.json();

    if (data.success) {
      // If saved config has explicit version values, prefer those; otherwise use module's build.gradle values
      let versionCode, versionName;
      if (savedConfig && savedConfig.versionCode != null) {
        versionCode = savedConfig.versionCode;
      } else {
        versionCode = data.version.versionCode;
      }
      if (savedConfig && savedConfig.versionName != null && savedConfig.versionName !== '') {
        versionName = savedConfig.versionName;
      } else {
        versionName = data.version.versionName;
      }

      elements.versionCode.value = versionCode;
      elements.versionName.value = versionName;
      state.versionCode = versionCode;
      state.versionName = versionName;
    }
  } catch (error) {
    console.error('Failed to load version:', error);
  }
}

// Start Build
async function startBuild() {
  // Check cooldown (5 seconds)
  const now = Date.now();
  const timeSinceLastClick = now - buildButtonLastClickTime;

  if (timeSinceLastClick < BUILD_BUTTON_COOLDOWN) {
    const remainingSeconds = Math.ceil((BUILD_BUTTON_COOLDOWN - timeSinceLastClick) / 1000);
    showToast(`请等待 ${remainingSeconds} 秒后再试`, 'warning');
    return;
  }

  // Update last click time
  buildButtonLastClickTime = now;

  state.variant = elements.variantSelect.value;
  state.versionCode = parseInt(elements.versionCode.value, 10);
  state.versionName = elements.versionName.value;
  state.jdkVersion = elements.jdkVersionSelect && elements.jdkVersionSelect.value
    ? parseInt(elements.jdkVersionSelect.value, 10)
    : null;
  state.useCache = elements.useCacheCheckbox.checked;

  if (!state.variant) {
    alert('请选择变体');
    return;
  }

  elements.buildBtn.disabled = true;
  elements.buildBtn.textContent = '提交中...';

  try {
    // Create build
    const res = await fetch(`${API_BASE}/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectName: state.projectName,
        branch: state.branch,
        moduleName: state.moduleName,
        variant: state.variant,
        versionCode: state.versionCode,
        versionName: state.versionName,
        jdkVersion: state.jdkVersion,
        useCache: state.useCache
      })
    });

    const data = await res.json();

    if (data.success) {
      state.buildId = data.buildId;
      elements.steps.build.classList.remove('hidden');
      elements.buildLog.textContent = '';

      // Keep button disabled showing "构建中..." until loadActiveBuilds confirms state
      elements.buildBtn.disabled = true;
      elements.buildBtn.textContent = '构建中...';

      // Connect to SSE
      connectBuildLogs(data.buildId);

      // Refresh active builds, then update button state based on actual server state
      loadActiveBuilds().then(() => {
        updateBuildButtonState();
      });
    } else {
      alert(`构建失败: ${data.error}`);
      elements.buildBtn.disabled = false;
      elements.buildBtn.textContent = '开始构建';
    }
  } catch (error) {
    alert(`构建失败: ${error.message}`);
    elements.buildBtn.disabled = false;
    elements.buildBtn.textContent = '开始构建';
  }
}

/**
 * Update build button state based on whether the current project has an active or pending build
 */
function updateBuildButtonState() {
  const projectBuild = state.activeBuilds.find(b => b.projectName === state.projectName);
  if (projectBuild) {
    elements.buildBtn.disabled = true;
    elements.buildBtn.textContent = projectBuild.status === 'pending' ? '排队中...' : '构建中...';
  } else {
    elements.buildBtn.disabled = false;
    elements.buildBtn.textContent = '开始构建';
  }
}

// Connect to Build via SSE for real-time log streaming and status updates.
// Disk log polling is used as fallback when SSE log events are not received.
function connectBuildLogs(buildId) {
  // Close any existing SSE connection
  if (currentEventSource) {
    currentEventSource.close();
  }

  sseLogActive = false;
  const eventSource = new EventSource(`${API_BASE}/build/${buildId}/logs`);
  currentEventSource = eventSource;

  // Set initial status based on build state (may be updated by SSE status event)
  const buildInfo = state.activeBuilds.find(b => b.id === buildId);
  if (buildInfo && buildInfo.status === 'pending') {
    elements.buildStatus.className = 'build-status queued';
    elements.buildStatus.querySelector('.status-text').textContent = '排队中，等待构建...';
  } else {
    elements.buildStatus.className = 'build-status building';
    elements.buildStatus.querySelector('.status-text').textContent = '构建中...';
  }

  // Start polling disk logs as fallback for real-time display
  startLogPolling(buildId);

  // Listen for real-time log events from SSE (primary mechanism)
  eventSource.addEventListener('log', (e) => {
    sseLogActive = true;
    elements.buildLog.textContent += e.data;
    elements.buildLog.scrollTop = elements.buildLog.scrollHeight;
  });

  eventSource.addEventListener('status', (e) => {
    const data = JSON.parse(e.data);
    console.log('Build status:', data);
    if (data.status === 'queued') {
      elements.buildStatus.className = 'build-status queued';
      elements.buildStatus.querySelector('.status-text').textContent = '排队中，等待构建...';
    } else if (data.status === 'building') {
      elements.buildStatus.className = 'build-status building';
      elements.buildStatus.querySelector('.status-text').textContent = '构建中...';
      updateBuildButtonState();
      loadActiveBuilds();
    }
  });

  eventSource.addEventListener('complete', (e) => {
    const data = JSON.parse(e.data);
    eventSource.close();
    currentEventSource = null;

    elements.buildStatus.className = 'build-status success';
    elements.buildStatus.querySelector('.status-text').textContent = '构建成功!';

    state.buildId = null;

    // Stop polling, do a final log load from disk
    stopLogPolling();
    loadBuildLog(state.projectName);

    // Reload APK list and active builds
    loadApks();
    loadActiveBuilds().then(() => {
      updateBuildButtonState();
    });
  });

  eventSource.addEventListener('error', (e) => {
    let data;
    try {
      data = JSON.parse(e.data);
    } catch (parseErr) {
      // Non-JSON error event (e.g. connection lost), close and clean up
      eventSource.close();
      currentEventSource = null;
      state.buildId = null;
      stopLogPolling();
      loadBuildLog(state.projectName);
      loadActiveBuilds().then(() => {
        updateBuildButtonState();
      });
      return;
    }

    const errorMessage = data.error || '构建失败';

    eventSource.close();
    currentEventSource = null;

    // Detect cancellation from the error message
    if (errorMessage.includes('已取消') || errorMessage.includes('cancelled')) {
      elements.buildStatus.className = 'build-status error';
      elements.buildStatus.querySelector('.status-text').textContent = '构建已取消';
    } else {
      elements.buildStatus.className = 'build-status error';
      elements.buildStatus.querySelector('.status-text').textContent = `构建失败: ${errorMessage}`;
    }

    state.buildId = null;

    stopLogPolling();
    loadBuildLog(state.projectName);
    loadActiveBuilds().then(() => {
      updateBuildButtonState();
    });
  });

  eventSource.onerror = () => {
    eventSource.close();
    currentEventSource = null;
    state.buildId = null;
    elements.buildStatus.className = 'build-status error';
    elements.buildStatus.querySelector('.status-text').textContent = '连接断开';

    updateBuildButtonState();

    stopLogPolling();
    loadBuildLog(state.projectName);
  };
}

// Poll disk logs in real-time during build
function startLogPolling(buildId) {
  if (logPollIntervalId) return;

  logPollIntervalId = setInterval(async () => {
    if (!state.projectName) return;

    try {
      const res = await fetch(
        `${API_BASE}/build-logs/${encodeURIComponent(state.projectName)}/poll?offset=${logPollOffset}`
      );
      const data = await res.json();

      if (data.success && data.content) {
        // Only write logs from polling if SSE is not delivering them (avoid duplicates)
        if (!sseLogActive) {
          elements.buildLog.textContent += data.content;
          elements.buildLog.scrollTop = elements.buildLog.scrollHeight;
        }
        logPollOffset = data.offset;
      }

      // Check if the build is still active by querying its status
      // Don't rely on state.activeBuilds which may not be updated yet
      if (buildId) {
        try {
          const statusRes = await fetch(`${API_BASE}/build/${buildId}/status`);
          const statusData = await statusRes.json();
          if (statusData.success && ['completed', 'failed', 'cancelled'].includes(statusData.build.status)) {
            stopLogPolling();
          }
        } catch (e) {
          // Ignore status check errors, continue polling
        }
      }
    } catch (error) {
      // Ignore polling errors
    }
  }, 1000); // Poll every 1 second
}

function stopLogPolling() {
  if (logPollIntervalId) {
    clearInterval(logPollIntervalId);
    logPollIntervalId = null;
  }
  sseLogActive = false;
}

// Load APKs
async function loadApks() {
  try {
    const res = await fetch(`${API_BASE}/apks`);
    const data = await res.json();

    if (data.success) {
      // Cache APKs for reuse
      state.cachedApks = data.apks;
      renderApks(data.apks);
    }
  } catch (error) {
    console.error('Failed to load APKs:', error);
  }
}

// Load Active Builds and Build History
async function loadActiveBuilds() {
  try {
    // Fetch active builds and build history in parallel
    const [activeRes, historyRes] = await Promise.all([
      fetch(`${API_BASE}/builds/active`),
      fetch(`${API_BASE}/builds/history`).catch(() => null)
    ]);

    const [data, historyData] = await Promise.all([
      activeRes.json(),
      historyRes ? historyRes.json() : Promise.resolve(null)
    ]);

    if (data.success) {
      state.activeBuilds = data.builds;
    }

    if (historyData && historyData.success) {
      state.recentBuilds = historyData.builds;
    }

    // Update indicators AFTER both activeBuilds and recentBuilds are set
    updateProjectBuildIndicators();

    // Re-render with cached APKs (avoid redundant API call)
    renderApks(state.cachedApks);
  } catch (error) {
    console.error('Failed to load active builds:', error);
  }
}

// Cancel Build
async function cancelBuild(buildId) {
  // Confirmation dialog
  if (!confirm('确定要取消此构建吗？')) {
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/build/${buildId}`, {
      method: 'DELETE'
    });

    const data = await res.json();

    if (data.success) {
      // Show success feedback
      showToast('构建已取消', 'success');

      // Clean up SSE connection if it's for this build
      if (currentEventSource) {
        currentEventSource.close();
        currentEventSource = null;
      }

      // Stop log polling
      stopLogPolling();

      // If the cancelled build is the current build, update the UI
      if (state.buildId === buildId) {
        elements.buildStatus.className = 'build-status error';
        elements.buildStatus.querySelector('.status-text').textContent = '构建已取消';
        state.buildId = null;

        // Reload build log from disk
        if (state.projectName) {
          loadBuildLog(state.projectName);
        }
      }

      // Refresh active builds list and update button state
      await loadActiveBuilds();
      updateBuildButtonState();
    } else {
      showToast(`取消失败: ${data.error}`, 'error');
    }
  } catch (error) {
    showToast(`取消失败: ${error.message}`, 'error');
  }
}

// Show toast notification
function showToast(message, type = 'info') {
  // Remove existing toast if any
  const existingToast = document.querySelector('.toast-notification');
  if (existingToast) {
    existingToast.remove();
  }

  // Create toast element
  const toast = document.createElement('div');
  toast.className = `toast-notification toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  // Auto-remove after 3 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.remove();
    }
  }, 3000);
}

// Render APKs with Active Builds
function renderApks(apks) {
  let html = '';

  // Combine active builds and recent builds into a single build history list
  const allBuilds = [
    ...state.activeBuilds.map(b => ({ ...b, _source: 'active' })),
    ...(state.recentBuilds || []).map(b => ({ ...b, _source: 'recent' }))
  ];

  // Filter by current project
  const projectBuilds = state.projectName
    ? allBuilds.filter(b => b.projectName === state.projectName)
    : allBuilds;

  if (projectBuilds.length === 0) {
    elements.apkList.innerHTML = '<div class="loading">暂无构建记录</div>';
    return;
  }

  // Sort by start time, newest first
  projectBuilds.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

  html += projectBuilds.map(build => {
    let statusLabel, statusClass, actionsHtml;

    // Build display name with version info
    const versionInfo = (build.versionName || '') + (build.versionCode ? ` (${build.versionCode})` : '');
    const buildDisplayName = build.projectName
      + (build.moduleName ? ` - ${build.moduleName}` : '')
      + (build.variant ? ` - ${build.variant}` : '')
      + (versionInfo ? ` - ${versionInfo}` : '');

    if (build.status === 'pending') {
      statusLabel = '排队中';
      statusClass = 'apk-item queued';
      actionsHtml = `<button class="btn btn-cancel" onclick="cancelBuild('${build.id}')">取消</button>`;
    } else if (build.status === 'building') {
      statusLabel = '构建中';
      statusClass = 'apk-item building';
      actionsHtml = `<button class="btn btn-cancel" onclick="cancelBuild('${build.id}')">取消</button>`;
    } else if (build.status === 'completed') {
      statusLabel = '构建成功';
      statusClass = 'apk-item success';
      const downloadBtn = build.apkUrl
        ? `<a class="btn btn-primary" href="${build.apkUrl}" download>下载 APK</a>`
        : '';
      const deleteBtn = build.apkUrl
        ? `<button class="btn btn-danger" onclick="deleteBuildApk('${build.apkUrl}','${build.id}')">删除</button>`
        : `<button class="btn btn-danger" onclick="deleteBuildRecord('${build.id}')">删除</button>`;
      actionsHtml = downloadBtn + deleteBtn;
    } else if (build.status === 'failed') {
      statusLabel = '构建失败';
      statusClass = 'apk-item failed';
      actionsHtml = `<button class="btn btn-danger" onclick="deleteBuildRecord('${build.id}')">删除</button>`;
    } else if (build.status === 'cancelled') {
      statusLabel = '构建取消';
      statusClass = 'apk-item cancelled';
      actionsHtml = `<button class="btn btn-danger" onclick="deleteBuildRecord('${build.id}')">删除</button>`;
    } else {
      statusLabel = build.status;
      statusClass = 'apk-item';
      actionsHtml = '';
    }

    const endTime = build.endTime ? new Date(build.endTime).toLocaleString() : '';

    return `
      <div class="${statusClass}">
        <div class="apk-info">
          <div class="apk-filename">
            <span class="build-result-indicator">${statusLabel}</span>
            ${buildDisplayName}
          </div>
          <div class="apk-meta">
            开始时间: ${new Date(build.startTime).toLocaleString()} |
            结束时间: ${endTime}
            ${build.error ? '<br>错误: ' + build.error : ''}
          </div>
        </div>
        <div class="apk-actions">
          ${actionsHtml}
        </div>
      </div>
    `;
  }).join('');

  elements.apkList.innerHTML = html;
}

// Format file size
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Delete APK
async function deleteApk(filename) {
  if (!confirm(`确定要删除 ${filename} 吗?`)) return;

  try {
    const res = await fetch(`${API_BASE}/apks/${encodeURIComponent(filename)}`, {
      method: 'DELETE'
    });

    const data = await res.json();

    if (data.success) {
      loadApks();
    } else {
      alert(`删除失败: ${data.error}`);
    }
  } catch (error) {
    alert(`删除失败: ${error.message}`);
  }
}

// Delete a completed build's APK file
async function deleteBuildApk(apkUrl, buildId) {
  // Extract filename from URL like /build/apk/filename.apk
  const filename = apkUrl.split('/').pop();
  if (!filename || !confirm(`确定要删除 ${filename} 吗?`)) return;

  try {
    const res = await fetch(`${API_BASE}/apks/${encodeURIComponent(filename)}`, {
      method: 'DELETE'
    });

    const data = await res.json();

    if (data.success) {
      // Also remove build record
      await deleteBuildRecord(buildId, true);
    } else {
      alert(`删除失败: ${data.error}`);
    }
  } catch (error) {
    alert(`删除失败: ${error.message}`);
  }
}

// Delete a build record from history
async function deleteBuildRecord(buildId, silent = false) {
  try {
    const res = await fetch(`${API_BASE}/builds/${buildId}`, {
      method: 'DELETE'
    });

    const data = await res.json();

    if (data.success) {
      await loadActiveBuilds();
      if (!silent) showToast('构建记录已删除', 'success');
    } else {
      if (!silent) alert(`删除失败: ${data.error}`);
    }
  } catch (error) {
    if (!silent) alert(`删除失败: ${error.message}`);
  }
}

// ============================================
// BUILD LOG FUNCTIONS (Persistent)
// ============================================

/**
 * Load build log for a project from disk (full load, resets scroll position)
 */
async function loadBuildLog(projectName) {
  if (!projectName) return;

  // Reset offset for fresh load
  logPollOffset = 0;
  elements.buildLog.textContent = '加载中...';
  elements.buildLog.scrollTop = 0;

  try {
    const res = await fetch(`${API_BASE}/build-logs/${encodeURIComponent(projectName)}`);
    const data = await res.json();

    if (data.success) {
      // Reverse log content so newest entries appear at top
      const content = data.content || '暂无日志';
      if (data.content) {
        const lines = content.split('\n');
        lines.reverse();
        elements.buildLog.textContent = lines.join('\n');
      } else {
        elements.buildLog.textContent = content;
      }
      elements.buildLog.scrollTop = 0;

      // Update offset to end of file for subsequent polling
      logPollOffset = data.totalSize;

      if (data.totalSize > 0) {
        let info = `日志大小: ${data.sizeDisplay}`;
        if (data.trimmed) {
          info += ' (仅显示最近 512KB)';
        }
        elements.logInfo.textContent = info;
      } else {
        elements.logInfo.textContent = '';
      }
    } else {
      elements.buildLog.textContent = '暂无日志';
      elements.logInfo.textContent = '';
    }
  } catch (error) {
    elements.buildLog.textContent = '暂无日志';
    elements.logInfo.textContent = '';
  }
}

/**
 * Clear logs for the currently selected project
 */
async function clearCurrentLogs() {
  const projectName = state.projectName;
  if (!projectName) {
    alert('请先选择项目');
    return;
  }

  if (!confirm(`确定要清空 ${projectName} 的所有构建日志吗？`)) {
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/build-logs/${encodeURIComponent(projectName)}`, {
      method: 'DELETE'
    });
    const data = await res.json();

    if (data.success) {
      elements.buildLog.textContent = '日志已清空';
      elements.buildLog.scrollTop = 0;
      elements.logInfo.textContent = '';
      logPollOffset = 0;
      showToast(`${projectName} 日志已清空`, 'success');
    } else {
      showToast(`清空失败: ${data.error}`, 'error');
    }
  } catch (error) {
    showToast(`清空失败: ${error.message}`, 'error');
  }
}
