const {
    db,
    saveDB,
    loadDB,
    hashPassword,
    generateToken,
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
};
