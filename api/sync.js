const { getFullDashboard, getToken } = require('../lib/olsera');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // Force refresh token and pull fresh dashboard data
    await getToken(true);
    const date = req.query?.date || req.body?.date;
    const dashboardData = await getFullDashboard(date);

    res.status(200).json({
      status: 'success',
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
