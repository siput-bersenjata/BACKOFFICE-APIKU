/**
 * Database Module for Olsera Filtered Snapshots & Public API Configuration
 * Supports Cloud Firestore (Firebase Project: salshya) with local filesystem fallback.
 */

const fs = require('fs');
const path = require('path');
const { resequenceOrderNumbers } = require('./olsera');

const FIRESTORE_CONFIG = {
  projectId: process.env.FIREBASE_PROJECT_ID || 'salshya',
  apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyB0Gm7gWsubCfRPgQkdKbS5-pUUinJOkOc',
  collection: 'olsera_filtered_snapshots',
  configDoc: 'public_api_config'
};

const LOCAL_DATA_DIR = path.join(__dirname, '..', 'data');
const LOCAL_DB_FILE = path.join(LOCAL_DATA_DIR, 'database.json');

// Ensure local data dir exists
try {
  if (!fs.existsSync(LOCAL_DATA_DIR)) {
    fs.mkdirSync(LOCAL_DATA_DIR, { recursive: true });
  }
} catch (e) {
  // Read-only filesystem in some serverless environments
}

// In-memory fallback if filesystem is read-only
let memoryStore = {
  config: {
    percentage: 50,
    updated_at: new Date().toISOString()
  },
  snapshots: []
};

/**
 * Load local file database if available
 */
