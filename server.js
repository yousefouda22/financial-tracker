/**
 * Financial Tracker Multi-User Server with Authentication & Telegram Bot
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const DATA_FILE = path.join(__dirname, 'data.json');

// Password Hashing Helper
function hashPassword(password) {
    return crypto.createHash('sha256').update(password + 'salt_financial_tracker_v2').digest('hex');
}

// Token Generator Helper
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Initial Data Structure
const DEFAULT_USER_STATE = {
    wallets: [
        { id: 'w1', name: 'بنك فلسطين', currency: 'ILS', initialBalance: 1500, icon: 'fa-building-columns' },
        { id: 'w2', name: 'كاش / محفظة شخصية', currency: 'ILS', initialBalance: 300, icon: 'fa-wallet' },
        { id: 'w3', name: 'حساب الدولار (بنك/بايبال)', currency: 'USD', initialBalance: 250, icon: 'fa-vault' }
    ],
    transactions: [],
    debts: [],
    telegramConfig: {
        botToken: '',
        chatId: '',
        enabled: false
    }
};

// Global Store Structure: { users: [], sessions: {}, userStates: {} }
let db = {
    users: [],
    sessions: {},
    userStates: {}
};

// Load or Migrate Database
function loadDB() {
    if (!fs.existsSync(DATA_FILE)) {
        // Create initial default admin user
        const defaultUserId = 'u_default';
        const defaultHash = hashPassword('123456');
        db.users.push({ id: defaultUserId, username: 'yousef', passwordHash: defaultHash, createdAt: new Date().toISOString() });
        db.userStates[defaultUserId] = JSON.parse(JSON.stringify(DEFAULT_USER_STATE));
        saveDB();
        return;
    }

    try {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        const parsed = JSON.parse(raw);

        // Check if old format (single user) and migrate seamlessly
        if (parsed && (parsed.wallets || parsed.transactions)) {
            console.log('Migrating single-user data.json to Multi-User database format...');
            const defaultUserId = 'u_default';
            const defaultHash = hashPassword('123456');
            
            db.users = [{ id: defaultUserId, username: 'yousef', passwordHash: defaultHash, createdAt: new Date().toISOString() }];
            db.sessions = {};
            db.userStates = {};
            db.userStates[defaultUserId] = {
                wallets: parsed.wallets || [],
                transactions: parsed.transactions || [],
                debts: parsed.debts || [],
                telegramConfig: parsed.telegramConfig || { botToken: '', chatId: '', enabled: false }
            };
            saveDB();
        } else {
            db = parsed;
            if (!db.users) db.users = [];
            if (!db.sessions) db.sessions = {};
            if (!db.userStates) db.userStates = {};
        }
    } catch (e) {
        console.error('Error loading database, resetting to default:', e);
        saveDB();
    }
}

function saveDB() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}

loadDB();

// Helper to authenticate request token
function getUserIdFromRequest(req) {
    const authHeader = req.headers['authorization'] || '';
    let token = '';
    if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7).trim();
    }
    if (!token) {
        // Check URL parameter or header fallback
        const urlParams = new URLSearchParams(req.url.split('?')[1] || '');
        token = urlParams.get('token') || '';
    }

    if (token && db.sessions && db.sessions[token]) {
        return db.sessions[token];
    }
    return null;
}

// Calculate Balances for a specific user state
function calculateWalletBalances(userState) {
    const wallets = userState.wallets || [];
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

// Telegram HTTPS API Request Helper
function callTelegramApi(botToken, method, payload) {
    return new Promise((resolve, reject) => {
        if (!botToken) return reject(new Error('Bot token missing'));

        const dataStr = JSON.stringify(payload);
        const options = {
            hostname: 'api.telegram.org',
            port: 443,
            path: `/bot${botToken}/${method}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(dataStr)
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    if (parsed.ok) resolve(parsed.result);
                    else reject(new Error(parsed.description || 'Telegram API Error'));
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', reject);
        req.write(dataStr);
        req.end();
    });
}

function sendTelegramMessage(botToken, chatId, text, replyMarkup = null) {
    const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML'
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    return callTelegramApi(botToken, 'sendMessage', payload);
}

function editTelegramMessage(botToken, chatId, messageId, text, replyMarkup = null) {
    const payload = {
        chat_id: chatId,
        message_id: messageId,
        text: text,
        parse_mode: 'HTML'
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    return callTelegramApi(botToken, 'editMessageText', payload);
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

const CAT_NAMES = {
    food: 'طعام ومأكولات 🍔',
    bills: 'فواتير واشتراكات 🧾',
    shopping: 'تسوق وأغراض 🛍️',
    transport: 'مواصلات وبنزين 🚗',
    health: 'صحة وعلاج 🏥',
    home: 'البيت والمستلزمات 🏠',
    salary: 'راتب شهري 💵',
    other_exp: 'مصاريف أخرى 📦',
    other_inc: 'دخل آخر 🪙'
};

function notifyTelegramNewTransaction(telegramConfig, transaction, wallet, updatedBalance) {
    if (!telegramConfig || !telegramConfig.enabled || !telegramConfig.botToken || !telegramConfig.chatId) {
        return;
    }

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

    sendTelegramMessage(telegramConfig.botToken, telegramConfig.chatId, message, MAIN_KEYBOARD)
        .then(() => console.log('Telegram alert sent successfully for web transaction:', transaction.id))
        .catch(err => console.error('Telegram notification error:', err.message));
}

// Find matching user by Telegram Chat ID
function findUserByTelegramChatId(chatId) {
    for (const user of db.users) {
        const uState = db.userStates[user.id];
        if (uState && uState.telegramConfig && uState.telegramConfig.enabled && String(uState.telegramConfig.chatId) === String(chatId)) {
            return { user, state: uState };
        }
    }

    // Fallback: If only one user has matching botToken, use that user
    for (const user of db.users) {
        const uState = db.userStates[user.id];
        if (uState && uState.telegramConfig && uState.telegramConfig.enabled) {
            return { user, state: uState };
        }
    }
    return null;
}

// Find best matching wallet by name from user text
function findMatchingWallet(wallets, userText, requestedCurrency = null) {
    const textLower = userText.toLowerCase();

    for (const wallet of wallets) {
        const wName = wallet.name.toLowerCase();
        if (textLower.includes(wName)) {
            return wallet;
        }
    }

    for (const wallet of wallets) {
        const parts = wallet.name.toLowerCase().split(/\s+/);
        for (const part of parts) {
            if (part.length > 2 && textLower.includes(part)) {
                return wallet;
            }
        }
    }

    if (requestedCurrency) {
        const matchCurr = wallets.find(w => w.currency === requestedCurrency);
        if (matchCurr) return matchCurr;
    }

    return null;
}

function buildWalletInlineKeyboard(wallets, actionType, amount, currency, note) {
    const buttons = [];
    wallets.forEach(w => {
        const symbol = w.currency === 'USD' ? '$' : '₪';
        const label = `🏦 ${w.name} (${w.currentBalance.toFixed(2)} ${symbol})`;
        const payload = `act:${actionType}:${amount}:${w.currency}:${w.id}`;
        buttons.push([{ text: label, callback_data: payload }]);
    });
    return { inline_keyboard: buttons };
}

// Telegram Message Processing
async function handleTelegramMessage(msg) {
    const chatId = msg.chat.id;
    const matched = findUserByTelegramChatId(chatId);
    if (!matched) {
        console.warn(`No user found matching Telegram Chat ID: ${chatId}`);
        return;
    }

    const { user, state: userState } = matched;
    const config = userState.telegramConfig;
    const botToken = config.botToken;
    const text = (msg.text || '').trim();

    console.log(`Received Telegram message from user [${user.username}] (${chatId}): ${text}`);

    if (text === '/start' || text === '/help' || text === 'القائمة' || text === '❓ تعليمات وإضافة سريع') {
        const welcomeText = `👋 <b>أهلاً بك يا ${user.username} في بوت محفظتي المالية!</b>

حسابك مرتبط ومحمي بنجاح! استخدم الأزرار بالأسفل أو ارسل أمراً سريعاً:

<b>طرق الخصم الشائعة ("خصم / شريت"):</b>
• <code>خصم 50 بنك فلسطين</code>
• <code>شريت 20 بايننس تسوق</code>

<b>طرق الإضافة والشحن ("دخل / شحن / إضافة"):</b>
• <code>شحن 500 جوال باي</code>
• <code>إضافة 100 ترست والت</code>`;
        await sendTelegramMessage(botToken, chatId, welcomeText, MAIN_KEYBOARD);
        return;
    }

    if (text === '📊 الرصيد الإجمالي' || text === '/balance' || text === 'الرصيد') {
        const wallets = calculateWalletBalances(userState);
        let totalIls = 0, totalUsd = 0;
        wallets.forEach(w => {
            if (w.currency === 'ILS') totalIls += w.currentBalance;
            if (w.currency === 'USD') totalUsd += w.currentBalance;
        });

        const reply = `💰 <b>ملخص الرصيد المجموع الإجمالي لحساب (${user.username}):</b>

🇵🇸 <b>إجمالي الشيكل:</b> ${totalIls.toLocaleString('en-US', {minimumFractionDigits: 2})} ₪
🇺🇸 <b>إجمالي الدولار:</b> $${totalUsd.toLocaleString('en-US', {minimumFractionDigits: 2})}

إجمالي المحافظ المفتوحة: ${wallets.length} حسابات.`;
        await sendTelegramMessage(botToken, chatId, reply, MAIN_KEYBOARD);
        return;
    }

    if (text === '💳 أرصدة المحافظ' || text === '/wallets') {
        const wallets = calculateWalletBalances(userState);
        let reply = `💳 <b>تفاصيل أقصى رصيد لكل محفظة/بنك [${user.username}]:</b>\n\n`;
        wallets.forEach(w => {
            const symbol = w.currency === 'USD' ? '$' : '₪';
            reply += `• <b>${w.name}:</b> ${w.currentBalance.toLocaleString('en-US', {minimumFractionDigits: 2})} ${symbol}\n`;
        });
        await sendTelegramMessage(botToken, chatId, reply, MAIN_KEYBOARD);
        return;
    }

    if (text === '🗓️ كم صرفت الشهر هاد' || text === '/spent') {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth();
        let ilsExp = 0, usdExp = 0;

        (userState.transactions || []).forEach(t => {
            const d = new Date(t.date);
            if (d.getFullYear() === y && d.getMonth() === m && t.type === 'expense') {
                if (t.currency === 'ILS') ilsExp += parseFloat(t.amount);
                if (t.currency === 'USD') usdExp += parseFloat(t.amount);
            }
        });

        const reply = `📉 <b>مصاريفك للشهر الحالي (${m + 1}/${y}):</b>

🇵🇸 <b>صرفت بالشيكل:</b> ${ilsExp.toLocaleString('en-US', {minimumFractionDigits: 2})} ₪
🇺🇸 <b>صرفت بالدولار:</b> $${usdExp.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
        await sendTelegramMessage(botToken, chatId, reply, MAIN_KEYBOARD);
        return;
    }

    if (text === '📈 كم دخلت الشهر هاد' || text === '/income') {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth();
        let ilsInc = 0, usdInc = 0;

        (userState.transactions || []).forEach(t => {
            const d = new Date(t.date);
            if (d.getFullYear() === y && d.getMonth() === m && t.type === 'income') {
                if (t.currency === 'ILS') ilsInc += parseFloat(t.amount);
                if (t.currency === 'USD') usdInc += parseFloat(t.amount);
            }
        });

        const reply = `📈 <b>مدخولاتك للشهر الحالي (${m + 1}/${y}):</b>

🇵🇸 <b>دخلت بالشيكل:</b> ${ilsInc.toLocaleString('en-US', {minimumFractionDigits: 2})} ₪
🇺🇸 <b>دخلت بالدولار:</b> $${usdInc.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
        await sendTelegramMessage(botToken, chatId, reply, MAIN_KEYBOARD);
        return;
    }

    if (text === '🤝 الديون والتزاماتي' || text === '/debts') {
        let recIls = 0, recUsd = 0;
        let payIls = 0, payUsd = 0;

        (userState.debts || []).forEach(d => {
            const rem = parseFloat(d.amount) - parseFloat(d.settledAmount || 0);
            if (rem > 0) {
                if (d.type === 'receivable') {
                    if (d.currency === 'ILS') recIls += rem;
                    if (d.currency === 'USD') recUsd += rem;
                } else {
                    if (d.currency === 'ILS') payIls += rem;
                    if (d.currency === 'USD') payUsd += rem;
                }
            }
        });

        const reply = `🤝 <b>ملخص الديون والتزاماتك المالية [${user.username}]:</b>

🟢 <b>ديون لك (يطالب بها الآخرين):</b>
• ${recIls.toFixed(2)} ₪ | $${recUsd.toFixed(2)}

🔴 <b>ديون عليك (متوجبة للغير):</b>
• ${payIls.toFixed(2)} ₪ | $${payUsd.toFixed(2)}`;
        await sendTelegramMessage(botToken, chatId, reply, MAIN_KEYBOARD);
        return;
    }

    // Dynamic Expense & Income parsing
    const expRegex = /^(خصم|شريت|مصروف)\s+([\d\.]+)\s*(دولار|شيكل)?\s*(.*)$/i;
    const incRegex = /^(إضافة|شحن|دخل|اضافة)\s+([\d\.]+)\s*(دولار|شيكل)?\s*(.*)$/i;

    let matchExp = text.match(expRegex);
    let matchInc = text.match(incRegex);

    if (matchExp || matchInc) {
        const isExp = !!matchExp;
        const match = matchExp || matchInc;
        const amount = parseFloat(match[2]);
        const currencyInput = (match[3] || '').trim();
        let remainingText = (match[4] || '').trim();

        let currency = null;
        if (currencyInput.includes('دولار') || text.includes('$')) currency = 'USD';
        else if (currencyInput.includes('شيكل') || text.includes('₪')) currency = 'ILS';

        const wallets = calculateWalletBalances(userState);
        if (wallets.length === 0) {
            await sendTelegramMessage(botToken, chatId, '⚠️ لا توجد لديك أي محفظة مضافة بالموقع!', MAIN_KEYBOARD);
            return;
        }

        const matchedWallet = findMatchingWallet(wallets, remainingText, currency);

        if (matchedWallet) {
            let note = remainingText;
            if (matchedWallet.name) {
                const re = new RegExp(matchedWallet.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                note = note.replace(re, '').trim();
            }
            if (!note) note = isExp ? 'عملية خصم من التليجرام' : 'عملية دخل من التليجرام';

            const newTrans = {
                id: 't_' + Date.now(),
                type: isExp ? 'expense' : 'income',
                walletId: matchedWallet.id,
                amount: amount,
                currency: matchedWallet.currency,
                category: isExp ? 'other_exp' : 'other_inc',
                note: note,
                date: new Date().toISOString()
            };

            if (!userState.transactions) userState.transactions = [];
            userState.transactions.push(newTrans);
            saveDB();

            const updatedWallets = calculateWalletBalances(userState);
            const updatedWallet = updatedWallets.find(w => w.id === matchedWallet.id);
            const symbol = matchedWallet.currency === 'USD' ? '$' : '₪';

            const reply = `${isExp ? '💸 <b>تم قيد الخصم بنجاح!</b>' : '💳 <b>تم قيد الشحن/الدخل بنجاح!</b>'}

▫️ <b>المبلغ:</b> ${isExp ? '-' : '+'}${amount} ${symbol}
🏦 <b>المحفظة:</b> ${matchedWallet.name}
📝 <b>الملاحظة:</b> ${note}

💳 <b>الرصيد الجديد بالمحفظة:</b> ${updatedWallet.currentBalance.toFixed(2)} ${symbol}`;

            await sendTelegramMessage(botToken, chatId, reply, MAIN_KEYBOARD);
            return;
        } else {
            const actionType = isExp ? 'exp' : 'inc';
            const inlineMarkup = buildWalletInlineKeyboard(wallets, actionType, amount, currency || 'ILS', remainingText);
            const promptText = `🤔 <b>اختر المحفظة أو البنك لتحديد الخصم/الشحن بقيمة ${amount} ${currency === 'USD' ? '$' : '₪'}:</b>`;
            await sendTelegramMessage(botToken, chatId, promptText, inlineMarkup);
            return;
        }
    }

    await sendTelegramMessage(botToken, chatId, `❓ لم أفهم الأمر بالتحديد.\nيمكنك كتابة:\n• <code>خصم 50 بنك فلسطين</code>\n• <code>شحن 100 بايننس</code>\n• أو استخدم القائمة بالأسفل:`, MAIN_KEYBOARD);
}

// Handle Callback Queries (Inline Button Clicks)
async function handleTelegramCallback(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const matched = findUserByTelegramChatId(chatId);
    if (!matched) return;

    const { user, state: userState } = matched;
    const botToken = userState.telegramConfig.botToken;
    const messageId = callbackQuery.message.message_id;
    const payload = callbackQuery.data;

    if (payload.startsWith('act:')) {
        const parts = payload.split(':');
        const actionType = parts[1];
        const amount = parseFloat(parts[2]);
        const currency = parts[3];
        const walletId = parts[4];

        const isExp = actionType === 'exp';
        const wallets = calculateWalletBalances(userState);
        const wallet = wallets.find(w => w.id === walletId);

        if (!wallet) {
            await callTelegramApi(botToken, 'answerCallbackQuery', { callback_query_id: callbackQuery.id, text: 'المحفظة غير موجودة!' });
            return;
        }

        const newTrans = {
            id: 't_' + Date.now(),
            type: isExp ? 'expense' : 'income',
            walletId: wallet.id,
            amount: amount,
            currency: wallet.currency,
            category: isExp ? 'other_exp' : 'other_inc',
            note: isExp ? 'خصم عبر اختيار المحفظة' : 'شحن عبر اختيار المحفظة',
            date: new Date().toISOString()
        };

        if (!userState.transactions) userState.transactions = [];
        userState.transactions.push(newTrans);
        saveDB();

        const updatedWallets = calculateWalletBalances(userState);
        const updatedWallet = updatedWallets.find(w => w.id === wallet.id);
        const symbol = wallet.currency === 'USD' ? '$' : '₪';

        await callTelegramApi(botToken, 'answerCallbackQuery', { callback_query_id: callbackQuery.id, text: 'تمت العملية بنجاح!' });

        const confirmText = `${isExp ? '💸 <b>تم قيد الخصم بنجاح!</b>' : '💳 <b>تم قيد الشحن/الدخل بنجاح!</b>'}

▫️ <b>المبلغ:</b> ${isExp ? '-' : '+'}${amount} ${symbol}
🏦 <b>المحفظة:</b> ${wallet.name}

💳 <b>الرصيد الجديد بالمحفظة:</b> ${updatedWallet.currentBalance.toFixed(2)} ${symbol}`;

        await editTelegramMessage(botToken, chatId, messageId, confirmText, null);
    }
}

// Telegram Long Polling Loop
let lastUpdateId = 0;
async function pollTelegramUpdates() {
    // Collect active bot tokens
    const activeTokens = new Set();
    for (const uId of Object.keys(db.userStates)) {
        const cfg = db.userStates[uId]?.telegramConfig;
        if (cfg && cfg.enabled && cfg.botToken) {
            activeTokens.add(cfg.botToken);
        }
    }

    for (const botToken of activeTokens) {
        try {
            const updates = await callTelegramApi(botToken, 'getUpdates', {
                offset: lastUpdateId + 1,
                timeout: 5
            });

            if (Array.isArray(updates)) {
                for (const update of updates) {
                    lastUpdateId = update.update_id;
                    if (update.message) {
                        await handleTelegramMessage(update.message);
                    } else if (update.callback_query) {
                        await handleTelegramCallback(update.callback_query);
                    }
                }
            }
        } catch (e) {
            // Ignore polling errors
        }
    }

    setTimeout(pollTelegramUpdates, 2000);
}

pollTelegramUpdates();

// MIME Types
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
};

// HTTP Server
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // AUTH API: REGISTER
    if (req.url === '/api/register' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { username, password } = JSON.parse(body);
                const cleanUser = (username || '').trim().toLowerCase();

                if (!cleanUser || !password || password.length < 4) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'اسم المستخدم وكلمة المرور (أقلها 4 أحرف) مطلوبة' }));
                    return;
                }

                const existing = db.users.find(u => u.username.toLowerCase() === cleanUser);
                if (existing) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'اسم المستخدم هذا مسجل مسبقاً، اختر اسماً آخر' }));
                    return;
                }

                const userId = 'u_' + Date.now();
                const passwordHash = hashPassword(password);
                const newUser = { id: userId, username: cleanUser, passwordHash, createdAt: new Date().toISOString() };
                
                db.users.push(newUser);
                db.userStates[userId] = JSON.parse(JSON.stringify(DEFAULT_USER_STATE));

                const token = generateToken();
                db.sessions[token] = userId;
                saveDB();

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, token, userId, username: cleanUser }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'بيانات غير صالحة' }));
            }
        });
        return;
    }

    // AUTH API: LOGIN
    if (req.url === '/api/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { username, password } = JSON.parse(body);
                const cleanUser = (username || '').trim().toLowerCase();
                const passwordHash = hashPassword(password);

                const user = db.users.find(u => u.username.toLowerCase() === cleanUser && u.passwordHash === passwordHash);
                if (!user) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' }));
                    return;
                }

                const token = generateToken();
                db.sessions[token] = user.id;
                saveDB();

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, token, userId: user.id, username: user.username }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'بيانات غير صالحة' }));
            }
        });
        return;
    }

    // USER DATA API: GET & POST
    if (req.url.startsWith('/api/data')) {
        const userId = getUserIdFromRequest(req);

        // Fallback for single admin user if no token passed
        const targetUserId = userId || (db.users[0] ? db.users[0].id : null);

        if (!targetUserId) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'غير مصرح، يرجى تسجيل الدخول أولاً' }));
            return;
        }

        if (req.method === 'GET') {
            const userState = db.userStates[targetUserId] || JSON.parse(JSON.stringify(DEFAULT_USER_STATE));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(userState));
            return;
        } else if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    const oldState = db.userStates[targetUserId] || {};
                    const oldTransIds = new Set((oldState.transactions || []).map(t => t.id));
                    const newTransactions = (parsed.transactions || []).filter(t => !oldTransIds.has(t.id));

                    db.userStates[targetUserId] = parsed;
                    saveDB();

                    const updatedWallets = calculateWalletBalances(parsed);

                    if (newTransactions.length > 0 && parsed.telegramConfig && parsed.telegramConfig.enabled) {
                        newTransactions.forEach(t => {
                            const wallet = updatedWallets.find(w => w.id === t.walletId);
                            const remBal = wallet ? wallet.currentBalance : undefined;
                            notifyTelegramNewTransaction(parsed.telegramConfig, t, wallet, remBal);
                        });
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: 'Data saved successfully' }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid JSON format' }));
                }
            });
            return;
        }
    }

    // TELEGRAM TEST API
    if (req.url === '/api/test-telegram' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { botToken, chatId } = JSON.parse(body);
                const testMsg = `🔔 <b>إشعار تجريبي من موقع محفظتي المالية!</b>\n\nتم تفعيل البوت التفاعلي الذكي بنجاح! يمكنك الآن كتابة:\n• <code>خصم 50 بنك فلسطين</code>\n• <code>شحن 100 بايننس</code>\n• أو كتابة المبلغ فقط لتظهر لك أزرار الاختيار!`;
                sendTelegramMessage(botToken, chatId, testMsg, MAIN_KEYBOARD)
                    .then(() => {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    })
                    .catch(err => {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, error: err.message }));
                    });
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
            }
        });
        return;
    }

    // STATIC FILE SERVING
    let reqUrl = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    let filePath = path.join(__dirname, reqUrl);

    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    });
});

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

server.listen(PORT, '0.0.0.0', () => {
    const localIp = getLocalIp();
    console.log(`\n==================================================`);
    console.log(`🚀 Multi-User Financial Tracker Server is running!`);
    console.log(`💻 On your PC open:      http://localhost:${PORT}`);
    console.log(`📱 On your Mobile open:  http://${localIp}:${PORT}`);
    console.log(`==================================================\n`);
});
