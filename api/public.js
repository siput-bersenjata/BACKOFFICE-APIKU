const { getSalesDetails, formatDate, formatRupiah, extractAuthContext, resequenceOrderNumbers } = require('../lib/olsera');
const { getPublicConfig, saveSnapshot, shouldRun5HourSync, getSnapshots } = require('../lib/database');

/**
 * Core computation for public transactions & filter metrics per store
 */
async function computePublicTransactions(restoSlug, options = {}) {
  const { date, reqPercentage, customAuthContext, disableSnapshotSave = false } = options;
  const todayStr = date || formatDate(new Date());

  let normSlug = restoSlug ? restoSlug.toLowerCase().replace(/[^a-z0-9_-]/g, '') : null;
  if (normSlug === 'depottanjungapi') normSlug = 'depotanjungapi';

  const config = await getPublicConfig();
  let percentage = (config.accounts && normSlug && config.accounts[normSlug]?.percentage !== undefined)
    ? Number(config.accounts[normSlug].percentage)
    : (config.percentage || 50);

  if (reqPercentage) {
    const parsed = parseInt(reqPercentage, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) {
      percentage = parsed;
    }
  }

  let authContext = customAuthContext || {};

  // Resolve credentials if not provided
  if (!authContext.username && !authContext.token) {
    const matchedAccount = (config.accounts && normSlug && config.accounts[normSlug])
      || (config.active_account && (!normSlug || normSlug === (config.active_account.store_url_id || config.active_account.storeUrlId)?.toLowerCase()) ? config.active_account : null)
      || config.active_account;

    if (matchedAccount && (matchedAccount.username || matchedAccount.token)) {
      authContext = {
        token: matchedAccount.token || null,
        username: matchedAccount.username || null,
        password: matchedAccount.password || null,
        storeUrlId: normSlug || matchedAccount.store_url_id || matchedAccount.storeUrlId
      };
    } else if (normSlug) {
      authContext.storeUrlId = normSlug;
    }
  } else if (normSlug && !authContext.storeUrlId) {
    authContext.storeUrlId = normSlug;
  }

  const effectiveStore = normSlug || authContext.storeUrlId || config.active_account?.store_url_id || 'depotanjungapi';

  // Fetch today's transactions
  let allTx = [];
  let effectiveDate = todayStr;

  try {
    const page1 = await getSalesDetails(todayStr, todayStr, 1, 100, authContext);
    allTx = page1.data || [];

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

  // Fallback 1: yesterday if today has no sales
  if (allTx.length === 0 && !date) {
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
      console.warn('[Public API] Yesterday fetch warning:', yestErr.message);
    }
  }

  // Fallback 2: check snapshot in Firestore database
  if (allTx.length === 0) {
    try {
      const snaps = await getSnapshots(20, effectiveStore);
      if (snaps && snaps.length > 0) {
        const match = snaps[0];
        if (match && match.transactions && match.transactions.length > 0) {
          allTx = match.transactions;
          if (match.date) effectiveDate = match.date;
        }
      }
    } catch (dbErr) {
      console.warn('[Public API] Snapshot fallback warning:', dbErr.message);
    }
  }

  const totalReal = allTx.length;
  const targetCount = totalReal === 0 ? 0 : Math.max(1, Math.min(totalReal, Math.round(totalReal * (percentage / 100))));

  let filtered = [];
  if (totalReal === 0 || targetCount === 0) {
    filtered = [];
  } else if (targetCount >= totalReal) {
    filtered = [...allTx];
  } else {
    const step = totalReal / targetCount;
    const selectedIndices = new Set();
    for (let i = 0; i < targetCount; i++) {
      const idx = Math.min(totalReal - 1, Math.floor(i * step));
      if (idx >= 0 && !selectedIndices.has(idx) && allTx[idx] !== undefined) {
        selectedIndices.add(idx);
        filtered.push(allTx[idx]);
      }
    }
    let fallbackIdx = 0;
    while (filtered.length < targetCount && fallbackIdx < totalReal) {
      if (!selectedIndices.has(fallbackIdx) && allTx[fallbackIdx] !== undefined) {
        selectedIndices.add(fallbackIdx);
        filtered.push(allTx[fallbackIdx]);
      }
      fallbackIdx++;
    }
  }

  filtered = filtered.filter(tx => tx !== undefined);
  filtered = resequenceOrderNumbers(filtered);

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

  const storeName = (config.accounts && config.accounts[effectiveStore]?.store_name)
    || config.active_account?.store_name
    || (effectiveStore === 'depotanjungapi' ? 'Depot TanjungApi' : 'Naiki cafe');

  if (!disableSnapshotSave && ((await shouldRun5HourSync()) || filtered.length > 0)) {
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

  return {
    store: effectiveStore,
    store_name: storeName,
    percentage,
    effectiveDate,
    totalReal,
    filteredCount: filtered.length,
    realRevenue,
    formattedRealRevenue: formatRupiah(realRevenue),
    filteredRevenue,
    formattedFilteredRevenue: formatRupiah(filteredRevenue),
    realTax,
    formattedRealTax: formatRupiah(realTax),
    filteredTax,
    formattedFilteredTax: formatRupiah(filteredTax),
    filtered
  };
}

const handler = async (req, res) => {
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
    const todayStr = req.query?.date || formatDate(new Date());

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

    const authContext = extractAuthContext(req);
    const result = await computePublicTransactions(restoSlug, {
      date: todayStr,
      reqPercentage: req.query?.percentage,
      customAuthContext: authContext
    });

    res.status(200).json({
      status: 'success',
      api_name: 'Olsera POS Public Transaction API',
      store: result.store,
      timestamp: new Date().toISOString(),
      filter: {
        date: result.effectiveDate,
        total_real_transactions: result.totalReal,
        filtered_transactions_count: result.filteredCount,
        real_revenue: result.realRevenue,
        formatted_real_revenue: result.formattedRealRevenue,
        filtered_revenue: result.filteredRevenue,
        formatted_filtered_revenue: result.formattedFilteredRevenue,
        real_tax: result.realTax,
        formatted_real_tax: result.formattedRealTax,
        filtered_tax: result.filteredTax,
        formatted_filtered_tax: result.formattedFilteredTax
      },
      data: result.filtered
    });
  } catch (error) {
    console.error('[API /api/public] Error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Internal server error'
    });
  }
};

handler.computePublicTransactions = computePublicTransactions;
module.exports = handler;
