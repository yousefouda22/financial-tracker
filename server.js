/**
 * Financial Tracker - Universal Server, Vercel Serverless & Interactive Telegram Dashboard
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const DATA_FILE = process.env.VERCEL ? '/tmp/financial_tracker_data.json' : path.join(__dirname, 'data.json');
const APP_URL = 'https://financial-tracker-two-lilac.vercel.app';

// ─── Security & Helpers ───────────────────────────────────────────────────────

function hashPassword(password) {
    return crypto.createHash('sha256').update(password + 'salt_financial_tracker_v2').digest('hex');
}

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

const DEFAULT_USER_STATE = {
    wallets: [
        { id: 'w1', name: 'بنك فلسطين', currency: 'ILS', initialBalance: 1500, icon: 'fa-building-columns' },
        { id: 'w2', name: 'كاش / محفظة شخصية', currency: 'ILS', initialBalance: 300, icon: 'fa-wallet' },
        { id: 'w3', name: 'حساب الدولار (بنك/بايبال)', currency: 'USD', initialBalance: 250, icon: 'fa-vault' }
    ],
    transactions: [],
    debts: [],
    telegramConfig: { botToken: '', chatId: '', enabled: false }
};

let db = { users: [], sessions: {}, userStates: {} };

function loadDB() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            if (parsed && (parsed.wallets || parsed.transactions)) {
                const defaultUserId = 'u_default';
                db.users = [{ id: defaultUserId, username: 'yousef', passwordHash: hashPassword('123456'), createdAt: new Date().toISOString() }];
                db.sessions = {};
                db.userStates = {
                    [defaultUserId]: {
                        wallets: parsed.wallets || [],
                        transactions: parsed.transactions || [],
                        debts: parsed.debts || [],
                        telegramConfig: parsed.telegramConfig || { botToken: '', chatId: '', enabled: false }
                    }
                };
                saveDB();
                return;
            }
            db = parsed;
            if (!db.users) db.users = [];
            if (!db.sessions) db.sessions = {};
            if (!db.userStates) db.userStates = {};
            return;
        }
    } catch (e) {
        console.error('DB load error:', e.message);
    }
    const defaultUserId = 'u_default';
    db.users = [{ id: defaultUserId, username: 'yousef', passwordHash: hashPassword('123456'), createdAt: new Date().toISOString() }];
    db.sessions = {};
    db.userStates = { [defaultUserId]: JSON.parse(JSON.stringify(DEFAULT_USER_STATE)) };
    saveDB();
}

function saveDB() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
    } catch (e) {
        console.warn('DB save failed:', e.message);
    }
}

function getUserIdFromRequest(req) {
    const authHeader = req.headers['authorization'] || '';
    let token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : '';
    if (!token) {
        const qs = req.url ? (req.url.split('?')[1] || '') : '';
        token = new URLSearchParams(qs).get('token') || '';
    }
    return token && db.sessions && db.sessions[token] ? db.sessions[token] : null;
}

function calculateWalletBalances(userState) {
    const wallets = (userState.wallets || []).map(w => ({ ...w }));
    const transactions = userState.transactions || [];
    wallets.forEach(wallet => {
        let current = parseFloat(wallet.initialBalance || 0);
        transactions.forEach(t => {
            if (t.walletId === wallet.id) {
                const amt = parseFloat(t.amount || 0);
                if (t.type === 'income') current += amt;
                else if (t.type === 'expense') current -= amt;
            }
        });
        wallet.currentBalance = current;
    });
    return wallets;
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        if (req.body && typeof req.body === 'object') {
            return resolve(req.body);
        }
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); }
        });
        req.on('error', reject);
    });
}

// ─── Telegram API Client ──────────────────────────────────────────────────────

function callTelegramApi(botToken, method, payload) {
    return new Promise((resolve, reject) => {
        if (!botToken) return reject(new Error('Bot token missing'));
        const dataStr = JSON.stringify(payload);
        const options = {
            hostname: 'api.telegram.org',
            port: 443,
            path: `/bot${botToken}/${method}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dataStr) }
        };
        const r = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const p = JSON.parse(body);
                    if (p.ok) resolve(p.result); else reject(new Error(p.description || 'Telegram Error'));
                } catch (e) { reject(e); }
            });
        });
        r.on('error', reject);
        r.write(dataStr);
        r.end();
    });
}

const MAIN_KEYBOARD = {
    keyboard: [
        [{ text: '📊 لوحة التحكم الرئيسية' }, { text: '💳 أرصدة المحافظ' }],
        [{ text: '➖ تسجيل خصم سريع' }, { text: '➕ تسجيل دخل سريع' }],
        [{ text: '🤝 الديون والتزاماتي' }, { text: '❓ مساعدة وتعليمات' }]
    ],
    resize_keyboard: true,
    persistent: true
};

const CAT_NAMES = {
    food: 'طعام ومأكولات 🍔',
    bills: 'فواتير واشتراكات 🧾',
    shopping: 'تسوق وأغراض 🛍️',
    transport: 'مواصلات وبنزين 🚗',
    health: 'صحة وعلاج 🏥',
    home: 'البيت والمستلزمات 🏠',
    salary: 'راتب شهري 💵',
    debt_payment: 'تسديد ديون والتزامات 🤝',
    other_exp: 'مصاريف أخرى 📦',
    other_inc: 'دخل آخر 🪙'
};

function sendTelegramMessage(botToken, chatId, text, replyMarkup = null) {
    const payload = { chat_id: chatId, text, parse_mode: 'HTML' };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    return callTelegramApi(botToken, 'sendMessage', payload);
}

function editTelegramMessage(botToken, chatId, messageId, text, replyMarkup = null) {
    const payload = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    return callTelegramApi(botToken, 'editMessageText', payload);
}

function answerCallbackQuery(botToken, callbackQueryId, text = null) {
    const payload = { callback_query_id: callbackQueryId };
    if (text) payload.text = text;
    return callTelegramApi(botToken, 'answerCallbackQuery', payload).catch(() => {});
}

async function setupTelegramWebhook(botToken) {
    if (!botToken) return;
    try {
        const webhookUrl = `${APP_URL}/api/telegram-webhook`;
        await callTelegramApi(botToken, 'setWebhook', { url: webhookUrl, drop_pending_updates: false });
        console.log(`Telegram Webhook set successfully to: ${webhookUrl}`);
    } catch (e) {
        console.error('Failed to setup Telegram Webhook:', e.message);
    }
}

async function notifyTelegramNewTransaction(telegramConfig, transaction, wallet, updatedBalance) {
    if (!telegramConfig || !telegramConfig.enabled || !telegramConfig.botToken || !telegramConfig.chatId) return;

    const isExpense = transaction.type === 'expense';
    const title = isExpense ? '🚨 <b>عملية خصم جديدة (شريت)</b>' : '🎉 <b>عملية دخل جديدة (إضافة)</b>';
    const symbol = transaction.currency === 'USD' ? '$' : '₪';
    const catName = CAT_NAMES[transaction.category] || transaction.category || 'عام';
    const walletName = wallet ? wallet.name : 'غير محدد';
    const noteText = transaction.note ? `\n📝 <b>الملاحظة:</b> ${transaction.note}` : '';
    const dateStr = new Date(transaction.date).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
    const balanceStr = updatedBalance !== undefined ? `\n💳 <b>الرصيد الجديد بالمحفظة:</b> ${updatedBalance.toFixed(2)} ${symbol}` : '';

    const message = `${title}

💰 <b>المبلغ:</b> ${isExpense ? '-' : '+'}${transaction.amount} ${symbol}
🏦 <b>المحفظة:</b> ${walletName}
🏷️ <b>التصنيف:</b> ${catName}${noteText}
📅 <b>التاريخ:</b> ${dateStr}${balanceStr}

———————————————
✅ <i>تم التحديث عبر موقع محفظتي المالية</i>`;

    try {
        await sendTelegramMessage(telegramConfig.botToken, telegramConfig.chatId, message, MAIN_KEYBOARD);
    } catch (err) {
        console.error('Telegram notification error:', err.message);
    }
}

// ─── Telegram Interactive Dashboard Views ────────────────────────────────────

function findUserByTelegramChatId(chatId) {
    const sChatId = String(chatId);
    for (const user of db.users) {
        const uState = db.userStates[user.id];
        if (uState && uState.telegramConfig && String(uState.telegramConfig.chatId) === sChatId) {
            return { user, state: uState };
        }
    }
    for (const user of db.users) {
        const uState = db.userStates[user.id];
        if (uState && uState.telegramConfig && uState.telegramConfig.botToken) {
            return { user, state: uState };
        }
    }
    if (db.users.length > 0) {
        const user = db.users[0];
        return { user, state: db.userStates[user.id] || DEFAULT_USER_STATE };
    }
    return null;
}

function generateDashboardView(user, userState) {
    const wallets = calculateWalletBalances(userState);
    let totalIls = 0, totalUsd = 0;
    wallets.forEach(w => {
        if (w.currency === 'ILS') totalIls += w.currentBalance;
        if (w.currency === 'USD') totalUsd += w.currentBalance;
    });

    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    let monthExpIls = 0, monthExpUsd = 0;
    let monthIncIls = 0, monthIncUsd = 0;

    (userState.transactions || []).forEach(t => {
        const d = new Date(t.date);
        if (d.getFullYear() === y && d.getMonth() === m) {
            const amt = parseFloat(t.amount || 0);
            if (t.type === 'expense') {
                if (t.currency === 'ILS') monthExpIls += amt;
                else if (t.currency === 'USD') monthExpUsd += amt;
            } else if (t.type === 'income') {
                if (t.currency === 'ILS') monthIncIls += amt;
                else if (t.currency === 'USD') monthIncUsd += amt;
            }
        }
    });

    let recIls = 0, recUsd = 0;
    let payIls = 0, payUsd = 0;
    (userState.debts || []).forEach(d => {
        const rem = parseFloat(d.amount || 0) - parseFloat(d.settledAmount || 0);
        if (rem > 0) {
            if (d.type === 'receivable') {
                if (d.currency === 'ILS') recIls += rem;
                else if (d.currency === 'USD') recUsd += rem;
            } else {
                if (d.currency === 'ILS') payIls += rem;
                else if (d.currency === 'USD') payUsd += rem;
            }
        }
    });

    const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    const currentMonthName = monthNames[m];

    const text = `💎 <b>لوحة التحكم المالية — محفظتي</b>
👤 <b>الحساب:</b> <code>${user.username}</code>
━━━━━━━━━━━━━━━━━━━━━
💰 <b>الرصيد الإجمالي المتاح:</b>
• 🇵🇸 <b>${totalIls.toLocaleString('en-US', { minimumFractionDigits: 2 })} ₪</b>
• 🇺🇸 <b>$${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}</b>

📅 <b>حركة شهر ${currentMonthName}:</b>
• 🔴 <b>المصاريف:</b> -${monthExpIls.toLocaleString('en-US', { minimumFractionDigits: 2 })} ₪ ${monthExpUsd > 0 ? `| -$${monthExpUsd.toFixed(2)}` : ''}
• 🟢 <b>الدخل:</b> +${monthIncIls.toLocaleString('en-US', { minimumFractionDigits: 2 })} ₪ ${monthIncUsd > 0 ? `| +$${monthIncUsd.toFixed(2)}` : ''}

🤝 <b>الديون والالتزامات:</b>
• 🟢 <b>لك عند الغير:</b> ${recIls.toFixed(2)} ₪ ${recUsd > 0 ? `| $${recUsd.toFixed(2)}` : ''}
• 🔴 <b>عليك للغير:</b> ${payIls.toFixed(2)} ₪ ${payUsd > 0 ? `| $${payUsd.toFixed(2)}` : ''}
━━━━━━━━━━━━━━━━━━━━━
👇 <i>اختر ما تريد إدارته من لوحة التحكم أدناه:</i>`;

    const inlineKeyboard = {
        inline_keyboard: [
            [
                { text: '💳 أرصدة المحافظ والحسابات', callback_data: 'nav:wallets' },
                { text: '📊 تقرير وتحليل الشهر', callback_data: 'nav:report' }
            ],
            [
                { text: '➖ تسجيل خصم (شريت)', callback_data: 'tx:start:expense' },
                { text: '➕ تسجيل دخل (شحن)', callback_data: 'tx:start:income' }
            ],
            [
                { text: '🤝 سجل الديون والتسديد', callback_data: 'nav:debts' },
                { text: '🕒 آخر 5 عمليات', callback_data: 'nav:recent' }
            ],
            [
                { text: '🌐 فتح الموقع بالكامل (Web App)', web_app: { url: APP_URL } }
            ],
            [
                { text: '🔄 تحديث لوحة التحكم', callback_data: 'nav:dashboard' }
            ]
        ]
    };

    return { text, replyMarkup: inlineKeyboard };
}

function generateWalletsView(user, userState) {
    const wallets = calculateWalletBalances(userState);
    let text = `💳 <b>أرصدة وتفاصيل الحسابات والمحافظ:</b>
━━━━━━━━━━━━━━━━━━━━━\n`;
    wallets.forEach((w, idx) => {
        const symbol = w.currency === 'USD' ? '$' : '₪';
        text += `<b>${idx + 1}. ${w.name}:</b>\n`;
        text += `   💰 <b>الرصيد:</b> <code>${w.currentBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${symbol}</code>\n\n`;
    });
    text += `<i>اختر أي محفظة أدناه لقيد عملية سريعة عليها أو معاينتها:</i>`;

    const buttons = [];
    wallets.forEach(w => {
        const symbol = w.currency === 'USD' ? '$' : '₪';
        buttons.push([{
            text: `🏦 ${w.name} (${w.currentBalance.toFixed(0)} ${symbol})`,
            callback_data: `wallet:view:${w.id}`
        }]);
    });
    buttons.push([
        { text: '➖ خصم سريع', callback_data: 'tx:start:expense' },
        { text: '➕ شحن سريع', callback_data: 'tx:start:income' }
    ]);
    buttons.push([{ text: '🔙 العودة للوحة التحكم', callback_data: 'nav:dashboard' }]);

    return { text, replyMarkup: { inline_keyboard: buttons } };
}

function generateSingleWalletView(walletId, user, userState) {
    const wallets = calculateWalletBalances(userState);
    const wallet = wallets.find(w => w.id === walletId) || wallets[0];
    if (!wallet) return generateWalletsView(user, userState);

    const symbol = wallet.currency === 'USD' ? '$' : '₪';
    const txs = (userState.transactions || []).filter(t => t.walletId === wallet.id).slice(-5).reverse();

    let text = `🏦 <b>كشف حساب: ${wallet.name}</b>
━━━━━━━━━━━━━━━━━━━━━
💰 <b>الرصيد الحالي المتاح:</b> <code>${wallet.currentBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${symbol}</code>
🪙 <b>الرصيد الافتتاحي:</b> ${wallet.initialBalance} ${symbol}

🕒 <b>آخر العمليات على هذه المحفظة:</b>\n`;

    if (txs.length === 0) {
        text += `<i>لا توجد أي معاملات مسجلة على هذه المحفظة بعد.</i>\n`;
    } else {
        txs.forEach(t => {
            const isExp = t.type === 'expense';
            const cat = CAT_NAMES[t.category] || t.category || 'عام';
            const dateStr = new Date(t.date).toLocaleDateString('ar-EG', { month: 'numeric', day: 'numeric' });
            text += `• ${isExp ? '🔴 -' : '🟢 +'}${t.amount} ${symbol} (${cat}) - <i>${dateStr}</i>\n`;
        });
    }

    const buttons = [
        [
            { text: `➖ خصم من ${wallet.name}`, callback_data: `tx:wallet:expense:${wallet.id}` },
            { text: `➕ شحن في ${wallet.name}`, callback_data: `tx:wallet:income:${wallet.id}` }
        ],
        [
            { text: '💳 كل المحافظ', callback_data: 'nav:wallets' },
            { text: '🔙 لوحة التحكم', callback_data: 'nav:dashboard' }
        ]
    ];

    return { text, replyMarkup: { inline_keyboard: buttons } };
}

function generateSelectWalletView(actionType, user, userState) {
    const wallets = calculateWalletBalances(userState);
    const isExp = actionType === 'expense';
    const actionLabel = isExp ? 'الخصم (شريت)' : 'الشحن (الدخل)';

    let text = `${isExp ? '➖' : '➕'} <b>اختيار المحفظة لتسجيل ${actionLabel}:</b>
━━━━━━━━━━━━━━━━━━━━━
<i>اختر المحفظة أو البنك الذي تمت عبره العملية:</i>`;

    const buttons = [];
    wallets.forEach(w => {
        const symbol = w.currency === 'USD' ? '$' : '₪';
        buttons.push([{
            text: `🏦 ${w.name} (${w.currentBalance.toFixed(0)} ${symbol})`,
            callback_data: `tx:wallet:${actionType}:${w.id}`
        }]);
    });
    buttons.push([{ text: '🔙 إلغاء والعودة للوحة التحكم', callback_data: 'nav:dashboard' }]);

    return { text, replyMarkup: { inline_keyboard: buttons } };
}

function generateSelectCategoryView(actionType, walletId, user, userState) {
    const wallets = calculateWalletBalances(userState);
    const wallet = wallets.find(w => w.id === walletId) || wallets[0];
    const isExp = actionType === 'expense';

    let text = `🏷️ <b>اختيار التصنيف:</b>
━━━━━━━━━━━━━━━━━━━━━
🏦 <b>المحفظة المختارة:</b> ${wallet ? wallet.name : ''}
${isExp ? '💸' : '💰'} <b>نوع العملية:</b> ${isExp ? 'خصم / مصروف' : 'دخل / إيداع'}

<i>حدد تصنيف هذه العملية:</i>`;

    const buttons = [];
    if (isExp) {
        buttons.push([
            { text: '🍔 طعام ومأكولات', callback_data: `tx:cat:${actionType}:${walletId}:food` },
            { text: '🧾 فواتير واشتراكات', callback_data: `tx:cat:${actionType}:${walletId}:bills` }
        ]);
        buttons.push([
            { text: '🛍️ تسوق وأغراض', callback_data: `tx:cat:${actionType}:${walletId}:shopping` },
            { text: '🚗 مواصلات وبنزين', callback_data: `tx:cat:${actionType}:${walletId}:transport` }
        ]);
        buttons.push([
            { text: '🏥 صحة وعلاج', callback_data: `tx:cat:${actionType}:${walletId}:health` },
            { text: '🏠 البيت والمستلزمات', callback_data: `tx:cat:${actionType}:${walletId}:home` }
        ]);
        buttons.push([
            { text: '🤝 تسديد التزام/دين', callback_data: `tx:cat:${actionType}:${walletId}:debt_payment` },
            { text: '📦 مصاريف أخرى', callback_data: `tx:cat:${actionType}:${walletId}:other_exp` }
        ]);
    } else {
        buttons.push([
            { text: '💵 راتب شهري', callback_data: `tx:cat:${actionType}:${walletId}:salary` },
            { text: '🪙 دخل أو عمل حر', callback_data: `tx:cat:${actionType}:${walletId}:other_inc` }
        ]);
    }
    buttons.push([{ text: '🔙 رجوع لاختيار المحفظة', callback_data: `tx:start:${actionType}` }]);

    return { text, replyMarkup: { inline_keyboard: buttons } };
}

function generateSelectAmountView(actionType, walletId, catId, user, userState) {
    const wallets = calculateWalletBalances(userState);
    const wallet = wallets.find(w => w.id === walletId) || wallets[0];
    const symbol = wallet ? (wallet.currency === 'USD' ? '$' : '₪') : '₪';
    const catName = CAT_NAMES[catId] || catId;
    const isExp = actionType === 'expense';

    let text = `💰 <b>تحديد المبلغ:</b>
━━━━━━━━━━━━━━━━━━━━━
🏦 <b>المحفظة:</b> ${wallet ? wallet.name : ''}
🏷️ <b>التصنيف:</b> ${catName}

<i>اختر مبلغاً سريعاً بنقرة واحدة، أو اكتب المبلغ وملاحظتك في رسالة:</i>`;

    const amounts = wallet && wallet.currency === 'USD' ? [10, 25, 50, 100, 250, 500] : [20, 50, 100, 200, 300, 500];
    const buttons = [];
    for (let i = 0; i < amounts.length; i += 2) {
        buttons.push([
            { text: `${amounts[i]} ${symbol}`, callback_data: `tx:amt:${actionType}:${walletId}:${catId}:${amounts[i]}` },
            { text: `${amounts[i+1]} ${symbol}`, callback_data: `tx:amt:${actionType}:${walletId}:${catId}:${amounts[i+1]}` }
        ]);
    }
    buttons.push([{ text: '🔙 رجوع لاختيار التصنيف', callback_data: `tx:wallet:${actionType}:${walletId}` }]);

    return { text, replyMarkup: { inline_keyboard: buttons } };
}

function generateDebtsView(user, userState) {
    const debts = userState.debts || [];
    let text = `🤝 <b>سجل الديون والالتزامات المالية:</b>
━━━━━━━━━━━━━━━━━━━━━\n`;

    let recList = [], payList = [];
    debts.forEach(d => {
        const rem = parseFloat(d.amount || 0) - parseFloat(d.settledAmount || 0);
        if (rem > 0) {
            if (d.type === 'receivable') recList.push({ ...d, remaining: rem });
            else payList.push({ ...d, remaining: rem });
        }
    });

    text += `🟢 <b>أموال لك عند الآخرين (${recList.length}):</b>\n`;
    if (recList.length === 0) text += `<i>لا توجد ديون مستحقة لك.</i>\n\n`;
    else {
        recList.forEach((d, i) => {
            const sym = d.currency === 'USD' ? '$' : '₪';
            text += `${i + 1}. <b>${d.personName}:</b> ${d.remaining} ${sym} (${d.description || 'دين'})\n`;
        });
        text += `\n`;
    }

    text += `🔴 <b>ديون عليك متوجبة للغير (${payList.length}):</b>\n`;
    if (payList.length === 0) text += `<i>لا توجد ديون عليك، ممتاز!</i>\n\n`;
    else {
        payList.forEach((d, i) => {
            const sym = d.currency === 'USD' ? '$' : '₪';
            text += `${i + 1}. <b>${d.personName}:</b> ${d.remaining} ${sym} (${d.description || 'التزام'})\n`;
        });
        text += `\n`;
    }

    const buttons = [];
    const allPending = [...recList, ...payList];
    if (allPending.length > 0) {
        allPending.slice(0, 6).forEach(d => {
            const sym = d.currency === 'USD' ? '$' : '₪';
            buttons.push([{
                text: `✅ تسديد بالكامل: ${d.personName} (${d.remaining} ${sym})`,
                callback_data: `debt:settle:${d.id}`
            }]);
        });
    }
    buttons.push([{ text: '🔙 العودة للوحة التحكم', callback_data: 'nav:dashboard' }]);

    return { text, replyMarkup: { inline_keyboard: buttons } };
}

function generateRecentView(user, userState) {
    const txs = (userState.transactions || []).slice(-8).reverse();
    const wallets = calculateWalletBalances(userState);

    let text = `🕒 <b>سجل آخر العمليات والمعاملات:</b>
━━━━━━━━━━━━━━━━━━━━━\n`;

    if (txs.length === 0) {
        text += `<i>لم تقم بقيد أي عمليات حتى الآن.</i>\n`;
    } else {
        txs.forEach((t, i) => {
            const isExp = t.type === 'expense';
            const sym = t.currency === 'USD' ? '$' : '₪';
            const wallet = wallets.find(w => w.id === t.walletId);
            const wName = wallet ? wallet.name : 'محفظة';
            const cat = CAT_NAMES[t.category] || t.category || 'عام';
            const dStr = new Date(t.date).toLocaleDateString('ar-EG', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            text += `<b>${i + 1}.</b> ${isExp ? '🔴 خصم' : '🟢 دخل'}: <b>${t.amount} ${sym}</b>\n`;
            text += `   🏦 ${wName} | 🏷️ ${cat}\n`;
            if (t.note) text += `   📝 <i>${t.note}</i>\n`;
            text += `   📅 ${dStr}\n\n`;
        });
    }

    const buttons = [
        [
            { text: '➖ خصم جديد', callback_data: 'tx:start:expense' },
            { text: '➕ دخل جديد', callback_data: 'tx:start:income' }
        ],
        [{ text: '🔙 العودة للوحة التحكم', callback_data: 'nav:dashboard' }]
    ];

    return { text, replyMarkup: { inline_keyboard: buttons } };
}

function generateReportView(user, userState) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

    let totalExp = 0, totalInc = 0;
    const catTotals = {};

    (userState.transactions || []).forEach(t => {
        const d = new Date(t.date);
        if (d.getFullYear() === y && d.getMonth() === m) {
            const amt = parseFloat(t.amount || 0);
            if (t.type === 'expense') {
                totalExp += amt;
                catTotals[t.category] = (catTotals[t.category] || 0) + amt;
            } else if (t.type === 'income') {
                totalInc += amt;
            }
        }
    });

    let text = `📊 <b>تقرير وتحليل شهر ${monthNames[m]} ${y}:</b>
━━━━━━━━━━━━━━━━━━━━━
📈 <b>إجمالي الدخل:</b> +${totalInc.toFixed(2)} ₪
📉 <b>إجمالي المصاريف:</b> -${totalExp.toFixed(2)} ₪
💰 <b>صافي الوفر:</b> ${(totalInc - totalExp).toFixed(2)} ₪
━━━━━━━━━━━━━━━━━━━━━
🏷️ <b>توزيع المصاريف حسب التصنيفات:</b>\n`;

    const sortedCats = Object.keys(catTotals).sort((a, b) => catTotals[b] - catTotals[a]);
    if (sortedCats.length === 0) {
        text += `<i>لا توجد مصاريف مسجلة هذا الشهر.</i>\n`;
    } else {
        sortedCats.forEach(catKey => {
            const amt = catTotals[catKey];
            const pct = totalExp > 0 ? Math.round((amt / totalExp) * 100) : 0;
            const barLen = Math.round(pct / 10);
            const bar = '■'.repeat(barLen) + '□'.repeat(10 - barLen);
            const name = CAT_NAMES[catKey] || catKey;
            text += `• <b>${name}:</b> ${amt.toFixed(2)} ₪ (${pct}%)\n   <code>${bar}</code>\n`;
        });
    }

    const buttons = [
        [
            { text: '💳 أرصدة المحافظ', callback_data: 'nav:wallets' },
            { text: '🕒 آخر العمليات', callback_data: 'nav:recent' }
        ],
        [{ text: '🔙 العودة للوحة التحكم', callback_data: 'nav:dashboard' }]
    ];

    return { text, replyMarkup: { inline_keyboard: buttons } };
}

// ─── Telegram Updates Handler (Messages & Callbacks) ─────────────────────────

async function handleTelegramUpdate(update) {
    // 1. Handle Inline Button Clicks (Callback Queries)
    if (update.callback_query) {
        const cq = update.callback_query;
        const chatId = cq.message.chat.id;
        const messageId = cq.message.message_id;
        const data = cq.data || '';

        const matched = findUserByTelegramChatId(chatId);
        if (!matched) {
            await answerCallbackQuery(matched?.state?.telegramConfig?.botToken, cq.id, 'حسابك غير مرتبط بعد');
            return;
        }

        const { user, state: userState } = matched;
        const botToken = userState.telegramConfig.botToken;

        // Route callback actions
        if (data === 'nav:dashboard') {
            const v = generateDashboardView(user, userState);
            await editTelegramMessage(botToken, chatId, messageId, v.text, v.replyMarkup);
            await answerCallbackQuery(botToken, cq.id);
            return;
        }

        if (data === 'nav:wallets') {
            const v = generateWalletsView(user, userState);
            await editTelegramMessage(botToken, chatId, messageId, v.text, v.replyMarkup);
            await answerCallbackQuery(botToken, cq.id);
            return;
        }

        if (data.startsWith('wallet:view:')) {
            const wId = data.replace('wallet:view:', '');
            const v = generateSingleWalletView(wId, user, userState);
            await editTelegramMessage(botToken, chatId, messageId, v.text, v.replyMarkup);
            await answerCallbackQuery(botToken, cq.id);
            return;
        }

        if (data.startsWith('tx:start:')) {
            const act = data.replace('tx:start:', '');
            const v = generateSelectWalletView(act, user, userState);
            await editTelegramMessage(botToken, chatId, messageId, v.text, v.replyMarkup);
            await answerCallbackQuery(botToken, cq.id);
            return;
        }

        if (data.startsWith('tx:wallet:')) {
            const parts = data.split(':');
            const act = parts[2];
            const wId = parts[3];
            const v = generateSelectCategoryView(act, wId, user, userState);
            await editTelegramMessage(botToken, chatId, messageId, v.text, v.replyMarkup);
            await answerCallbackQuery(botToken, cq.id);
            return;
        }

        if (data.startsWith('tx:cat:')) {
            const parts = data.split(':');
            const act = parts[2];
            const wId = parts[3];
            const catId = parts[4];
            const v = generateSelectAmountView(act, wId, catId, user, userState);
            await editTelegramMessage(botToken, chatId, messageId, v.text, v.replyMarkup);
            await answerCallbackQuery(botToken, cq.id);
            return;
        }

        if (data.startsWith('tx:amt:')) {
            const parts = data.split(':');
            const act = parts[2];
            const wId = parts[3];
            const catId = parts[4];
            const amt = parseFloat(parts[5]);

            const wallets = calculateWalletBalances(userState);
            const wallet = wallets.find(w => w.id === wId) || wallets[0];
            const symbol = wallet ? (wallet.currency === 'USD' ? '$' : '₪') : '₪';
            const isExp = act === 'expense';

            const newTx = {
                id: 't_' + Date.now(),
                type: isExp ? 'expense' : 'income',
                walletId: wallet ? wallet.id : wId,
                amount: amt,
                currency: wallet ? wallet.currency : 'ILS',
                category: catId,
                note: `عبر لوحة تحكم التليجرام`,
                date: new Date().toISOString()
            };

            if (!userState.transactions) userState.transactions = [];
            userState.transactions.push(newTx);
            saveDB();

            const updatedWallets = calculateWalletBalances(userState);
            const updatedWallet = updatedWallets.find(w => w.id === (wallet ? wallet.id : wId));

            const confirmText = `${isExp ? '💸 <b>تم قيد الخصم بنجاح!</b>' : '💳 <b>تم قيد الشحن بنجاح!</b>'}
━━━━━━━━━━━━━━━━━━━━━
💰 <b>المبلغ:</b> ${isExp ? '-' : '+'}${amt} ${symbol}
🏦 <b>المحفظة:</b> ${wallet ? wallet.name : ''}
🏷️ <b>التصنيف:</b> ${CAT_NAMES[catId] || catId}
💳 <b>الرصيد الجديد بالمحفظة:</b> <code>${updatedWallet ? updatedWallet.currentBalance.toFixed(2) : ''} ${symbol}</code>`;

            const replyMarkup = {
                inline_keyboard: [
                    [
                        { text: '➕ عملية جديدة', callback_data: `tx:start:${act}` },
                        { text: '📊 لوحة التحكم', callback_data: 'nav:dashboard' }
                    ]
                ]
            };

            await editTelegramMessage(botToken, chatId, messageId, confirmText, replyMarkup);
            await answerCallbackQuery(botToken, cq.id, 'تمت العملية بنجاح! ✅');
            return;
        }

        if (data.startsWith('debt:settle:')) {
            const debtId = data.replace('debt:settle:', '');
            const debt = (userState.debts || []).find(d => d.id === debtId);
            if (debt) {
                debt.settledAmount = debt.amount;
                saveDB();
                await answerCallbackQuery(botToken, cq.id, `تم تسديد دين ${debt.personName} بالكامل! ✅`);
                const v = generateDebtsView(user, userState);
                await editTelegramMessage(botToken, chatId, messageId, v.text, v.replyMarkup);
                return;
            }
        }

        if (data === 'nav:debts') {
            const v = generateDebtsView(user, userState);
            await editTelegramMessage(botToken, chatId, messageId, v.text, v.replyMarkup);
            await answerCallbackQuery(botToken, cq.id);
            return;
        }

        if (data === 'nav:recent') {
            const v = generateRecentView(user, userState);
            await editTelegramMessage(botToken, chatId, messageId, v.text, v.replyMarkup);
            await answerCallbackQuery(botToken, cq.id);
            return;
        }

        if (data === 'nav:report') {
            const v = generateReportView(user, userState);
            await editTelegramMessage(botToken, chatId, messageId, v.text, v.replyMarkup);
            await answerCallbackQuery(botToken, cq.id);
            return;
        }

        await answerCallbackQuery(botToken, cq.id);
        return;
    }

    // 2. Handle Text Messages
    if (update.message && update.message.text) {
        const msg = update.message;
        const chatId = msg.chat.id;
        const text = msg.text.trim();

        const matched = findUserByTelegramChatId(chatId);
        if (!matched) return;

        const { user, state: userState } = matched;
        const botToken = userState.telegramConfig.botToken;

        // Commands & Main Menu triggers
        if (text === '/start' || text === '/menu' || text === '📊 لوحة التحكم الرئيسية' || text === 'لوحة التحكم' || text === 'الرئيسية') {
            const v = generateDashboardView(user, userState);
            await sendTelegramMessage(botToken, chatId, v.text, v.replyMarkup);
            return;
        }

        if (text === '💳 أرصدة المحافظ' || text === '/wallets' || text === 'المحافظ' || text === 'الرصيد') {
            const v = generateWalletsView(user, userState);
            await sendTelegramMessage(botToken, chatId, v.text, v.replyMarkup);
            return;
        }

        if (text === '➖ تسجيل خصم سريع' || text === 'خصم' || text === 'شريت') {
            const v = generateSelectWalletView('expense', user, userState);
            await sendTelegramMessage(botToken, chatId, v.text, v.replyMarkup);
            return;
        }

        if (text === '➕ تسجيل دخل سريع' || text === 'دخل' || text === 'شحن') {
            const v = generateSelectWalletView('income', user, userState);
            await sendTelegramMessage(botToken, chatId, v.text, v.replyMarkup);
            return;
        }

        if (text === '🤝 الديون والتزاماتي' || text === '/debts' || text === 'الديون') {
            const v = generateDebtsView(user, userState);
            await sendTelegramMessage(botToken, chatId, v.text, v.replyMarkup);
            return;
        }

        if (text === '❓ مساعدة وتعليمات' || text === '/help') {
            const helpText = `📖 <b>دليل استخدام بوت محفظتي المالية:</b>
━━━━━━━━━━━━━━━━━━━━━
يمكنك التحكم بمحفظتك بطريقتين:

1️⃣ <b>عبر الأزرار التفاعلية (Inline Buttons):</b>
اضغط على <b>لوحة التحكم الرئيسية</b> وستظهر لك الأزرار للتحكم الكامل واختيار المحافظ والتصنيفات وتفقد الديون بلمسة واحدة.

2️⃣ <b>عبر الأوامر النصية السريعة والذكية:</b>
• <code>خصم 50 بنك فلسطين طعام</code>
• <code>شريت 25 كاش تسوق</code>
• <code>شحن 500 بايبال راتب</code>
• <code>إضافة 100 بنك فلسطين</code>

🌐 <b>الموقع المباشر:</b> <a href="${APP_URL}">فتح موقع محفظتي</a>`;
            await sendTelegramMessage(botToken, chatId, helpText, MAIN_KEYBOARD);
            return;
        }

        // Smart Natural Language Regex Parser
        const expRegex = /^(خصم|شريت|صرفت|مصروف)\s+([\d\.]+)\s*(دولار|شيكل)?\s*(.*)$/i;
        const incRegex = /^(إضافة|شحن|دخل|اضافة|ايداع)\s+([\d\.]+)\s*(دولار|شيكل)?\s*(.*)$/i;

        const matchExp = text.match(expRegex);
        const matchInc = text.match(incRegex);

        if (matchExp || matchInc) {
            const isExp = !!matchExp;
            const match = matchExp || matchInc;
            const amount = parseFloat(match[2]);
            const currInput = (match[3] || '').trim();
            const rest = (match[4] || '').trim();

            const wallets = calculateWalletBalances(userState);
            let targetWallet = null;

            // Match wallet by name
            for (const w of wallets) {
                if (rest.toLowerCase().includes(w.name.toLowerCase())) {
                    targetWallet = w;
                    break;
                }
            }
            if (!targetWallet && currInput.includes('دولار')) {
                targetWallet = wallets.find(w => w.currency === 'USD');
            }
            if (!targetWallet) targetWallet = wallets[0];

            let cat = isExp ? 'other_exp' : 'other_inc';
            for (const [k, v] of Object.entries(CAT_NAMES)) {
                if (rest.includes(v.split(' ')[0])) {
                    cat = k;
                    break;
                }
            }

            const newTx = {
                id: 't_' + Date.now(),
                type: isExp ? 'expense' : 'income',
                walletId: targetWallet ? targetWallet.id : 'w1',
                amount: amount,
                currency: targetWallet ? targetWallet.currency : 'ILS',
                category: cat,
                note: rest || (isExp ? 'خصم سريع' : 'شحن سريع'),
                date: new Date().toISOString()
            };

            if (!userState.transactions) userState.transactions = [];
            userState.transactions.push(newTx);
            saveDB();

            const updatedWallets = calculateWalletBalances(userState);
            const updatedWallet = updatedWallets.find(w => w.id === targetWallet?.id);
            const sym = targetWallet ? (targetWallet.currency === 'USD' ? '$' : '₪') : '₪';

            const confirmText = `${isExp ? '💸 <b>تم قيد الخصم بنجاح!</b>' : '💳 <b>تم قيد الشحن بنجاح!</b>'}
━━━━━━━━━━━━━━━━━━━━━
💰 <b>المبلغ:</b> ${isExp ? '-' : '+'}${amount} ${sym}
🏦 <b>المحفظة:</b> ${targetWallet ? targetWallet.name : ''}
🏷️ <b>التصنيف:</b> ${CAT_NAMES[cat] || cat}
💳 <b>الرصيد الجديد بالمحفظة:</b> <code>${updatedWallet ? updatedWallet.currentBalance.toFixed(2) : ''} ${sym}</code>`;

            const replyMarkup = {
                inline_keyboard: [
                    [{ text: '📊 عرض لوحة التحكم المحدثة', callback_data: 'nav:dashboard' }]
                ]
            };

            await sendTelegramMessage(botToken, chatId, confirmText, replyMarkup);
            return;
        }

        // Bare number handling (e.g. user enters "50")
        const bareNum = parseFloat(text);
        if (!isNaN(bareNum) && bareNum > 0 && String(bareNum) === text) {
            const wallets = calculateWalletBalances(userState);
            const promptText = `🤔 <b>هل تريد خصم أم إضافة ${bareNum}؟</b>\nاختر العملية والمحفظة:`;
            const buttons = [];
            wallets.forEach(w => {
                const sym = w.currency === 'USD' ? '$' : '₪';
                buttons.push([
                    { text: `🔴 خصم ${bareNum} ${sym} من ${w.name}`, callback_data: `tx:amt:expense:${w.id}:other_exp:${bareNum}` },
                    { text: `🟢 دخل ${bareNum} ${sym} في ${w.name}`, callback_data: `tx:amt:income:${w.id}:other_inc:${bareNum}` }
                ]);
            });
            buttons.push([{ text: '🔙 إلغاء', callback_data: 'nav:dashboard' }]);
            await sendTelegramMessage(botToken, chatId, promptText, { inline_keyboard: buttons });
            return;
        }

        // Default: Show dashboard
        const v = generateDashboardView(user, userState);
        await sendTelegramMessage(botToken, chatId, v.text, v.replyMarkup);
    }
}

// ─── Static Files Cache / Helper ──────────────────────────────────────────────

function readStatic(filename) {
    const candidates = [
        path.join(__dirname, 'public', filename),
        path.join(__dirname, '..', 'public', filename),
        path.join(process.cwd(), 'public', filename),
        path.join(process.cwd(), 'financial-tracker', 'public', filename)
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            return fs.readFileSync(p);
        }
    }
    return null;
}

// ─── Request Handler ──────────────────────────────────────────────────────────

loadDB();

const requestHandler = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    const parsedUrl = new URL(req.url, 'http://localhost');
    const pathFromQuery = parsedUrl.searchParams.get('_path');
    const pathFromHeader = req.headers['x-matched-path'] || req.headers['x-forwarded-uri'];
    const activePath = pathFromQuery || pathFromHeader || req.url;
    const rawUrl = activePath.split('?')[0];

    // ── Telegram Webhook Endpoint ─────────────────────────────────────────────
    if (rawUrl.includes('/telegram-webhook') && req.method === 'POST') {
        try {
            const update = await parseBody(req);
            await handleTelegramUpdate(update);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: true }));
        } catch (e) {
            console.error('Webhook processing error:', e.message);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: false, error: e.message }));
        }
    }

    // ── Static Frontend Serving ───────────────────────────────────────────────
    if (rawUrl === '/' || rawUrl === '/index.html') {
        const html = readStatic('index.html');
        if (html) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(html);
        }
    }

    if (rawUrl === '/app.js' || rawUrl.endsWith('/app.js')) {
        const js = readStatic('app.js');
        if (js) {
            res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
            return res.end(js);
        }
    }

    if (rawUrl === '/styles.css' || rawUrl.endsWith('/styles.css')) {
        const css = readStatic('styles.css');
        if (css) {
            res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
            return res.end(css);
        }
    }

    // ── Auth: Register ────────────────────────────────────────────────────────
    if (rawUrl.includes('/register') && req.method === 'POST') {
        try {
            const { username, password } = await parseBody(req);
            const cleanUser = (username || '').trim().toLowerCase();
            if (!cleanUser || !password || password.length < 4) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'اسم المستخدم وكلمة المرور (أقلها 4 أحرف) مطلوبة' }));
            }
            if (db.users.find(u => u.username.toLowerCase() === cleanUser)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'اسم المستخدم مسجل مسبقاً' }));
            }
            const userId = 'u_' + Date.now();
            const newUser = { id: userId, username: cleanUser, passwordHash: hashPassword(password), createdAt: new Date().toISOString() };
            db.users.push(newUser);
            db.userStates[userId] = JSON.parse(JSON.stringify(DEFAULT_USER_STATE));
            const token = generateToken();
            db.sessions[token] = userId;
            saveDB();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, token, userId, username: cleanUser }));
        } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'بيانات غير صالحة' }));
        }
    }

    // ── Auth: Login ───────────────────────────────────────────────────────────
    if (rawUrl.includes('/login') && req.method === 'POST') {
        try {
            const { username, password } = await parseBody(req);
            const cleanUser = (username || '').trim().toLowerCase();
            const passwordHash = hashPassword(password);
            const user = db.users.find(u => u.username.toLowerCase() === cleanUser && u.passwordHash === passwordHash);
            if (!user) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' }));
            }
            const token = generateToken();
            db.sessions[token] = user.id;
            saveDB();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, token, userId: user.id, username: user.username }));
        } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'بيانات غير صالحة' }));
        }
    }

    // ── Data API (GET / POST) ─────────────────────────────────────────────────
    if (rawUrl.includes('/data')) {
        const userId = getUserIdFromRequest(req);
        const targetUserId = userId || (db.users[0] ? db.users[0].id : null);
        if (!targetUserId) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'غير مصرح، يرجى تسجيل الدخول' }));
        }

        if (req.method === 'GET') {
            const userState = db.userStates[targetUserId] || JSON.parse(JSON.stringify(DEFAULT_USER_STATE));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(userState));
        }

        if (req.method === 'POST') {
            try {
                const parsed = await parseBody(req);
                const oldState = db.userStates[targetUserId] || {};
                const oldTransIds = new Set((oldState.transactions || []).map(t => t.id));
                const newTransactions = (parsed.transactions || []).filter(t => !oldTransIds.has(t.id));

                db.userStates[targetUserId] = parsed;
                saveDB();

                // Setup webhook if token changed
                if (parsed.telegramConfig && parsed.telegramConfig.botToken) {
                    setupTelegramWebhook(parsed.telegramConfig.botToken).catch(() => {});
                }

                const updatedWallets = calculateWalletBalances(parsed);

                if (newTransactions.length > 0 && parsed.telegramConfig && parsed.telegramConfig.enabled) {
                    for (const t of newTransactions) {
                        const wallet = updatedWallets.find(w => w.id === t.walletId);
                        const remBal = wallet ? wallet.currentBalance : undefined;
                        await notifyTelegramNewTransaction(parsed.telegramConfig, t, wallet, remBal);
                    }
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        }
    }

    // ── Telegram Test & Webhook Registration API ──────────────────────────────
    if (rawUrl.includes('/test-telegram') && req.method === 'POST') {
        try {
            const { botToken, chatId } = await parseBody(req);
            // Register webhook automatically
            await setupTelegramWebhook(botToken);

            // Send initial dashboard message with inline keyboards
            const user = db.users.find(u => u.id === (db.sessions[getUserIdFromRequest(req)] || 'u_default')) || db.users[0] || { username: 'yousef' };
            const uState = db.userStates[user.id] || DEFAULT_USER_STATE;
            const dash = generateDashboardView(user, uState);

            await sendTelegramMessage(botToken, chatId, dash.text, dash.replyMarkup);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true }));
        } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: e.message }));
        }
    }

    // Fallback: Serve index.html for any SPA navigation
    const html = readStatic('index.html');
    if (html) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
};

// Start local HTTP server if running outside Vercel
if (!process.env.VERCEL) {
    const server = http.createServer(requestHandler);
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}

// Export for Vercel Serverless
module.exports = requestHandler;
