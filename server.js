/**
 * Local & Serverless Server
 * Serves static assets from public/ and routes API calls to api/ handlers.
 * Includes automated 5-hour background snapshot sync for local daemon.
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
const authHandler = require('./api/auth');
const publicHandler = require('./api/public');
const databaseHandler = require('./api/database');

async function handleRequest(req, res) {
  const parsedUrl = url.parse(req.url, true);
  let pathname = parsedUrl.pathname || '/';

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
  } else if (pathname === '/api/auth') {
    return authHandler(req, res);
  } else if (pathname === '/api/public' || pathname.startsWith('/api/public/')) {
    const parts = pathname.split('/');
    if (parts.length > 3 && parts[3]) {
      req.query.resto = parts[3];
    }
    return publicHandler(req, res);
  } else if (pathname === '/api/database') {
    return databaseHandler(req, res);
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

// 5-Hour Background Scheduler for local server
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
function start5HourScheduler() {
  setInterval(async () => {
    console.log('[Scheduler] Running 5-hour scheduled database snapshot...');
    try {
      const { formatDate, getSalesDetails, resequenceOrderNumbers } = require('./lib/olsera');
      const { getPublicConfig, saveSnapshot } = require('./lib/database');

      const today = formatDate(new Date());
      const config = await getPublicConfig();
      const page1 = await getSalesDetails(today, today, 1, 100);
      const allTx = page1.data || [];
      const totalReal = allTx.length;
      const targetCount = Math.max(1, Math.min(totalReal, Math.round(totalReal * (config.percentage / 100))));
      
      let filtered = [];
      if (targetCount >= totalReal) {
        filtered = [...allTx];
      } else {
        const step = totalReal / targetCount;
        const selected = new Set();
        for (let i = 0; i < targetCount; i++) {
          const idx = Math.min(totalReal - 1, Math.floor(i * step));
          if (!selected.has(idx)) {
            selected.add(idx);
            filtered.push(allTx[idx]);
          }
        }
        let fallback = 0;
        while (filtered.length < targetCount && fallback < totalReal) {
          if (!selected.has(fallback)) {
            selected.add(fallback);
            filtered.push(allTx[fallback]);
          }
          fallback++;
        }
      }

      // Resequence order numbers so there are no gaps/jumps
      filtered = resequenceOrderNumbers(filtered);

      let rev = 0, tax = 0;
      filtered.forEach(t => {
        rev += Number(t.paid_amount) || Number(t.subtotal) || 0;
        tax += Number(t.tax) || 0;
      });

      await saveSnapshot({
        date: today,
        percentage: config.percentage,
        total_real_transactions: totalReal,
        saved_count: filtered.length,
        total_revenue: rev,
        total_tax: tax,
        transactions: filtered
      });
      console.log('[Scheduler] 5-hour snapshot successfully saved to database!');
    } catch (e) {
      console.error('[Scheduler] Error running 5-hour snapshot:', e.message);
    }
  }, FIVE_HOURS_MS);
}

if (process.env.NODE_ENV !== 'production' || require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    start5HourScheduler();
  });
}

module.exports = handleRequest;
