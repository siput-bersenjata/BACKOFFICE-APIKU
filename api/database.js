const { getSalesDetails, formatDate, extractAuthContext, resequenceOrderNumbers } = require('../lib/olsera');
const { getPublicConfig, savePublicConfig, saveSnapshot, getSnapshots, cleanupOldSnapshots, getRetentionStatus } = require('../lib/database');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

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
      const percentage = body?.percentage !== undefined ? Number(body.percentage) : undefined;
      const monthly_retention = body?.monthly_retention !== undefined ? Boolean(body.monthly_retention) : undefined;
      const grace_period_days = body?.grace_period_days !== undefined ? Number(body.grace_period_days) : undefined;
      const store_name = body?.store_name;
      const store_url_id = body?.store_url_id;
      const username = body?.username;
      const password = body?.password;
      const token = body?.token;
      const is_custom = body?.is_custom !== undefined ? Boolean(body.is_custom) : undefined;

      const savedConfig = await savePublicConfig({
        percentage,
        monthly_retention,
        grace_period_days,
        store_name,
        store_url_id,
        username,
        password,
        token,
        is_custom
      });
      return res.status(200).json({
        status: 'success',
        message: `Konfigurasi database berhasil disimpan.`,
        config: savedConfig
      });
    }

    if (action === 'save_account_config') {
      const store_name = body?.store_name;
      const store_url_id = body?.store_url_id;
      const username = body?.username;
      const password = body?.password;
      const token = body?.token;
      const is_custom = body?.is_custom !== undefined ? Boolean(body.is_custom) : undefined;

      const savedConfig = await savePublicConfig({
        store_name,
        store_url_id,
        username,
        password,
        token,
        is_custom
      });

      return res.status(200).json({
        status: 'success',
        message: `Akun/resto ${savedConfig.store_name} berhasil disinkronkan ke API Publik.`,
        config: savedConfig
      });
    }

    if (action === 'save_retention_config') {
      const monthly_retention = body?.monthly_retention !== undefined ? Boolean(body.monthly_retention) : true;
      const grace_period_days = body?.grace_period_days !== undefined ? Math.max(0, Math.min(10, Number(body.grace_period_days))) : 2;

      const savedConfig = await savePublicConfig({ monthly_retention, grace_period_days });
      const retentionStatus = getRetentionStatus(new Date(), savedConfig.grace_period_days);

      return res.status(200).json({
        status: 'success',
        message: `Pengaturan retensi bulanan database berhasil disimpan (Jeda: ${savedConfig.grace_period_days} hari).`,
        config: savedConfig,
        retention: retentionStatus
      });
    }

    if (action === 'cleanup_monthly') {
      try {
        const force = body?.force === true;
        const result = await cleanupOldSnapshots({ force });
        const [config, snapshots] = await Promise.all([
          getPublicConfig(),
          getSnapshots(30)
        ]);

        return res.status(200).json({
          status: 'success',
          message: force
            ? `Pembersihan paksa selesai: ${result.purged_count} snapshot bulan lalu telah dihapus.`
            : (result.purged_count > 0 
                ? `Pembersihan otomatis selesai: ${result.purged_count} snapshot periode lalu telah dibersihkan.`
                : 'Pengecekan siklus bulanan selesai: Semua snapshot sudah sesuai periode aktif.'),
          result,
          config,
          retention: getRetentionStatus(new Date(), Number(config.grace_period_days) || 2),
          total_snapshots: snapshots.length,
          snapshots
        });
      } catch (err) {
        console.error('[API /api/database cleanup_monthly] Error:', err);
        return res.status(500).json({
          status: 'error',
          message: err.message || 'Gagal menjalankan pembersihan retensi bulanan'
        });
      }
    }

    if (action === 'sync_now') {
      try {
        const todayStr = formatDate(new Date());
        const config = await getPublicConfig();
        const percentage = body?.percentage ? Number(body.percentage) : config.percentage;

        const headerAuth = extractAuthContext(req);
        const effectiveAuth = {
          token: headerAuth.token || config.token || null,
          storeUrlId: body?.store_url_id || headerAuth.storeUrlId || config.store_url_id || 'naikicafe',
          username: headerAuth.username || config.username || null,
          password: headerAuth.password || config.password || null
        };
        const storeName = body?.store_name || config.store_name || 'Naiki cafe';

        const page1 = await getSalesDetails(todayStr, todayStr, 1, 100, effectiveAuth);
        let allTx = page1.data || [];

        if (page1.meta && page1.meta.last_page > 1) {
          try {
            const page2 = await getSalesDetails(todayStr, todayStr, 2, 100, effectiveAuth);
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

        // Resequence order numbers so there are no gaps/jumps
        filtered = resequenceOrderNumbers(filtered);

        let filteredRevenue = 0;
        let filteredTax = 0;
        filtered.forEach(tx => {
          filteredRevenue += Number(tx.paid_amount) || Number(tx.subtotal) || 0;
          filteredTax += Number(tx.tax) || 0;
        });

        const newSnapshot = await saveSnapshot({
          store_name: storeName,
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

  // GET: Return config, retention status, and snapshots
  try {
    const [config, snapshots] = await Promise.all([
      getPublicConfig(),
      getSnapshots(30)
    ]);

    const retention = getRetentionStatus(new Date(), Number(config.grace_period_days) || 2);

    res.status(200).json({
      status: 'success',
      database: {
        engine: 'Cloud Firestore (Firebase Project: salshya)',
        collection: 'olsera_filtered_snapshots',
        sync_schedule: 'Setiap 5 Jam Sekali (Otomatis)',
        retention_policy: `Siklus Bulanan (Jeda ${config.grace_period_days || 2} Hari)`
      },
      config,
      retention,
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