function readLocalDb() {
  try {
    if (fs.existsSync(LOCAL_DB_FILE)) {
      const content = fs.readFileSync(LOCAL_DB_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (e) {
    // Ignore read errors
  }
  return memoryStore;
}

/**
 * Save to local file database
 */
function writeLocalDb(data) {
  memoryStore = data;
  try {
    fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    // Read-only on serverless, memoryStore will hold it
  }
}

/**
 * Helper to get current Date object in WIB (UTC+7, Indonesia Time)
 */
function getWibDate(date = new Date()) {
  const d = new Date(date);
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  return new Date(utc + (3600000 * 7));
}

/**
 * Check if a given snapshot date is eligible for retention or should be purged.
 * Retention Rule:
 * - Keeps data for the current active month (e.g. 2026-10).
 * - When month transitions (e.g. into 2026-11):
 *   - Day 1 and Day 2 of the new month are a 2-day grace period (data from previous month is kept for backup/review).
 *   - From Day 3 onwards of the new month, all snapshots from previous months are permanently purged.
 *   - Any data older than 1 previous month (e.g., >= 2 months old) is always purged.
 */
function shouldPurgeSnapshot(snapshotDateStr, referenceDate = new Date(), graceDays = 2) {
  if (!snapshotDateStr) return false;
  
  const ref = getWibDate(referenceDate);
  const snap = new Date(snapshotDateStr);
  if (isNaN(snap.getTime())) return false;

  const currentYear = ref.getFullYear();
  const currentMonth = ref.getMonth(); // 0 - 11
  const currentDay = ref.getDate(); // 1 - 31

  const snapYear = snap.getFullYear();
  const snapMonth = snap.getMonth();

  // If snapshot is from current year and current month -> keep!
  if (snapYear === currentYear && snapMonth === currentMonth) {
    return false;
  }

  // If snapshot is from future -> keep!
  if (snapYear > currentYear || (snapYear === currentYear && snapMonth > currentMonth)) {
    return false;
  }

  // Calculate month difference
  const monthDiff = (currentYear - snapYear) * 12 + (currentMonth - snapMonth);

  // If older than 1 month (i.e. 2 months or more ago) -> definitely purge
  if (monthDiff > 1) {
    return true;
  }

  // Exactly 1 previous month:
  // Grace period: if currentDay <= graceDays (day 1 or 2), DO NOT purge yet.
  // Once currentDay > graceDays (day 3 onwards), purge!
  if (monthDiff === 1) {
    return currentDay > graceDays;
  }

  return false;
}

/**
 * Get detailed metadata about current monthly retention status
 */
function getRetentionStatus(referenceDate = new Date(), graceDays = 2) {
  const ref = getWibDate(referenceDate);
  const currentYear = ref.getFullYear();
  const currentMonth = ref.getMonth();
  const currentDay = ref.getDate();

  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  const currentMonthName = `${monthNames[currentMonth]} ${currentYear}`;
  
  // Previous month name
  const prevDate = new Date(currentYear, currentMonth - 1, 1);
  const prevMonthName = `${monthNames[prevDate.getMonth()]} ${prevDate.getFullYear()}`;

  // Next month name
  const nextDate = new Date(currentYear, currentMonth + 1, 1);
  const nextMonthName = `${monthNames[nextDate.getMonth()]} ${nextDate.getFullYear()}`;

  const isGracePeriodActive = currentDay <= graceDays;
  const daysRemainingInGrace = isGracePeriodActive ? (graceDays - currentDay + 1) : 0;
  
  // Next purge date: 3rd of next month (or 3rd of this month if today is day 1 or 2)
  let purgeDate;
  if (isGracePeriodActive) {
    purgeDate = new Date(currentYear, currentMonth, graceDays + 1);
  } else {
    purgeDate = new Date(currentYear, currentMonth + 1, graceDays + 1);
  }

  const nextPurgeFormatted = `${purgeDate.getDate()} ${monthNames[purgeDate.getMonth()]} ${purgeDate.getFullYear()}`;

  return {
    policy: 'monthly',
    grace_period_days: graceDays,
    current_period: currentMonthName,
    current_period_key: `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`,
    previous_period: prevMonthName,
    next_period: nextMonthName,
    today_wib: `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}`,
    current_day: currentDay,
    is_grace_period_active: isGracePeriodActive,
    grace_days_remaining: daysRemainingInGrace,
    next_purge_date: nextPurgeFormatted,
    description: `Database hanya menyimpan data hasil filter per periode bulan berjalan (${currentMonthName}). Ketika berganti bulan, data bulan lalu diberikan masa tenggang ${graceDays} hari (tanggal 1-${graceDays}) sebelum otomatis dihapus permanen pada tanggal ${graceDays + 1}.`
  };
}

/**
 * Get Public API Configuration (percentage, monthly retention, active restaurant account, etc.)
 */
async function getPublicConfig() {
  // 1. Try Firestore
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_CONFIG.projectId}/databases/(default)/documents/${FIRESTORE_CONFIG.collection}/${FIRESTORE_CONFIG.configDoc}?key=${FIRESTORE_CONFIG.apiKey}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const doc = await res.json();
      const fields = doc.fields || {};
      
      let activeAccount = null;
      if (fields.active_account_json?.stringValue) {
        try {
          activeAccount = JSON.parse(fields.active_account_json.stringValue);
        } catch (e) {}
      }

      let accounts = {};
      if (fields.accounts_json?.stringValue) {
        try {
          accounts = JSON.parse(fields.accounts_json.stringValue);
        } catch (e) {}
      }

      return {
        percentage: Number(fields.percentage?.integerValue || fields.percentage?.doubleValue || 50),
        monthly_retention: fields.monthly_retention?.booleanValue !== undefined ? fields.monthly_retention.booleanValue : true,
        grace_period_days: Number(fields.grace_period_days?.integerValue || 2),
        active_account: activeAccount,
        accounts: accounts,
        updated_at: fields.updated_at?.stringValue || new Date().toISOString()
      };
    }
  } catch (err) {
    console.warn('[DB] Firestore config read warning, using local/memory:', err.message);
  }

  // 2. Fallback to local
  const local = readLocalDb();
  return {
    percentage: local.config?.percentage !== undefined ? local.config.percentage : 50,
    monthly_retention: local.config?.monthly_retention !== undefined ? local.config.monthly_retention : true,
    grace_period_days: local.config?.grace_period_days !== undefined ? local.config.grace_period_days : 2,
    active_account: local.config?.active_account || null,
    accounts: local.config?.accounts || {},
    updated_at: local.config?.updated_at || new Date().toISOString()
  };
}

/**
 * Save Public API Configuration
 */
