const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let token = localStorage.getItem('lt-token'), me = null, timer, flash = '', toastT;

function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800); }
async function api(p, m = 'GET', b) {
  const r = await fetch('/api/' + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: b ? JSON.stringify(b) : undefined });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && token) { flash = d.error === 'Please log in' ? '' : d.error; logout(true); }
  if (!r.ok) throw new Error(d.error || 'Something went wrong');
  return d;
}
function logout(quiet) {
  if (token && !quiet) fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }).catch(() => {});
  localStorage.removeItem('lt-token'); token = null; me = null; boot();
}
const copy = async (t) => { try { await navigator.clipboard.writeText(t); toast('Link copied'); } catch { toast('Copy failed. Select the link and press Ctrl + C'); } };
const header = () => { $('#nav').innerHTML = `<button id="out" class="quiet small">Log out (${esc(me.name)})</button>`; $('#out').onclick = () => logout(); };

/* ---------- login / sign up ---------- */
function authView(reg) {
  $('#nav').innerHTML = '';
  $('#view').innerHTML = `<h1>Paste a link.<br>Share it short.<br>Watch who opens it.</h1>
  <form class="form" id="auth">
    <div id="err" class="error">${esc(flash)}</div>
    <label>Username<input class="f" name="username" autocomplete="username" required></label>
    <label>Password<input class="f" type="password" name="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required></label>
    <div class="actions"><button>${reg ? 'Create account' : 'Log in'}</button><button type="button" class="quiet" id="sw">${reg ? 'I have an account' : 'Create an account'}</button></div>
  </form>`;
  flash = '';
  $('#sw').onclick = () => authView(!reg);
  $('#auth').onsubmit = async (e) => {
    e.preventDefault();
    try { const d = await api(reg ? 'register' : 'login', 'POST', Object.fromEntries(new FormData(e.target))); token = d.token; localStorage.setItem('lt-token', token); boot(); }
    catch (x) { $('#err').textContent = x.message; }
  };
}

/* ---------- user: shorten links, see own clicks and visits ---------- */
function userView() {
  header();
  $('#view').innerHTML = `<section class="hero">
    <h1>Paste a link.<br>Share it short.<br>Watch who opens it.</h1>
    <div class="bar">
      <input id="urlInput" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="Paste your long link here (Ctrl + V)" aria-label="Long link" autofocus>
      <button id="pasteBtn" class="quiet" type="button">Paste</button>
      <button id="shortenBtn" type="button">Shorten</button>
    </div>
    <p id="error" class="error" role="alert"></p>
    <div id="result" class="result hidden"><div><small>Your short link</small><a id="shortLink" target="_blank" rel="noopener"></a></div><button id="copyBtn" class="quiet" type="button">Copy link</button></div>
  </section>
  <section class="ledger">
    <div class="ledger-head"><h2>Your links</h2><span class="cols"><span>Clicks</span><span>Visitors</span></span></div>
    <div id="links"></div>
    <p id="empty" class="empty">No links yet. Paste one above and it will show up here.</p>
  </section>`;
  const input = $('#urlInput');
  const shorten = async () => {
    $('#error').textContent = '';
    if (!input.value.trim()) return ($('#error').textContent = 'Paste a link first.');
    $('#shortenBtn').disabled = true;
    try {
      const d = await api('links', 'POST', { url: input.value });
      $('#shortLink').textContent = $('#shortLink').href = d.short;
      $('#result').classList.remove('hidden'); input.value = ''; loadLinks();
    } catch (x) { $('#error').textContent = x.message; }
    finally { $('#shortenBtn').disabled = false; }
  };
  $('#shortenBtn').onclick = shorten;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') shorten(); });
  $('#pasteBtn').onclick = async () => {
    try { const t = (await navigator.clipboard.readText()).trim(); if (!t) return toast('Your clipboard is empty'); input.value = t; input.focus(); }
    catch { input.focus(); toast('Allow clipboard access, or press Ctrl + V'); }
  };
  $('#copyBtn').onclick = () => copy($('#shortLink').href);
  $('#links').onclick = (e) => { const b = e.target.closest('[data-copy]'); if (b) copy(b.dataset.copy); };
  loadLinks(); clearInterval(timer); timer = setInterval(loadLinks, 5000);
}
async function loadLinks() {
  if (!$('#links')) return;
  const ls = await api('links');
  $('#empty').classList.toggle('hidden', ls.length > 0);
  $('#links').innerHTML = ls.map((l) => `<div class="row"><div class="info"><div class="s">${esc(l.short.replace(/^https?:\/\//, ''))}</div><div class="o">${esc(l.url)}</div></div>
    <button class="quiet small copy" data-copy="${esc(l.short)}">Copy</button><div class="nums"><span>${l.clicks}</span><span>${l.visits}</span></div></div>`).join('');
}

