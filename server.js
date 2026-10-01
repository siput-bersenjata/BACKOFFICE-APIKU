/**
 * Local Development Server
 * Serves static assets from public/ and routes API calls to api/ handlers.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Route handlers
const dashboardHandler = require('./api/dashboard');
const transactionsHandler = require('./api/transactions');
const syncHandler = require('./api/sync');

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Augment req object with query and body helper
  req.query = parsedUrl.query;

  // Helper for JSON response
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  };

  res.status = (code) => {
    res.statusCode = code;
    return res;
  };

  // API Routes
  if (pathname === '/api/dashboard') {
    return dashboardHandler(req, res);
  } else if (pathname === '/api/transactions') {
    return transactionsHandler(req, res);
  } else if (pathname === '/api/sync') {
    return syncHandler(req, res);
  }

  // Static file serving
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  
  // Security check: ensure path is within PUBLIC_DIR
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for SPA routing
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.statusCode = 500;
        return res.end(`Error reading file: ${readErr.code}`);
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    });
  });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` Olsera Dashboard Running: http://localhost:${PORT}`);
  console.log(` Auto-sync with Olsera Backoffice: ACTIVE`);
  console.log(`=======================================================`);
});
