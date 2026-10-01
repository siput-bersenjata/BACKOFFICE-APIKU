const { getSalesDetails, formatDate, extractAuthContext } = require('../lib/olsera');
const { getPublicConfig, savePublicConfig, saveSnapshot, getSnapshots } = require('../lib/database');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Parse body helper
  let body = req.body;
  if (!body && typeof req.on === 'function') {
    body = await new Promise((resolve) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve({}); }
      });
    });
  }

  if (req.method === 'POST') {
    const action = body?.action || req.query?.action || 'sync_now';

    if (action === 'save_config') {
      const percentage = Number(body?.percentage || req.query?.percentage || 50);
      const savedConfig = await savePublicConfig({ percentage });
      return res.status(200).json({
        status: 'success',
        message: `Persentase data API publik berhasil disimpan: ${savedConfig.percentage}%`,
        config: savedConfig
      });
    }

    if (action === 'sync_now') {
      try {
        const todayStr = formatDate(new Date());
        const config = await getPublicConfig();
        const percentage = body?.percentage ? Number(body.percentage) : config.percentage;

        const authContext = extractAuthContext(req);
        const page1 = await getSalesDetails(todayStr, todayStr, 1, 100, authContext);
        let allTx = page1.data || [];

        if (page1.meta && page1.meta.last_page > 1) {
          try {
            const page2 = await getSalesDetails(todayStr, todayStr, 2, 100, authContext);
            if (page2.data) allTx = allTx.concat(page2.data);
          } catch (e) {}
        }

        const totalReal = allTx.length;
        const targetCount = Math.max(1, Math.min(totalReal, Math.round(totalReal * (percentage / 100))));

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

        let filteredRevenue = 0;
        let filteredTax = 0;
        filtered.forEach(tx => {
          filteredRevenue += Number(tx.paid_amount) || Number(tx.subtotal) || 0;
          filteredTax += Number(tx.tax) || 0;
        });

        const newSnapshot = await saveSnapshot({
          date: todayStr,
          percentage,
          total_real_transactions: totalReal,
          saved_count: filtered.length,
          total_revenue: filteredRevenue,
          total_tax: filteredTax,
          transactions: filtered
        });

        return res.status(200).json({
          status: 'success',
          message: 'Data filter transaksi hari ini berhasil disimpan ke Cloud Database!',
          snapshot: newSnapshot
        });
      } catch (err) {
        console.error('[API /api/database sync_now] Error:', err);
        return res.status(500).json({
          status: 'error',
          message: err.message || 'Gagal menyimpan snapshot ke database'
        });
      }
    }
  }

  // GET: Return config and snapshots
  try {
    const [config, snapshots] = await Promise.all([
      getPublicConfig(),
      getSnapshots(20)
    ]);

    res.status(200).json({
      status: 'success',
      database: {
        engine: 'Cloud Firestore (Firebase Project: salshya)',
        collection: 'olsera_filtered_snapshots',
        sync_schedule: 'Setiap 5 Jam Sekali (Otomatis)'
      },
      config,
      total_snapshots: snapshots.length,
      snapshots
    });
  } catch (error) {
    console.error('[API /api/database GET] Error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to read database'
    });
  }
};
