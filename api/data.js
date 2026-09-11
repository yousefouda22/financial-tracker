const {
    db,
    saveDB,
    loadDB,
    DEFAULT_USER_STATE,
    getUserIdFromRequest,
    calculateWalletBalances,
    parseBody,
    setCors
} = require('./_db');

module.exports = async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    loadDB();

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

    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
};
