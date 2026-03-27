/**
 * Quick Verification Script
 * Verifies all implemented features are working correctly
 */

const http = require('http');

const API_BASE = 'http://localhost:3000/build/api';

console.log('========================================');
console.log('Feature Implementation Verification');
console.log('========================================\n');

// Helper function
function makeRequest(method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function verify() {
  const checks = [];

  // Check 1: Active Builds Endpoint
  console.log('1. Checking GET /builds/active...');
  try {
    const result = await makeRequest('GET', '/build/api/builds/active');
    if (result.status === 200 && result.body.success && Array.isArray(result.body.builds)) {
      console.log('   ✅ PASS: Endpoint working correctly\n');
      checks.push(true);
    } else {
      console.log('   ❌ FAIL: Unexpected response\n');
      checks.push(false);
    }
  } catch (error) {
    console.log('   ❌ FAIL: Server not responding. Is it running?\n');
    checks.push(false);
  }

  // Check 2: Cancel Build Endpoint
  console.log('2. Checking DELETE /build/:id...');
  try {
    const result = await makeRequest('DELETE', '/build/api/build/test-id');
    if (result.status === 400 && !result.body.success) {
      console.log('   ✅ PASS: Endpoint validates input correctly\n');
      checks.push(true);
    } else {
      console.log('   ❌ FAIL: Unexpected behavior\n');
      checks.push(false);
    }
  } catch (error) {
    console.log('   ❌ FAIL: Error occurred\n');
    checks.push(false);
  }

  // Check 3: All Builds Endpoint
  console.log('3. Checking GET /builds...');
  try {
    const result = await makeRequest('GET', '/build/api/builds');
    if (result.status === 200 && result.body.success && Array.isArray(result.body.builds)) {
      console.log('   ✅ PASS: Endpoint working correctly\n');
      checks.push(true);
    } else {
      console.log('   ❌ FAIL: Unexpected response\n');
      checks.push(false);
    }
  } catch (error) {
    console.log('   ❌ FAIL: Error occurred\n');
    checks.push(false);
  }

  // Check 4: Frontend Files Exist
  console.log('4. Checking frontend files...');
  const fs = require('fs');
  const path = require('path');

  const files = [
    'public/js/app.js',
    'public/css/style.css',
    'public/index.html'
  ];

  let allExist = true;
  for (const file of files) {
    const fullPath = path.join(__dirname, file);
    if (fs.existsSync(fullPath)) {
      console.log(`   ✅ ${file} exists`);
    } else {
      console.log(`   ❌ ${file} missing`);
      allExist = false;
    }
  }
  console.log();
  checks.push(allExist);

  // Check 5: Code Patterns
  console.log('5. Checking code patterns...');
  const appJs = fs.readFileSync(path.join(__dirname, 'public/js/app.js'), 'utf8');

  const patterns = [
    { name: 'debounce function', pattern: /function debounce\(/ },
    { name: 'debouncedSaveConfig', pattern: /const debouncedSaveConfig/ },
    { name: 'loadActiveBuilds', pattern: /async function loadActiveBuilds\(/ },
    { name: 'cancelBuild (frontend)', pattern: /async function cancelBuild\(/ },
    { name: 'activeBuilds state', pattern: /activeBuilds:\s*\[\]/ }
  ];

  let allPatterns = true;
  for (const { name, pattern } of patterns) {
    if (pattern.test(appJs)) {
      console.log(`   ✅ ${name} implemented`);
    } else {
      console.log(`   ❌ ${name} missing`);
      allPatterns = false;
    }
  }
  console.log();
  checks.push(allPatterns);

  // Check 6: Backend Functions
  console.log('6. Checking backend implementation...');
  const buildQueue = fs.readFileSync(path.join(__dirname, 'src/services/buildQueue.js'), 'utf8');

  const backendPatterns = [
    { name: 'cancelBuild function', pattern: /function cancelBuild\(/ },
    { name: 'getActiveBuilds function', pattern: /function getActiveBuilds\(/ },
    { name: 'registerBuildProcess', pattern: /function registerBuildProcess\(/ },
    { name: 'buildProcesses Map', pattern: /const buildProcesses = new Map\(\)/ }
  ];

  let allBackend = true;
  for (const { name, pattern } of backendPatterns) {
    if (pattern.test(buildQueue)) {
      console.log(`   ✅ ${name} implemented`);
    } else {
      console.log(`   ❌ ${name} missing`);
      allBackend = false;
    }
  }
  console.log();
  checks.push(allBackend);

  // Check 7: CSS Styles
  console.log('7. Checking CSS styles...');
  const styleCss = fs.readFileSync(path.join(__dirname, 'public/css/style.css'), 'utf8');

  const cssPatterns = [
    { name: '.apk-item.building', pattern: /\.apk-item\.building/ },
    { name: '@keyframes pulse', pattern: /@keyframes pulse/ },
    { name: '.building-indicator', pattern: /\.building-indicator/ },
    { name: '.btn-cancel', pattern: /\.btn-cancel/ }
  ];

  let allCss = true;
  for (const { name, pattern } of cssPatterns) {
    if (pattern.test(styleCss)) {
      console.log(`   ✅ ${name} style defined`);
    } else {
      console.log(`   ❌ ${name} missing`);
      allCss = false;
    }
  }
  console.log();
  checks.push(allCss);

  // Summary
  console.log('========================================');
  const passed = checks.filter(c => c).length;
  const total = checks.length;
  console.log(`Verification Results: ${passed}/${total} checks passed`);
  console.log('========================================\n');

  if (passed === total) {
    console.log('✅ All features implemented correctly!');
    console.log('   Ready for manual testing.');
    console.log('   See MANUAL_TEST_CHECKLIST.md for test procedures.\n');
    process.exit(0);
  } else {
    console.log('❌ Some checks failed.');
    console.log('   Please review the implementation.\n');
    process.exit(1);
  }
}

verify().catch(error => {
  console.error('Verification failed:', error);
  process.exit(1);
});
