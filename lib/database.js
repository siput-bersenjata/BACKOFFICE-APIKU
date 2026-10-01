/**
 * Database Module for Olsera Filtered Snapshots & Public API Configuration
 * Supports Cloud Firestore (Firebase Project: salshya) with local filesystem fallback.
 */

const fs = require('fs');
const path = require('path');

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
 * Get Public API Configuration (percentage, etc.)
 */
async function getPublicConfig() {
  // 1. Try Firestore
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_CONFIG.projectId}/databases/(default)/documents/${FIRESTORE_CONFIG.collection}/${FIRESTORE_CONFIG.configDoc}?key=${FIRESTORE_CONFIG.apiKey}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const doc = await res.json();
      const fields = doc.fields || {};
      return {
        percentage: Number(fields.percentage?.integerValue || fields.percentage?.doubleValue || 50),
        updated_at: fields.updated_at?.stringValue || new Date().toISOString()
      };
    }
  } catch (err) {
    console.warn('[DB] Firestore config read warning, using local/memory:', err.message);
  }

  // 2. Fallback to local
  const local = readLocalDb();
  return local.config || { percentage: 50, updated_at: new Date().toISOString() };
}

/**
 * Save Public API Configuration
 */
async function savePublicConfig(config) {
  const percentage = Math.max(1, Math.min(100, Number(config.percentage) || 50));
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
  local.config = { percentage, updated_at };
  writeLocalDb(local);

  return local.config;
}

/**
 * Save a new filtered transaction snapshot to the database
 */
async function saveSnapshot(snapshotData) {
  const snapshot_id = snapshotData.snapshot_id || `snap_${Date.now()}`;
  const nowStr = new Date().toISOString();

  const record = {
    snapshot_id,
    date: snapshotData.date,
    percentage: snapshotData.percentage,
    total_real_transactions: snapshotData.total_real_transactions || 0,
    saved_count: snapshotData.saved_count || 0,
    total_revenue: snapshotData.total_revenue || 0,
    total_tax: snapshotData.total_tax || 0,
    created_at: nowStr,
    source: 'Olsera Backoffice (Auto 5-Hour Sync)',
    database_destination: `Firebase Firestore (salshya / ${FIRESTORE_CONFIG.collection})`,
    transactions: snapshotData.transactions || []
  };

  // 1. Try Firestore
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_CONFIG.projectId}/databases/(default)/documents/${FIRESTORE_CONFIG.collection}?key=${FIRESTORE_CONFIG.apiKey}`;
    const firestoreDoc = {
      fields: {
        snapshot_id: { stringValue: snapshot_id },
        date: { stringValue: record.date },
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
      console.log(`[DB] Saved snapshot to Firestore: ${snapshot_id}`);
    }
  } catch (err) {
    console.warn('[DB] Firestore write warning, saved to local cache:', err.message);
  }

  // 2. Save to local/memory store
  const local = readLocalDb();
  if (!local.snapshots) local.snapshots = [];
  local.snapshots.unshift(record);
  // Keep last 30 snapshots
  local.snapshots = local.snapshots.slice(0, 30);
  local.last_sync_time = Date.now();
  writeLocalDb(local);

  return record;
}

/**
 * Get snapshots list from Firestore / local
 */
async function getSnapshots(limit = 15) {
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
        return snapshots;
      }
    }
  } catch (err) {
    console.warn('[DB] Firestore read warning, fallback to local:', err.message);
  }

  // 2. Fallback to local
  const local = readLocalDb();
  return (local.snapshots || []).slice(0, limit);
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
  shouldRun5HourSync
};
