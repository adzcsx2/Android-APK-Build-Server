const express = require('express');
const path = require('path');
const config = require('../../config.json');

const router = express.Router();

// Serve static files (CSS, JS)
router.use('/css', express.static(path.join(__dirname, '../../public/css')));
router.use('/js', express.static(path.join(__dirname, '../../public/js')));

// Serve APK files
const apkOutputDir = path.isAbsolute(config.apk.outputDir)
  ? config.apk.outputDir
  : path.resolve(__dirname, '../../', config.apk.outputDir);
router.use('/apk', express.static(apkOutputDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.apk')) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    }
  }
}));

// Serve frontend
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/index.html'));
});

// API routes
router.use('/api', require('./projects'));
router.use('/api', require('./build'));
router.use('/api', require('./config'));

module.exports = router;
