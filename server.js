/**
 * Financial Tracker - Universal Server & Vercel Serverless Entrypoint
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const DATA_FILE = process.env.VERCEL ? '/tmp/financial_tracker_data.json' : path.join(__dirname, 'data.json');

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
                // Migrate single-user format
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

// ─── Telegram Alerts ──────────────────────────────────────────────────────────

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

function sendTelegramMessage(botToken, chatId, text) {
    return callTelegramApi(botToken, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
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

    const rawUrl = req.url.split('?')[0];

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
                db.userStates[targetUserId] = parsed;
                saveDB();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        }
    }

    // ── Telegram Test ─────────────────────────────────────────────────────────
    if (rawUrl.includes('/test-telegram') && req.method === 'POST') {
        try {
            const { botToken, chatId } = await parseBody(req);
            await sendTelegramMessage(botToken, chatId, '🔔 <b>تم تفعيل بوت محفظتي المالية بنجاح!</b>');
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
