/**
 * Financial Tracker Application
 * Multi-Currency Expense, Income, Wallet & Debt Management System
 */

// Categories Configuration
const CATEGORIES = {
    expense: [
        { id: 'food', name: 'طعام ومأكولات', icon: 'fa-utensils', color: 'bg-orange-500' },
        { id: 'bills', name: 'فواتير واشتراكات', icon: 'fa-file-invoice-dollar', color: 'bg-blue-500' },
        { id: 'shopping', name: 'تسوق وأغراض', icon: 'fa-bag-shopping', color: 'bg-pink-500' },
        { id: 'transport', name: 'مواصلات وبنزين', icon: 'fa-car', color: 'bg-amber-500' },
        { id: 'health', name: 'صحة وعلاج', icon: 'fa-heart-pulse', color: 'bg-red-500' },
        { id: 'home', name: 'البيت والمستلزمات', icon: 'fa-house', color: 'bg-indigo-500' },
        { id: 'debt_payment', name: 'تسديد ديون والتزامات', icon: 'fa-handshake', color: 'bg-purple-500' },
        { id: 'other_exp', name: 'مصاريف أخرى', icon: 'fa-ellipsis', color: 'bg-slate-500' }
    ],
    income: [
        { id: 'salary', name: 'راتب شهري', icon: 'fa-money-bill-wave', color: 'bg-emerald-500' },
        { id: 'freelance', name: 'عمل حر / مشاريع', icon: 'fa-laptop-code', color: 'bg-teal-500' },
        { id: 'gift', name: 'عيدية / هدية', icon: 'fa-gift', color: 'bg-pink-500' },
        { id: 'debt_collect', name: 'تحصيل دين محصل', icon: 'fa-hand-holding-dollar', color: 'bg-cyan-500' },
        { id: 'other_inc', name: 'دخل آخر', icon: 'fa-coins', color: 'bg-lime-500' }
    ]
};

// Wallet Icons List for selector
const WALLET_ICONS = [
    'fa-building-columns', 'fa-wallet', 'fa-credit-card', 
    'fa-money-check', 'fa-piggy-bank', 'fa-coins', 
    'fa-mobile-screen', 'fa-vault', 'fa-sack-dollar', 'fa-shop'
];

// Initial Data Structure
const DEFAULT_STATE = {
    wallets: [
        { id: 'w1', name: 'بنك فلسطين', currency: 'ILS', initialBalance: 1500, icon: 'fa-building-columns' },
        { id: 'w2', name: 'كاش / محفظة شخصية', currency: 'ILS', initialBalance: 300, icon: 'fa-wallet' },
        { id: 'w3', name: 'حساب الدولار (بنك/بايبال)', currency: 'USD', initialBalance: 250, icon: 'fa-vault' }
    ],
    transactions: [
        {
            id: 't1',
            type: 'income',
            walletId: 'w1',
            amount: 3000,
            currency: 'ILS',
            category: 'salary',
            note: 'راتب الشهر الحالي',
            date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
        },
        {
            id: 't2',
            type: 'expense',
            walletId: 'w2',
            amount: 85,
            currency: 'ILS',
            category: 'food',
            note: 'شريت أغراض للمنزل',
            date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
        }
    ],
    debts: [
        {
            id: 'd1',
            type: 'receivable', // ديون لي
            person: 'أحمد محمود',
            amount: 200,
            currency: 'ILS',
            settledAmount: 0,
            note: 'سلفة مؤقتة',
            dueDate: '',
            status: 'pending'
        }
    ]
};

// App State
let state = {
    wallets: [],
    transactions: [],
    debts: []
};

let categoryChartInstance = null;
let isPrivacyMode = localStorage.getItem('financial_tracker_privacy') === 'true';

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    setDefaultDateInput();
    renderWalletIconSelector();
    updatePrivacyIcon();
    updateUI();
});

// Load state from server API or localStorage fallback
async function loadState() {
    let apiUrl = '/api/data';
    if (window.location.protocol === 'file:') {
        apiUrl = 'http://localhost:8080/api/data';
    }

    try {
        const res = await fetch(apiUrl);
        if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.wallets) && data.wallets.length > 0) {
                state = data;
                localStorage.setItem('financial_tracker_data_v1', JSON.stringify(state));
                updateUI();
                return;
            }
        }
    } catch (e) {
        console.warn('Server API not reachable:', e);
    }

    // LocalStorage fallback
    const saved = localStorage.getItem('financial_tracker_data_v1');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (parsed && Array.isArray(parsed.wallets) && parsed.wallets.length > 0) {
                state = parsed;
            }
        } catch (e) {
            console.error('Failed to parse saved data:', e);
        }
    }
    updateUI();
}

// Save state to server API & LocalStorage
async function saveState() {
    localStorage.setItem('financial_tracker_data_v1', JSON.stringify(state));
    let apiUrl = '/api/data';
    if (window.location.protocol === 'file:') {
        apiUrl = 'http://localhost:8080/api/data';
    }
    try {
        await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state)
        });
    } catch (e) {
        console.warn('Failed to sync state to server API:', e);
    }
}

// Auto-sync polling every 3 seconds for live multi-device updates
setInterval(async () => {
    let apiUrl = '/api/data';
    if (window.location.protocol === 'file:') {
        apiUrl = 'http://localhost:8080/api/data';
    }
    try {
        const res = await fetch(apiUrl);
        if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.wallets) && data.wallets.length > 0) {
                const currentStr = JSON.stringify(state);
                const serverStr = JSON.stringify(data);
                if (currentStr !== serverStr) {
                    state = data;
                    localStorage.setItem('financial_tracker_data_v1', serverStr);
                    updateUI();
                }
            }
        }
    } catch (e) {
        // Silent fail if offline
    }
}, 3000);

