const { getSalesDetails, formatDate, formatRupiah, extractAuthContext, resequenceOrderNumbers } = require('../lib/olsera');
const { getPublicConfig, saveSnapshot, shouldRun5HourSync } = require('../lib/database');

module.exports = async (req, res) => {
  // CORS Headers for public access
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // 1. Strict constraint: ONLY TODAY'S DATE
    const todayStr = formatDate(new Date());

    // 2. Determine percentage: Query param or saved database config
    const config = await getPublicConfig();
    let percentage = config.percentage || 50;

    if (req.query.percentage) {
      const parsed = parseInt(req.query.percentage, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) {
        percentage = parsed;
      }
    }

    const authContext = extractAuthContext(req);

    // 3. Fetch today's transactions (fetch up to 200 items for today)
    const page1 = await getSalesDetails(todayStr, todayStr, 1, 100, authContext);
    let allTx = page1.data || [];

    // If more than 100 items exist, fetch second page
    if (page1.meta && page1.meta.last_page > 1) {
      try {
        const page2 = await getSalesDetails(todayStr, todayStr, 2, 100, authContext);
        if (page2.data) allTx = allTx.concat(page2.data);
      } catch (e) {}
    }

    const totalReal = allTx.length;

    // 4. Filter by percentage
    // Calculate how many transactions to include
    const targetCount = Math.max(1, Math.min(totalReal, Math.round(totalReal * (percentage / 100))));

    let filtered = [];
    if (targetCount >= totalReal) {
      filtered = [...allTx];
    } else {
      // Sample evenly across the array so it reflects the entire day
      const step = totalReal / targetCount;
      const selectedIndices = new Set();
      for (let i = 0; i < targetCount; i++) {
        const idx = Math.min(totalReal - 1, Math.floor(i * step));
        if (!selectedIndices.has(idx)) {
          selectedIndices.add(idx);
          filtered.push(allTx[idx]);
        }
      }
      // If due to rounding we need more
      let fallbackIdx = 0;
      while (filtered.length < targetCount && fallbackIdx < totalReal) {
        if (!selectedIndices.has(fallbackIdx)) {
          selectedIndices.add(fallbackIdx);
          filtered.push(allTx[fallbackIdx]);
        }
        fallbackIdx++;
      }
    }

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

    // 6. Check if 5-hour database snapshot is due
    if (await shouldRun5HourSync()) {
      saveSnapshot({
        date: todayStr,
        percentage,
        total_real_transactions: totalReal,
        saved_count: filtered.length,
        total_revenue: filteredRevenue,
        total_tax: filteredTax,
        transactions: filtered
      }).catch(e => console.error('[Auto 5-Hour DB Sync Error]:', e.message));
    }

    res.status(200).json({
      status: 'success',
      api_name: 'Olsera POS Public Transaction API',
      policy: 'Data khusus hari ini saja, difilter berdasarkan rasio persentase yang dikonfigurasi.',
      timestamp: new Date().toISOString(),
      filter: {
        date: todayStr,
        percentage_applied: `${percentage}%`,
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
