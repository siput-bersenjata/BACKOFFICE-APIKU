const { getSalesDetails, formatDate, extractAuthContext, resequenceOrderNumbers } = require('../lib/olsera');
const { 
  getPublicConfig, 
  savePublicConfig, 
  saveSnapshot, 
  getSnapshots, 
  cleanupOldSnapshots, 
  getRetentionStatus,
  normalizeStoreSlug,
  getRegisteredOutlets,
  getOutletConfig,
  saveOutletConfig
} = require('../lib/database');

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

  const requestedStore = body?.store || req.query?.store || null;
  const storeSlug = requestedStore ? normalizeStoreSlug(requestedStore) : null;

  if (req.method === 'POST') {
    const action = body?.action || req.query?.action || 'sync_now';

    if (action === 'list_outlets') {
      const outlets = await getRegisteredOutlets();
      return res.status(200).json({
        status: 'success',
        outlets
      });
    }

    if (action === 'save_config') {
      const percentage = body?.percentage !== undefined ? Number(body.percentage) : undefined;
      const monthly_retention = body?.monthly_retention !== undefined ? Boolean(body.monthly_retention) : undefined;
      const grace_period_days = body?.grace_period_days !== undefined ? Number(body.grace_period_days) : undefined;

      if (storeSlug) {
        const savedOutlet = await saveOutletConfig(storeSlug, { percentage, monthly_retention, grace_period_days });
        return res.status(200).json({
          status: 'success',
          store: storeSlug,
          message: `Konfigurasi database untuk ${savedOutlet.store_name} berhasil disimpan.`,
          config: savedOutlet
        });
      }

      const savedConfig = await savePublicConfig({ percentage, monthly_retention, grace_period_days });
      return res.status(200).json({
        status: 'success',
        message: `Konfigurasi database global berhasil disimpan.`,
        config: savedConfig
      });
    }

    if (action === 'save_retention_config') {
      const monthly_retention = body?.monthly_retention !== undefined ? Boolean(body.monthly_retention) : true;
      const grace_period_days = body?.grace_period_days !== undefined ? Math.max(0, Math.min(10, Number(body.grace_period_days))) : 2;

      if (storeSlug) {
        const savedOutlet = await saveOutletConfig(storeSlug, { monthly_retention, grace_period_days });
        return res.status(200).json({
          status: 'success',
          store: storeSlug,
          message: `Pengaturan retensi bulanan untuk ${savedOutlet.store_name} berhasil disimpan (Jeda: ${savedOutlet.grace_period_days} hari).`,
          config: savedOutlet,
          retention: savedOutlet.retention
        });
      }

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
          storeSlug ? getOutletConfig(storeSlug) : getPublicConfig(),
          getSnapshots(30, storeSlug)
        ]);

        return res.status(200).json({
          status: 'success',
          store: storeSlug || 'all',
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

    if (action === 'save_active_account') {
      try {
        const account = body?.account;
        if (!account) {
          return res.status(400).json({ status: 'error', message: 'Data akun restoran wajib diisi' });
        }
        const updatedConfig = await savePublicConfig({ active_account: account });
        return res.status(200).json({
          status: 'success',
          message: 'Akun restoran aktif berhasil disimpan ke database!',
          config: updatedConfig
        });
      } catch (err) {
        console.error('[API /api/database save_active_account] Error:', err);
        return res.status(500).json({
          status: 'error',
          message: err.message || 'Gagal menyimpan akun restoran aktif'
        });
      }
    }

    if (action === 'sync_now') {
      try {
        const todayStr = body?.date || formatDate(new Date());
        let effectivePercentage = 50;
        let storeUrlId = 'depotanjungapi';
        let storeName = 'Depot TanjungApi';

        let authContext = extractAuthContext(req);

        if (storeSlug) {
          const outletConf = await getOutletConfig(storeSlug);
          effectivePercentage = body?.percentage ? Number(body.percentage) : outletConf.percentage;
          storeUrlId = outletConf.store_url_id;
          storeName = outletConf.store_name;

          if (!authContext.username && !authContext.token) {
            authContext = {
              username: outletConf.username,
              password: outletConf.password,
              token: outletConf.token,
              storeUrlId: outletConf.store_url_id
            };
          }
        } else {
          const config = await getPublicConfig();
          effectivePercentage = body?.percentage ? Number(body.percentage) : config.percentage;

          if (!authContext.username && !authContext.token && config.active_account) {
            authContext = {
              username: config.active_account.username,
              password: config.active_account.password,
              token: config.active_account.token,
              storeUrlId: config.active_account.store_url_id || config.active_account.storeUrlId
            };
          }

          storeUrlId = authContext.storeUrlId || config.active_account?.store_url_id || 'depotanjungapi';
          storeName = config.active_account?.store_name || (storeUrlId === 'depotanjungapi' ? 'Depot TanjungApi' : 'Naiki cafe');
        }

        let effectiveDate = todayStr;
        let allTx = [];

        try {
          const page1 = await getSalesDetails(todayStr, todayStr, 1, 100, authContext);
          allTx = page1.data || [];

          if (page1.meta && page1.meta.last_page > 1) {
            try {
              const page2 = await getSalesDetails(todayStr, todayStr, 2, 100, authContext);
              if (page2.data) allTx = allTx.concat(page2.data);
            } catch (e) {}
          }
        } catch (fetchErr) {
          console.warn('[Sync Now] Today fetch warning:', fetchErr.message);
        }

        // Fallback to yesterday if today has no sales yet and date was not explicitly forced
        if (allTx.length === 0 && !body?.date) {
          try {
            const parts = todayStr.split('-');
            const yestDate = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] - 1));
            const yesterdayStr = yestDate.toISOString().split('T')[0];

            const yestPage1 = await getSalesDetails(yesterdayStr, yesterdayStr, 1, 100, authContext);
            if (yestPage1 && yestPage1.data && yestPage1.data.length > 0) {
              allTx = yestPage1.data;
              effectiveDate = yesterdayStr;
            }
          } catch (yestErr) {
            console.warn('[Sync Now] Yesterday fetch warning:', yestErr.message);
          }
        }

        const totalReal = allTx.length;
        const targetCount = Math.max(1, Math.min(totalReal, Math.round(totalReal * (effectivePercentage / 100))));

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
          date: effectiveDate,
          store_url_id: storeUrlId,
          store_name: storeName,
          percentage: effectivePercentage,
          total_real_transactions: totalReal,
          saved_count: filtered.length,
          total_revenue: filteredRevenue,
          total_tax: filteredTax,
          transactions: filtered
        });

        return res.status(200).json({
          status: 'success',
          store: storeUrlId,
          message: `Data filter transaksi ${storeName} berhasil disimpan ke Cloud Database!`,
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

  // GET: Return config, retention status, and snapshots (filtered by store if requested)
  try {
    if (req.query?.action === 'list_outlets') {
      const outlets = await getRegisteredOutlets();
      return res.status(200).json({
        status: 'success',
        outlets
      });
    }

    if (storeSlug) {
      const [outletConfig, snapshots] = await Promise.all([
        getOutletConfig(storeSlug),
        getSnapshots(30, storeSlug)
      ]);

      return res.status(200).json({
        status: 'success',
        store: storeSlug,
        database: {
          engine: 'Cloud Firestore (Firebase Project: salshya)',
          collection: 'olsera_filtered_snapshots',
          outlet_name: outletConfig.store_name,
          outlet_slug: outletConfig.store_url_id,
          sync_schedule: 'Setiap 5 Jam Sekali (Otomatis)',
          retention_policy: `Siklus Bulanan (Jeda ${outletConfig.grace_period_days} Hari)`
        },
        config: outletConfig,
        retention: outletConfig.retention,
        total_snapshots: snapshots.length,
        snapshots
      });
    }

    const [config, snapshots, outlets] = await Promise.all([
      getPublicConfig(),
      getSnapshots(30),
      getRegisteredOutlets()
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
      outlets,
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
