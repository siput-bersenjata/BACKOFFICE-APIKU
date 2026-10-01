/**
 * Dashboard Olsera Client Application
 * Handles data fetching, live auto-refresh, Chart.js updates, filtering and UI interactions.
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

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initLucide();
    initCharts();
    setupEventListeners();
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

    // 2. Payment Methods Donut / Pie Chart
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
    const refreshBtn = document.getElementById('refreshBtn');
    refreshBtn.addEventListener('click', () => {
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
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', (e) => {
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

    // Modal Close
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
            fetchDashboardData(true); // silent background fetch
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
        const res = await fetch(`/api/sync?date=${currentDate}`, { method: 'POST' });
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
        const res = await fetch(`/api/dashboard?date=${currentDate}`);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        dashboardData = data;
        applyDashboardData(data);
    } catch (error) {
        console.error('Fetch error:', error);
        document.getElementById('lastUpdatedText').innerText = 'Gagal sinkron (Periksa koneksi)';
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
        document.getElementById('storeNameText').innerText = data.store.name || 'Naiki Cafe';
        document.getElementById('outletBadge').innerText = data.store.name || 'Naiki Cafe';
        document.getElementById('userRoleBadge').innerText = data.store.role || 'Perpajakan (PJ)';
    }

    // KPI Cards
    if (data.kpi) {
        document.getElementById('kpiRevenue').innerText = data.kpi.revenue.formatted;
        document.getElementById('kpiTransactions').innerText = (data.kpi.transactions.total || 0) + ' Transaksi';
        document.getElementById('kpiAvgSale').innerText = data.kpi.average_sale.formatted;
        document.getElementById('kpiTax').innerText = data.kpi.tax.formatted;

        // Revenue Growth Badge
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

    // Table Badge
    const totalCount = data.meta?.total || allTransactions.length;
    document.getElementById('tableCountBadge').innerText = `${totalCount} Data`;
    document.getElementById('navTxBadge').innerText = totalCount;

    // Last Updated Time
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
