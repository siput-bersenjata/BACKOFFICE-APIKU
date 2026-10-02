const { getFullDashboard, getToken, extractAuthContext } = require('../lib/olsera');
const { getOutletConfig, normalizeStoreSlug } = require('../lib/database');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-olsera-token, x-olsera-store, x-olsera-username, x-olsera-password'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    let authContext = extractAuthContext(req);
    const store = req.query?.store || req.body?.store;

    if (!authContext.username && !authContext.token && store) {
      try {
        const outlet = await getOutletConfig(store);
        if (outlet) {
          authContext = {
            username: outlet.username,
            password: outlet.password,
            storeUrlId: outlet.store_url_id,
            token: outlet.token || null
          };
        }
      } catch (err) {
        console.warn('[Sync API] Outlet config resolve warning:', err.message);
      }
    }

    // Refresh token if needed
    await getToken(authContext, true);
    const date = req.query?.date || req.body?.date;
    const dashboardData = await getFullDashboard(date, authContext);

    res.status(200).json({
      status: 'success',
      store: authContext.storeUrlId || store || 'default',
      message: 'Data successfully synchronized from Olsera Backoffice',
      timestamp: new Date().toISOString(),
      data: dashboardData
    });
  } catch (error) {
    console.error('[API /api/sync] Error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Synchronization failed'
    });
  }
};
