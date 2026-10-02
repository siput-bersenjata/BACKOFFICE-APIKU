const { getSalesDetails, formatDate, formatRupiah, extractAuthContext, resequenceOrderNumbers } = require('../lib/olsera');
const { getPublicConfig, saveSnapshot, shouldRun5HourSync, getSnapshots } = require('../lib/database');

module.exports = async (req, res) => {
  // CORS Headers for public access
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // 1. Strict constraint: TODAY'S DATE (WIB) by default, or query param date if specified
    const todayStr = req.query?.date || formatDate(new Date());

    // Extract resto / outlet name if accessed via /api/public/:resto (e.g. /api/public/depotanjungapi)
    let restoSlug = req.query?.resto;
    if (!restoSlug && req.url) {
      const match = req.url.split('?')[0].match(/\/api\/public\/([^/?#]+)/);
      if (match) {
        restoSlug = decodeURIComponent(match[1]);
      }
    }
    if (restoSlug) {
      restoSlug = restoSlug.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (restoSlug === 'depottanjungapi') restoSlug = 'depotanjungapi';
    }

    // 2. Determine percentage: Query param or saved database config
    const config = await getPublicConfig();
    let percentage = config.percentage || 50;

    if (req.query.percentage) {
      const parsed = parseInt(req.query.percentage, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) {
        percentage = parsed;
      }
    }

    let authContext = extractAuthContext(req);

    // Resolve credentials: if caller didn't supply auth headers, use matched store account or active account
    if (!authContext.username && !authContext.token) {
      const matchedAccount = (config.accounts && restoSlug && config.accounts[restoSlug])
        || (config.active_account && (!restoSlug || restoSlug === (config.active_account.store_url_id || config.active_account.storeUrlId)?.toLowerCase()) ? config.active_account : null)
        || config.active_account;

      if (matchedAccount && (matchedAccount.username || matchedAccount.token)) {
        authContext = {
          token: matchedAccount.token || null,
          username: matchedAccount.username || null,
          password: matchedAccount.password || null,
          storeUrlId: restoSlug || matchedAccount.store_url_id || matchedAccount.storeUrlId
        };
      } else if (restoSlug) {
        authContext.storeUrlId = restoSlug;
      }
    } else if (restoSlug && !authContext.storeUrlId) {
      authContext.storeUrlId = restoSlug;
    }

    const effectiveStore = restoSlug || authContext.storeUrlId || config.active_account?.store_url_id || 'depotanjungapi';

    // 3. Fetch today's transactions (fetch up to 500 items for today across pages)
    let allTx = [];
    let effectiveDate = todayStr;

    try {
      const page1 = await getSalesDetails(todayStr, todayStr, 1, 100, authContext);
      allTx = page1.data || [];

      // If more than 100 items exist, fetch subsequent pages in parallel
      if (page1.meta && page1.meta.last_page > 1) {
        try {
          const remainingPages = [];
          for (let p = 2; p <= Math.min(page1.meta.last_page, 5); p++) {
            remainingPages.push(getSalesDetails(todayStr, todayStr, p, 100, authContext));
          }
          const results = await Promise.all(remainingPages);
          results.forEach(res => {
            if (res && res.data && Array.isArray(res.data)) {
              allTx = allTx.concat(res.data);
            }
          });
        } catch (e) {
          console.warn('[Public API] Error fetching additional pages:', e.message);
        }
      }
    } catch (fetchErr) {
      console.warn('[Public API] Live fetch warning:', fetchErr.message);
    }

    // If today has 0 transactions and user did not specify an explicit date, fallback to yesterday (or recent active date)
    if (allTx.length === 0 && !req.query?.date) {
      try {
        const parts = todayStr.split('-');
        const yestDate = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] - 1));
        const yesterdayStr = yestDate.toISOString().split('T')[0];

        const yestPage1 = await getSalesDetails(yesterdayStr, yesterdayStr, 1, 100, authContext);
        if (yestPage1 && yestPage1.data && yestPage1.data.length > 0) {
          allTx = yestPage1.data;
          effectiveDate = yesterdayStr;
          console.log(`[Public API] Fallback to recent date with transactions: ${yesterdayStr} (${allTx.length} tx)`);
        }
      } catch (yestErr) {
        console.warn('[Public API] Yesterday fetch warning:', yestErr.message);
      }
    }

    // Fallback 2: check database snapshot for this store
    if (allTx.length === 0) {
      try {
        const snaps = await getSnapshots(20);
        const match = snaps.find(s => !s.store_url_id || s.store_url_id === effectiveStore || s.store_url_id === 'depotanjungapi');
        if (match && match.transactions && match.transactions.length > 0) {
          allTx = match.transactions;
          if (match.date) effectiveDate = match.date;
        }
      } catch (dbErr) {
        console.warn('[Public API] Snapshot fallback warning:', dbErr.message);
      }
    }

    const totalReal = allTx.length;

    // 4. Filter by percentage
    // Calculate how many transactions to include
    const targetCount = totalReal === 0 ? 0 : Math.max(1, Math.min(totalReal, Math.round(totalReal * (percentage / 100))));

    let filtered = [];
    if (totalReal === 0 || targetCount === 0) {
      filtered = [];
    } else if (targetCount >= totalReal) {
      filtered = [...allTx];
    } else {

      // Sample evenly across the array so it reflects the entire day
      const step = totalReal / targetCount;
      const selectedIndices = new Set();
      for (let i = 0; i < targetCount; i++) {
        const idx = Math.min(totalReal - 1, Math.floor(i * step));
        if (idx >= 0 && !selectedIndices.has(idx) && allTx[idx] !== undefined) {
          selectedIndices.add(idx);
          filtered.push(allTx[idx]);
        }
      }
      // If due to rounding we need more
      let fallbackIdx = 0;
      while (filtered.length < targetCount && fallbackIdx < totalReal) {
        if (!selectedIndices.has(fallbackIdx) && allTx[fallbackIdx] !== undefined) {
          selectedIndices.add(fallbackIdx);
          filtered.push(allTx[fallbackIdx]);
        }
        fallbackIdx++;
      }
    }

    // Filter out undefined just in case
    filtered = filtered.filter(tx => tx !== undefined);

    // Resequence order numbers so there are no gaps/jumps
    filtered = resequenceOrderNumbers(filtered);

    // 5. Calculate totals for real and filtered datasets
    let realRevenue = 0;
    let realTax = 0;
    allTx.forEach(tx => {
      realRevenue += Number(tx.paid_amount) || Number(tx.subtotal) || 0;
      realTax += Number(tx.tax) || 0;
    });

    let filteredRevenue = 0;
    let filteredTax = 0;

    filtered.forEach(tx => {
      filteredRevenue += Number(tx.paid_amount) || Number(tx.subtotal) || 0;
      filteredTax += Number(tx.tax) || 0;
    });

    // 6. Check if database snapshot is due or if first snapshot
    const storeName = config.active_account?.store_name || (effectiveStore === 'depotanjungapi' ? 'Depot TanjungApi' : 'Naiki cafe');
    if (await shouldRun5HourSync() || filtered.length > 0) {
      saveSnapshot({
        date: effectiveDate,
        store_url_id: effectiveStore,
        store_name: storeName,
        percentage,
        total_real_transactions: totalReal,
        saved_count: filtered.length,
        total_revenue: filteredRevenue,
        total_tax: filteredTax,
        transactions: filtered
      }).catch(e => console.error('[Auto DB Sync Error]:', e.message));
    }

    res.status(200).json({
      status: 'success',
      api_name: 'Olsera POS Public Transaction API',
      store: effectiveStore,
      timestamp: new Date().toISOString(),
      filter: {
        date: effectiveDate,
        total_real_transactions: totalReal,
        filtered_transactions_count: filtered.length,
        real_revenue: realRevenue,
        formatted_real_revenue: formatRupiah(realRevenue),
        filtered_revenue: filteredRevenue,
        formatted_filtered_revenue: formatRupiah(filteredRevenue),
        real_tax: realTax,
        formatted_real_tax: formatRupiah(realTax),
        filtered_tax: filteredTax,
        formatted_filtered_tax: formatRupiah(filteredTax)
      },
      data: filtered
    });
  } catch (error) {
    console.error('[API /api/public] Error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Internal server error'
    });
  }
};
