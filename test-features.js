/**
 * Test Script for Feature Verification
 * Run with: node test-features.js
 */

const http = require('http');

const API_BASE = 'http://localhost:3000/build/api';

// Helper function to make HTTP requests
function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

// Test Suite
async function runTests() {
  console.log('========================================');
  console.log('Feature Test Suite');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  // Test 1: Get Active Builds
  console.log('Test 1: GET /builds/active');
  try {
    const result = await makeRequest('GET', '/build/api/builds/active');
    if (result.success && Array.isArray(result.builds)) {
      console.log('  PASS: Returns array of active builds\n');
      passed++;
    } else {
      console.log('  FAIL: Unexpected response format\n');
      failed++;
    }
  } catch (error) {
    console.log(`  FAIL: ${error.message}`);
    console.log('  Make sure server is running on port 3000\n');
    failed++;
  }

  // Test 2: Create and Cancel Build
  console.log('Test 2: Cancel Build');
  try {
    // First, try to get projects
    const projectsResult = await makeRequest('GET', '/build/api/projects');

    if (!projectsResult.success || !projectsResult.projects || projectsResult.projects.length === 0) {
      console.log('  SKIP: No projects available for testing\n');
    } else {
      // Create a build (this will likely fail if project doesn't exist, but tests the endpoint)
      const buildResult = await makeRequest('POST', '/build/api/build', {
        projectName: projectsResult.projects[0].name,
        branch: 'master',
        moduleName: 'app',
        variant: 'debug',
        versionCode: 1,
        versionName: '1.0.0'
      });

      if (buildResult.success && buildResult.buildId) {
        // Try to cancel it
        const cancelResult = await makeRequest('DELETE', `/build/api/build/${buildResult.buildId}`);

        if (cancelResult.success) {
          console.log('  PASS: Build created and cancelled successfully\n');
          passed++;
        } else {
          console.log(`  FAIL: Could not cancel build: ${cancelResult.error}\n`);
          failed++;
        }
      } else {
        console.log(`  SKIP: Could not create test build: ${buildResult.error}\n`);
      }
    }
  } catch (error) {
    console.log(`  FAIL: ${error.message}\n`);
    failed++;
  }

  // Test 3: Get All Builds
  console.log('Test 3: GET /builds');
  try {
    const result = await makeRequest('GET', '/build/api/builds');
    if (result.success && Array.isArray(result.builds)) {
      console.log('  PASS: Returns array of all builds\n');
      passed++;
    } else {
      console.log('  FAIL: Unexpected response format\n');
      failed++;
    }
  } catch (error) {
    console.log(`  FAIL: ${error.message}\n`);
    failed++;
  }

  // Test 4: Cancel Non-Existent Build
  console.log('Test 4: Cancel Non-Existent Build');
  try {
    const result = await makeRequest('DELETE', '/build/api/build/non-existent-id');
    if (!result.success) {
      console.log('  PASS: Correctly returns error for non-existent build\n');
      passed++;
    } else {
      console.log('  FAIL: Should not succeed for non-existent build\n');
      failed++;
    }
  } catch (error) {
    console.log(`  FAIL: ${error.message}\n`);
    failed++;
  }

  // Summary
  console.log('========================================');
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