/* Small confirm dialog (replaces the browser's confirm box) */
function ask(title, text, ok, danger) {
  return new Promise((resolve) => {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dt"><h2 id="dt">${esc(title)}</h2><p>${esc(text)}</p>
      <div class="actions"><button type="button" class="quiet" data-r="0">Cancel</button><button type="button" class="${danger ? 'warn-btn' : ''}" data-r="1">${esc(ok)}</button></div></div>`;
    const prev = document.activeElement;
    const done = (v) => { document.removeEventListener('keydown', onKey); m.remove(); if (prev && prev.focus) prev.focus(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    m.addEventListener('click', (e) => { if (e.target === m) done(false); else if (e.target.dataset.r) done(e.target.dataset.r === '1'); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(m);
    m.querySelector('[data-r="0"]').focus();
  });
}

/* ---------- admin: users, links created, devices, block, delete ---------- */
function adminView() {
  header();
  $('#view').innerHTML = `<h1 class="s">Admin dashboard</h1><div id="adm"></div>`;
  $('#view').onclick = async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const n = b.dataset.name, act = b.dataset.act;
    try {
      if (act === 'delete') {
        if (!(await ask(`Delete ${n}?`, 'This permanently deletes the account and all of their links. This cannot be undone.', 'Delete account', true))) return;
        await api('admin/users/' + encodeURIComponent(n), 'DELETE'); toast('Account deleted');
      } else if (act === 'block') {
        if (!(await ask(`Block ${n}?`, 'They will be logged out and cannot log in until you unblock them. Their short links keep working.', 'Block user', true))) return;
        await api(`admin/users/${encodeURIComponent(n)}/block`, 'POST', { blocked: true }); toast('User blocked');
      } else {
        await api(`admin/users/${encodeURIComponent(n)}/block`, 'POST', { blocked: false }); toast('User unblocked');
      }
      loadAdmin();
    } catch (x) { toast(x.message); }
  };
  loadAdmin(); clearInterval(timer); timer = setInterval(loadAdmin, 8000);
}
async function loadAdmin() {
  if (!$('#adm')) return;
  const d = await api('admin/summary');
  $('#adm').innerHTML = `<div class="totals three"><div><b>${d.totalUsers}</b><small>users</small></div><div><b>${d.totalLinks}</b><small>links created</small></div><div><b>${d.totalClicks}</b><small>total clicks</small></div></div>
  <div class="scroll"><table><thead><tr><th>Username</th><th>Devices</th><th>Joined</th><th>Links</th><th>Clicks</th><th>Status</th><th></th></tr></thead><tbody>
  ${d.users.map((u) => `<tr><td>${esc(u.name)}</td><td>${u.devices.length ? u.devices.map(esc).join('<br>') : '-'}</td><td>${new Date(u.created).toLocaleDateString()}</td><td>${u.links}</td><td>${u.clicks}</td>
    <td>${u.blocked ? '<span class="badge disabled">Blocked</span>' : '<span class="badge">Active</span>'}</td>
    <td><div class="acts"><button class="quiet small" data-act="${u.blocked ? 'unblock' : 'block'}" data-name="${esc(u.name)}">${u.blocked ? 'Unblock' : 'Block'}</button><button class="quiet small danger" data-act="delete" data-name="${esc(u.name)}">Delete</button></div></td></tr>`).join('') || '<tr><td colspan="7" class="muted">No users have signed up yet.</td></tr>'}
  </tbody></table></div>`;
}

document.addEventListener('paste', (e) => {
  const i = $('#urlInput'); if (!i || document.activeElement === i) return;
  const t = ((e.clipboardData && e.clipboardData.getData('text')) || '').trim();
  if (t) { i.value = t; i.focus(); toast('Link pasted. Press Enter to shorten.'); }
});

async function boot() {
  clearInterval(timer);
  if (!token) return authView(false);
  try { me = await api('me'); me.role === 'admin' ? adminView() : userView(); } catch { if (!token) return; authView(false); }
}
boot();
