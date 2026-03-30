const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Load config
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

// Create Express app
const app = express();
app.use(express.json());

// Import routes
const routes = require('./src/routes');
const initRoutes = require('./src/routes/init');

// Mount init page at /init (root level, outside basePath)
app.use('/init', initRoutes);

// Mount routes under basePath
app.use(config.server.basePath, routes);

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: err.message });
});

// Ensure directories exist
const apkDir = config.apk.outputDir;
if (!fs.existsSync(apkDir)) {
  fs.mkdirSync(apkDir, { recursive: true });
}

// Get local IP address (prefer WLAN/Ethernet)
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  const priorityNames = ['WLAN', '以太网', 'Ethernet', 'Wi-Fi', 'Local Area Connection'];

  // First try priority interfaces
  for (const name of priorityNames) {
    if (interfaces[name]) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  }

  // Fallback: find any non-internal IPv4 that's not a virtual adapter
  for (const name of Object.keys(interfaces)) {
    // Skip virtual adapters
    if (name.includes('Clash') || name.includes('TAP') || name.includes('VPN') || name.includes('Loopback')) {
      continue;
    }
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        // Skip common virtual adapter IP ranges
        if (!iface.address.startsWith('198.18.') && !iface.address.startsWith('169.254.')) {
          return iface.address;
        }
      }
    }
  }

  return '127.0.0.1';
}

// Start server
const { port, host } = config.server;
const localIP = getLocalIP();
const basePath = config.server.basePath;

app.listen(port, host, () => {
  console.log('');
  console.log('========================================');
  console.log('   Android APK Build Server Started');
  console.log('========================================');
  console.log('');
  console.log('  Local:   http://localhost:' + port + basePath);
  console.log('  Network: http://' + localIP + ':' + port + basePath);
  console.log('');
  console.log('  APK retention: ' + config.apk.retentionDays + ' days');
  console.log('  Max concurrent builds: ' + config.build.maxConcurrent);
  console.log('');
  console.log('========================================');
  console.log('');
});

// Start build history cleanup scheduler (keep max N records per project)
require('./src/services/buildHistoryService').startCleanupScheduler();
