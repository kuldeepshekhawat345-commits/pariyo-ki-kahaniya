const express = require('express'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const app = express(), PORT = process.env.PORT || 3000, DB = path.join(__dirname, 'data', 'linktrack.json');
app.set('trust proxy', true);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- storage: kept in memory, written to disk every 2 seconds ---------- */
let db, dirty = false;
const save = () => { dirty = true; };
const flush = () => { if (!dirty) return; dirty = false; fs.mkdirSync(path.dirname(DB), { recursive: true }); fs.writeFileSync(DB, JSON.stringify(db)); };
setInterval(flush, 2000);
['SIGTERM', 'SIGINT'].forEach((s) => process.on(s, () => { flush(); process.exit(); }));
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const hash = (pw, salt = crypto.randomBytes(8).toString('hex')) => ({ salt, hash: crypto.scryptSync(pw, salt, 32).toString('hex') });
const pwOk = (pw, h) => crypto.timingSafeEqual(Buffer.from(hash(pw, h.salt).hash), Buffer.from(h.hash));

try { db = JSON.parse(fs.readFileSync(DB, 'utf8')); }
catch { db = { users: { admin: { role: 'admin', created: Date.now(), devices: [], ...hash(process.env.ADMIN_PASSWORD || 'admin123') } }, sessions: {}, links: {} }; save(); }

/* ---------- helpers ---------- */
function deviceOf(req) {
  const ua = req.get('user-agent') || '';
  const d = /tablet|ipad/i.test(ua) ? 'Tablet' : /mobi|android|iphone/i.test(ua) ? 'Mobile' : 'Desktop';
  const os = /windows/i.test(ua) ? 'Windows' : /android/i.test(ua) ? 'Android' : /iphone|ipad|ios/i.test(ua) ? 'iOS' : /mac os/i.test(ua) ? 'macOS' : /linux/i.test(ua) ? 'Linux' : 'Unknown OS';
  const br = /edg\//i.test(ua) ? 'Edge' : /opr\/|opera/i.test(ua) ? 'Opera' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'Unknown browser';
  return `${d} (${os}, ${br})`;
}
const base = (r) => `${r.protocol}://${r.get('host')}`;
const clean = (v) => String(v || '').trim().toLowerCase();

const auth = (role) => (req, res, next) => {
  const t = (req.get('authorization') || '').slice(7);
  const name = has(db.sessions, t) ? db.sessions[t] : null;
  const u = name && has(db.users, name) ? db.users[name] : null;
  if (!u) return res.status(401).json({ error: 'Please log in' });
  if (u.blocked) return res.status(401).json({ error: 'This account has been blocked by the admin' });
  if (role && u.role !== role) return res.status(403).json({ error: 'Admins only' });
  req.user = { name, role: u.role };
  next();
};
function startSession(req, res, name) {
  const u = db.users[name];
  const dv = deviceOf(req);
  u.devices = u.devices || [];
  if (!u.devices.includes(dv)) u.devices = [...u.devices, dv].slice(-5);
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = name; save();
  res.json({ token, name, role: u.role });
}

/* ---------- accounts ---------- */
app.post('/api/register', (req, res) => {
  const name = clean(req.body.username), pw = String(req.body.password || '');
  if (!/^[a-z0-9_]{3,20}$/.test(name) || pw.length < 6) return res.status(400).json({ error: 'Username: 3 to 20 letters, numbers or _. Password: at least 6 characters.' });
  if (has(db.users, name)) return res.status(400).json({ error: 'This username is already taken' });
  db.users[name] = { role: 'user', created: Date.now(), devices: [], ...hash(pw) };
  startSession(req, res, name);
});
app.post('/api/login', (req, res) => {
  const name = clean(req.body.username), u = has(db.users, name) ? db.users[name] : null;
  if (!u || !pwOk(String(req.body.password || ''), u)) return res.status(401).json({ error: 'Wrong username or password' });
  if (u.blocked) return res.status(401).json({ error: 'This account has been blocked by the admin' });
  startSession(req, res, name);
});
app.get('/api/me', auth(), (req, res) => res.json(req.user));
app.post('/api/logout', auth(), (req, res) => { delete db.sessions[(req.get('authorization') || '').slice(7)]; save(); res.json({ ok: true }); });

/* ---------- user: own links only ---------- */
app.post('/api/links', auth('user'), (req, res) => {
  let url = String(req.body.url || '').trim(), u;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { u = new URL(url); if (!u.hostname.includes('.')) throw 0; } catch { return res.status(400).json({ error: 'Enter a valid link, for example https://example.com' }); }
  if (u.host === req.get('host')) return res.status(400).json({ error: 'You cannot shorten a link to this site' });
  let code; do { code = crypto.randomBytes(5).toString('base64url').slice(0, 6); } while (has(db.links, code));
  db.links[code] = { code, url: u.href, owner: req.user.name, created: Date.now(), clicks: 0, vids: [] };
  save();
  res.json({ code, short: `${base(req)}/${code}` });
});
app.get('/api/links', auth('user'), (req, res) => res.json(
  Object.values(db.links).filter((l) => l.owner === req.user.name).sort((a, b) => b.created - a.created)
    .map((l) => ({ code: l.code, short: `${base(req)}/${l.code}`, url: l.url, clicks: l.clicks, visits: l.vids.length }))
));

/* ---------- admin ---------- */
app.get('/api/admin/summary', auth('admin'), (req, res) => {
  const users = Object.entries(db.users).filter(([, u]) => u.role === 'user').map(([name, u]) => {
    const ls = Object.values(db.links).filter((l) => l.owner === name);
    return { name, created: u.created, devices: u.devices || [], blocked: !!u.blocked, links: ls.length, clicks: ls.reduce((a, l) => a + l.clicks, 0) };
  }).sort((a, b) => b.created - a.created);
  res.json({ users, totalUsers: users.length, totalLinks: users.reduce((a, u) => a + u.links, 0), totalClicks: users.reduce((a, u) => a + u.clicks, 0) });
});
const target = (req, res) => {
  const n = req.params.name;
  if (!has(db.users, n) || db.users[n].role !== 'user') { res.status(404).json({ error: 'User not found' }); return null; }
  return n;
};
const dropSessions = (n) => Object.entries(db.sessions).forEach(([t, v]) => { if (v === n) delete db.sessions[t]; });
app.post('/api/admin/users/:name/block', auth('admin'), (req, res) => {
  const n = target(req, res); if (!n) return;
  db.users[n].blocked = !!req.body.blocked;
  if (db.users[n].blocked) dropSessions(n);
  save(); res.json({ blocked: db.users[n].blocked });
});
app.delete('/api/admin/users/:name', auth('admin'), (req, res) => {
  const n = target(req, res); if (!n) return;
  Object.values(db.links).filter((l) => l.owner === n).forEach((l) => delete db.links[l.code]);
  dropSessions(n); delete db.users[n];
  save(); res.json({ deleted: n });
});

/* ---------- redirect + tracking ---------- */
app.get('/:code([A-Za-z0-9_-]{3,30})', (req, res) => {
  const l = has(db.links, req.params.code) ? db.links[req.params.code] : null;
  if (!l) return res.status(404).send('<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><body style="font-family:system-ui;max-width:420px;margin:15vh auto;padding:0 20px"><h2>Link not found</h2>');
  const vid = crypto.createHash('sha256').update(req.ip + (req.get('user-agent') || '')).digest('hex').slice(0, 12);
  l.clicks++;
  if (!l.vids.includes(vid)) l.vids.push(vid);
  save();
  res.redirect(l.url);
});

app.listen(PORT, () => console.log(`LinkTrack is running at http://localhost:${PORT}`));
