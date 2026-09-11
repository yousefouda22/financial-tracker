const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const DATA_FILE = '/tmp/financial_tracker_data.json';

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
            db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
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
        console.warn('DB save warning:', e.message);
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
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

loadDB();

module.exports = {
    db,
    saveDB,
    loadDB,
    hashPassword,
    generateToken,
    DEFAULT_USER_STATE,
    getUserIdFromRequest,
    calculateWalletBalances,
    parseBody,
    setCors
};
