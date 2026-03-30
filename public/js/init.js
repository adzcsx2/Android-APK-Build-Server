(function () {
  let configuredPaths = [];
  let lastScannedPath = '';
  let verified = false;
  let configuredJdks = [];
  let defaultJdkId = null;

  const passwordOverlay = document.getElementById('password-overlay');
  const passwordInput = document.getElementById('password-input');
  const passwordBtn = document.getElementById('password-btn');
  const passwordError = document.getElementById('password-error');
  const mainContent = document.getElementById('main-content');
  const scanPathInput = document.getElementById('scan-path');
  const scanBtn = document.getElementById('scan-btn');
  const addPathBtn = document.getElementById('add-path-btn');
  const scanStatus = document.getElementById('scan-status');
  const previewSection = document.getElementById('preview-section');
  const projectPreview = document.getElementById('project-preview');
  const pathList = document.getElementById('path-list');
  const saveStatus = document.getElementById('save-status');

  // JDK elements
  const jdkNameInput = document.getElementById('jdk-name');
  const jdkVersionInput = document.getElementById('jdk-version');
  const jdkPathInput = document.getElementById('jdk-path');
  const validateJdkBtn = document.getElementById('validate-jdk-btn');
  const addJdkBtn = document.getElementById('add-jdk-btn');
  const jdkValidateStatus = document.getElementById('jdk-validate-status');
  const jdkList = document.getElementById('jdk-list');
  const jdkStatus = document.getElementById('jdk-status');

  // Password verification
  passwordBtn.addEventListener('click', verifyPassword);
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') verifyPassword();
  });
  passwordInput.focus();

  async function verifyPassword() {
    const pwd = passwordInput.value;
    if (!pwd) {
      showStatus(passwordError, '请输入密码', 'error');
      return;
    }

    passwordBtn.disabled = true;
    passwordBtn.textContent = '验证中...';

    try {
      const res = await fetch('/init/api/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd })
      });
      const data = await res.json();

      if (data.success) {
        verified = true;
        passwordOverlay.classList.add('hidden');
        mainContent.classList.remove('hidden');
        loadPaths();
        loadJdks();
      } else {
        showStatus(passwordError, data.error || '密码错误', 'error');
        passwordInput.select();
      }
    } catch (err) {
      showStatus(passwordError, '验证失败: ' + err.message, 'error');
    } finally {
      passwordBtn.disabled = false;
      passwordBtn.textContent = '确认';
    }
  }

  // Scan button
  scanBtn.addEventListener('click', async () => {
    const dirPath = scanPathInput.value.trim();
    if (!dirPath) {
      showStatus(scanStatus, '请输入目录路径', 'error');
      return;
    }

    scanBtn.disabled = true;
    scanBtn.textContent = '扫描中...';
    hideStatus(scanStatus);
    previewSection.classList.add('hidden');

    try {
      const res = await fetch('/init/api/workplaces/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath })
      });
      const data = await res.json();

      if (!data.success) {
        showStatus(scanStatus, data.error, 'error');
        return;
      }

      lastScannedPath = dirPath;
      renderPreview(data.projects, dirPath);

      if (data.projects.length === 0) {
        showStatus(scanStatus, '该目录下未找到 Android 项目', 'warning');
      } else {
        showStatus(scanStatus, '找到 ' + data.projects.length + ' 个 Android 项目', 'success');
        addPathBtn.disabled = false;
      }
    } catch (err) {
      showStatus(scanStatus, '扫描失败: ' + err.message, 'error');
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = '扫描';
    }
  });

  // Add path button - auto save
  addPathBtn.addEventListener('click', async () => {
    if (!lastScannedPath) return;

    if (configuredPaths.includes(lastScannedPath)) {
      showStatus(scanStatus, '该路径已在列表中', 'warning');
      return;
    }

    configuredPaths.push(lastScannedPath);
    addPathBtn.disabled = true;
    renderPathList();
    scanPathInput.value = '';
    previewSection.classList.add('hidden');
    hideStatus(scanStatus);

    await autoSave();
  });

  // Remove path handler - auto save
  pathList.addEventListener('click', async (e) => {
    const removeBtn = e.target.closest('.btn-remove');
    if (!removeBtn) return;

    const index = parseInt(removeBtn.dataset.index, 10);
    const pathName = configuredPaths[index];

    if (!confirm('确定要移除 ' + pathName + ' 吗？')) return;

    configuredPaths.splice(index, 1);
    renderPathList();

    await autoSave();
  });

  async function autoSave() {
    try {
      const res = await fetch('/init/api/workplaces/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: configuredPaths })
      });
      const data = await res.json();

      if (data.success) {
        showStatus(saveStatus, '已自动保存', 'success');
      } else {
        showStatus(saveStatus, '保存失败: ' + data.error, 'error');
      }
    } catch (err) {
      showStatus(saveStatus, '保存失败: ' + err.message, 'error');
    }
  }

  async function loadPaths() {
    try {
      const res = await fetch('/init/api/workplaces');
      const data = await res.json();

      if (data.success) {
        configuredPaths = data.paths || [];
        renderPathList();
      }
    } catch (err) {
      pathList.innerHTML = '<div class="status-message error">加载失败: ' + err.message + '</div>';
    }
  }

  function renderPreview(projects, dirPath) {
    if (projects.length === 0) {
      previewSection.classList.add('hidden');
      return;
    }

    projectPreview.innerHTML = projects.map(p =>
      '<div class="project-preview-item">' +
        '<div class="name">' + escapeHtml(p.name) + '</div>' +
        '<div class="path">' + escapeHtml(p.path) + '</div>' +
      '</div>'
    ).join('');

    previewSection.classList.remove('hidden');
  }

  function renderPathList() {
    if (configuredPaths.length === 0) {
      pathList.innerHTML = '<div class="empty-message">暂无工作目录，请添加</div>';
      return;
    }

    pathList.innerHTML = configuredPaths.map((p, i) =>
      '<div class="path-item">' +
        '<div class="path-info">' +
          '<div class="path-text">' + escapeHtml(p) + '</div>' +
          '<div class="path-index">#' + (i + 1) + '</div>' +
        '</div>' +
        '<button class="btn btn-danger btn-remove" data-index="' + i + '">移除</button>' +
      '</div>'
    ).join('');
  }

  // ========================
  // JDK Management
  // ========================

  // Validate JDK path
  validateJdkBtn.addEventListener('click', async () => {
    const jdkPath = jdkPathInput.value.trim();
    if (!jdkPath) {
      showStatus(jdkValidateStatus, '请输入 JDK 路径', 'error');
      return;
    }

    validateJdkBtn.disabled = true;
    validateJdkBtn.textContent = '验证中...';

    try {
      const res = await fetch('/init/api/jdks/validate-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jdkPath })
      });
      const data = await res.json();

      if (data.valid) {
        showStatus(jdkValidateStatus, '路径验证通过', 'success');
      } else {
        showStatus(jdkValidateStatus, data.error || '路径验证失败', 'error');
      }
    } catch (err) {
      showStatus(jdkValidateStatus, '验证失败: ' + err.message, 'error');
    } finally {
      validateJdkBtn.disabled = false;
      validateJdkBtn.textContent = '验证路径';
    }
  });

  // Add JDK
  addJdkBtn.addEventListener('click', async () => {
    const name = jdkNameInput.value.trim();
    const version = jdkVersionInput.value.trim();
    const jdkPath = jdkPathInput.value.trim();

    if (!name || !version || !jdkPath) {
      showStatus(jdkStatus, '请填写所有字段', 'error');
      return;
    }

    addJdkBtn.disabled = true;
    addJdkBtn.textContent = '添加中...';
    hideStatus(jdkStatus);

    try {
      const res = await fetch('/init/api/jdks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, version, jdkPath })
      });
      const data = await res.json();

      if (data.success) {
        showStatus(jdkStatus, '添加成功', 'success');
        jdkNameInput.value = '';
        jdkVersionInput.value = '';
        jdkPathInput.value = '';
        hideStatus(jdkValidateStatus);
        await loadJdks();
      } else {
        showStatus(jdkStatus, data.error || '添加失败', 'error');
      }
    } catch (err) {
      showStatus(jdkStatus, '添加失败: ' + err.message, 'error');
    } finally {
      addJdkBtn.disabled = false;
      addJdkBtn.textContent = '添加 JDK';
    }
  });

  // JDK list click handler (delete + set default)
  jdkList.addEventListener('click', async (e) => {
    const deleteBtn = e.target.closest('.btn-jdk-delete');
    const defaultBtn = e.target.closest('.btn-jdk-default');

    if (deleteBtn) {
      const id = deleteBtn.dataset.id;
      const jdk = configuredJdks.find(j => j.id === id);
      if (!jdk) return;

      if (!confirm('确定要删除 ' + jdk.name + ' 吗？')) return;

      deleteBtn.disabled = true;
      deleteBtn.textContent = '删除中...';

      try {
        const res = await fetch('/init/api/jdks/' + id, { method: 'DELETE' });
        const data = await res.json();

        if (data.success) {
          showStatus(jdkStatus, '删除成功', 'success');
          await loadJdks();
        } else {
          showStatus(jdkStatus, data.error || '删除失败', 'error');
        }
      } catch (err) {
        showStatus(jdkStatus, '删除失败: ' + err.message, 'error');
      } finally {
        await loadJdks();
      }
    }

    if (defaultBtn) {
      const id = defaultBtn.dataset.id;
      if (id === defaultJdkId) return;

      defaultBtn.disabled = true;
      defaultBtn.textContent = '设置中...';

      try {
        const res = await fetch('/init/api/jdks/' + id + '/default', { method: 'PUT' });
        const data = await res.json();

        if (data.success) {
          showStatus(jdkStatus, '已设为默认', 'success');
          await loadJdks();
        } else {
          showStatus(jdkStatus, data.error || '设置失败', 'error');
        }
      } catch (err) {
        showStatus(jdkStatus, '设置失败: ' + err.message, 'error');
      } finally {
        await loadJdks();
      }
    }
  });

  async function loadJdks() {
    try {
      const res = await fetch('/init/api/jdks');
      const data = await res.json();

      if (data.success) {
        configuredJdks = data.jdks || [];
        defaultJdkId = data.defaultId || null;
        renderJdkList();
      }
    } catch (err) {
      jdkList.innerHTML = '<div class="status-message error">加载失败: ' + err.message + '</div>';
    }
  }

  function renderJdkList() {
    if (configuredJdks.length === 0) {
      jdkList.innerHTML = '<div class="empty-message">暂无 JDK 配置，请添加</div>';
      return;
    }

    jdkList.innerHTML = configuredJdks.map(jdk => {
      const isDefault = jdk.id === defaultJdkId;
      const defaultBtnClass = isDefault ? 'btn btn-default is-active' : 'btn btn-default';
      const defaultBtnText = isDefault ? '当前默认' : '设为默认';

      return '<div class="jdk-item' + (isDefault ? ' is-default' : '') + '">' +
        '<div class="jdk-info">' +
          '<div class="jdk-name">' + escapeHtml(jdk.name) + '</div>' +
          '<div class="jdk-version">版本: ' + jdk.version + '</div>' +
          '<div class="jdk-path-text">' + escapeHtml(jdk.path) + '</div>' +
        '</div>' +
        '<div class="jdk-actions">' +
          '<button class="' + defaultBtnClass + ' btn-jdk-default" data-id="' + jdk.id + '"' + (isDefault ? ' disabled' : '') + '>' + defaultBtnText + '</button>' +
          '<button class="btn btn-danger btn-jdk-delete" data-id="' + jdk.id + '">删除</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function showStatus(el, message, type) {
    el.textContent = message;
    el.className = 'status-message ' + type;
    el.classList.remove('hidden');
  }

  function hideStatus(el) {
    el.classList.add('hidden');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
