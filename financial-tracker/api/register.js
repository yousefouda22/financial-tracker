const {
    db,
    saveDB,
    loadDB,
    hashPassword,
    generateToken,
    DEFAULT_USER_STATE,
    parseBody,
    setCors
} = require('./_db');

module.exports = async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    }

    loadDB();

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
};
