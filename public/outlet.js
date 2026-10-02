/**
 * Outlet Dashboard Client Application
 * Dedicated dashboard per outlet with strict database snapshot & public API isolation.
 */

// State
const currentStore = getCurrentOutletSlug();
let currentDate = getTodayString();
let dashboardData = null;
let allTransactions = [];
let filteredTransactions = [];
let currentPage = 1;
const itemsPerPage = 15;
let autoRefreshTimer = null;
let revenueChart = null;
let paymentChart = null;

let outletConfig = null;
let dbSnapshots = [];

function getCurrentOutletSlug() {
    const path = window.location.pathname.toLowerCase();
    const match = path.match(/\/(?:outlet\/)?([a-z0-9_-]+)/);
    const params = new URLSearchParams(window.location.search);
    let slug = params.get('store');
    if (!slug && match && match[1] && match[1] !== 'outlet' && match[1] !== 'index.html' && match[1] !== 'outlet.html') {
        slug = match[1];
    }
    if (!slug) slug = 'depotanjungapi';
    if (slug === 'depottanjungapi') slug = 'depotanjungapi';
    if (slug === 'naikiresto') slug = 'naikicafe';
    return slug;
}

function getTodayString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function initLucide() {
    if (window.lucide) {
        lucide.createIcons();
    }
}

function formatRupiah(number) {
    const num = Number(number) || 0;
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0
    }).format(num);
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initLucide();
    initCharts();
    setupEventListeners();
    updateOutletStaticUI();
    fetchOutletDatabaseInfo();
    fetchDashboardData();
    setupAutoRefresh();
});

function updateOutletStaticUI() {
    const displayName = currentStore === 'depotanjungapi' ? 'Depot TanjungApi' : (currentStore === 'naikicafe' ? 'Naiki cafe' : currentStore);
    
    document.title = `Dashboard Outlet ${displayName} - Olsera Sync`;

    const elStoreName = document.getElementById('storeNameText');
    if (elStoreName) elStoreName.textContent = displayName;

    const elSlugBadge = document.getElementById('storeSlugBadge');
    if (elSlugBadge) elSlugBadge.textContent = currentStore;

    const elHeaderStore = document.getElementById('headerStoreName');
    if (elHeaderStore) elHeaderStore.textContent = displayName;

    const elBannerTitle = document.getElementById('bannerStoreTitle');
    if (elBannerTitle) elBannerTitle.textContent = displayName;

    const elPublicLabel = document.getElementById('publicStoreNameLabel');
    if (elPublicLabel) elPublicLabel.textContent = displayName;

    const elTableTitle = document.getElementById('tableOutletTitle');
    if (elTableTitle) elTableTitle.textContent = displayName;

    const elDbOutlet = document.getElementById('dbOutletNameText');
    if (elDbOutlet) elDbOutlet.textContent = displayName;

    const elDbSlug = document.getElementById('dbOutletSlugText');
    if (elDbSlug) elDbSlug.textContent = `Slug: ${currentStore}`;

    // Update Public API Endpoint Box
    const origin = window.location.origin || 'https://backoffice-apiku.vercel.app';
    const publicUrl = `${origin}/api/public/${currentStore}`;
    
    const elApiUrl = document.getElementById('publicApiUrlText');
    if (elApiUrl) elApiUrl.textContent = publicUrl;

    const elApiMethod = document.getElementById('publicApiMethodBadge');
    if (elApiMethod) elApiMethod.textContent = `GET /api/public/${currentStore}`;

    const elOpenJson = document.getElementById('openApiUrlBtn');
    if (elOpenJson) elOpenJson.href = `/api/public/${currentStore}`;

    const elOpenPreview = document.getElementById('openPreviewPageBtn');
    if (elOpenPreview) elOpenPreview.href = `/preview.html?resto=${currentStore}`;
}

/**
 * Setup Event Listeners
 */