// Set default datetime to now in modals
function setDefaultDateInput() {
    const now = new Date();
    const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('trans-date').value = localIso;
}

// Global UI Update
function updateUI() {
    calculateWalletBalances();
    renderDashboardStats();
    renderWalletsList();
    renderTransactions();
    renderDebts();
    updateDashboardCharts();
    populateWalletSelects();
    updateCategoryOptions();
}

// Calculate Dynamic Current Balance for Each Wallet
function calculateWalletBalances() {
    state.wallets.forEach(wallet => {
        let current = parseFloat(wallet.initialBalance || 0);

        // Add/Subtract transactions
        state.transactions.forEach(t => {
            if (t.walletId === wallet.id) {
                const amt = parseFloat(t.amount || 0);
                if (t.type === 'income') current += amt;
                else if (t.type === 'expense') current -= amt;
            }
        });

        wallet.currentBalance = current;
    });
}

// Render Dashboard Statistics
function renderDashboardStats() {
    // 1. Total Balances Breakdown
    let totalIls = 0;
    let totalUsd = 0;

    state.wallets.forEach(w => {
        if (w.currency === 'ILS') totalIls += w.currentBalance;
        if (w.currency === 'USD') totalUsd += w.currentBalance;
    });

    document.getElementById('total-balance-ils').textContent = formatAmountDisplay(totalIls, '₪');
    document.getElementById('total-balance-usd').textContent = formatAmountDisplay(totalUsd, '$', true);

    // 2. Current Month Income & Expense Calculations
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // Set month display text
    const monthNames = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
    document.getElementById('current-month-name').textContent = `مصاريف شهر ${monthNames[currentMonth]} ${currentYear}`;

    let monthExpIls = 0, monthExpUsd = 0;
    let monthIncIls = 0, monthIncUsd = 0;

    state.transactions.forEach(t => {
        const tDate = new Date(t.date);
        if (tDate.getFullYear() === currentYear && tDate.getMonth() === currentMonth) {
            const amt = parseFloat(t.amount || 0);
            if (t.type === 'expense') {
                if (t.currency === 'ILS') monthExpIls += amt;
                if (t.currency === 'USD') monthExpUsd += amt;
            } else if (t.type === 'income') {
                if (t.currency === 'ILS') monthIncIls += amt;
                if (t.currency === 'USD') monthIncUsd += amt;
            }
        }
    });

    document.getElementById('month-expense-ils').textContent = formatAmountDisplay(monthExpIls, '₪');
    document.getElementById('month-expense-usd').textContent = formatAmountDisplay(monthExpUsd, '$', true);
    
    document.getElementById('month-income-ils').textContent = formatAmountDisplay(monthIncIls, '₪');
    document.getElementById('month-income-usd').textContent = formatAmountDisplay(monthIncUsd, '$', true);

    // 3. Recent Transactions Table Preview in Dashboard (Last 5)
    const recentTbody = document.getElementById('recent-transactions-tbody');
    recentTbody.innerHTML = '';

    const sortedTrans = [...state.transactions].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);

    if (sortedTrans.length === 0) {
        recentTbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-slate-500">لا توجد عمليات مسجلة حتى الآن</td></tr>`;
    } else {
        sortedTrans.forEach(t => {
            const wallet = state.wallets.find(w => w.id === t.walletId);
            const catObj = getCategoryObj(t.type, t.category);
            const isExp = t.type === 'expense';
            const currSymbol = t.currency === 'USD' ? '$' : '₪';
            const isPrefix = t.currency === 'USD';

            const tr = document.createElement('tr');
            tr.className = "border-b border-slate-700/40 hover:bg-slate-800/50 transition";
            tr.innerHTML = `
                <td class="px-4 py-3">
                    <span class="px-2.5 py-1 rounded-xl text-xs font-bold ${isExp ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}">
                        ${isExp ? '<i class="fa-solid fa-arrow-down me-1"></i> خصم' : '<i class="fa-solid fa-arrow-up me-1"></i> دخل'}
                    </span>
                </td>
                <td class="px-4 py-3 font-semibold text-white flex items-center gap-2">
                    <i class="fa-solid ${wallet ? wallet.icon : 'fa-wallet'} text-slate-400"></i>
                    <span>${wallet ? wallet.name : 'غير محدد'}</span>
                </td>
                <td class="px-4 py-3 font-bold ${isExp ? 'text-red-400' : 'text-emerald-400'}">
                    ${isExp ? '-' : '+'}${formatAmountDisplay(t.amount, currSymbol, isPrefix)}
                </td>
                <td class="px-4 py-3">
                    <span class="inline-flex items-center gap-1.5 text-xs text-slate-300">
                        <i class="fa-solid ${catObj.icon}"></i>
                        <span>${catObj.name}</span>
                    </span>
                </td>
                <td class="px-4 py-3 text-xs text-slate-300 max-w-xs truncate">${t.note || '-'}</td>
                <td class="px-4 py-3 text-xs text-slate-400">${formatDate(t.date)}</td>
            `;
            recentTbody.appendChild(tr);
        });
    }

    // 4. Dashboard Wallets Preview List
    const dashWalletsList = document.getElementById('dashboard-wallets-list');
    dashWalletsList.innerHTML = '';
    state.wallets.forEach(w => {
        const symbol = w.currency === 'USD' ? '$' : '₪';
        const isPrefix = w.currency === 'USD';
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-3 rounded-xl bg-slate-900/60 border border-slate-700/50";
        div.innerHTML = `
            <div class="flex items-center gap-2.5">
                <div class="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-brand-400 text-sm">
                    <i class="fa-solid ${w.icon}"></i>
                </div>
                <div>
                    <div class="text-xs font-bold text-white">${w.name}</div>
                    <div class="text-[10px] text-slate-400">${w.currency === 'USD' ? 'حساب دولار' : 'حساب شيكل'}</div>
                </div>
            </div>
            <div class="text-sm font-extrabold ${w.currentBalance >= 0 ? 'text-white' : 'text-red-400'}">
                ${formatAmountDisplay(w.currentBalance, symbol, isPrefix)}
            </div>
        `;
        dashWalletsList.appendChild(div);
    });
}

