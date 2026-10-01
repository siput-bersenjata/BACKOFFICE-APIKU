const { getFullDashboard } = require('../lib/olsera');

module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { date } = req.query || {};
    const dashboardData = await getFullDashboard(date);
    res.status(200).json(dashboardData);
  } catch (error) {
    console.error('[API /api/dashboard] Error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Internal server error while fetching dashboard data'
    });
  }
};