function setupEventListeners() {
    // Navigation
    const navDash = document.getElementById('navDashboardBtn');
    const navTx = document.getElementById('navTransactionsBtn');
    const navCharts = document.getElementById('navChartsBtn');
    const navPublic = document.getElementById('navPublicApiBtn');

    if (navDash) navDash.addEventListener('click', () => switchView('dashboard'));
    if (navTx) navTx.addEventListener('click', () => switchView('transactions'));
    if (navCharts) navCharts.addEventListener('click', () => switchView('charts'));
    if (navPublic) navPublic.addEventListener('click', () => switchView('publicApi'));

    // Sync button
    const syncBtn = document.getElementById('syncBtn');
    if (syncBtn) syncBtn.addEventListener('click', syncData);

    // Refresh tx button
    const refreshTxBtn = document.getElementById('refreshTxBtn');
    if (refreshTxBtn) refreshTxBtn.addEventListener('click', () => fetchTransactions(1));

    // Date filters
    const dateInput = document.getElementById('dateFilterInput');
    if (dateInput) {
        dateInput.value = currentDate;
        dateInput.addEventListener('change', (e) => {
            if (e.target.value) {
                currentDate = e.target.value;
                fetchDashboardData(currentDate);
            }
        });
    }

    const applyDateBtn = document.getElementById('applyDateBtn');
    if (applyDateBtn && dateInput) {
        applyDateBtn.addEventListener('click', () => {
            if (dateInput.value) {
                currentDate = dateInput.value;
                fetchDashboardData(currentDate);
            }
        });
    }

    const todayDateBtn = document.getElementById('todayDateBtn');
    if (todayDateBtn && dateInput) {
        todayDateBtn.addEventListener('click', () => {
            currentDate = getTodayString();
            dateInput.value = currentDate;
            fetchDashboardData(currentDate);
        });
    }

    // Search input
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            if (!query) {
                filteredTransactions = [...allTransactions];
            } else {
                filteredTransactions = allTransactions.filter(tx => 
                    (tx.order_no && tx.order_no.toLowerCase().includes(query)) ||
                    (tx.payment_type_name && tx.payment_type_name.toLowerCase().includes(query)) ||
                    (tx.customer_name && tx.customer_name.toLowerCase().includes(query))
                );
            }
            renderTransactionsTable(1);
        });
    }

    // Pagination
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    if (prevPageBtn) {
        prevPageBtn.addEventListener('click', () => {
            if (currentPage > 1) renderTransactionsTable(currentPage - 1);
        });
    }
    if (nextPageBtn) {
        nextPageBtn.addEventListener('click', () => {
            renderTransactionsTable(currentPage + 1);
        });
    }

    // Modal Close
    const closeModalBtn = document.getElementById('closeModalBtn');
    const closeModalBtn2 = document.getElementById('closeModalBtn2');
    const detailModal = document.getElementById('detailModal');
    if (closeModalBtn) closeModalBtn.addEventListener('click', () => detailModal && detailModal.classList.add('hidden'));
    if (closeModalBtn2) closeModalBtn2.addEventListener('click', () => detailModal && detailModal.classList.add('hidden'));

    // Percentage slider
    const slider = document.getElementById('percentageSlider');
    if (slider) {
        slider.addEventListener('input', (e) => {
            const val = e.target.value;
            const text = document.getElementById('sliderValueText');
            if (text) text.textContent = `${val}%`;
            calculateLiveSimulation(val);
        });
    }

    // Save default percentage
    const saveDefaultBtn = document.getElementById('saveDefaultPercentageBtn');
    if (saveDefaultBtn) {
        saveDefaultBtn.addEventListener('click', savePercentageConfig);
    }

    // Copy API URL
    const copyBtn = document.getElementById('copyApiUrlBtn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const origin = window.location.origin || 'https://backoffice-apiku.vercel.app';
            const url = `${origin}/api/public/${currentStore}`;
            navigator.clipboard.writeText(url).then(() => {
                const btnText = document.getElementById('copyBtnText');
                if (btnText) {
                    btnText.textContent = 'Tersalin!';
                    setTimeout(() => { btnText.textContent = 'Salin Tautan API'; }, 2000);
                }
            });
        });
    }

    // Manual DB Snapshot Sync
    const manualDbSyncBtn = document.getElementById('manualDbSyncBtn');
    if (manualDbSyncBtn) {
        manualDbSyncBtn.addEventListener('click', manualSyncSnapshot);
    }

    // Refresh Snapshots
    const refreshSnapshotsBtn = document.getElementById('refreshSnapshotsBtn');
    if (refreshSnapshotsBtn) {
        refreshSnapshotsBtn.addEventListener('click', fetchOutletDatabaseInfo);
    }

    // Save Retention
    const saveRetentionBtn = document.getElementById('saveRetentionBtn');
    if (saveRetentionBtn) {
        saveRetentionBtn.addEventListener('click', saveRetentionConfig);
    }

    // Mobile menu toggle
    const mobileBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('mobileBackdrop');
    if (mobileBtn && sidebar && backdrop) {
        mobileBtn.addEventListener('click', () => {
            sidebar.classList.toggle('hidden');
            backdrop.classList.toggle('hidden');
        });
        backdrop.addEventListener('click', () => {
            sidebar.classList.add('hidden');
            backdrop.classList.add('hidden');
        });
    }
}