// Render Dashboard Category Breakdown Chart
function updateDashboardCharts() {
    const ctx = document.getElementById('categoryChart')?.getContext('2d');
    if (!ctx) return;

    const selectedCurrency = document.getElementById('chart-currency-filter')?.value || 'ILS';
    
    // Group expense by category for current month & selected currency
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const categorySums = {};
    CATEGORIES.expense.forEach(c => categorySums[c.name] = 0);

    state.transactions.forEach(t => {
        const tDate = new Date(t.date);
        if (t.type === 'expense' && t.currency === selectedCurrency &&
            tDate.getFullYear() === currentYear && tDate.getMonth() === currentMonth) {
            const catObj = getCategoryObj('expense', t.category);
            categorySums[catObj.name] = (categorySums[catObj.name] || 0) + parseFloat(t.amount);
        }
    });

    const labels = [];
    const data = [];
    const colors = [
        '#ef4444', '#3b82f6', '#ec4899', '#f59e0b', 
        '#10b981', '#6366f1', '#a855f7', '#64748b'
    ];

    Object.entries(categorySums).forEach(([catName, sum]) => {
        if (sum > 0) {
            labels.push(catName);
            data.push(sum);
        }
    });

    if (categoryChartInstance) {
        categoryChartInstance.destroy();
    }

    if (data.length === 0) {
        // Draw empty indicator chart
        categoryChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['لا توجد مصاريف بهذا الشهر'],
                datasets: [{
                    data: [1],
                    backgroundColor: ['#334155']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#94a3b8', font: { family: 'Cairo' } } }
                }
            }
        });
        return;
    }

    categoryChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 2,
                borderColor: '#1e293b'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { color: '#e2e8f0', font: { family: 'Cairo', size: 12 } }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const val = context.raw || 0;
                            const symbol = selectedCurrency === 'USD' ? '$' : '₪';
                            return ` ${context.label}: ${formatNumber(val)} ${symbol}`;
                        }
                    }
                }
            }
        }
    });
}

// Render Wallets Cards Grid
function renderWalletsList() {
    const grid = document.getElementById('wallets-grid');
    if (!grid) return;

    grid.innerHTML = '';

    if (state.wallets.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full py-12 text-center bg-slate-800/40 rounded-2xl border border-dashed border-slate-700 space-y-3">
                <i class="fa-solid fa-wallet text-4xl text-slate-600"></i>
                <p class="text-slate-400 font-medium">لم تقم بإضافة أي محفظة أو بنك حتى الآن.</p>
                <button onclick="openWalletModal()" class="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold rounded-xl transition">إضافة محفظة الآن</button>
            </div>
        `;
        return;
    }

    state.wallets.forEach(wallet => {
        const symbol = wallet.currency === 'USD' ? '$' : '₪';
        const isUsd = wallet.currency === 'USD';

        const card = document.createElement('div');
        card.className = "bg-slate-800/90 border border-slate-700/70 rounded-2xl p-5 shadow-xl space-y-4 relative overflow-hidden group hover:border-slate-600 transition";
        card.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-2xl ${isUsd ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'} flex items-center justify-center text-xl font-bold shadow-inner">
                        <i class="fa-solid ${wallet.icon || 'fa-building-columns'}"></i>
                    </div>
                    <div>
                        <h3 class="text-base font-bold text-white">${wallet.name}</h3>
                        <span class="inline-block px-2 py-0.5 rounded-md text-[10px] font-bold ${isUsd ? 'bg-blue-500/10 text-blue-300' : 'bg-emerald-500/10 text-emerald-300'}">
                            ${wallet.currency === 'USD' ? 'حساب دولار ($)' : 'حساب شيكل (₪)'}
                        </span>
                    </div>
                </div>
                <div class="flex items-center gap-1">
                    <button onclick="editWallet('${wallet.id}')" title="تعديل المحفظة" class="text-slate-            <div class="pt-2 border-t border-slate-700/50">
                <div class="text-xs text-slate-400 mb-1">الرصيد الحالي المتوفر:</div>
                <div class="text-2xl font-black ${wallet.currentBalance >= 0 ? (isUsd ? 'text-blue-400' : 'text-emerald-400') : 'text-red-400'}">
                    ${formatAmountDisplay(wallet.currentBalance, symbol, isUsd)}
                </div>
                <div class="text-[11px] text-slate-500 mt-1">الرصيد الأولي عند التأسيس: ${formatAmountDisplay(wallet.initialBalance, symbol, isUsd)}</div>
            </div>

            <div class="flex gap-2 pt-2">
                <button onclick="quickTransactionForWallet('${wallet.id}', 'expense')" class="flex-1 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1">
                    <i class="fa-solid fa-minus me-1"></i> خصم
                </button>
                <button onclick="quickTransactionForWallet('${wallet.id}', 'income')" class="flex-1 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1">
                    <i class="fa-solid fa-plus me-1"></i> إضافة
                </button>
            </div>
        `;
        grid.appendChild(card);
    });
}

