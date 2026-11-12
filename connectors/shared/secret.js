// Общая проверка секрета вебхука.
// amoCRM и СДЭК не умеют добавлять свои заголовки, поэтому секрет передаётся в адресе:
// https://домен/webhook/amo?secret=...  В nginx для этих адресов журнал запросов отключён.
const crypto = require('crypto');

function requireSecret(name) {
    const secret = process.env[name];
    if (!secret) {
        if (process.env.NODE_ENV === 'production') {
            console.error(`${name} не задан: коннектор не запускается без секрета вебхука`);
            process.exit(1);
        }
        console.warn(`${name} не задан: проверка секрета отключена (допустимо только при разработке)`);
    }
    return (req, res, next) => {
        if (!secret) return next();
        const got = String(req.headers['x-webhook-secret'] || req.query.secret || '');
        const a = Buffer.from(got);
        const b = Buffer.from(secret);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        next();
    };
}

module.exports = { requireSecret };
