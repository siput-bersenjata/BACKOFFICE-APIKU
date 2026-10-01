/**
 * Dashboard Olsera Client Application
 * Handles data fetching, live auto-refresh, Chart.js updates, filtering,
 * and dynamic Olsera account switching with multi-outlet support.
 */

// State
let currentDate = getTodayString();
let dashboardData = null;
let allTransactions = [];
let filteredTransactions = [];
let currentPage = 1;
const itemsPerPage = 15;
let autoRefreshTimer = null;
let revenueChart = null;
let paymentChart = null;

// Custom Account Storage Key
const STORAGE_KEY = 'olsera_active_account_v1';

// Active account state (default or custom)
let activeAccount = loadSavedAccount();

function loadSavedAccount() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (e) {
        console.warn('Failed to parse saved account:', e);
    }
    return {
        isCustom: false,
        username: 'bapendapedua@gmail.com',
        token: null,
        storeUrlId: 'naikicafe',
        stores: []
    };
}

function saveAccount(acc) {
    activeAccount = acc;
    if (acc.isCustom) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(acc));
    } else {
        localStorage.removeItem(STORAGE_KEY);
    }
    updateAccountUI();
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initLucide();
    initCharts();
    setupEventListeners();
    updateAccountUI();
    updatePublicApiUrl();
    calculateLiveSimulation();
    fetchDashboardData();
    setupAutoRefresh();
});

function initLucide() {
    if (window.lucide) {
        lucide.createIcons();
    }
}

function getTodayString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getYesterdayString() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Get headers including custom Olsera account credentials if set
 */
function getAuthHeaders() {
    const headers = {
        'Accept': 'application/json'
    };

    if (activeAccount.isCustom) {
        if (activeAccount.token) {
            headers['x-olsera-token'] = activeAccount.token;
        }
        if (activeAccount.username) {
            headers['x-olsera-username'] = activeAccount.username;
        }
        if (activeAccount.password) {
            headers['x-olsera-password'] = activeAccount.password;
        }
        if (activeAccount.storeUrlId) {
            headers['x-olsera-store'] = activeAccount.storeUrlId;
        }
    }

    return headers;
}

/**
 * Configure and initialize Chart.js
 */
