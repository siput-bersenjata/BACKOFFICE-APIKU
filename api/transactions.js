const { getSalesDetails, formatDate, extractAuthContext } = require('../lib/olsera');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-olsera-token, x-olsera-store, x-olsera-username, x-olsera-password'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const today = formatDate(new Date());
    const startDate = req.query.start_date || today;
    const endDate = req.query.end_date || today;
    const page = parseInt(req.query.page, 10) || 1;
    const perPage = parseInt(req.query.per_page, 10) || 50;
    const authContext = extractAuthContext(req);

    const data = await getSalesDetails(startDate, endDate, page, perPage, authContext);
    res.status(200).json(data);
  } catch (error) {
    console.error('[API /api/transactions] Error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Internal server error while fetching transactions'
    });
  }
};
