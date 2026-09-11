/**
 * Vercel Serverless API Handler
 * Handles all /api/* routes for the Financial Tracker
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Helper to reliably find and read static files on Vercel
function getStaticFile(filename) {
    const candidatePaths = [
        path.join(__dirname, '../public', filename),
        path.join(__dirname, 'public', filename),
        path.join(process.cwd(), 'public', filename),
        path.join(process.cwd(), 'financial-tracker', 'public', filename),
        path.join(__dirname, '..', filename)
    ];
    for (const p of candidatePaths) {
        try {
            if (fs.existsSync(p)) {
                return fs.readFileSync(p);
            }
        } catch (e) {}
    }
    return null;
}

// In Vercel, use /tmp for writable storage
const DATA_FILE = '/tmp/financial_tracker_data.json';

// ─── Helpers ────────────────────────────────────────────────────────────────

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
            db = parsed;
            if (!db.users) db.users = [];
            if (!db.sessions) db.sessions = {};
            if (!db.userStates) db.userStates = {};
            return;
        }
    } catch (e) {
        console.error('DB load error:', e.message);
    }
    // Initialize with default admin user
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
        const qs = (req.url.split('?')[1] || '');
        token = new URLSearchParams(qs).get('token') || '';
    }
    return token && db.sessions[token] ? db.sessions[token] : null;
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

// ─── Telegram ────────────────────────────────────────────────────────────────

function callTelegramApi(botToken, method, payload) {
    return new Promise((resolve, reject) => {
        const dataStr = JSON.stringify(payload);
        const options = {
            hostname: 'api.telegram.org',
            port: 443,
            path: `/bot${botToken}/${method}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dataStr) }
        };
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const p = JSON.parse(body);
                    if (p.ok) resolve(p.result); else reject(new Error(p.description || 'Telegram API Error'));
                } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.write(dataStr);
        req.end();
    });
}

const MAIN_KEYBOARD = {
    keyboard: [
        [{ text: '📊 الرصيد الإجمالي' }, { text: '💳 أرصدة المحافظ' }],
        [{ text: '🗓️ كم صرفت الشهر هاد' }, { text: '📈 كم دخلت الشهر هاد' }],
        [{ text: '🤝 الديون والتزاماتي' }, { text: '❓ تعليمات وإضافة سريع' }]
    ],
    resize_keyboard: true,
    persistent: true
};

function sendTelegramMessage(botToken, chatId, text, replyMarkup = null) {
    const payload = { chat_id: chatId, text, parse_mode: 'HTML' };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    return callTelegramApi(botToken, 'sendMessage', payload);
}

function notifyTelegramNewTransaction(telegramConfig, transaction, wallet, updatedBalance) {
    if (!telegramConfig?.enabled || !telegramConfig?.botToken || !telegramConfig?.chatId) return;
    const isExpense = transaction.type === 'expense';
    const symbol = transaction.currency === 'USD' ? '$' : '₪';
    const msg = `${isExpense ? '🚨 <b>عملية خصم جديدة</b>' : '🎉 <b>عملية دخل جديدة</b>'}\n\n💰 <b>المبلغ:</b> ${isExpense ? '-' : '+'}${transaction.amount} ${symbol}\n🏦 <b>المحفظة:</b> ${wallet ? wallet.name : 'غير محدد'}${updatedBalance !== undefined ? `\n💳 <b>الرصيد الجديد:</b> ${updatedBalance.toFixed(2)} ${symbol}` : ''}`;
    sendTelegramMessage(telegramConfig.botToken, telegramConfig.chatId, msg, MAIN_KEYBOARD)
        .catch(err => console.error('Telegram notify error:', err.message));
}

// ─── Body Parser Helper ──────────────────────────────────────────────────────

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
        req.on('error', reject);
    });
}

// ─── Main Handler ────────────────────────────────────────────────────────────

loadDB();

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = new URL(req.url, 'http://localhost');
    const qPath = (req.query && req.query._orig_path) || parsedUrl.searchParams.get('_orig_path');
    const rawPath = qPath || req.headers['x-forwarded-uri'] || req.headers['x-vercel-matched-path'] || req.headers['x-matched-path'] || req.headers['x-invoke-path'] || req.url || '';
    const url = rawPath.split('?')[0];

    if (req.url.includes('debug') || url.includes('debug')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            reqUrl: req.url,
            query: req.query,
            qPath,
            rawPath,
            url,
            headers: req.headers
        }, null, 2));
    }

    // ── Static Files Serving ──────────────────────────────────────────────────
    if (url === '/' || url === '/index.html') {
        const content = getStaticFile('index.html');
        if (content) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(content);
        }
    }

    if (url === '/app.js' || url.endsWith('/app.js')) {
        const content = getStaticFile('app.js');
        if (content) {
            res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
            return res.end(content);
        }
    }

    if (url === '/styles.css' || url.endsWith('/styles.css')) {
        const content = getStaticFile('styles.css');
        if (content) {
            res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
            return res.end(content);
        }
    }
    if (url === '/api/register' && req.method === 'POST') {
        try {
            const { username, password } = await parseBody(req);
            const cleanUser = (username || '').trim().toLowerCase();
            if (!cleanUser || !password || password.length < 4) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'اسم المستخدم وكلمة المرور (أقلها 4 أحرف) مطلوبة' }));
            }
            if (db.users.find(u => u.username.toLowerCase() === cleanUser)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'اسم المستخدم هذا مسجل مسبقاً' }));
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

    // ── Login ─────────────────────────────────────────────────────────────────
    if (url === '/api/login' && req.method === 'POST') {
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

    // ── Data GET/POST ─────────────────────────────────────────────────────────
    if (url === '/api/data' || url.startsWith('/api/data?')) {
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
                const updatedWallets = calculateWalletBalances(parsed);
                if (newTransactions.length > 0 && parsed.telegramConfig?.enabled) {
                    newTransactions.forEach(t => {
                        const wallet = updatedWallets.find(w => w.id === t.walletId);
                        notifyTelegramNewTransaction(parsed.telegramConfig, t, wallet, wallet?.currentBalance);
                    });
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        }
    }

    // ── Test Telegram ─────────────────────────────────────────────────────────
    if (url === '/api/test-telegram' && req.method === 'POST') {
        try {
            const { botToken, chatId } = await parseBody(req);
            const testMsg = `🔔 <b>إشعار تجريبي من موقع محفظتي المالية!</b>\n\nتم تفعيل البوت التفاعلي الذكي بنجاح!\n• <code>خصم 50 بنك فلسطين</code>\n• <code>شحن 100 بايننس</code>`;
            await sendTelegramMessage(botToken, chatId, testMsg, MAIN_KEYBOARD);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true }));
        } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: e.message }));
        }
    }

    // ── 404 ───────────────────────────────────────────────────────────────────
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'API route not found' }));
};