function initCharts() {
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.color = '#64748b';

    // 1. Revenue 7-Day Line Chart
    const revCtx = document.getElementById('revenueChart').getContext('2d');
    let gradientFill = revCtx.createLinearGradient(0, 0, 0, 300);
    gradientFill.addColorStop(0, 'rgba(79, 70, 229, 0.25)');
    gradientFill.addColorStop(1, 'rgba(79, 70, 229, 0.0)');

    revenueChart = new Chart(revCtx, {
        type: 'line',
        data: {
            labels: ['...', '...', '...', '...', '...', '...', '...'],
            datasets: [{
                label: 'Pendapatan',
                data: [0, 0, 0, 0, 0, 0, 0],
                borderColor: '#4f46e5',
                backgroundColor: gradientFill,
                borderWidth: 3,
                pointBackgroundColor: '#ffffff',
                pointBorderColor: '#4f46e5',
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.38
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#0f172a',
                    padding: 12,
                    cornerRadius: 8,
                    titleFont: { size: 13, weight: '600', family: 'Inter' },
                    bodyFont: { size: 14, weight: 'bold', family: 'Inter' },
                    callbacks: {
                        label: function (context) {
                            const val = context.parsed.y || 0;
                            return ' Pendapatan: ' + new Intl.NumberFormat('id-ID', {
                                style: 'currency',
                                currency: 'IDR',
                                maximumFractionDigits: 0
                            }).format(val);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { borderDash: [4, 4], color: '#f1f5f9', drawBorder: false },
                    ticks: {
                        callback: function (val) {
                            if (val >= 1000000) {
                                return 'Rp ' + (val / 1000000).toFixed(1) + 'Jt';
                            } else if (val >= 1000) {
                                return 'Rp ' + (val / 1000).toFixed(0) + 'Rb';
                            }
                            return 'Rp ' + val;
                        },
                        padding: 8
                    }
                },
                x: {
                    grid: { display: false, drawBorder: false },
                    ticks: { padding: 8 }
                }
            }
        }
    });

    // 2. Payment Methods Donut Chart
    const payCtx = document.getElementById('paymentChart').getContext('2d');
    paymentChart = new Chart(payCtx, {
        type: 'doughnut',
        data: {
            labels: ['Memuat...'],
            datasets: [{
                data: [1],
                backgroundColor: ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6'],
                borderWidth: 2,
                borderColor: '#ffffff',
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        boxWidth: 12,
                        padding: 14,
                        font: { size: 12 }
                    }
                },
                tooltip: {
                    backgroundColor: '#0f172a',
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        label: function (context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            return ` ${label}: ${value} transaksi`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * Setup UI Event Listeners
 */
function setupEventListeners() {
    // Refresh Button
    document.getElementById('refreshBtn').addEventListener('click', () => {
        triggerManualSync();
    });

    // Date Filters
    const todayBtn = document.getElementById('filterTodayBtn');
    const yestBtn = document.getElementById('filterYesterdayBtn');
    const datePicker = document.getElementById('datePicker');

    todayBtn.addEventListener('click', () => {
        setDateFilter(getTodayString());
        setActiveFilterButton(todayBtn, [yestBtn]);
    });

    yestBtn.addEventListener('click', () => {
        setDateFilter(getYesterdayString());
        setActiveFilterButton(yestBtn, [todayBtn]);
    });

    datePicker.value = currentDate;
    datePicker.addEventListener('change', (e) => {
        if (e.target.value) {
            setDateFilter(e.target.value);
            setActiveFilterButton(null, [todayBtn, yestBtn]);
        }
    });

    // Search Input filter
    document.getElementById('searchInput').addEventListener('input', (e) => {
        filterTransactions(e.target.value);
    });

    // Pagination
    document.getElementById('prevPageBtn').addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderTablePage();
        }
    });

    document.getElementById('nextPageBtn').addEventListener('click', () => {
        const totalPages = Math.ceil(filteredTransactions.length / itemsPerPage);
        if (currentPage < totalPages) {
            currentPage++;
            renderTablePage();
        }
    });

    // Auto-refresh interval change
    document.getElementById('autoRefreshInterval').addEventListener('change', (e) => {
        setupAutoRefresh(Number(e.target.value));
    });

    // Modal Close handlers
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
    document.getElementById('closeModalBtn2').addEventListener('click', closeModal);
    document.getElementById('detailModal').addEventListener('click', (e) => {
        if (e.target.id === 'detailModal') closeModal();
    });

    // CSV Download
    document.getElementById('downloadCsvBtn').addEventListener('click', exportToCsv);

    // Mobile menu toggle
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.getElementById('sidebar');
    const mobileBackdrop = document.getElementById('mobileBackdrop');

    mobileMenuBtn.addEventListener('click', () => {
        sidebar.classList.toggle('hidden');
        sidebar.classList.toggle('flex');
        mobileBackdrop.classList.toggle('hidden');
    });

    mobileBackdrop.addEventListener('click', () => {
        sidebar.classList.add('hidden');
        sidebar.classList.remove('flex');
        mobileBackdrop.classList.add('hidden');
    });

    // Account Modal triggers
    document.getElementById('switchAccountBtn').addEventListener('click', openAccountModal);
    document.getElementById('headerAccountBtn').addEventListener('click', openAccountModal);
    document.getElementById('closeAccountModalBtn').addEventListener('click', closeAccountModal);
    document.getElementById('accountModal').addEventListener('click', (e) => {
        if (e.target.id === 'accountModal') closeAccountModal();
    });

    // Toggle Password Visibility
    document.getElementById('togglePasswordBtn').addEventListener('click', () => {
        const pwInput = document.getElementById('inputPassword');
        const isPw = pwInput.type === 'password';
        pwInput.type = isPw ? 'text' : 'password';
    });

    // Account Form Submit
    document.getElementById('accountForm').addEventListener('submit', handleAccountSubmit);

    // Reset Account Button
    document.getElementById('resetAccountBtn').addEventListener('click', handleResetAccount);

    // Outlet selector change
    const outletSelect = document.getElementById('outletSelect');
    outletSelect.addEventListener('change', (e) => {
        if (e.target.value) {
            activeAccount.storeUrlId = e.target.value;
            saveAccount(activeAccount);
            closeAccountModal();
            fetchDashboardData();
        }
    });

    // View Navigation Buttons
    const navDashboardBtn = document.getElementById('navDashboardBtn');
    if (navDashboardBtn) navDashboardBtn.addEventListener('click', () => switchView('dashboard'));

    const navTransactionsBtn = document.getElementById('navTransactionsBtn');
    if (navTransactionsBtn) navTransactionsBtn.addEventListener('click', () => switchView('transactions'));

    const navChartsBtn = document.getElementById('navChartsBtn');
    if (navChartsBtn) navChartsBtn.addEventListener('click', () => switchView('charts'));

    const navPublicApiBtn = document.getElementById('navPublicApiBtn');
    if (navPublicApiBtn) navPublicApiBtn.addEventListener('click', () => switchView('publicApi'));

    // Public API Slider
    const percentageSlider = document.getElementById('percentageSlider');
    if (percentageSlider) {
        percentageSlider.addEventListener('input', (e) => {
            updateSliderUI(e.target.value);
        });
    }

    // Save Default Percentage to Database
    const saveDefaultBtn = document.getElementById('saveDefaultPercentageBtn');
    if (saveDefaultBtn) {
        saveDefaultBtn.addEventListener('click', saveDefaultPercentage);
    }

    // Manual Database Sync
    const manualDbSyncBtn = document.getElementById('manualDbSyncBtn');
    if (manualDbSyncBtn) {
        manualDbSyncBtn.addEventListener('click', triggerDatabaseSyncNow);
    }

    // Copy API URL & Filter Preview
    setupCopyUrlButton();
    setupFilterPreviewControls();

    // Export Filtered Snapshot buttons
    const dlJsonBtn = document.getElementById('downloadFilteredJsonBtn');
    if (dlJsonBtn) dlJsonBtn.addEventListener('click', exportFilteredJson);

    const dlCsvBtn = document.getElementById('downloadFilteredCsvBtn');
    if (dlCsvBtn) dlCsvBtn.addEventListener('click', exportFilteredCsv);
}

function setActiveFilterButton(activeBtn, inactiveBtns) {
    inactiveBtns.forEach(btn => {
        btn.className = 'px-3 py-1.5 text-slate-600 hover:text-slate-900 rounded-md transition-all';
    });
    if (activeBtn) {
        activeBtn.className = 'px-3 py-1.5 bg-indigo-600 text-white rounded-md shadow-sm transition-all';
    }
}

function setDateFilter(dateStr) {
    currentDate = dateStr;
    document.getElementById('datePicker').value = dateStr;
    fetchDashboardData();
}

/**
 * Setup Realtime Polling
 */
function setupAutoRefresh(customMs = null) {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }

    const selectEl = document.getElementById('autoRefreshInterval');
    const ms = customMs !== null ? customMs : Number(selectEl.value);

    if (ms > 0) {
        autoRefreshTimer = setInterval(() => {
            fetchDashboardData(true);
        }, ms);
    }
}

/**
 * Trigger manual sync with loading indicator animation
 */
async function triggerManualSync() {
    const refreshIcon = document.getElementById('refreshIcon');
    refreshIcon.classList.add('spin-refresh');

    try {
        const headers = {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
        };

        const res = await fetch(`/api/sync?date=${currentDate}`, {
            method: 'POST',
            headers
        });

        if (res.ok) {
            const result = await res.json();
            if (result.data) {
                applyDashboardData(result.data);
            }
        }
    } catch (e) {
        console.error('Manual sync failed:', e);
        await fetchDashboardData();
    } finally {
        setTimeout(() => {
            refreshIcon.classList.remove('spin-refresh');
        }, 500);
    }
}

/**
 * Fetch dashboard data from /api/dashboard
 */
async function fetchDashboardData(isBackground = false) {
    const refreshIcon = document.getElementById('refreshIcon');
    if (!isBackground) {
        refreshIcon.classList.add('spin-refresh');
    }

    try {
        const res = await fetch(`/api/dashboard?date=${currentDate}`, {
            headers: getAuthHeaders()
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        dashboardData = data;
        applyDashboardData(data);
    } catch (error) {
        console.error('Fetch error:', error);
        document.getElementById('lastUpdatedText').innerText = 'Gagal sinkron (Periksa koneksi atau akun)';
    } finally {
        if (!isBackground) {
            refreshIcon.classList.remove('spin-refresh');
        }
    }
}

/**
 * Apply fetched data to UI and charts
 */
function applyDashboardData(data) {
    if (!data) return;

    // Store Info
    if (data.store) {
        const name = data.store.name || 'Naiki cafe';
        document.getElementById('storeNameText').innerText = name;
        document.getElementById('storeNameText').title = name;
        document.getElementById('outletBadge').innerText = name;
        document.getElementById('headerStoreName').innerText = name;
        document.getElementById('userRoleBadge').innerText = data.store.role || 'Perpajakan (PJ)';
    }

    // Account Info
    if (data.account) {
        const email = activeAccount.isCustom ? activeAccount.username : 'bapendapedua@gmail.com';
        document.getElementById('activeUserEmail').innerText = `Akun: ${email}`;
        document.getElementById('headerUserName').innerText = activeAccount.isCustom ? (activeAccount.name || email.split('@')[0]) : 'Bapenda Admin';
        document.getElementById('userAvatarText').innerText = (email[0] || 'O').toUpperCase();
    }

    // KPI Cards
    if (data.kpi) {
        document.getElementById('kpiRevenue').innerText = data.kpi.revenue.formatted;
        document.getElementById('kpiTransactions').innerText = (data.kpi.transactions.total || 0) + ' Transaksi';
        document.getElementById('kpiAvgSale').innerText = data.kpi.average_sale.formatted;
        document.getElementById('kpiTax').innerText = data.kpi.tax.formatted;

        const growthBadge = document.getElementById('revenueGrowthBadge');
        const pct = data.kpi.revenue.growthPct || 0;
        if (pct >= 0) {
            growthBadge.className = 'flex items-center text-emerald-600 font-semibold bg-emerald-50 px-2 py-0.5 rounded-md';
            growthBadge.innerHTML = `<i data-lucide="trending-up" class="w-3.5 h-3.5 mr-1"></i> +${pct}%`;
        } else {
            growthBadge.className = 'flex items-center text-rose-600 font-semibold bg-rose-50 px-2 py-0.5 rounded-md';
            growthBadge.innerHTML = `<i data-lucide="trending-down" class="w-3.5 h-3.5 mr-1"></i> ${pct}%`;
        }
    }

    // 7 Days Trend Chart
    if (data.charts && data.charts.trend_7days && revenueChart) {
        const trend = data.charts.trend_7days;
        revenueChart.data.labels = trend.labels;
        revenueChart.data.datasets[0].data = trend.revenues;
        revenueChart.update('active');
    }

    // Payment Methods Donut Chart
    if (data.charts && data.charts.payment_methods && paymentChart) {
        const pm = data.charts.payment_methods;
        if (pm.labels && pm.labels.length > 0) {
            paymentChart.data.labels = pm.labels;
            paymentChart.data.datasets[0].data = pm.counts;
        } else {
            paymentChart.data.labels = ['Belum ada transaksi'];
            paymentChart.data.datasets[0].data = [1];
        }
        paymentChart.update('active');
    }

    // Transactions Table
    allTransactions = data.transactions || [];
    filteredTransactions = [...allTransactions];
    currentPage = 1;
    renderTablePage();
    calculateLiveSimulation();

    const totalCount = data.meta?.total || allTransactions.length;
    document.getElementById('tableCountBadge').innerText = `${totalCount} Data`;
    document.getElementById('navTxBadge').innerText = totalCount;

    const now = new Date();
    const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    document.getElementById('lastUpdatedText').innerText = `Terakhir sinkron: ${timeStr} WIB`;

    initLucide();
}

/**
 * Filter transactions table by search query
 */
function filterTransactions(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) {
        filteredTransactions = [...allTransactions];
    } else {
        filteredTransactions = allTransactions.filter(tx => {
            const no = (tx.order_no || '').toLowerCase();
            const mode = (tx.payment_mode_name || '').toLowerCase();
            const amount = String(tx.paid_amount || '');
            return no.includes(q) || mode.includes(q) || amount.includes(q);
        });
    }
    currentPage = 1;
    renderTablePage();
}

/**
 * Render paginated table rows
 */
function renderTablePage() {
    const tbody = document.getElementById('transactionsTableBody');
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const pageItems = filteredTransactions.slice(start, end);

    if (pageItems.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="p-8 text-center text-slate-400">
                    <div class="flex flex-col items-center justify-center gap-1">
                        <i data-lucide="inbox" class="w-8 h-8 text-slate-300"></i>
                        <p class="font-medium text-slate-500">Tidak ada transaksi ditemukan</p>
                        <p class="text-xs text-slate-400">Untuk periode tanggal yang dipilih.</p>
                    </div>
                </td>
            </tr>
        `;
        initLucide();
        updatePaginationControls(0);
        return;
    }

    let html = '';
    pageItems.forEach((tx) => {
        const isVoid = tx.voided === 1;
        const timePart = tx.order_time ? tx.order_time.split(' ')[1] : '-';
        const paymentBadge = getPaymentBadge(tx.payment_mode_name);
        const statusBadge = isVoid 
            ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">Batal / Void</span>`
            : `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">Sukses</span>`;

        html += `
            <tr class="hover:bg-slate-50/70 transition-colors">
                <td class="p-4 font-mono font-medium text-indigo-600 text-xs sm:text-sm">
                    ${tx.order_no}
                </td>
                <td class="p-4 text-slate-500 text-xs sm:text-sm">
                    ${timePart} WIB
                </td>
                <td class="p-4">
                    ${paymentBadge}
                </td>
                <td class="p-4 text-slate-600 font-medium">
                    ${tx.fsubtotal || 'Rp ' + Number(tx.subtotal).toLocaleString('id-ID')}
                </td>
                <td class="p-4 text-slate-500">
                    ${tx.ftax || 'Rp ' + Number(tx.tax).toLocaleString('id-ID')}
                </td>
                <td class="p-4 font-bold text-slate-900 text-sm">
                    ${tx.fpaid_amount || 'Rp ' + Number(tx.paid_amount).toLocaleString('id-ID')}
                </td>
                <td class="p-4">
                    ${statusBadge}
                </td>
                <td class="p-4 text-center">
                    <button onclick="openDetailModal('${tx.order_no}')" class="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Lihat detail transaksi">
                        <i data-lucide="eye" class="w-4 h-4 inline"></i>
                    </button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    initLucide();
    updatePaginationControls(filteredTransactions.length);
}

function getPaymentBadge(mode) {
    const m = (mode || '').toLowerCase();
    if (m.includes('qris') || m.includes('bca')) {
        return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-50 text-sky-700 border border-sky-200">
            <span class="w-1.5 h-1.5 rounded-full bg-sky-500"></span> ${mode}
        </span>`;
    } else if (m.includes('cash') || m.includes('tunai')) {
        return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> CASH
        </span>`;
    } else {
        return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span> ${mode || 'Lainnya'}
        </span>`;
    }
}

function updatePaginationControls(totalItems) {
    const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
    const startIdx = totalItems > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0;
    const endIdx = Math.min(currentPage * itemsPerPage, totalItems);

    document.getElementById('paginationInfo').innerText = 
        `Menampilkan ${startIdx}-${endIdx} dari ${totalItems} transaksi`;
    document.getElementById('pageIndicator').innerText = `Halaman ${currentPage} / ${totalPages}`;

    document.getElementById('prevPageBtn').disabled = currentPage <= 1;
    document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;
}

/**
 * Open detail modal for a specific transaction
 */
window.openDetailModal = function (orderNo) {
    const tx = allTransactions.find(t => t.order_no === orderNo);
    if (!tx) return;

    document.getElementById('modalOrderNo').innerText = `#${tx.order_no}`;

    const modalBody = document.getElementById('modalBody');
    modalBody.innerHTML = `
        <div class="space-y-3">
            <div class="flex justify-between py-1.5 border-b border-slate-100">
                <span class="text-slate-500">Nomor Transaksi</span>
                <span class="font-mono font-bold text-slate-800">${tx.order_no}</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-slate-100">
                <span class="text-slate-500">Waktu Pembelian</span>
                <span class="font-medium text-slate-800">${tx.forder_time || tx.order_time}</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-slate-100">
                <span class="text-slate-500">Metode Pembayaran</span>
                <span class="font-semibold text-slate-800">${tx.payment_mode_name}</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-slate-100">
                <span class="text-slate-500">Station / POS</span>
                <span class="font-mono text-slate-800">${tx.station || 'Main POS'}</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-slate-100">
                <span class="text-slate-500">Subtotal</span>
                <span class="font-medium text-slate-800">${tx.fsubtotal || 'Rp ' + Number(tx.subtotal).toLocaleString('id-ID')}</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-slate-100">
                <span class="text-slate-500">Pajak PB1 (10%)</span>
                <span class="font-medium text-rose-600">${tx.ftax || 'Rp ' + Number(tx.tax).toLocaleString('id-ID')}</span>
            </div>
            ${tx.rounding && Number(tx.rounding) !== 0 ? `
            <div class="flex justify-between py-1.5 border-b border-slate-100">
                <span class="text-slate-500">Pembulatan</span>
                <span class="text-slate-600">${tx.frounding || tx.rounding}</span>
            </div>` : ''}
            <div class="flex justify-between py-2 bg-indigo-50/70 p-3 rounded-xl border border-indigo-100">
                <span class="font-bold text-indigo-950">Total Akhir Bayar</span>
                <span class="font-extrabold text-indigo-600 text-base">${tx.fpaid_amount || 'Rp ' + Number(tx.paid_amount).toLocaleString('id-ID')}</span>
            </div>
            <div class="flex justify-between items-center pt-1 text-xs">
                <span class="text-slate-400">Status Validasi Olsera</span>
                <span class="px-2 py-0.5 rounded-full font-bold ${tx.voided === 1 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}">
                    ${tx.voided === 1 ? 'DIBATALKAN / VOID' : 'TERVERIFIKASI SUKSES'}
                </span>
            </div>
        </div>
    `;

    document.getElementById('detailModal').classList.remove('hidden');
    initLucide();
};

function closeModal() {
    document.getElementById('detailModal').classList.add('hidden');
}

/**
 * Account Modal Controls
 */
function updateAccountUI() {
    const isCustom = activeAccount.isCustom;
    const email = isCustom ? activeAccount.username : 'bapendapedua@gmail.com';
    const storeName = (dashboardData?.store?.name) || (activeAccount.storeName) || 'Naiki cafe';

    document.getElementById('modalCurrentEmail').innerText = email;
    document.getElementById('modalCurrentStore').innerText = storeName;

    const typeBadge = document.getElementById('modalAccountTypeBadge');
    if (isCustom) {
        typeBadge.className = 'px-2 py-0.5 text-[11px] font-bold rounded-full bg-emerald-600 text-white';
        typeBadge.innerText = 'Akun Kustom';
    } else {
        typeBadge.className = 'px-2 py-0.5 text-[11px] font-bold rounded-full bg-indigo-600 text-white';
        typeBadge.innerText = 'Bawaan Bapenda';
    }

    // Populate outlet select if account has multiple stores
    const outletGroup = document.getElementById('outletSelectGroup');
    const outletSelect = document.getElementById('outletSelect');

    if (activeAccount.stores && activeAccount.stores.length > 1) {
        outletGroup.classList.remove('hidden');
        outletSelect.innerHTML = activeAccount.stores.map(s => `
            <option value="${s.url_id}" ${s.url_id === activeAccount.storeUrlId ? 'selected' : ''}>
                ${s.name} (${s.role || 'POS'})
            </option>
        `).join('');
    } else {
        outletGroup.classList.add('hidden');
    }
}

function openAccountModal() {
    updateAccountUI();
    hideAlert();
    document.getElementById('accountModal').classList.remove('hidden');
    initLucide();
}

function closeAccountModal() {
    document.getElementById('accountModal').classList.add('hidden');
    hideAlert();
}

function showAlert(message, type = 'error') {
    const el = document.getElementById('authAlert');
    el.classList.remove('hidden', 'bg-red-50', 'text-red-700', 'border-red-200', 'bg-emerald-50', 'text-emerald-700', 'border-emerald-200');

    if (type === 'error') {
        el.classList.add('bg-red-50', 'text-red-700', 'border', 'border-red-200');
    } else {
        el.classList.add('bg-emerald-50', 'text-emerald-700', 'border', 'border-emerald-200');
    }
    el.innerHTML = `<div class="flex items-center gap-2"><i data-lucide="${type === 'error' ? 'alert-circle' : 'check-circle'}" class="w-4 h-4 shrink-0"></i><span>${message}</span></div>`;
    el.classList.remove('hidden');
    initLucide();
}

function hideAlert() {
    const el = document.getElementById('authAlert');
    el.classList.add('hidden');
}

/**
 * Handle Account Form Submission (Login with new Olsera credentials)
 */
async function handleAccountSubmit(e) {
    e.preventDefault();
    hideAlert();

    const email = document.getElementById('inputEmail').value.trim();
    const password = document.getElementById('inputPassword').value;
    const saveBtn = document.getElementById('saveAccountBtn');

    if (!email || !password) {
        showAlert('Harap isi email dan password Olsera.');
        return;
    }

    const origBtnHtml = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Menghubungkan ke Olsera...</span>`;
    initLucide();

    try {
        const res = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: email, password })
        });

        const json = await res.json();

        if (!res.ok || json.status !== 'success') {
            throw new Error(json.message || 'Gagal login ke Olsera. Periksa username dan password.');
        }

        const data = json.data;
        const stores = data.stores || [];
        const primaryStore = stores[0] || { name: 'Outlet Olsera', url_id: 'naikicafe' };

        // Save new account state
        saveAccount({
            isCustom: true,
            username: email,
            password: password,
            token: data.token,
            storeUrlId: primaryStore.url_id,
            storeName: primaryStore.name,
            stores: stores,
            name: data.user?.name || email.split('@')[0]
        });

        showAlert(`Berhasil terhubung ke akun ${email}! Memuat outlet ${primaryStore.name}...`, 'success');

        // Reset form
        document.getElementById('inputEmail').value = '';
        document.getElementById('inputPassword').value = '';

        setTimeout(() => {
            closeAccountModal();
            fetchDashboardData();
        }, 1200);

    } catch (err) {
        showAlert(err.message || 'Terjadi kesalahan saat menghubungkan akun.');
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = origBtnHtml;
        initLucide();
    }
}

/**
 * Reset back to default Bapenda account
 */
function handleResetAccount() {
    if (confirm('Apakah Anda yakin ingin mengembalikan akun ke bawaan Bapenda (bapendapedua@gmail.com)?')) {
        saveAccount({
            isCustom: false,
            username: 'bapendapedua@gmail.com',
            token: null,
            storeUrlId: 'naikicafe',
            stores: []
        });

        document.getElementById('inputEmail').value = '';
        document.getElementById('inputPassword').value = '';
        showAlert('Akun dikembalikan ke bawaan Bapenda.', 'success');

        setTimeout(() => {
            closeAccountModal();
            fetchDashboardData();
        }, 800);
    }
}

/**
 * Export current transactions list to CSV file
 */
function exportToCsv() {
    if (!filteredTransactions || filteredTransactions.length === 0) {
        alert('Tidak ada data untuk diekspor!');
        return;
    }

    const headers = ['Order No', 'Order Time', 'Payment Mode', 'Subtotal', 'Tax', 'Paid Amount', 'Status', 'Station'];
    const rows = filteredTransactions.map(tx => [
        `"${tx.order_no}"`,
        `"${tx.order_time}"`,
        `"${tx.payment_mode_name}"`,
        tx.subtotal,
        tx.tax,
        tx.paid_amount,
        tx.voided === 1 ? 'Void' : 'Success',
        `"${tx.station || ''}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `transaksi_olsera_${currentDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/* ==========================================================================
   FITUR BARU: API PUBLIK & MANAJEMEN DATABASE
   - Filter persentase data publik khusus hari ini
   - Sinkronisasi snapshot terfilter ke Cloud Firestore per 5 jam / manual
   - Halaman tersendiri untuk preview, ekspor, dan restore snapshot
   ========================================================================== */

let currentSliderPercentage = 50;
let publicDbSnapshots = [];
let selectedSnapshotIndex = 0;

/**
 * Switch between Main Realtime Dashboard and Public API / Database View
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
        updatePublicApiUrl();
        calculateLiveSimulation();
        fetchDatabaseSnapshots();
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

    // Close mobile sidebar if open
    const sidebar = document.getElementById('sidebar');
    const mobileBackdrop = document.getElementById('mobileBackdrop');
    if (window.innerWidth < 768 && sidebar && !sidebar.classList.contains('hidden')) {
        sidebar.classList.add('hidden');
        sidebar.classList.remove('flex');
        if (mobileBackdrop) mobileBackdrop.classList.add('hidden');
    }

    initLucide();
}

/**
 * Update slider value and trigger live simulation recalculation
 */
function updateSliderUI(val) {
    currentSliderPercentage = Math.max(1, Math.min(100, Number(val) || 50));
    const slider = document.getElementById('percentageSlider');
    if (slider) slider.value = currentSliderPercentage;
    const txt = document.getElementById('sliderValueText');
    if (txt) txt.innerText = `${currentSliderPercentage}%`;
    calculateLiveSimulation();
    updatePublicApiUrl();
}

// Preset button handler exposed to window for inline onclicks
window.setSliderPreset = function(val) {
    updateSliderUI(val);
};

/**
 * Re-sequence order numbers sequentially starting from the first transaction's number
 * to eliminate gaps/jumps caused by percentage filtering.
 */
function resequenceOrderNumbers(transactions) {
    if (!Array.isArray(transactions) || transactions.length === 0) return transactions;
    const first = transactions.find(t => t && t.order_no);
    if (!first || !first.order_no) return transactions;

    const str = String(first.order_no);
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



/**
 * Calculate live simulation numbers for current slider percentage
 */
function calculateLiveSimulation() {
    const txs = allTransactions || [];
    const totalReal = txs.length;
    const percentage = currentSliderPercentage;
    const targetCount = totalReal === 0 ? 0 : Math.max(1, Math.min(totalReal, Math.round(totalReal * (percentage / 100))));

    const simTotalEl = document.getElementById('simTotalReal');
    const simCountEl = document.getElementById('simFilteredCount');
    const simRevEl = document.getElementById('simFilteredRevenue');
    const simTaxEl = document.getElementById('simFilteredTax');

    if (simTotalEl) simTotalEl.innerText = `${totalReal} Transaksi`;
    if (simCountEl) simCountEl.innerText = `${targetCount} Transaksi`;

    if (totalReal === 0) {
        if (simRevEl) simRevEl.innerText = 'Rp 0';
        if (simTaxEl) simTaxEl.innerText = 'Rp 0';
        return;
    }

    // Sample transactions evenly to reflect the full day
    let filtered = [];
    if (targetCount >= totalReal) {
        filtered = [...txs];
    } else {
        const step = totalReal / targetCount;
        const selected = new Set();
        for (let i = 0; i < targetCount; i++) {
            const idx = Math.min(totalReal - 1, Math.floor(i * step));
            if (!selected.has(idx)) {
                selected.add(idx);
                filtered.push(txs[idx]);
            }
        }
        let fallback = 0;
        while (filtered.length < targetCount && fallback < totalReal) {
            if (!selected.has(fallback)) {
                selected.add(fallback);
                filtered.push(txs[fallback]);
            }
            fallback++;
        }
    }

    // Resequence order numbers so there are no jumps
    filtered = resequenceOrderNumbers(filtered);

    let filteredRevenue = 0;
    let filteredTax = 0;
    filtered.forEach(tx => {
        filteredRevenue += Number(tx.paid_amount) || Number(tx.subtotal) || 0;
        filteredTax += Number(tx.tax) || 0;
    });

    if (simRevEl) simRevEl.innerText = 'Rp ' + Math.round(filteredRevenue).toLocaleString('id-ID');
    if (simTaxEl) simTaxEl.innerText = 'Rp ' + Math.round(filteredTax).toLocaleString('id-ID');
}

/**
 * Update Public API URL displayed on page
 */
function updatePublicApiUrl() {
    const origin = window.location.origin;
    const url = `${origin}/api/public?percentage=${currentSliderPercentage}`;
    const textEl = document.getElementById('publicApiUrlText');
    const openBtn = document.getElementById('openApiUrlBtn');
    const previewBtn = document.getElementById('openPreviewPageBtn');
    if (textEl) textEl.innerText = url;
    if (openBtn) openBtn.href = url;
    if (previewBtn) previewBtn.href = `/preview.html?percentage=${currentSliderPercentage}`;
}

/**
 * Setup Copy URL to clipboard button
 */
function setupCopyUrlButton() {
    const copyBtn = document.getElementById('copyApiUrlBtn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const origin = window.location.origin;
            const url = `${origin}/api/public?percentage=${currentSliderPercentage}`;
            navigator.clipboard.writeText(url).then(() => {
                const txt = document.getElementById('copyBtnText');
                if (txt) {
                    txt.innerText = 'Tersalin!';
                    setTimeout(() => {
                        txt.innerText = 'Salin Tautan API';
                    }, 2000);
                }
            }).catch(() => {
                alert('Tautan API: ' + url);
            });
        });
    }
}

/**
 * Save chosen percentage as default in database
 */
async function saveDefaultPercentage() {
    const btn = document.getElementById('saveDefaultPercentageBtn');
    if (!btn) return;
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Menyimpan...</span>`;
    initLucide();

    try {
        const res = await fetch('/api/database', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'save_config',
                percentage: currentSliderPercentage
            })
        });

        const data = await res.json();
        if (res.ok && data.status === 'success') {
            btn.classList.add('bg-emerald-100', 'text-emerald-800', 'border-emerald-300');
            btn.innerHTML = `<i data-lucide="check" class="w-3.5 h-3.5"></i><span>Default Tersimpan (${currentSliderPercentage}%)</span>`;
            initLucide();
            setTimeout(() => {
                btn.classList.remove('bg-emerald-100', 'text-emerald-800', 'border-emerald-300');
                btn.innerHTML = origHtml;
                btn.disabled = false;
                initLucide();
            }, 2000);
        } else {
            throw new Error(data.message || 'Gagal menyimpan konfigurasi');
        }
    } catch (err) {
        alert('Gagal menyimpan: ' + err.message);
        btn.disabled = false;
        btn.innerHTML = origHtml;
        initLucide();
    }
}

/**
 * Trigger immediate snapshot synchronization to Cloud Firestore
 */
async function triggerDatabaseSyncNow() {
    const btn = document.getElementById('manualDbSyncBtn');
    if (!btn) return;
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Menyimpan ke Cloud Firestore...</span>`;
    initLucide();

    try {
        const res = await fetch('/api/database', {
            method: 'POST',
            headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'sync_now',
                percentage: currentSliderPercentage
            })
        });

        const json = await res.json();
        if (res.ok && json.status === 'success') {
            btn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
            btn.classList.add('bg-emerald-600', 'hover:bg-emerald-700');
            btn.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4"></i><span>Snapshot Berhasil Disimpan!</span>`;
            initLucide();

            await fetchDatabaseSnapshots();

            setTimeout(() => {
                btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-700');
                btn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
                btn.innerHTML = origHtml;
                btn.disabled = false;
                initLucide();
            }, 2500);
        } else {
            throw new Error(json.message || 'Gagal menyimpan snapshot');
        }
    } catch (err) {
        alert('Gagal menyimpan snapshot ke database: ' + err.message);
        btn.disabled = false;
        btn.innerHTML = origHtml;
        initLucide();
    }
}

/**
 * Fetch list of database snapshots from /api/database
 */
async function fetchDatabaseSnapshots() {
    const tbody = document.getElementById('filteredTableBody');
    const pillsContainer = document.getElementById('snapshotPillsContainer');
    const badge = document.getElementById('snapshotCountBadge');
    const lastSyncEl = document.getElementById('dbLastSyncText');
    const nextSyncEl = document.getElementById('dbNextSyncText');

    try {
        const res = await fetch('/api/database');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        if (json.config && json.config.percentage && !window._hasLoadedConfig) {
            window._hasLoadedConfig = true;
            updateSliderUI(json.config.percentage);
        }

        publicDbSnapshots = json.snapshots || [];
        if (badge) badge.innerText = `${publicDbSnapshots.length} Snapshot`;

        if (publicDbSnapshots.length === 0) {
            if (lastSyncEl) lastSyncEl.innerText = 'Belum ada snapshot';
            if (pillsContainer) pillsContainer.innerHTML = `<span class="text-slate-400 italic">Belum ada snapshot tersimpan. Klik tombol simpan snapshot di atas.</span>`;
            if (tbody) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" class="p-8 text-center text-slate-400">
                            <div class="flex flex-col items-center justify-center gap-1">
                                <i data-lucide="database" class="w-8 h-8 text-slate-300"></i>
                                <p class="font-medium text-slate-500">Belum ada snapshot tersimpan di database</p>
                                <p class="text-xs text-slate-400">Gunakan tombol di atas untuk menyimpan data terfilter ke Cloud Firestore.</p>
                            </div>
                        </td>
                    </tr>
                `;
                initLucide();
            }
            return;
        }

        // Format last sync time
        const latest = publicDbSnapshots[0];
        const latestDate = new Date(latest.created_at || latest.synced_at || Date.now());
        const timeStr = latestDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        const dateStr = latestDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
        if (lastSyncEl) lastSyncEl.innerText = `${dateStr}, ${timeStr} WIB (${latest.saved_count || latest.filtered_count || 0} data / ${latest.percentage}%)`;

        // Calculate next 5-hour sync schedule
        if (nextSyncEl) {
            const nextSyncTime = new Date(latestDate.getTime() + 5 * 60 * 60 * 1000);
            const nextTimeStr = nextSyncTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
            nextSyncEl.innerText = `± ${nextTimeStr} WIB (Siklus 5 Jam)`;
        }

        // Render snapshot selector pills
        if (pillsContainer) {
            let pillsHtml = '';
            publicDbSnapshots.forEach((snap, idx) => {
                const sDate = new Date(snap.created_at || snap.synced_at || Date.now());
                const sTime = sDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
                const isSelected = idx === selectedSnapshotIndex;
                const btnClass = isSelected
                    ? 'px-3 py-1 bg-indigo-600 text-white rounded-lg font-bold shadow-sm'
                    : 'px-3 py-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 rounded-lg font-medium';
                
                const snapLabel = snap.id ? snap.id.substring(0, 10) : `Snapshot #${idx + 1}`;
                pillsHtml += `
                    <button onclick="selectDatabaseSnapshot(${idx})" class="${btnClass} shrink-0 transition-all flex items-center gap-1.5 text-xs">
                        <span>${snapLabel} (${sTime})</span>
                        <span class="text-[10px] px-1.5 py-0.2 rounded bg-black/10 font-bold">${snap.percentage}%</span>
                    </button>
                `;
            });
            pillsContainer.innerHTML = pillsHtml;
        }

        renderSelectedSnapshotTable();

    } catch (err) {
        console.error('Failed to fetch database snapshots:', err);
        if (lastSyncEl) lastSyncEl.innerText = 'Gagal memuat dari Cloud';
    }
}

/**
 * Handle selecting a specific snapshot pill
 */
window.selectDatabaseSnapshot = function(idx) {
    selectedSnapshotIndex = idx;
    const pillsContainer = document.getElementById('snapshotPillsContainer');
    if (pillsContainer) {
        const buttons = pillsContainer.querySelectorAll('button');
        buttons.forEach((btn, i) => {
            if (i === idx) {
                btn.className = 'px-3 py-1 bg-indigo-600 text-white rounded-lg font-bold shadow-sm shrink-0 transition-all flex items-center gap-1.5 text-xs';
            } else {
                btn.className = 'px-3 py-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 rounded-lg font-medium shrink-0 transition-all flex items-center gap-1.5 text-xs';
            }
        });
    }
    renderSelectedSnapshotTable();
};

/**
 * Render table rows for selected snapshot
 */
function renderSelectedSnapshotTable() {
    const tbody = document.getElementById('filteredTableBody');
    if (!tbody) return;

    const snap = publicDbSnapshots[selectedSnapshotIndex] || publicDbSnapshots[0];
    if (!snap) return;

    let txs = snap.transactions || [];
    if (typeof txs === 'string') {
        try { txs = JSON.parse(txs); } catch (e) { txs = []; }
    }
    txs = resequenceOrderNumbers(txs);

    if (txs.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="p-8 text-center text-slate-400">
                    <p>Snapshot ini tidak memiliki rincian transaksi.</p>
                </td>
            </tr>
        `;
        return;
    }

    let html = '';
    txs.forEach((tx) => {
        const isVoid = tx.voided === 1;
        const timePart = tx.order_time ? tx.order_time.split(' ')[1] : '-';
        const paymentBadge = getPaymentBadge(tx.payment_mode_name);
        const statusBadge = isVoid 
            ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">Batal / Void</span>`
            : `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">Sukses</span>`;

        html += `
            <tr class="hover:bg-slate-50/70 transition-colors">
                <td class="p-4 font-mono font-medium text-indigo-600 text-xs sm:text-sm">
                    ${tx.order_no}
                </td>
                <td class="p-4 text-slate-500 text-xs sm:text-sm">
                    ${timePart} WIB
                </td>
                <td class="p-4">
                    ${paymentBadge}
                </td>
                <td class="p-4 text-slate-600 font-medium">
                    ${tx.fsubtotal || 'Rp ' + Number(tx.subtotal).toLocaleString('id-ID')}
                </td>
                <td class="p-4 text-slate-500">
                    ${tx.ftax || 'Rp ' + Number(tx.tax).toLocaleString('id-ID')}
                </td>
                <td class="p-4 font-bold text-slate-900 text-sm">
                    ${tx.fpaid_amount || 'Rp ' + Number(tx.paid_amount).toLocaleString('id-ID')}
                </td>
                <td class="p-4">
                    ${statusBadge}
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    initLucide();
}

/**
 * Export selected database snapshot as JSON file
 */
function exportFilteredJson() {
    const snap = publicDbSnapshots[selectedSnapshotIndex] || publicDbSnapshots[0];
    if (!snap) {
        alert('Belum ada snapshot database untuk diekspor!');
        return;
    }
    const cleanSnap = {
        ...snap,
        transactions: resequenceOrderNumbers(snap.transactions || [])
    };
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(cleanSnap, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `snapshot_database_${snap.date || getTodayString()}_${snap.percentage || 50}pct.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
}

/**
 * Export selected database snapshot as CSV file
 */
function exportFilteredCsv() {
    const snap = publicDbSnapshots[selectedSnapshotIndex] || publicDbSnapshots[0];
    if (!snap) {
        alert('Belum ada snapshot database untuk diekspor!');
        return;
    }
    let txs = snap.transactions || [];
    if (typeof txs === 'string') {
        try { txs = JSON.parse(txs); } catch(e) { txs = []; }
    }
    txs = resequenceOrderNumbers(txs);
    if (txs.length === 0) {
        alert('Tidak ada transaksi dalam snapshot ini untuk diekspor.');
        return;
    }

    const headers = ['Order No', 'Order Time', 'Payment Mode', 'Subtotal', 'Tax', 'Paid Amount', 'Status'];
    const rows = txs.map(tx => [
        `"${tx.order_no}"`,
        `"${tx.order_time}"`,
        `"${tx.payment_mode_name}"`,
        tx.subtotal,
        tx.tax,
        tx.paid_amount,
        tx.voided === 1 ? 'Void' : 'Success'
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `snapshot_database_${snap.date || getTodayString()}_${snap.percentage || 50}pct.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

