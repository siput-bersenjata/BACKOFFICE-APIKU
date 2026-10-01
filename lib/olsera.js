/**
 * Olsera Backoffice API Client
 * Handles authentication, token caching, store information, and transaction data retrieval.
 */

const OLSERA_CONFIG = {
  authUrl: 'https://api-dash.olsera.co.id/oauth/token',
  apiBase: 'https://api-dash.olsera.co.id/api',
  credentials: {
    username: process.env.OLSERA_USERNAME || 'bapendapedua@gmail.com',
    password: process.env.OLSERA_PASSWORD || 'bapenda123',
    client_id: 2,
    client_secret: process.env.OLSERA_CLIENT_SECRET || '0XqbhEW6E72GNHn0iIM7Ui1GgB8jny91wYnXAIb8',
    grant_type: 'password'
  },
  headers: {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'device': '123123123',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  },
  storeUrlId: 'naikicafe',
  lang: 'id',
  version: 'v1'
};

// In-memory cache for token and store data
let cachedToken = null;
let tokenExpiresAt = 0;
let cachedStore = null;

/**
 * Authenticate with Olsera Backoffice API
 */
async function login() {
  try {
    const res = await fetch(OLSERA_CONFIG.authUrl, {
      method: 'POST',
      headers: OLSERA_CONFIG.headers,
      body: JSON.stringify(OLSERA_CONFIG.credentials)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Login failed with HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    cachedToken = data.access_token;
    // expires_in is in seconds (e.g. 2592000 = 30 days)
    const expiresInMs = (data.expires_in || 3600) * 1000;
    tokenExpiresAt = Date.now() + expiresInMs - 60000; // 1 min buffer

    return cachedToken;
  } catch (error) {
    console.error('[Olsera API] Login error:', error.message);
    throw error;
  }
}

/**
 * Get valid access token
 */
async function getToken(forceRefresh = false) {
  if (!cachedToken || forceRefresh || Date.now() >= tokenExpiresAt) {
    await login();
  }
  return cachedToken;
}

/**
 * Perform authenticated request to Olsera API with automatic retry on 401
 */
async function request(endpoint, options = {}) {
  let token = await getToken();

  const url = endpoint.startsWith('http') ? endpoint : `${OLSERA_CONFIG.apiBase}/${endpoint}`;

  const headers = {
    ...OLSERA_CONFIG.headers,
    'Authorization': `Bearer ${token}`,
    ...(options.headers || {})
  };

  let res = await fetch(url, {
    ...options,
    headers
  });

  // If unauthorized, refresh token once and retry
  if (res.status === 401) {
    console.warn('[Olsera API] Token 401 Unauthorized, refreshing token...');
    token = await getToken(true);
    headers['Authorization'] = `Bearer ${token}`;
    res = await fetch(url, {
      ...options,
      headers
    });
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Olsera API HTTP ${res.status} [${url}]: ${errText}`);
  }

  return await res.json();
}

/**
 * Get store information (e.g. Naiki cafe)
 */
async function getStoreInfo() {
  if (cachedStore) return cachedStore;

  try {
    const params = new URLSearchParams({
      per_page: '10',
      page: '1',
      'sort_type[]': 'desc',
      'sort_column[]': 'is_store_active'
    });

    const data = await request(`store?${params.toString()}`);
    if (data && data.data && data.data.length > 0) {
      cachedStore = data.data[0];
      return cachedStore;
    }
    return { name: 'Naiki cafe', url_id: 'naikicafe' };
  } catch (err) {
    console.error('[Olsera API] Failed to fetch store info:', err.message);
    return { name: 'Naiki cafe', url_id: 'naikicafe' };
  }
}

/**
 * Build store service path
 */
function getStoreBasePath(storeUrlId = OLSERA_CONFIG.storeUrlId) {
  return `${storeUrlId}/admin/${OLSERA_CONFIG.version}/${OLSERA_CONFIG.lang}`;
}

/**
 * Get tax report summary for date range
 * Returns { revenue_income, frevenue_income, revenue_tax, frevenue_tax }
 */
async function getTaxReport(startDate, endDate) {
  const storePath = getStoreBasePath();
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate
  });

  const url = `${storePath}/salesreports/taxation/taxreports?${params.toString()}`;
  const res = await request(url);
  return res.data || {
    revenue_income: 0,
    frevenue_income: '0',
    revenue_tax: 0,
    frevenue_tax: '0'
  };
}

/**
 * Get sales details / transaction list
 */
async function getSalesDetails(startDate, endDate, page = 1, perPage = 50) {
  const storePath = getStoreBasePath();
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    page: String(page),
    per_page: String(perPage)
  });

  const url = `${storePath}/salesreports/taxation/salesdetails?${params.toString()}`;
  return await request(url);
}

/**
 * Helper to format date YYYY-MM-DD
 */
function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get 7 Days Revenue Trend for Chart
 */
async function get7DaysTrend() {
  const days = [];
  const now = new Date();

  // Create array for past 7 days (including today)
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(formatDate(d));
  }

  const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const labels = [];
  const revenues = [];
  const taxes = [];

  // Query each day in parallel (or fetch week range and summarize)
  const results = await Promise.allSettled(
    days.map(async (dayStr) => {
      const summary = await getTaxReport(dayStr, dayStr);
      return {
        date: dayStr,
        revenue: summary.revenue_income || 0,
        tax: summary.revenue_tax || 0
      };
    })
  );

  results.forEach((res, idx) => {
    const dateObj = new Date(days[idx] + 'T00:00:00');
    const dayName = dayNames[dateObj.getDay()];
    const dateFormatted = `${dateObj.getDate()}/${dateObj.getMonth() + 1}`;
    labels.push(`${dayName} (${dateFormatted})`);

    if (res.status === 'fulfilled') {
      revenues.push(res.value.revenue);
      taxes.push(res.value.tax);
    } else {
      revenues.push(0);
      taxes.push(0);
    }
  });

  return {
    dates: days,
    labels,
    revenues,
    taxes
  };
}

/**
 * Format currency to IDR
 */
function formatRupiah(number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(number);
}

/**
 * Get full dashboard dataset in one unified call
 */
async function getFullDashboard(selectedDate = null) {
  const todayStr = selectedDate || formatDate(new Date());

  // Yesterday date
  const yesterdayObj = new Date(todayStr + 'T00:00:00');
  yesterdayObj.setDate(yesterdayObj.getDate() - 1);
  const yesterdayStr = formatDate(yesterdayObj);

  // Parallel fetch: Store, Today Tax, Yesterday Tax, Today Transactions (first 50), 7 Days Trend
  const [storeInfo, todayTax, yesterdayTax, todayTx, trend7Days] = await Promise.all([
    getStoreInfo().catch(() => ({ name: 'Naiki cafe', url_id: 'naikicafe' })),
    getTaxReport(todayStr, todayStr).catch(() => ({ revenue_income: 0, revenue_tax: 0 })),
    getTaxReport(yesterdayStr, yesterdayStr).catch(() => ({ revenue_income: 0, revenue_tax: 0 })),
    getSalesDetails(todayStr, todayStr, 1, 50).catch(() => ({ data: [], meta: { total: 0 } })),
    get7DaysTrend().catch(() => ({ labels: [], revenues: [], taxes: [] }))
  ]);

  const rawTxList = todayTx.data || [];
  const totalTransactions = todayTx.meta?.total || rawTxList.length;

  // Calculate payment methods distribution from transactions
  const paymentBreakdown = {};
  rawTxList.forEach(tx => {
    if (tx.voided === 1) return; // ignore voided
    const mode = tx.payment_mode_name || 'Lainnya';
    const amount = Number(tx.paid_amount) || Number(tx.subtotal) || 0;
    if (!paymentBreakdown[mode]) {
      paymentBreakdown[mode] = { count: 0, amount: 0 };
    }
    paymentBreakdown[mode].count += 1;
    paymentBreakdown[mode].amount += amount;
  });

  // Calculate KPI values
  const todayRevenue = todayTax.revenue_income || 0;
  const yesterdayRevenue = yesterdayTax.revenue_income || 0;
  const revenueGrowthPct = yesterdayRevenue > 0
    ? (((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100).toFixed(1)
    : 0;

  const todayTaxAmount = todayTax.revenue_tax || 0;
  const avgTicket = totalTransactions > 0 ? Math.round(todayRevenue / totalTransactions) : 0;

  return {
    status: 'success',
    timestamp: new Date().toISOString(),
    store: {
      id: storeInfo.store_id || 175605,
      name: storeInfo.name || 'Naiki cafe',
      url_id: storeInfo.url_id || 'naikicafe',
      role: storeInfo.role_name || 'Perpajakan (PJ)',
      logo: storeInfo.logo || storeInfo.logo_md || null,
      expiry_date: storeInfo.fexpiry_date || '17 March 2027'
    },
    filter: {
      date: todayStr,
      yesterday: yesterdayStr
    },
    kpi: {
      revenue: {
        raw: todayRevenue,
        formatted: formatRupiah(todayRevenue),
        growthPct: Number(revenueGrowthPct),
        isPositive: Number(revenueGrowthPct) >= 0
      },
      transactions: {
        total: totalTransactions,
        growthPct: 0 // calculated if previous count available
      },
      average_sale: {
        raw: avgTicket,
        formatted: formatRupiah(avgTicket)
      },
      tax: {
        raw: todayTaxAmount,
        formatted: formatRupiah(todayTaxAmount),
        ratePct: 10
      }
    },
    charts: {
      trend_7days: trend7Days,
      payment_methods: {
        labels: Object.keys(paymentBreakdown),
        counts: Object.values(paymentBreakdown).map(v => v.count),
        amounts: Object.values(paymentBreakdown).map(v => v.amount),
        raw: paymentBreakdown
      }
    },
    transactions: rawTxList.slice(0, 20), // latest 20
    meta: todayTx.meta || { total: totalTransactions, current_page: 1 }
  };
}

module.exports = {
  login,
  getToken,
  getStoreInfo,
  getTaxReport,
  getSalesDetails,
  get7DaysTrend,
  getFullDashboard,
  formatRupiah,
  formatDate
};