// Render Transactions Table with Filters
function renderTransactions() {
    const tbody = document.getElementById('all-transactions-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    const filterSearch = document.getElementById('filter-search')?.value.trim().toLowerCase() || '';
    const filterType = document.getElementById('filter-type')?.value || 'all';
    const filterWallet = document.getElementById('filter-wallet')?.value || 'all';
    const filterCurrency = document.getElementById('filter-currency')?.value || 'all';
    const filterMonth = document.getElementById('filter-month')?.value || '';

    let filtered = state.transactions.filter(t => {
        // Search note
        if (filterSearch && !t.note.toLowerCase().includes(filterSearch)) return false;
        // Type filter
        if (filterType !== 'all' && t.type !== filterType) return false;
        // Wallet filter
        if (filterWallet !== 'all' && t.walletId !== filterWallet) return false;
        // Currency filter
        if (filterCurrency !== 'all' && t.currency !== filterCurrency) return false;
        // Month filter (format YYYY-MM)
        if (filterMonth) {
            const tMonth = t.date.slice(0, 7);
            if (tMonth !== filterMonth) return false;
        }
        return true;
    });

    // Sort newest first
    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-500">لا توجد عمليات تطابق الفلتر المحدد</td></tr>`;
        return;
    }

    filtered.forEach(t => {
        const wallet = state.wallets.find(w => w.id === t.walletId);
        const catObj = getCategoryObj(t.type, t.category);
        const isExp = t.type === 'expense';
        const currSymbol = t.currency === 'USD' ? '$' : '₪';
        const isPrefix = t.currency === 'USD';

        const tr = document.createElement('tr');
        tr.className = "border-b border-slate-700/40 hover:bg-slate-800/50 transition";
        tr.innerHTML = `
            <td class="px-4 py-3">
                <span class="px-2 py-1 rounded-lg text-xs font-bold ${isExp ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}">
                    ${isExp ? '<i class="fa-solid fa-arrow-down me-1"></i> خصم' : '<i class="fa-solid fa-arrow-up me-1"></i> دخل'}
                </span>
            </td>
            <td class="px-4 py-3 font-semibold text-white">
                <i class="fa-solid ${wallet ? wallet.icon : 'fa-wallet'} text-slate-400 me-1.5"></i>
                <span>${wallet ? wallet.name : 'غير محدد'}</span>
            </td>
            <td class="px-4 py-3 font-bold ${isExp ? 'text-red-400' : 'text-emerald-400'}">
                ${isExp ? '-' : '+'}${formatAmountDisplay(t.amount, currSymbol, isPrefix)}
            </td>
            <td class="px-4 py-3">
                <span class="inline-flex items-center gap-1.5 text-xs text-slate-300">
                    <i class="fa-solid ${catObj.icon}"></i>
                    <span>${catObj.name}</span>
                </span>
            </td>
            <td class="px-4 py-3 text-xs text-slate-300 max-w-xs font-medium">${t.note || '-'}</td>
            <td class="px-4 py-3 text-xs text-slate-400">${formatDate(t.date)}</td>
            <td class="px-4 py-3 text-center">
                <button onclick="deleteTransaction('${t.id}')" title="حذف العملية" class="text-slate-400 hover:text-red-400 p-1.5 rounded-lg hover:bg-slate-700/60 transition">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Render Debts Cards Grid & Totals
function renderDebts() {
    const grid = document.getElementById('debts-grid');
    if (!grid) return;

    let recIls = 0, recUsd = 0;
    let payIls = 0, payUsd = 0;

    grid.innerHTML = '';

    state.debts.forEach(d => {
        const remaining = parseFloat(d.amount) - parseFloat(d.settledAmount || 0);
        if (remaining > 0) {
            if (d.type === 'receivable') {
                if (d.currency === 'ILS') recIls += remaining;
                if (d.currency === 'USD') recUsd += remaining;
            } else {
                if (d.currency === 'ILS') payIls += remaining;
                if (d.currency === 'USD') payUsd += remaining;
            }
        }
    });

    document.getElementById('total-debts-receivable-ils').textContent = formatAmountDisplay(recIls, '₪');
    document.getElementById('total-debts-receivable-usd').textContent = formatAmountDisplay(recUsd, '$', true);
    document.getElementById('total-debts-payable-ils').textContent = formatAmountDisplay(payIls, '₪');
    document.getElementById('total-debts-payable-usd').textContent = formatAmountDisplay(payUsd, '$', true);

    if (state.debts.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full py-12 text-center bg-slate-800/40 rounded-2xl border border-dashed border-slate-700 space-y-3">
                <i class="fa-solid fa-handshake-simple text-4xl text-slate-600"></i>
                <p class="text-slate-400 font-medium">لا توجد ديون مسجلة حالياً.</p>
                <button onclick="openDebtModal()" class="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-xl transition">تسجيل دين جديد</button>
            </div>
        `;
        return;
    }

    state.debts.forEach(debt => {
        const remaining = parseFloat(debt.amount) - parseFloat(debt.settledAmount || 0);
        const isFullySettled = remaining <= 0;
        const isRec = debt.type === 'receivable';
        const symbol = debt.currency === 'USD' ? '$' : '₪';
        const isUsd = debt.currency === 'USD';

        const card = document.createElement('div');
        card.className = `bg-slate-800/90 border rounded-2xl p-5 shadow-xl space-y-4 relative overflow-hidden ${isFullySettled ? 'border-slate-700 opacity-60' : (isRec ? 'border-emerald-500/50' : 'border-red-500/50')}`;
        
        card.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl ${isRec ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'} flex items-center justify-center font-bold text-lg">
                        <i class="fa-solid ${isRec ? 'fa-arrow-down-left' : 'fa-arrow-up-right'}"></i>
                    </div>
                    <div>
                        <h3 class="text-base font-bold text-white">${debt.person}</h3>
                        <span class="text-xs font-semibold ${isRec ? 'text-emerald-400' : 'text-red-400'}">
                            ${isRec ? 'دين لي (أطالبه بمبلغ)' : 'دين علي (مطلوب مني)'}
                        </span>
                    </div>
                </div>
                <button onclick="deleteDebt('${debt.id}')" title="حذف الدين" class="text-slate-400 hover:text-red-400 p-1.5 rounded-lg hover:bg-slate-700/60 transition">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>

            <div class="space-y-2 bg-slate-900/60 p-3.5 rounded-xl border border-slate-700/50">
                <div class="flex justify-between text-xs">
                    <span class="text-slate-400">المبلغ الإجمالي:</span>
                    <span class="font-bold text-white">${formatAmountDisplay(debt.amount, symbol, isUsd)}</span>
                </div>
                <div class="flex justify-between text-xs">
                    <span class="text-slate-400">المسدد سابقاً:</span>
                    <span class="font-bold text-emerald-400">${formatAmountDisplay(debt.settledAmount || 0, symbol, isUsd)}</span>
                </div>
                <div class="flex justify-between text-sm pt-2 border-t border-slate-700/60">
                    <span class="font-bold text-slate-300">المبلغ المتبقي:</span>
                    <span class="font-black ${isFullySettled ? 'text-slate-500 line-through' : (isRec ? 'text-emerald-400' : 'text-red-400')}">
                        ${formatAmountDisplay(remaining, symbol, isUsd)}
                    </span>
                </div>
            </div>

            ${debt.note ? `<p class="text-xs text-slate-400 italic">" ${debt.note} "</p>` : ''}

            <div class="flex items-center justify-between pt-1">
                ${isFullySettled ? 
                    `<span class="w-full text-center py-2 bg-slate-700/50 text-slate-400 text-xs font-bold rounded-xl"><i class="fa-solid fa-check me-1"></i> تم التسديد بالكامل</span>` :
                    `<button onclick="openDebtSettleModal('${debt.id}')" class="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-md shadow-emerald-600/20 flex items-center justify-center gap-1.5">
                        <i class="fa-solid fa-hand-holding-dollar"></i>
                        <span>تسديد / تحصيل دفعة</span>
                    </button>`
                }
            </div>
        `;

        grid.appendChild(card);
    });
}

// Populate Wallet Dropdowns in Modals & Filters
function populateWalletSelects() {
    const transSelect = document.getElementById('trans-wallet-id');
    const filterSelect = document.getElementById('filter-wallet');

    if (transSelect) {
        transSelect.innerHTML = '';
        state.wallets.forEach(w => {
            const symbol = w.currency === 'USD' ? '$' : '₪';
            const opt = document.createElement('option');
            opt.value = w.id;
            opt.textContent = `${w.name} (الرصيد: ${formatNumber(w.currentBalance)} ${symbol})`;
            transSelect.appendChild(opt);
        });
    }

    if (filterSelect) {
        filterSelect.innerHTML = '<option value="all">جميع المحافظ والبنوك</option>';
        state.wallets.forEach(w => {
            const opt = document.createElement('option');
            opt.value = w.id;
            opt.textContent = w.name;
            filterSelect.appendChild(opt);
        });
    }
}

// Sync currency input when selecting wallet in Transaction Modal
function syncCurrencyWithWallet() {
    const walletId = document.getElementById('trans-wallet-id')?.value;
    const wallet = state.wallets.find(w => w.id === walletId);
    if (wallet) {
        document.getElementById('trans-currency').value = wallet.currency;
    }
}

// Render Category Dropdown Options
function updateCategoryOptions() {
    const isExpense = document.getElementById('type-expense')?.checked;
    const catSelect = document.getElementById('trans-category');
    if (!catSelect) return;

    catSelect.innerHTML = '';
    const list = isExpense ? CATEGORIES.expense : CATEGORIES.income;

    list.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        catSelect.appendChild(opt);
    });
}

// Render Wallet Icons Selection in Modal
function renderWalletIconSelector() {
    const container = document.getElementById('wallet-icon-selector');
    if (!container) return;

    container.innerHTML = '';
    WALLET_ICONS.forEach((icon, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `p-2.5 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center transition ${idx === 0 ? 'border-brand-500 bg-brand-500/10 text-brand-400 font-bold' : ''}`;
        btn.innerHTML = `<i class="fa-solid ${icon}"></i>`;
        btn.onclick = () => {
            document.querySelectorAll('#wallet-icon-selector button').forEach(b => {
                b.classList.remove('border-brand-500', 'bg-brand-500/10', 'text-brand-400');
            });
            btn.classList.add('border-brand-500', 'bg-brand-500/10', 'text-brand-400');
            document.getElementById('wallet-icon').value = icon;
        };
        container.appendChild(btn);
    });
}

/* ==========================================================================
   HANDLERS & MODAL CONTROL
   ========================================================================== */

// Switch Main Navigation Tabs
function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active', 'text-brand-500', 'border-brand-500');
        btn.classList.add('text-slate-400', 'border-transparent');
    });

    const targetBtn = document.getElementById(`tab-${tabId}`);
    if (targetBtn) {
        targetBtn.classList.add('active', 'text-brand-500', 'border-brand-500');
        targetBtn.classList.remove('text-slate-400', 'border-transparent');
    }

    document.querySelectorAll('main > section').forEach(sec => sec.classList.add('hidden'));
    const targetSec = document.getElementById(`view-${tabId}`);
    if (targetSec) targetSec.classList.remove('hidden');
}

// Open Transaction Modal
function openTransactionModal(type = 'expense') {
    if (state.wallets.length === 0) {
        showToast('يرجى إضافة محفظة أو بنك أولاً قبل تسجيل أي عملية!', 'warning');
        openWalletModal();
        return;
    }

    document.getElementById('transaction-form').reset();
    document.getElementById('trans-id').value = '';
    
    if (type === 'expense') {
        document.getElementById('type-expense').checked = true;
    } else {
        document.getElementById('type-income').checked = true;
    }
    
    updateCategoryOptions();
    populateWalletSelects();
    syncCurrencyWithWallet();
    setDefaultDateInput();

    document.getElementById('transaction-modal-title').innerHTML = `
        <i class="fa-solid fa-coins text-brand-400"></i>
        <span>${type === 'expense' ? 'خصم / تسجيل مصروف (شريت)' : 'إضافة / تسجيل دخل'}</span>
    `;

    document.getElementById('transaction-modal').classList.remove('hidden');
}

function closeTransactionModal() {
    document.getElementById('transaction-modal').classList.add('hidden');
}

function quickTransactionForWallet(walletId, type) {
    openTransactionModal(type);
    document.getElementById('trans-wallet-id').value = walletId;
    syncCurrencyWithWallet();
}

// Save Transaction
function handleSaveTransaction(e) {
    e.preventDefault();

    const id = document.getElementById('trans-id').value || 't_' + Date.now();
    const type = document.querySelector('input[name="trans-type"]:checked').value;
    const walletId = document.getElementById('trans-wallet-id').value;
    const amount = parseFloat(document.getElementById('trans-amount').value);
    const currency = document.getElementById('trans-currency').value;
    const category = document.getElementById('trans-category').value;
    const note = document.getElementById('trans-note').value.trim();
    const dateInput = document.getElementById('trans-date').value;
    const date = dateInput ? new Date(dateInput).toISOString() : new Date().toISOString();

    if (!walletId || isNaN(amount) || amount <= 0) {
        showToast('يرجى إدخال مبلغ صحيح واختيار المحفظة', 'danger');
        return;
    }

    const existingIdx = state.transactions.findIndex(t => t.id === id);
    const transObj = { id, type, walletId, amount, currency, category, note, date };

    if (existingIdx >= 0) {
        state.transactions[existingIdx] = transObj;
    } else {
        state.transactions.push(transObj);
    }

    saveState();
    updateUI();
    closeTransactionModal();
    showToast(type === 'expense' ? 'تم قيد الخصم من المحفظة بنجاح' : 'تم إضافة المبلغ للمحفظة بنجاح', 'success');
}

// Delete Transaction
function deleteTransaction(id) {
    if (!confirm('هل أنت تأكد من إغلاق وحذف هذه العملية؟')) return;
    state.transactions = state.transactions.filter(t => t.id !== id);
    saveState();
    updateUI();
    showToast('تم حذف العملية بنجاح', 'success');
}

// Open Wallet Modal
function openWalletModal(walletId = null) {
    document.getElementById('wallet-form').reset();
    document.getElementById('wallet-id').value = '';

    if (walletId) {
        const wallet = state.wallets.find(w => w.id === walletId);
        if (wallet) {
            document.getElementById('wallet-id').value = wallet.id;
            document.getElementById('wallet-name').value = wallet.name;
            document.getElementById('wallet-currency').value = wallet.currency;
            document.getElementById('wallet-balance').value = wallet.initialBalance;
            document.getElementById('wallet-icon').value = wallet.icon || 'fa-building-columns';
            document.getElementById('wallet-modal-title').innerHTML = `
                <i class="fa-solid fa-pen-to-square text-brand-400"></i>
                <span>تعديل المحفظة</span>
            `;
        }
    } else {
        document.getElementById('wallet-modal-title').innerHTML = `
            <i class="fa-solid fa-building-columns text-brand-400"></i>
            <span>إضافة محفظة / بنك جديد</span>
        `;
    }

    document.getElementById('wallet-modal').classList.remove('hidden');
}

function closeWalletModal() {
    document.getElementById('wallet-modal').classList.add('hidden');
}

function handleSaveWallet(e) {
    e.preventDefault();

    const id = document.getElementById('wallet-id').value || 'w_' + Date.now();
    const name = document.getElementById('wallet-name').value.trim();
    const currency = document.getElementById('wallet-currency').value;
    const initialBalance = parseFloat(document.getElementById('wallet-balance').value || 0);
    const icon = document.getElementById('wallet-icon').value || 'fa-building-columns';

    if (!name) {
        showToast('يرجى إدخال اسم المحفظة أو البنك', 'danger');
        return;
    }

    const existingIdx = state.wallets.findIndex(w => w.id === id);
    const walletObj = { id, name, currency, initialBalance, icon };

    if (existingIdx >= 0) {
        state.wallets[existingIdx] = walletObj;
    } else {
        state.wallets.push(walletObj);
    }

    saveState();
    updateUI();
    closeWalletModal();
    showToast('تم حفظ المحفظة بنجاح', 'success');
}

function editWallet(id) {
    openWalletModal(id);
}

function deleteWallet(id) {
    const hasTrans = state.transactions.some(t => t.walletId === id);
    if (hasTrans) {
        if (!confirm('هذه المحفظة تحتوي على عمليات مرتبطة بها. حذفها سيؤدي لحذف عملياتها أيضاً! هل تريد المتابعة؟')) return;
        state.transactions = state.transactions.filter(t => t.walletId !== id);
    } else {
        if (!confirm('هل تأكد من حذف هذه المحفظة؟')) return;
    }

    state.wallets = state.wallets.filter(w => w.id !== id);
    saveState();
    updateUI();
    showToast('تم حذف المحفظة', 'success');
}

// Open Debt Modal
function openDebtModal() {
    document.getElementById('debt-form').reset();
    document.getElementById('debt-modal').classList.remove('hidden');
}

function closeDebtModal() {
    document.getElementById('debt-modal').classList.add('hidden');
}

function handleSaveDebt(e) {
    e.preventDefault();

    const type = document.querySelector('input[name="debt-type"]:checked').value;
    const person = document.getElementById('debt-person').value.trim();
    const amount = parseFloat(document.getElementById('debt-amount').value);
    const currency = document.getElementById('debt-currency').value;
    const note = document.getElementById('debt-note').value.trim();
    const dueDate = document.getElementById('debt-due-date').value;

    if (!person || isNaN(amount) || amount <= 0) {
        showToast('يرجى إدخال بيانات الدين بشكل صحيح', 'danger');
        return;
    }

    const newDebt = {
        id: 'd_' + Date.now(),
        type,
        person,
        amount,
        currency,
        settledAmount: 0,
        note,
        dueDate,
        status: 'pending'
    };

    state.debts.push(newDebt);
    saveState();
    updateUI();
    closeDebtModal();
    showToast('تم تسجيل الدين بنجاح', 'success');
}

function deleteDebt(id) {
    if (!confirm('هل تريد حذف هذا الدين؟')) return;
    state.debts = state.debts.filter(d => d.id !== id);
    saveState();
    updateUI();
    showToast('تم حذف الدين', 'success');
}

// Debt Settlement Modal
function openDebtSettleModal(debtId) {
    const debt = state.debts.find(d => d.id === debtId);
    if (!debt) return;

    const remaining = parseFloat(debt.amount) - parseFloat(debt.settledAmount || 0);

    document.getElementById('settle-debt-id').value = debt.id;
    document.getElementById('settle-person-name').textContent = debt.person;
    const symbol = debt.currency === 'USD' ? '$' : '₪';
    document.getElementById('settle-remaining-amount').textContent = `${formatNumber(remaining)} ${symbol}`;
    document.getElementById('settle-amount').value = remaining;

    // Filter wallets by matching currency
    const walletSelect = document.getElementById('settle-wallet-id');
    walletSelect.innerHTML = '';
    const matchingWallets = state.wallets.filter(w => w.currency === debt.currency);

    if (matchingWallets.length === 0) {
        showToast(`لا توجد لديك محفظة بعملة (${debt.currency}) لتأثير الرصيد. قم بإنشاء واحدة أولاً.`, 'warning');
        openWalletModal();
        return;
    }

    matchingWallets.forEach(w => {
        const opt = document.createElement('option');
        opt.value = w.id;
        opt.textContent = `${w.name} (رصيدها: ${formatNumber(w.currentBalance)} ${symbol})`;
        walletSelect.appendChild(opt);
    });

    document.getElementById('debt-settle-modal').classList.remove('hidden');
}

function closeDebtSettleModal() {
    document.getElementById('debt-settle-modal').classList.add('hidden');
}

function handleSettleDebt(e) {
    e.preventDefault();

    const debtId = document.getElementById('settle-debt-id').value;
    const settleAmt = parseFloat(document.getElementById('settle-amount').value);
    const walletId = document.getElementById('settle-wallet-id').value;

    const debt = state.debts.find(d => d.id === debtId);
    if (!debt || isNaN(settleAmt) || settleAmt <= 0) return;

    const remaining = parseFloat(debt.amount) - parseFloat(debt.settledAmount || 0);
    if (settleAmt > remaining) {
        showToast('مبلغ التسديد أكبر من الدين المتبقي!', 'danger');
        return;
    }

    // Update settled amount
    debt.settledAmount = (parseFloat(debt.settledAmount || 0) + settleAmt);
    if (debt.settledAmount >= debt.amount) debt.status = 'completed';

    // Create a transaction record to automatically update wallet balance!
    const isReceivable = debt.type === 'receivable';
    const transType = isReceivable ? 'income' : 'expense';
    const cat = isReceivable ? 'debt_collect' : 'debt_payment';
    const noteText = isReceivable ? `تحصيل دفعة دين من ${debt.person}` : `تسديد دفعة دين لـ ${debt.person}`;

    state.transactions.push({
        id: 't_' + Date.now(),
        type: transType,
        walletId: walletId,
        amount: settleAmt,
        currency: debt.currency,
        category: cat,
        note: noteText,
        date: new Date().toISOString()
    });

    saveState();
    updateUI();
    closeDebtSettleModal();
    showToast('تم تسجيل التسديد وتحديث رصيد المحفظة بنجاح!', 'success');
}

/* Backup Export & Import */
function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `محفظتي_نسخة_احتياطية_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast('تم تصدير النسخة الاحتياطية بنجاح', 'success');
}

function importData(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(event) {
        try {
            const imported = JSON.parse(event.target.result);
            if (imported && Array.isArray(imported.wallets) && Array.isArray(imported.transactions)) {
                state = imported;
                saveState();
                updateUI();
                showToast('تم استيراد البيانات بنجاح', 'success');
            } else {
                showToast('ملف البيانات غير صالحة', 'danger');
            }
        } catch (err) {
            showToast('حدث خطأ في قراءة ملف JSON', 'danger');
        }
    };
    reader.readAsText(file);
}

/* Telegram Notifications Settings Handlers */
function openTelegramModal() {
    const config = state.telegramConfig || {};
    document.getElementById('telegram-enabled').checked = !!config.enabled;
    document.getElementById('telegram-token').value = config.botToken || '';
    document.getElementById('telegram-chat-id').value = config.chatId || '';
    document.getElementById('telegram-modal').classList.remove('hidden');
}

function closeTelegramModal() {
    document.getElementById('telegram-modal').classList.add('hidden');
}

function handleSaveTelegramConfig(e) {
    e.preventDefault();

    const enabled = document.getElementById('telegram-enabled').checked;
    const botToken = document.getElementById('telegram-token').value.trim();
    const chatId = document.getElementById('telegram-chat-id').value.trim();

    if (enabled && (!botToken || !chatId)) {
        showToast('يرجى إدخال رمز البوت (Bot Token) ومعرف الشات (Chat ID) لتفعيل الإشعارات', 'warning');
        return;
    }

    state.telegramConfig = { enabled, botToken, chatId };
    saveState();
    closeTelegramModal();
    showToast(enabled ? 'تم تفعيل إشعارات التليجرام الفورية بنجاح 🔔' : 'تم تعطيل إشعارات التليجرام', 'success');
}

async function testTelegramNotification() {
    const botToken = document.getElementById('telegram-token').value.trim();
    const chatId = document.getElementById('telegram-chat-id').value.trim();

    if (!botToken || !chatId) {
        showToast('ادخل رمز البوت ومعرف الشات أولاً لاختبار الرسالة', 'warning');
        return;
    }

    showToast('جاري إرسال الرسالة التجريبية...', 'info');

    try {
        const res = await fetch('/api/test-telegram', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ botToken, chatId })
        });
        const data = await res.json();
        if (data.success) {
            showToast('وصلت الرسالة بنجاح إلى التليجرام! 🎉', 'success');
        } else {
            showToast(`فشل الإرسال: ${data.error || 'تأكد من صحة البيانات والضغط على Start للبوت'}`, 'danger');
        }
    } catch (e) {
        showToast('حدث خطأ في الاتصال بالخادم', 'danger');
    }
}

/* Privacy Mode Functions */
function formatAmountDisplay(num, symbol, isPrefix = false) {
    if (isPrivacyMode) {
        return isPrefix ? `${symbol} ••••••` : `•••••• ${symbol}`;
    }
    const formatted = formatNumber(num);
    return isPrefix ? `${symbol}${formatted}` : `${formatted} ${symbol}`;
}

function togglePrivacyMode() {
    isPrivacyMode = !isPrivacyMode;
    localStorage.setItem('financial_tracker_privacy', isPrivacyMode);
    updatePrivacyIcon();
    updateUI();
    showToast(isPrivacyMode ? 'تم إخفاء المبالغ 🙈' : 'تم إظهار المبالغ 👁️', 'info');
}

function updatePrivacyIcon() {
    const icon = document.getElementById('privacy-icon');
    const btn = document.getElementById('toggle-privacy-btn');
    if (!icon || !btn) return;

    if (isPrivacyMode) {
        icon.className = 'fa-solid fa-eye-slash text-amber-400 text-base';
        btn.classList.add('bg-amber-500/20', 'border', 'border-amber-500/40');
        btn.title = 'إظهار المبالغ';
    } else {
        icon.className = 'fa-solid fa-eye text-base';
        btn.classList.remove('bg-amber-500/20', 'border', 'border-amber-500/40');
        btn.title = 'إخفاء المبالغ';
    }
}

/* Helper Utilities */
function getCategoryObj(type, catId) {
    const list = CATEGORIES[type] || CATEGORIES.expense;
    return list.find(c => c.id === catId) || { name: catId || 'عام', icon: 'fa-tag' };
}

function formatNumber(num) {
    return parseFloat(num || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(isoStr) {
    if (!isoStr) return '-';
    const d = new Date(isoStr);
    return `${d.toLocaleDateString('ar-EG')} - ${d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}`;
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const colors = {
        success: 'bg-emerald-600 text-white',
        danger: 'bg-red-600 text-white',
        warning: 'bg-amber-600 text-white',
        info: 'bg-slate-800 text-white border border-slate-700'
    };

    const toast = document.createElement('div');
    toast.className = `px-4 py-3 rounded-2xl shadow-2xl text-xs font-bold flex items-center gap-2 transform transition-all duration-300 translate-y-5 opacity-0 ${colors[type] || colors.info}`;
    toast.innerHTML = `
        <i class="fa-solid ${type === 'success' ? 'fa-check-circle' : (type === 'danger' ? 'fa-triangle-exclamation' : 'fa-circle-info')} text-sm"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.remove('translate-y-5', 'opacity-0');
    }, 50);

    setTimeout(() => {
        toast.classList.add('opacity-0', '-translate-y-2');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}
