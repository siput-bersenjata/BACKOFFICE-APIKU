/**
 * Olsera Backoffice API Client
 * Handles authentication, dynamic token caching, multi-account support,
 * store information, and transaction data retrieval.
 */

const DEFAULT_CONFIG = {
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

// Global cache for default account
let cachedDefaultToken = null;
let defaultTokenExpiresAt = 0;
let cachedDefaultStore = null;

// Cache for custom accounts: Map(username -> { token, expiresAt, store })
const customTokens = new Map();

/**
 * Login with custom or default credentials
 */
async function login(customCreds = null) {
  const username = customCreds?.username || DEFAULT_CONFIG.credentials.username;
  const password = customCreds?.password || DEFAULT_CONFIG.credentials.password;

  const payload = {
    username,
    password,
    client_id: 2,
    client_secret: DEFAULT_CONFIG.credentials.client_secret,
    grant_type: 'password'
  };

  try {
    const res = await fetch(DEFAULT_CONFIG.authUrl, {
      method: 'POST',
      headers: DEFAULT_CONFIG.headers,
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => null);
      const msg = errData?.error_description || errData?.message || `HTTP ${res.status}`;
      throw new Error(`Login Olsera gagal: ${msg}`);
    }

    const data = await res.json();
    const token = data.access_token;
    const expiresInMs = (data.expires_in || 3600) * 1000;
    const expiresAt = Date.now() + expiresInMs - 60000;

    if (!customCreds || username === DEFAULT_CONFIG.credentials.username) {
      cachedDefaultToken = token;
      defaultTokenExpiresAt = expiresAt;
    } else {
      customTokens.set(username, { token, expiresAt });
    }

    return token;
  } catch (error) {
    console.error(`[Olsera API] Login error (${username}):`, error.message);
    throw error;
  }
}

/**
 * Get active token for context
 */
async function getToken(authContext = {}, forceRefresh = false) {
  if (authContext.token && !forceRefresh) {
    return authContext.token;
  }

  const username = authContext.username || DEFAULT_CONFIG.credentials.username;
  const password = authContext.password || DEFAULT_CONFIG.credentials.password;

  if (username === DEFAULT_CONFIG.credentials.username) {
    if (!cachedDefaultToken || forceRefresh || Date.now() >= defaultTokenExpiresAt) {
      await login();
    }
    return cachedDefaultToken;
  }

  // Custom user
  const cached = customTokens.get(username);
  if (!cached || forceRefresh || Date.now() >= cached.expiresAt) {
    return await login({ username, password });
  }
  return cached.token;
}

/**
 * Authenticated request to Olsera API
 */
async function request(endpoint, options = {}, authContext = {}) {
  let token = await getToken(authContext);

  const url = endpoint.startsWith('http') ? endpoint : `${DEFAULT_CONFIG.apiBase}/${endpoint}`;

  const headers = {
    ...DEFAULT_CONFIG.headers,
    'Authorization': `Bearer ${token}`,
    ...(options.headers || {})
  };

  let res = await fetch(url, {
    ...options,
    headers
  });

  if (res.status === 401) {
    console.warn('[Olsera API] Token 401 Unauthorized, refreshing...');
    // If authContext had a token, it is now invalid. We force a fresh login with username/password.
    if (authContext.token) delete authContext.token;
    
    token = await getToken(authContext, true);
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
 * Login and retrieve full account info and stores list
 */
async function authenticateAccount(username, password) {
  const token = await login({ username, password });

  // Parallel fetch: stores and user profile
  const [storesData, userData] = await Promise.all([
    request('store?per_page=50&page=1', {}, { token }).catch(() => ({ data: [] })),
    request('user', {}, { token }).catch(() => ({ data: {} }))
  ]);

  const stores = (storesData && storesData.data) || [];
  const user = (userData && userData.data) || { email: username, name: username.split('@')[0] };

  return {
    token,
    user,
    stores: stores.map(s => ({
      id: s.store_id,
      name: s.name,
      url_id: s.url_id,
      role: s.role_name || s.role_id,
      logo: s.logo || s.logo_md || null,
      expiry_date: s.fexpiry_date || s.expiry_date
    }))
  };
}

/**
 * Get store information for active account
 */
async function getStoreInfo(authContext = {}) {
  try {
    const params = new URLSearchParams({
      per_page: '10',
      page: '1',
      'sort_type[]': 'desc',
      'sort_column[]': 'is_store_active'
    });

    const data = await request(`store?${params.toString()}`, {}, authContext);
    if (data && data.data && data.data.length > 0) {
      if (authContext.storeUrlId) {
        const matched = data.data.find(s => s.url_id === authContext.storeUrlId);
        if (matched) return matched;
      }
      return data.data[0];
    }
  } catch (err) {
    console.error('[Olsera API] Failed to fetch store info:', err.message);
  }

  return {
    name: authContext.storeUrlId || DEFAULT_CONFIG.storeUrlId,
    url_id: authContext.storeUrlId || DEFAULT_CONFIG.storeUrlId
  };
}

/**
 * Build store service path
 */
function getStoreBasePath(storeUrlId) {
  const store = storeUrlId || DEFAULT_CONFIG.storeUrlId;
  return `${store}/admin/${DEFAULT_CONFIG.version}/${DEFAULT_CONFIG.lang}`;
}

/**
 * Get tax report summary for date range
 */
async function getTaxReport(startDate, endDate, authContext = {}) {
  const storeUrlId = authContext.storeUrlId || DEFAULT_CONFIG.storeUrlId;
  const storePath = getStoreBasePath(storeUrlId);
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate
  });

  const url = `${storePath}/salesreports/taxation/taxreports?${params.toString()}`;
  const res = await request(url, {}, authContext);
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
async function getSalesDetails(startDate, endDate, page = 1, perPage = 50, authContext = {}) {
  const storeUrlId = authContext.storeUrlId || DEFAULT_CONFIG.storeUrlId;
  const storePath = getStoreBasePath(storeUrlId);
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    page: String(page),
    per_page: String(perPage)
  });

  const url = `${storePath}/salesreports/taxation/salesdetails?${params.toString()}`;
  return await request(url, {}, authContext);
}

