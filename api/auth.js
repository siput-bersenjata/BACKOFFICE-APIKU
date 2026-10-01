const { authenticateAccount } = require('../lib/olsera');

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

  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Method Not Allowed' });
    return;
  }

  // Parse body
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

  const { username, password } = body || {};

  if (!username || !password) {
    res.status(400).json({
      status: 'error',
      message: 'Username/Email dan Password Olsera wajib diisi.'
    });
    return;
  }

  try {
    const result = await authenticateAccount(username.trim(), password);
    res.status(200).json({
      status: 'success',
      message: 'Autentikasi akun Olsera berhasil',
      data: result
    });
  } catch (error) {
    console.error('[API /api/auth] Error:', error.message);
    res.status(401).json({
      status: 'error',
      message: error.message || 'Login Olsera gagal. Periksa kembali email dan password Anda.'
    });
  }
};