async function savePublicConfig(config) {
  const current = await getPublicConfig();
  const percentage = config.percentage !== undefined ? Math.max(1, Math.min(100, Number(config.percentage) || 50)) : current.percentage;
  const monthly_retention = config.monthly_retention !== undefined ? Boolean(config.monthly_retention) : (current.monthly_retention !== undefined ? current.monthly_retention : true);
  const grace_period_days = config.grace_period_days !== undefined ? Math.max(0, Math.min(10, Number(config.grace_period_days) || 2)) : (current.grace_period_days !== undefined ? current.grace_period_days : 2);
  
  const active_account = config.active_account !== undefined ? config.active_account : (current.active_account || null);
  const accounts = { ...(current.accounts || {}), ...(config.accounts || {}) };
  if (active_account && (active_account.storeUrlId || active_account.store_url_id)) {
    const slug = (active_account.storeUrlId || active_account.store_url_id).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    accounts[slug] = active_account;
  }

  const updated_at = new Date().toISOString();

  // 1. Try Firestore
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_CONFIG.projectId}/databases/(default)/documents/${FIRESTORE_CONFIG.collection}/${FIRESTORE_CONFIG.configDoc}?key=${FIRESTORE_CONFIG.apiKey}`;
    await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          percentage: { integerValue: String(percentage) },
          monthly_retention: { booleanValue: monthly_retention },
          grace_period_days: { integerValue: String(grace_period_days) },
          active_account_json: { stringValue: JSON.stringify(active_account) },
          accounts_json: { stringValue: JSON.stringify(accounts) },
          updated_at: { stringValue: updated_at },
          type: { stringValue: 'config' }
        }
      })
    });
  } catch (err) {
    console.warn('[DB] Firestore config save warning:', err.message);
  }

  // 2. Update local
  const local = readLocalDb();
  local.config = {
    percentage,
    monthly_retention,
    grace_period_days,
    active_account,
    accounts,
    updated_at
  };
  writeLocalDb(local);

  return local.config;
}

/**
 * Execute monthly retention cleanup
 * Removes snapshots from previous months after the grace period has passed
 */
async function cleanupOldSnapshots(options = {}) {
  const { force = false, referenceDate = new Date() } = options;
  const config = await getPublicConfig();
  if (config.monthly_retention === false && !force) {
    return { purged_count: 0, message: 'Monthly retention is disabled' };
  }

  const graceDays = force ? -1 : (Number(config.grace_period_days) || 2);
  const refDate = getWibDate(referenceDate);

  let purgedCount = 0;
  const purgedIds = [];

  // 1. Clean local database
  const local = readLocalDb();
  if (Array.isArray(local.snapshots) && local.snapshots.length > 0) {
    const originalCount = local.snapshots.length;
    const kept = [];
    for (const snap of local.snapshots) {
      const snapDate = snap.date || snap.created_at;
      if (shouldPurgeSnapshot(snapDate, refDate, graceDays)) {
        purgedCount++;
        purgedIds.push(snap.snapshot_id);
      } else {
        kept.push(snap);
      }
    }
    if (kept.length !== originalCount) {
      local.snapshots = kept;
      writeLocalDb(local);
      console.log(`[DB Retention] Purged ${originalCount - kept.length} local snapshots from previous period.`);
    }
  }

  // 2. Clean Firestore documents
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_CONFIG.projectId}/databases/(default)/documents/${FIRESTORE_CONFIG.collection}?pageSize=100&key=${FIRESTORE_CONFIG.apiKey}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      const docs = data.documents || [];
      for (const d of docs) {
        const fields = d.fields || {};
        if (fields.type?.stringValue === 'config' || d.name?.endsWith(FIRESTORE_CONFIG.configDoc)) {
          continue;
        }
        const snapDate = fields.date?.stringValue || fields.created_at?.stringValue;
        if (shouldPurgeSnapshot(snapDate, refDate, graceDays)) {
          try {
            const delUrl = `https://firestore.googleapis.com/v1/${d.name}?key=${FIRESTORE_CONFIG.apiKey}`;
            await fetch(delUrl, { method: 'DELETE' });
            console.log(`[DB Retention] Deleted old Firestore doc: ${d.name}`);
            const id = fields.snapshot_id?.stringValue || d.name;
            if (!purgedIds.includes(id)) {
              purgedCount++;
              purgedIds.push(id);
            }
          } catch (delErr) {
            console.warn(`[DB Retention] Failed deleting Firestore doc:`, delErr.message);
          }
        }
      }
    }
  } catch (err) {
    console.warn('[DB Retention] Firestore scan warning:', err.message);
  }

  return {
    purged_count: purgedCount,
    purged_ids: purgedIds,
    retention_status: getRetentionStatus(refDate, Number(config.grace_period_days) || 2)
  };
}

/**
 * Save a new filtered transaction snapshot to the database
 */
