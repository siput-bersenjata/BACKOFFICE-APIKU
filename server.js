/**
 * Local & Serverless Server
 * Serves static assets from public/ and routes API calls to api/ handlers.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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

async function handleRequest(req, res) {
  const parsedUrl = url.parse(req.url, true);
  let pathname = parsedUrl.pathname || '/';

  // Strip leading /public if rewritten
  pathname = pathname.replace(/^\/public/, '');
  req.query = parsedUrl.query;

  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
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

  // Static files in public/
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
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
      res.end(content);
    });
  });
}

const server = http.createServer(handleRequest);

if (process.env.NODE_ENV !== 'production' || require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

// Export for serverless environments
module.exports = handleRequest;