/**
 * Format date YYYY-MM-DD
 */
function formatDate(d) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

/**
 * Get 7 Days Revenue Trend for Chart
 */
async function get7DaysTrend(authContext = {}) {
  const days = [];
  const now = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(formatDate(d));
  }

  const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const labels = [];
  const revenues = [];
  const taxes = [];

  const results = await Promise.allSettled(
    days.map(async (dayStr) => {
      const summary = await getTaxReport(dayStr, dayStr, authContext);
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

function formatRupiah(number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(number);
}

/**
 * Extract auth context from request headers
 */
function extractAuthContext(req) {
  const headers = req.headers || {};
  return {
    token: headers['x-olsera-token'] || null,
    storeUrlId: headers['x-olsera-store'] || null,
    username: headers['x-olsera-username'] || null,
    password: headers['x-olsera-password'] || null
  };
}

/**
 * Get full dashboard dataset with dynamic account support
 */
async function getFullDashboard(selectedDate = null, authContext = {}) {
  const todayStr = selectedDate || formatDate(new Date());

  const yesterdayObj = new Date(todayStr + 'T00:00:00Z');
  // We don't want timezone offsets to shift it since we gave it UTC 00:00:00.
  // Actually, simplest way is to parse the YYYY-MM-DD back safely:
  const parts = todayStr.split('-');
  const yesterdayDate = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] - 1));
  const yesterdayStr = yesterdayDate.toISOString().split('T')[0];

  // Parallel fetch: Store, Today Tax, Yesterday Tax, Today Transactions, 7 Days Trend
  const [storeInfo, todayTax, yesterdayTax, todayTx, trend7Days] = await Promise.all([
    getStoreInfo(authContext).catch(() => ({ name: authContext.storeUrlId || 'Naiki cafe', url_id: authContext.storeUrlId || 'naikicafe' })),
    getTaxReport(todayStr, todayStr, authContext).catch(() => ({ revenue_income: 0, revenue_tax: 0 })),
    getTaxReport(yesterdayStr, yesterdayStr, authContext).catch(() => ({ revenue_income: 0, revenue_tax: 0 })),
    getSalesDetails(todayStr, todayStr, 1, 50, authContext).catch(() => ({ data: [], meta: { total: 0 } })),
    get7DaysTrend(authContext).catch(() => ({ labels: [], revenues: [], taxes: [] }))
  ]);

  const rawTxList = todayTx.data || [];
  const totalTransactions = todayTx.meta?.total || rawTxList.length;

  const paymentBreakdown = {};
  rawTxList.forEach(tx => {
    if (tx.voided === 1) return;
    const mode = tx.payment_mode_name || 'Lainnya';
    const amount = Number(tx.paid_amount) || Number(tx.subtotal) || 0;
    if (!paymentBreakdown[mode]) {
      paymentBreakdown[mode] = { count: 0, amount: 0 };
    }
    paymentBreakdown[mode].count += 1;
    paymentBreakdown[mode].amount += amount;
  });

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
    account: {
      username: authContext.username || DEFAULT_CONFIG.credentials.username,
      is_custom: !!(authContext.token || authContext.username)
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
        growthPct: 0
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
    transactions: rawTxList.slice(0, 20),
    meta: todayTx.meta || { total: totalTransactions, current_page: 1 }
  };
}

/**
 * Re-sequence order numbers sequentially starting from the first transaction's number
 * to eliminate gaps/jumps caused by percentage filtering.
 */
function resequenceOrderNumbers(transactions) {
  if (!Array.isArray(transactions) || transactions.length === 0) return transactions;

  const first = transactions.find(t => t && t.order_no);
  if (!first || !first.order_no) return transactions;

  const str = String(first.order_no);
  // Match prefix up to last non-digit character (if any) followed by trailing digits
  let match = str.match(/^(.*[^0-9])([0-9]+)$/);
  let prefix = '';
  let digitsStr = '';

  if (match) {
    prefix = match[1];
    digitsStr = match[2];
  } else if (/^\d+$/.test(str)) {
    prefix = '';
    digitsStr = str;
  } else {
    // If no trailing digits found, return as is
    return transactions;
  }

  const padLength = digitsStr.length;
  let currentVal = BigInt(digitsStr);

  return transactions.map((t) => {
    if (!t) return t;
    const newNo = prefix + currentVal.toString().padStart(padLength, '0');
    currentVal += 1n;
    return {
      ...t,
      order_no: newNo
    };
  });
}

  formatDate,
  resequenceOrderNumbers
};