async function saveSnapshot(snapshotData) {
  const snapshot_id = snapshotData.snapshot_id || `snap_${Date.now()}`;
  const nowStr = new Date().toISOString();

  const transactions = resequenceOrderNumbers(snapshotData.transactions || []);

  const record = {
    snapshot_id,
    date: snapshotData.date,
    store_url_id: snapshotData.store_url_id || 'depottanjungapi',
    store_name: snapshotData.store_name || 'Depot TanjungApi',
    percentage: snapshotData.percentage,
    total_real_transactions: snapshotData.total_real_transactions || 0,
    saved_count: snapshotData.saved_count || transactions.length || 0,
    total_revenue: snapshotData.total_revenue || 0,
    total_tax: snapshotData.total_tax || 0,
    created_at: nowStr,
    source: 'Olsera Backoffice (Auto 5-Hour Sync)',
    database_destination: `Firebase Firestore (salshya / ${FIRESTORE_CONFIG.collection})`,
    transactions
  };

  // 1. Try Firestore
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_CONFIG.projectId}/databases/(default)/documents/${FIRESTORE_CONFIG.collection}?key=${FIRESTORE_CONFIG.apiKey}`;
    const firestoreDoc = {
      fields: {
        snapshot_id: { stringValue: snapshot_id },
        date: { stringValue: record.date },
        store_url_id: { stringValue: record.store_url_id },
        store_name: { stringValue: record.store_name },
        percentage: { integerValue: String(record.percentage) },
        total_real_transactions: { integerValue: String(record.total_real_transactions) },
        saved_count: { integerValue: String(record.saved_count) },
        total_revenue: { doubleValue: Number(record.total_revenue) },
        total_tax: { doubleValue: Number(record.total_tax) },
        created_at: { stringValue: nowStr },
        type: { stringValue: 'snapshot' },
        transactions_json: { stringValue: JSON.stringify(record.transactions) }
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(firestoreDoc)
    });

    if (res.ok) {
      const data = await res.json();
      record.firestore_name = data.name;
      console.log(`[DB] Saved snapshot to Firestore: ${snapshot_id} (${record.store_url_id})`);
    }
  } catch (err) {
    console.warn('[DB] Firestore write warning, saved to local cache:', err.message);
  }

  // 2. Save to local/memory store
  const local = readLocalDb();
  if (!local.snapshots) local.snapshots = [];
  local.snapshots.unshift(record);
  // Keep last 50 snapshots in local cache
  local.snapshots = local.snapshots.slice(0, 50);
  local.last_sync_time = Date.now();
  writeLocalDb(local);

  // Trigger monthly retention cleanup check in background
  cleanupOldSnapshots().catch(e => console.warn('[DB] Auto cleanup warning on saveSnapshot:', e.message));

  return record;
}

/**
 * Get snapshots list from Firestore / local
 */
async function getSnapshots(limit = 30) {
  // Trigger retention cleanup check before returning list
  try {
    await cleanupOldSnapshots();
  } catch (e) {
    // Ignore cleanup check error during read
  }

  // 1. Try Firestore
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_CONFIG.projectId}/databases/(default)/documents/${FIRESTORE_CONFIG.collection}?pageSize=${limit}&key=${FIRESTORE_CONFIG.apiKey}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      const docs = data.documents || [];
      const snapshots = [];

      for (const d of docs) {
        const fields = d.fields || {};
        // Skip config doc
        if (fields.type?.stringValue === 'config' || d.name?.endsWith(FIRESTORE_CONFIG.configDoc)) {
          continue;
        }

        let transactions = [];
        if (fields.transactions_json?.stringValue) {
          try {
            transactions = JSON.parse(fields.transactions_json.stringValue);
          } catch (e) {}
        }

        snapshots.push({
          snapshot_id: fields.snapshot_id?.stringValue || path.basename(d.name),
          date: fields.date?.stringValue || '',
          store_url_id: fields.store_url_id?.stringValue || 'depottanjungapi',
          store_name: fields.store_name?.stringValue || '',
          percentage: Number(fields.percentage?.integerValue || 50),
          total_real_transactions: Number(fields.total_real_transactions?.integerValue || 0),
          saved_count: Number(fields.saved_count?.integerValue || 0),
          total_revenue: Number(fields.total_revenue?.doubleValue || 0),
          total_tax: Number(fields.total_tax?.doubleValue || 0),
          created_at: fields.created_at?.stringValue || d.createTime,
          database_destination: `Cloud Firestore (salshya / ${FIRESTORE_CONFIG.collection})`,
          transactions
        });
      }

      if (snapshots.length > 0) {
        // Sort newest first
        snapshots.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        return snapshots.map(s => ({
          ...s,
          transactions: resequenceOrderNumbers(s.transactions)
        }));
      }
    }
  } catch (err) {
    console.warn('[DB] Firestore read warning, fallback to local:', err.message);
  }

  // 2. Fallback to local
  const local = readLocalDb();
  const list = (local.snapshots || []).slice(0, limit);
  return list.map(s => ({
    ...s,
    transactions: resequenceOrderNumbers(s.transactions)
  }));
}

/**
 * Check if 5 hours have passed since last snapshot
 * 5 hours = 5 * 60 * 60 * 1000 = 18,000,000 ms
 */
async function shouldRun5HourSync() {
  const local = readLocalDb();
  const lastSync = local.last_sync_time || 0;
  const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
  return (Date.now() - lastSync) >= FIVE_HOURS_MS;
}

module.exports = {
  getPublicConfig,
  savePublicConfig,
  saveSnapshot,
  getSnapshots,
  shouldRun5HourSync,
  cleanupOldSnapshots,
  getRetentionStatus,
  shouldPurgeSnapshot
};