/**
 * Switch View
 */
function switchView(viewName) {
    const mainView = document.getElementById('mainDashboardView');
    const publicView = document.getElementById('publicApiView');
    const navDash = document.getElementById('navDashboardBtn');
    const navTx = document.getElementById('navTransactionsBtn');
    const navCharts = document.getElementById('navChartsBtn');
    const navPublic = document.getElementById('navPublicApiBtn');

    const defaultNavClass = 'w-full flex items-center gap-3 px-3 py-2.5 text-slate-600 hover:bg-slate-50 hover:text-slate-900 rounded-xl font-medium transition-colors text-left';
    const activeNavClass = 'w-full flex items-center gap-3 px-3 py-2.5 bg-indigo-50 text-indigo-600 rounded-xl font-medium transition-colors text-left';

    if (navDash) navDash.className = defaultNavClass;
    if (navTx) navTx.className = defaultNavClass;
    if (navCharts) navCharts.className = defaultNavClass;
    if (navPublic) navPublic.className = defaultNavClass + ' group';

    if (viewName === 'publicApi') {
        if (mainView) mainView.classList.add('hidden');
        if (publicView) publicView.classList.remove('hidden');
        if (navPublic) navPublic.className = activeNavClass + ' group';
        fetchOutletDatabaseInfo();
        calculateLiveSimulation();
    } else {
        if (publicView) publicView.classList.add('hidden');
        if (mainView) mainView.classList.remove('hidden');

        if (viewName === 'dashboard' && navDash) {
            navDash.className = activeNavClass;
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (viewName === 'transactions') {
            if (navTx) navTx.className = activeNavClass;
            const txCard = document.getElementById('transactionsCard');
            if (txCard) txCard.scrollIntoView({ behavior: 'smooth' });
        } else if (viewName === 'charts') {
            if (navCharts) navCharts.className = activeNavClass;
            const chartsSection = document.getElementById('revenueChart');
            if (chartsSection) chartsSection.scrollIntoView({ behavior: 'smooth' });
        }
    }

    // Close mobile menu if open
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('mobileBackdrop');
    if (window.innerWidth < 768 && sidebar && !sidebar.classList.contains('hidden')) {
        sidebar.classList.add('hidden');
        if (backdrop) backdrop.classList.add('hidden');
    }
}

/**
 * Fetch Outlet Database Info & Snapshots
 */
async function fetchOutletDatabaseInfo() {
    try {
        const res = await fetch(`/api/database?store=${currentStore}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data.status === 'success') {
            outletConfig = data.config;
            dbSnapshots = data.snapshots || [];

            // Update percentage slider
            const slider = document.getElementById('percentageSlider');
            const sliderText = document.getElementById('sliderValueText');
            if (slider && outletConfig?.percentage) {
                slider.value = outletConfig.percentage;
                if (sliderText) sliderText.textContent = `${outletConfig.percentage}%`;
            }

            // Update total snapshots count
            const elTotalSnap = document.getElementById('dbTotalSnapshots');
            if (elTotalSnap) elTotalSnap.textContent = `${dbSnapshots.length} Snapshot`;

            // Update user email
            const elUserEmail = document.getElementById('activeUserEmail');
            if (elUserEmail && outletConfig?.username) {
                elUserEmail.textContent = `Akun: ${outletConfig.username}`;
            }

            // Update retention status banner
            if (data.retention) {
                updateRetentionUI(data.retention, outletConfig?.grace_period_days || 2);
            }

            renderDbSnapshotsTable(dbSnapshots);
            calculateLiveSimulation();
        }
    } catch (err) {
        console.warn('[Outlet DB Info] Error:', err);
    }
}

/**
 * Update Retention UI
 */
function updateRetentionUI(retention, graceDays) {
    const periodTitle = document.getElementById('retentionPeriodTitle');
    if (periodTitle) periodTitle.textContent = `Periode Aktif Database: ${retention.current_period}`;

    const policyDesc = document.getElementById('retentionPolicyDesc');
    if (policyDesc) policyDesc.textContent = retention.description;

    const nextPurge = document.getElementById('retentionNextPurge');
    if (nextPurge) nextPurge.textContent = retention.next_purge_date || 'Tanggal 3 Bulan Depan';

    const graceSelect = document.getElementById('gracePeriodSelect');
    if (graceSelect) graceSelect.value = String(graceDays);
}

/**
 * Render DB Snapshots Table (Strictly isolated to this outlet)
 */
function renderDbSnapshotsTable(snapshots) {
    const tbody = document.getElementById('dbSnapshotsTableBody');
    if (!tbody) return;

    if (!snapshots || snapshots.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="p-8 text-center text-slate-400">
                    <div class="flex flex-col items-center justify-center gap-1.5">
                        <i data-lucide="inbox" class="w-8 h-8 text-slate-300"></i>
                        <span class="font-medium text-slate-600">Belum ada snapshot database tersimpan untuk outlet ini</span>
                        <span class="text-xs text-slate-400">Klik tombol "Simpan Snapshot Outlet Ini Sekarang" di atas untuk menyimpan data perdana.</span>
                    </div>
                </td>
            </tr>
        `;
        initLucide();
        return;
    }

    tbody.innerHTML = snapshots.map((s, idx) => {
        const timeFormatted = s.created_at ? new Date(s.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-';
        const dateFormatted = s.date || '-';
        const snapIdShort = s.snapshot_id ? s.snapshot_id.replace('snap_', '#') : `#${idx + 1}`;

        return `
            <tr class="hover:bg-slate-50/70 transition-colors">
                <td class="p-3.5 font-mono font-bold text-indigo-600">${snapIdShort}</td>
                <td class="p-3.5 font-semibold text-slate-800">${dateFormatted}</td>
                <td class="p-3.5">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700">
                        ${s.percentage}% Rasio
                    </span>
                </td>
                <td class="p-3.5 text-right font-medium text-slate-600">${s.total_real_transactions} tx</td>
                <td class="p-3.5 text-right font-bold text-emerald-600">${s.saved_count} tx</td>
                <td class="p-3.5 text-right font-bold text-slate-900">${formatRupiah(s.total_revenue)}</td>
                <td class="p-3.5 text-right font-medium text-amber-600">${formatRupiah(s.total_tax)}</td>
                <td class="p-3.5 text-slate-500 font-mono text-[11px]">${timeFormatted} WIB</td>
                <td class="p-3.5 text-center">
                    <button onclick="toggleSnapshotDetails(${idx})" class="px-2 py-1 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-600 text-[11px] font-semibold rounded transition-colors">
                        Lihat Data (${s.saved_count})
                    </button>
                </td>
            </tr>
            <tr id="snapDetailRow_${idx}" class="hidden bg-slate-50/90">
                <td colspan="9" class="p-4">
                    <div class="bg-white p-3 rounded-xl border border-slate-200 space-y-2">
                        <div class="flex items-center justify-between text-xs font-bold text-slate-700 pb-2 border-b border-slate-100">
                            <span>Daftar Transaksi Snapshot (${s.saved_count} item tersimpan)</span>
                            <span class="font-mono text-indigo-600">ID: ${s.snapshot_id}</span>
                        </div>
                        <div class="max-h-48 overflow-y-auto divide-y divide-slate-100 text-xs">
                            ${(s.transactions || []).map((t, i) => `
                                <div class="py-1.5 flex items-center justify-between">
                                    <span class="font-mono text-slate-600 font-bold">${t.order_no || `#${i+1}`}</span>
                                    <span class="text-slate-500">${t.fcreated_at || t.created_at || '-'}</span>
                                    <span class="text-slate-700 font-semibold">${t.payment_type_name || 'Cash'}</span>
                                    <span class="font-bold text-slate-800">${formatRupiah(t.paid_amount || t.subtotal || 0)}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    initLucide();
}

function toggleSnapshotDetails(idx) {
    const row = document.getElementById(`snapDetailRow_${idx}`);
    if (row) {
        row.classList.toggle('hidden');
    }
}

/**
 * Fetch Main Dashboard Data
 */
async function fetchDashboardData(date = currentDate) {
    try {
        const res = await fetch(`/api/dashboard?store=${currentStore}&date=${date}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        dashboardData = await res.json();

        updateMetrics(dashboardData);
        updateCharts(dashboardData);
        await fetchTransactions(1);
        calculateLiveSimulation();

        const updateEl = document.getElementById('lastUpdateText');
        if (updateEl) {
            updateEl.textContent = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' WIB';
        }
    } catch (err) {
        console.error('[Dashboard Data] Error:', err);
    }
}

/**
 * Update Key Metrics
 */
function updateMetrics(data) {
    if (!data) return;

    const rev = data.todayTax?.revenue_income || 0;
    const tax = data.todayTax?.revenue_tax || 0;
    const txCount = (data.todayTransactions?.data || []).length;
    const avg = txCount > 0 ? (rev / txCount) : 0;

    const elRev = document.getElementById('cardRevenue');
    if (elRev) elRev.textContent = formatRupiah(rev);

    const elTx = document.getElementById('cardTransactions');
    if (elTx) elTx.textContent = String(txCount);

    const elTax = document.getElementById('cardTax');
    if (elTax) elTax.textContent = formatRupiah(tax);

    const elAvg = document.getElementById('cardAverage');
    if (elAvg) elAvg.textContent = formatRupiah(avg);

    const badgeTx = document.getElementById('navTxBadge');
    if (badgeTx) badgeTx.textContent = String(txCount);
}

/**
 * Fetch Transactions
 */
async function fetchTransactions(page = 1) {
    try {
        const res = await fetch(`/api/transactions?store=${currentStore}&start_date=${currentDate}&end_date=${currentDate}&page=${page}&per_page=50`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        allTransactions = data.data || [];
        filteredTransactions = [...allTransactions];
        renderTransactionsTable(page);
        calculateLiveSimulation();
    } catch (err) {
        console.error('[Transactions] Error:', err);
    }
}

/**
 * Render Transactions Table
 */
function renderTransactionsTable(page = 1) {
    currentPage = page;
    const tbody = document.getElementById('transactionsTableBody');
    if (!tbody) return;

    if (!filteredTransactions || filteredTransactions.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="p-8 text-center text-slate-400">
                    <div class="flex flex-col items-center justify-center gap-1">
                        <i data-lucide="inbox" class="w-8 h-8 text-slate-300"></i>
                        <span class="font-medium text-slate-600">Tidak ada transaksi pada tanggal ini</span>
                    </div>
                </td>
            </tr>
        `;
        initLucide();
        return;
    }

    const start = (page - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const pageItems = filteredTransactions.slice(start, end);

    tbody.innerHTML = pageItems.map((tx, idx) => {
        const orderNo = tx.order_no || `#${start + idx + 1}`;
        const time = tx.fcreated_at ? tx.fcreated_at.split(' ')[1] : (tx.created_at || '-');
        const cashier = tx.creator_name || tx.cashier_name || 'Kasir';
        const method = tx.payment_type_name || 'Cash';
        const subtotal = Number(tx.subtotal) || 0;
        const tax = Number(tx.tax) || 0;
        const total = Number(tx.paid_amount) || Number(tx.total_amount) || (subtotal + tax);

        return `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="p-4 font-mono font-bold text-indigo-600">${orderNo}</td>
                <td class="p-4 text-slate-500 font-mono text-xs">${time}</td>
                <td class="p-4 font-medium text-slate-800">${cashier}</td>
                <td class="p-4">
                    <span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                        ${method}
                    </span>
                </td>
                <td class="p-4 text-right font-medium text-slate-700">${formatRupiah(subtotal)}</td>
                <td class="p-4 text-right font-medium text-amber-600">${formatRupiah(tax)}</td>
                <td class="p-4 text-right font-bold text-slate-900">${formatRupiah(total)}</td>
                <td class="p-4 text-center">
                    <button onclick="viewTransactionDetail(${start + idx})" class="p-1 text-slate-400 hover:text-indigo-600 rounded hover:bg-slate-100">
                        <i data-lucide="eye" class="w-4 h-4"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    // Pagination info
    const elInfo = document.getElementById('paginationInfo');
    if (elInfo) elInfo.textContent = `Menampilkan ${start + 1}-${Math.min(end, filteredTransactions.length)} dari ${filteredTransactions.length} transaksi`;

    const elPage = document.getElementById('pageIndicator');
    if (elPage) elPage.textContent = `Halaman ${page}`;

    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = end >= filteredTransactions.length;

    initLucide();
}

function viewTransactionDetail(index) {
    const tx = filteredTransactions[index];
    if (!tx) return;

    const modal = document.getElementById('detailModal');
    const orderNo = document.getElementById('modalOrderNo');
    const body = document.getElementById('modalBody');

    if (orderNo) orderNo.textContent = tx.order_no || `#${index + 1}`;
    if (body) {
        body.innerHTML = `
            <div class="space-y-2">
                <div class="flex justify-between py-1 border-b border-slate-100">
                    <span class="text-slate-500">Waktu Transaksi</span>
                    <span class="font-medium text-slate-800">${tx.fcreated_at || tx.created_at || '-'}</span>
                </div>
                <div class="flex justify-between py-1 border-b border-slate-100">
                    <span class="text-slate-500">Kasir</span>
                    <span class="font-medium text-slate-800">${tx.creator_name || tx.cashier_name || 'Kasir'}</span>
                </div>
                <div class="flex justify-between py-1 border-b border-slate-100">
                    <span class="text-slate-500">Metode Pembayaran</span>
                    <span class="font-semibold text-indigo-600">${tx.payment_type_name || 'Cash'}</span>
                </div>
                <div class="flex justify-between py-1 border-b border-slate-100">
                    <span class="text-slate-500">Subtotal</span>
                    <span class="font-medium text-slate-800">${formatRupiah(tx.subtotal || 0)}</span>
                </div>
                <div class="flex justify-between py-1 border-b border-slate-100">
                    <span class="text-slate-500">Pajak PB1</span>
                    <span class="font-medium text-amber-600">${formatRupiah(tx.tax || 0)}</span>
                </div>
                <div class="flex justify-between py-1 text-base font-bold text-slate-900 pt-1">
                    <span>Total Pembayaran</span>
                    <span class="text-indigo-600">${formatRupiah(tx.paid_amount || tx.total_amount || 0)}</span>
                </div>
            </div>
        `;
    }

    if (modal) modal.classList.remove('hidden');
}

/**
 * Live Simulation Calculation for this outlet
 */
function calculateLiveSimulation(overridePct = null) {
    const slider = document.getElementById('percentageSlider');
    const pct = overridePct !== null ? Number(overridePct) : (slider ? Number(slider.value) : 50);

    const totalReal = allTransactions.length;
    const targetCount = totalReal === 0 ? 0 : Math.max(1, Math.min(totalReal, Math.round(totalReal * (pct / 100))));

    let filtered = [];
    if (targetCount >= totalReal) {
        filtered = [...allTransactions];
    } else if (targetCount > 0) {
        const step = totalReal / targetCount;
        for (let i = 0; i < targetCount; i++) {
            const idx = Math.min(totalReal - 1, Math.floor(i * step));
            if (allTransactions[idx]) filtered.push(allTransactions[idx]);
        }
    }

    let rev = 0, tax = 0;
    filtered.forEach(tx => {
        rev += Number(tx.paid_amount) || Number(tx.subtotal) || 0;
        tax += Number(tx.tax) || 0;
    });

    const elSimReal = document.getElementById('simTotalReal');
    if (elSimReal) elSimReal.textContent = `${totalReal} Transaksi`;

    const elSimCount = document.getElementById('simFilteredCount');
    if (elSimCount) elSimCount.textContent = `${filtered.length} Transaksi`;

    const elSimRev = document.getElementById('simFilteredRevenue');
    if (elSimRev) elSimRev.textContent = formatRupiah(rev);

    const elSimTax = document.getElementById('simFilteredTax');
    if (elSimTax) elSimTax.textContent = formatRupiah(tax);
}

function setSliderPreset(val) {
    const slider = document.getElementById('percentageSlider');
    const text = document.getElementById('sliderValueText');
    if (slider) {
        slider.value = val;
        if (text) text.textContent = `${val}%`;
        calculateLiveSimulation(val);
    }
}

/**
 * Save Percentage Config for THIS outlet
 */
async function savePercentageConfig() {
    const slider = document.getElementById('percentageSlider');
    const percentage = slider ? Number(slider.value) : 50;
    const btn = document.getElementById('saveDefaultPercentageBtn');

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Menyimpan...</span>`;
        initLucide();
    }

    try {
        const res = await fetch('/api/database', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'save_config',
                store: currentStore,
                percentage
            })
        });
        const data = await res.json();
        alert(data.message || 'Konfigurasi persentase berhasil disimpan untuk outlet ini!');
        await fetchOutletDatabaseInfo();
    } catch (e) {
        alert('Gagal menyimpan konfigurasi: ' + e.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="save" class="w-3.5 h-3.5"></i><span>Simpan Sebagai Default Database Outlet</span>`;
            initLucide();
        }
    }
}

/**
 * Save Retention Config for THIS outlet
 */
async function saveRetentionConfig() {
    const graceSelect = document.getElementById('gracePeriodSelect');
    const grace_period_days = graceSelect ? Number(graceSelect.value) : 2;
    const btn = document.getElementById('saveRetentionBtn');

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Menyimpan...</span>`;
        initLucide();
    }

    try {
        const res = await fetch('/api/database', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'save_retention_config',
                store: currentStore,
                grace_period_days
            })
        });
        const data = await res.json();
        alert(data.message || 'Konfigurasi retensi bulanan berhasil disimpan!');
        await fetchOutletDatabaseInfo();
    } catch (e) {
        alert('Gagal menyimpan retensi: ' + e.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="save" class="w-3.5 h-3.5"></i><span>Simpan Retensi</span>`;
            initLucide();
        }
    }
}

/**
 * Manual Snapshot Sync for THIS outlet
 */
async function manualSyncSnapshot() {
    const btn = document.getElementById('manualDbSyncBtn');
    const slider = document.getElementById('percentageSlider');
    const percentage = slider ? Number(slider.value) : 50;

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Menyimpan Snapshot...</span>`;
        initLucide();
    }

    try {
        const res = await fetch('/api/database', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'sync_now',
                store: currentStore,
                percentage
            })
        });
        const data = await res.json();
        alert(data.message || 'Snapshot database berhasil disimpan ke Cloud Firestore!');
        await fetchOutletDatabaseInfo();
    } catch (e) {
        alert('Gagal menyimpan snapshot: ' + e.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="cloud-upload" class="w-4 h-4"></i><span>Simpan Snapshot Outlet Ini Sekarang</span>`;
            initLucide();
        }
    }
}

/**
 * Manual Sync Olsera Live Data
 */
async function syncData() {
    const syncIcon = document.getElementById('syncIcon');
    const syncText = document.getElementById('syncText');

    if (syncIcon) syncIcon.classList.add('spin-refresh');
    if (syncText) syncText.textContent = 'Sinkronisasi...';

    try {
        const res = await fetch(`/api/sync?store=${currentStore}`, { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await fetchDashboardData(currentDate);
    } catch (err) {
        console.error('[Sync Error]:', err);
    } finally {
        if (syncIcon) syncIcon.classList.remove('spin-refresh');
        if (syncText) syncText.textContent = 'Sinkronkan';
    }
}

/**
 * Auto Refresh every 60 seconds
 */
function setupAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(() => {
        fetchDashboardData(currentDate);
    }, 60000);
}

/**
 * Initialize Chart.js
 */
function initCharts() {
    const trendCtx = document.getElementById('salesTrendChart')?.getContext('2d');
    if (trendCtx) {
        revenueChart = new Chart(trendCtx, {
            type: 'line',
            data: {
                labels: ['H-6', 'H-5', 'H-4', 'H-3', 'H-2', 'Kemarin', 'Hari Ini'],
                datasets: [{
                    label: 'Omzet Penjualan (Rp)',
                    data: [0, 0, 0, 0, 0, 0, 0],
                    borderColor: '#4f46e5',
                    backgroundColor: 'rgba(79, 70, 229, 0.08)',
                    fill: true,
                    tension: 0.35,
                    borderWidth: 2.5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: (val) => val >= 1000000 ? (val / 1000000).toFixed(1) + 'M' : (val / 1000).toFixed(0) + 'k'
                        }
                    }
                }
            }
        });
    }

    const payCtx = document.getElementById('paymentMethodsChart')?.getContext('2d');
    if (payCtx) {
        paymentChart = new Chart(payCtx, {
            type: 'doughnut',
            data: {
                labels: ['Cash', 'QRIS', 'Debit/Kredit'],
                datasets: [{
                    data: [1, 0, 0],
                    backgroundColor: ['#4f46e5', '#10b981', '#f59e0b'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                cutout: '70%'
            }
        });
    }
}

/**
 * Update Charts with Real Data
 */
function updateCharts(data) {
    if (!data) return;

    if (revenueChart && data.trend7Days) {
        const labels = data.trend7Days.map(t => {
            const parts = t.date.split('-');
            return `${parts[2]}/${parts[1]}`;
        });
        const values = data.trend7Days.map(t => Number(t.revenue) || 0);

        revenueChart.data.labels = labels;
        revenueChart.data.datasets[0].data = values;
        revenueChart.update();
    }

    if (paymentChart && data.todayTax?.payment_methods) {
        const methods = data.todayTax.payment_methods;
        const labels = Object.keys(methods);
        const values = Object.values(methods).map(v => Number(v) || 0);

        if (labels.length > 0) {
            paymentChart.data.labels = labels;
            paymentChart.data.datasets[0].data = values;
            paymentChart.update();

            const listEl = document.getElementById('paymentMethodsList');
            if (listEl) {
                const total = values.reduce((a, b) => a + b, 0);
                listEl.innerHTML = labels.map((l, i) => {
                    const pct = total > 0 ? ((values[i] / total) * 100).toFixed(1) : 0;
                    return `
                        <div class="flex items-center justify-between text-xs">
                            <span class="text-slate-600 font-medium">${l}</span>
                            <span class="font-bold text-slate-800">${formatRupiah(values[i])} (${pct}%)</span>
                        </div>
                    `;
                }).join('');
            }
        }
    }
}
