const { authenticateAccount } = require('../lib/olsera');
const { saveOutletConfig, normalizeStoreSlug, getRegisteredOutlets } = require('../lib/database');

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
    const cleanUsername = username.trim();
    const result = await authenticateAccount(cleanUsername, password);
    const rawStores = result.stores || [];

    // Fallback if no stores were returned from Olsera
    const storesToProcess = rawStores.length > 0 ? rawStores : [{
      id: 1,
      name: cleanUsername.split('@')[0],
      url_id: cleanUsername.split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '')
    }];

    const registeredStores = [];
    for (const store of storesToProcess) {
      const slug = normalizeStoreSlug(store.url_id || store.name);
      try {
        await saveOutletConfig(slug, {
          username: cleanUsername,
          password: password,
          token: result.token,
          store_name: store.name,
          store_url_id: slug,
          percentage: 50,
          monthly_retention: true,
          grace_period_days: 2
        });
      } catch (saveErr) {
        console.warn(`[API /api/auth] Warning saving config for outlet ${slug}:`, saveErr.message);
      }

      registeredStores.push({
        ...store,
        url_id: slug,
        slug,
        sub_link: `/outlet/${slug}`,
        api_endpoint: `/api/public/${slug}`,
        preview_endpoint: `/preview.html?resto=${slug}`
      });
    }

    const allOutlets = await getRegisteredOutlets().catch(() => []);

    res.status(200).json({
      status: 'success',
      message: `Akun Olsera berhasil ditambahkan! Sub-link dan API otomatis dibuat untuk ${registeredStores.length} outlet.`,
      data: {
        token: result.token,
        user: result.user,
        stores: registeredStores,
        all_outlets: allOutlets
      }
    });
  } catch (error) {
    console.error('[API /api/auth] Error:', error.message);
    res.status(401).json({
      status: 'error',
      message: error.message || 'Login Olsera gagal. Periksa kembali email dan password Anda.'
    });
  }
};
