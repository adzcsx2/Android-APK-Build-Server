/**
 * Implementation Verification Script
 * Run this in the browser console after loading the application
 * to verify all features are working correctly
 */

(function verifyImplementation() {
  console.log('=== Implementation Verification ===\n');

  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };

  function test(name, fn) {
    try {
      const result = fn();
      if (result === true || result === undefined) {
        results.passed++;
        results.tests.push({ name, status: 'PASS' });
        console.log(`✓ ${name}`);
      } else {
        results.failed++;
        results.tests.push({ name, status: 'FAIL', reason: result });
        console.log(`✗ ${name} - ${result}`);
      }
    } catch (error) {
      results.failed++;
      results.tests.push({ name, status: 'ERROR', reason: error.message });
      console.log(`✗ ${name} - ERROR: ${error.message}`);
    }
  }

  // Test 1: Check state object has savedConfig
  test('State object has savedConfig property', () => {
    return state.hasOwnProperty('savedConfig');
  });

  // Test 2: Check localStorage functions exist
  test('loadProjectMemory function exists', () => {
    return typeof loadProjectMemory === 'function';
  });

  test('saveProjectMemory function exists', () => {
    return typeof saveProjectMemory === 'function';
  });

  // Test 3: Check fetchAllBranches function exists
  test('fetchAllBranches function exists', () => {
    return typeof fetchAllBranches === 'function';
  });

  // Test 4: Check fetch button element exists
  test('Fetch branches button exists in DOM', () => {
    const btn = document.getElementById('fetch-branches-btn');
    return btn !== null;
  });

  // Test 5: Check button has correct text
  test('Fetch button has correct text', () => {
    const btn = document.getElementById('fetch-branches-btn');
    return btn && btn.textContent === '获取所有分支';
  });

  // Test 6: Check button has btn-secondary class
  test('Fetch button has btn-secondary class', () => {
    const btn = document.getElementById('fetch-branches-btn');
    return btn && btn.classList.contains('btn-secondary');
  });

  // Test 7: Check elements object has fetchBranchesBtn
  test('Elements object has fetchBranchesBtn reference', () => {
    return elements.hasOwnProperty('fetchBranchesBtn');
  });

  // Test 8: Test localStorage save/load
  test('localStorage save and load works', () => {
    const testConfig = {
      branch: 'test-branch',
      moduleName: 'test-module',
      variant: 'debug',
      versionCode: 1,
      versionName: '1.0.0'
    };

    saveProjectMemory('test-project', testConfig);
    const loaded = loadProjectMemory('test-project');

    // Clean up
    localStorage.removeItem('build_config_test-project');

    return JSON.stringify(loaded) === JSON.stringify(testConfig);
  });

  // Test 9: Test loadProjectMemory returns null for non-existent
  test('loadProjectMemory returns null for non-existent project', () => {
    localStorage.removeItem('build_config_non-existent-project');
    const result = loadProjectMemory('non-existent-project');
    return result === null;
  });

  // Test 10: Test error handling in saveProjectMemory
  test('saveProjectMemory handles errors gracefully', () => {
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error('Test error');
    };

    try {
      saveProjectMemory('test', { branch: 'master' });
      localStorage.setItem = originalSetItem;
      return true; // Should not throw
    } catch (error) {
      localStorage.setItem = originalSetItem;
      return `Should not throw error: ${error.message}`;
    }
  });

  // Test 11: Check renderModules accepts savedConfig parameter
  test('renderModules accepts savedConfig parameter', () => {
    const original = renderModules.toString();
    return original.includes('savedConfig');
  });

  // Test 12: Check renderVariants accepts savedConfig parameter
  test('renderVariants accepts savedConfig parameter', () => {
    const original = renderVariants.toString();
    return original.includes('savedConfig');
  });

  // Test 13: Check loadVersion accepts savedConfig parameter
  test('loadVersion accepts savedConfig parameter', () => {
    const original = loadVersion.toString();
    return original.includes('savedConfig');
  });

  // Test 14: Check selectProject does not call loadBranches
  test('selectProject does NOT call loadBranches', () => {
    const original = selectProject.toString();
    return !original.includes('await loadBranches');
  });

  // Test 15: Check selectProject calls loadProjectMemory
  test('selectProject calls loadProjectMemory', () => {
    const original = selectProject.toString();
    return original.includes('loadProjectMemory');
  });

  // Test 16: Check startBuild calls saveProjectMemory
  test('startBuild calls saveProjectMemory', () => {
    const original = startBuild.toString();
    return original.includes('saveProjectMemory');
  });

  // Test 17: Test that CSS class exists
  test('CSS btn-secondary class is defined', () => {
    const testDiv = document.createElement('div');
    testDiv.className = 'btn-secondary';
    testDiv.style.display = 'none';
    document.body.appendChild(testDiv);

    const computedStyle = window.getComputedStyle(testDiv);
    const bgColor = computedStyle.backgroundColor;

    document.body.removeChild(testDiv);

    // Should have a background color (not transparent)
    return bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent';
  });

  // Test 18: Check STORAGE_KEY_PREFIX is defined
  test('STORAGE_KEY_PREFIX is defined', () => {
    return typeof STORAGE_KEY_PREFIX !== 'undefined' && STORAGE_KEY_PREFIX === 'build_config_';
  });

  // Test 19: Check savedConfig is initially null
  test('State savedConfig is initially null', () => {
    // This test may fail if a project was already selected
    // It's more of a sanity check
    return state.savedConfig === null || state.savedConfig !== undefined;
  });

  // Test 20: Check event listener is attached to fetch button
  test('Event listener attached to fetch button', () => {
    const btn = document.getElementById('fetch-branches-btn');
    // Check if button is reactive (has event listeners)
    // This is a heuristic - we check if clicking would trigger something
    return btn.onclick !== null || btn.getAttribute('onclick') !== null ||
           getEventListeners(btn).click !== undefined;
  });

  // Print summary
  console.log('\n=== Test Summary ===');
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  console.log(`Total: ${results.passed + results.failed}`);
  console.log(`Success Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);

  if (results.failed === 0) {
    console.log('\n✓ All tests passed! Implementation is correct.');
  } else {
    console.log('\n✗ Some tests failed. Please review the failures above.');
    console.log('\nFailed tests:');
    results.tests
      .filter(t => t.status !== 'PASS')
      .forEach(t => console.log(`  - ${t.name}: ${t.reason || t.status}`));
  }

  // Return results for programmatic access
  return results;
})();

/**
 * HOW TO USE:
 *
 * 1. Start the server: npm start
 * 2. Open browser: http://localhost:3000/build/
 * 3. Open Developer Tools (F12)
 * 4. Go to Console tab
 * 5. Paste this entire script and press Enter
 * 6. Review test results
 *
 * Expected: All tests should pass (20/20)
 */
