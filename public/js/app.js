const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let token = localStorage.getItem('lp-token'), me = null, view = 'dash', openCode = null, draft = {}, step = 1, toastT;

function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2000); }
async function api(p, m = 'GET', b) {
  const r = await fetch('/api/' + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: b ? JSON.stringify(b) : undefined });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && token) { logout(); }
  if (!r.ok) { const e = new Error(d.error || 'Something went wrong'); e.data = d; throw e; }
  return d;
}
const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' h ago' : new Date(t).toLocaleDateString(); };
const badge = (s) => `<span class="badge ${s.split(' ')[0]}">${esc(s)}</span>`;
const chips = (a) => a.length ? `<div class="chips">${a.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : '<p class="muted">No data yet</p>';
const copy = async (t) => { try { await navigator.clipboard.writeText(t); toast('Link copied'); } catch { toast('Copy failed. Select the text and press Ctrl + C'); } };
const notes = (a, k) => a.map((x) => `<div class="note ${k}">${esc(x)}</div>`).join('');

function logout() { localStorage.removeItem('lp-token'); token = null; me = null; boot(); }
function go(v) { view = v; openCode = null; step = 1; render(); }

function nav() {
  const t = [['dash', 'Dashboard'], ['links', 'Links'], ['new', 'New link'], ['camp', 'Campaigns'], ['import', 'Import']];
  if (me.role === 'admin') t.push(['admin', 'Admin']);
  $('#nav').innerHTML = t.map(([k, n]) => `<button data-v="${k}" class="${view === k ? 'on' : ''}">${n}</button>`).join('') + `<button id="out">Log out (${esc(me.name)})</button>`;
  $('#nav').onclick = (e) => { if (e.target.id === 'out') logout(); else if (e.target.dataset.v) go(e.target.dataset.v); };
}

/* ---------- login ---------- */
function loginView(reg) {
  $('#nav').innerHTML = '';
  $('#view').innerHTML = `<h1>Short links that<br>report back.</h1>
  <form class="form" id="auth">
    <div id="err" class="error"></div>
    <label>Username<input class="f" name="username" autocomplete="username" required></label>
    <label>Password<input class="f" type="password" name="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required></label>
    <div class="actions"><button>${reg ? 'Create account' : 'Log in'}</button><button type="button" class="quiet" id="sw">${reg ? 'I have an account' : 'Create an account'}</button></div>
    ${reg ? '' : '<p class="muted">Demo user: demo / demo123. Admin: admin / admin123</p>'}
  </form>`;
  $('#sw').onclick = () => loginView(!reg);
  $('#auth').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { const d = await api(reg ? 'register' : 'login', 'POST', Object.fromEntries(f)); token = d.token; localStorage.setItem('lp-token', token); boot(); }
    catch (x) { $('#err').textContent = x.message; }
  };
}

/* ---------- views ---------- */
async function dashView() {
  const d = await api('dashboard'), max = Math.max(1, ...d.days.map((x) => x.n));
  $('#view').innerHTML = `<h1 class="s">Dashboard</h1>
  <div class="totals four"><div><b>${d.clicks}</b><small>real clicks</small></div><div><b>${d.visitors}</b><small>unique visitors</small></div><div><b>${d.links}</b><small>links</small></div><div><b>${d.active}</b><small>active now</small></div></div>
  <h3>Clicks in the last 7 days</h3><div class="days">${d.days.map((x) => `<div>${x.n}<i style="height:${(x.n / max) * 80}%"></i>${x.label}</div>`).join('')}</div>
  <h3>Top links</h3>${d.top.length ? d.top.map((l) => `<div class="row" data-open="${esc(l.code)}"><div class="info"><div class="s">/${esc(l.code)}</div><div class="o">${esc(l.url)}</div></div><div class="nums"><span>${l.clicks}</span></div></div>`).join('') : '<p class="empty">No links yet. Create your first one.</p>'}
  <h3>Alerts</h3>${d.alerts.length ? `<ul class="alerts">${d.alerts.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : '<p class="muted">Nothing needs attention.</p>'}`;
  $('#view').onclick = (e) => { const r = e.target.closest('[data-open]'); if (r) { view = 'links'; openCode = r.dataset.open; render(); } };
}

async function linksView() {
  const ls = await api('links');
  $('#view').innerHTML = `<h1 class="s">Links</h1>
  <div class="ledger-head"><h2>${ls.length} link${ls.length === 1 ? '' : 's'}</h2><span class="cols"><span>Clicks</span><span>Visitors</span></span></div>
  ${ls.map((l) => `<div class="row ${l.code === openCode ? 'active' : ''}" tabindex="0" data-open="${esc(l.code)}"><div class="info"><div class="s">${esc(l.short.replace(/^https?:\/\//, ''))}${badge(l.status)}${l.locked ? '<span class="badge">password</span>' : ''}</div><div class="o">${esc(l.url)}</div></div><div class="nums"><span>${l.clicks}</span><span>${l.visits}</span></div></div>`).join('') || '<p class="empty">No links yet. Use New link to create one.</p>'}
  <div id="detail"></div>`;
  $('#view').onclick = (e) => { const r = e.target.closest('[data-open]'); if (r) { openCode = r.dataset.open; render(); } };
  if (openCode) detail(openCode);
}

async function detail(code) {
  const s = await api('links/' + code), el = $('#detail');
  el.innerHTML = `<section class="stats">
    <div class="stats-head"><h2>/${esc(s.code)} ${badge(s.status)}</h2><button class="quiet small" id="x">Close</button></div>
    <p class="muted">${esc(s.url)}</p>
    <p class="muted">${[s.campaign && 'Campaign: ' + esc(s.campaign), s.tags.length && 'Tags: ' + esc(s.tags.join(', ')), s.expires && 'Expires ' + new Date(s.expires).toLocaleDateString(), s.maxClicks && 'Limit ' + s.maxClicks + ' clicks', me.role === 'admin' && 'Owner: ' + esc(s.owner)].filter(Boolean).join(' | ')}</p>
    <div class="totals"><div><b>${s.clicks}</b><small>clicks</small></div><div><b>${s.visits}</b><small>unique visitors</small></div><div><b>${s.qrScans}</b><small>QR scans</small></div></div>
    <div class="actions"><button class="quiet small" id="cp">Copy link</button><button class="quiet small" id="qr">QR code</button><button class="quiet small" id="tg">${s.status === 'disabled' ? 'Enable link' : 'Disable link'}</button></div>
    <div id="qrbox"></div>
    <div class="breakdown"><div><h3>Device</h3>${chips(s.devices)}</div><div><h3>Operating system</h3>${chips(s.os)}</div><div><h3>Browser</h3>${chips(s.browsers)}</div></div>
    <h3>Traffic sources</h3>${Object.keys(s.sources).length ? `<div class="chips">${Object.entries(s.sources).map(([k, v]) => `<span class="chip">${esc(k)}<b>${v}</b></span>`).join('')}</div>` : '<p class="muted">No data yet</p>'}
    <h3>Latest clicks</h3><div class="scroll"><table><thead><tr><th>When</th><th>Device</th><th>System</th><th>Browser</th><th>Came from</th></tr></thead><tbody>${s.recent.map((r) => `<tr><td>${ago(r.t)}</td><td>${esc(r.device)}</td><td>${esc(r.os)}</td><td>${esc(r.browser)}</td><td>${esc(r.ref)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nobody has opened this link yet.</td></tr>'}</tbody></table></div>
    <p class="muted" style="margin-top:12px">${s.botsFiltered} bot click(s) filtered out.</p></section>`;
  $('#x').onclick = () => { openCode = null; render(); };
  $('#cp').onclick = () => copy(s.short);
  $('#tg').onclick = async () => { await api(`links/${code}/status`, 'POST', { status: s.status === 'disabled' ? 'active' : 'disabled' }); toast('Link updated'); render(); };
  $('#qr').onclick = async () => { const q = await api(`links/${code}/qr`); $('#qrbox').innerHTML = `<div class="qr"><img src="${q.dataUrl}" alt="QR code"><a href="${q.dataUrl}" download="${esc(code)}-qr.png"><button class="quiet small" type="button">Download PNG</button></a></div>`; };
}

async function newView() {
  const camps = await api('campaigns');
  if (draft.done) { const l = draft.done; draft = {}; step = 1;
    $('#view').innerHTML = `<h1 class="s">Link created</h1>${notes(l.warnings || [], 'warn')}<div class="result"><div><small>Your short link</small><a href="${esc(l.short)}" target="_blank" rel="noopener">${esc(l.short)}</a></div><button class="quiet" id="cp">Copy link</button></div><div class="actions" style="margin-top:16px"><button id="see">View analytics</button><button class="quiet" id="again">Create another</button></div>`;
    $('#cp').onclick = () => copy(l.short); $('#again').onclick = () => go('new'); $('#see').onclick = () => { view = 'links'; openCode = l.code; render(); }; return; }
  if (step === 1) {
    $('#view').innerHTML = `<h1 class="s">New link</h1><form class="form" id="f1"><div id="msgs"></div>
      <label>Destination URL<input class="f" name="url" value="${esc(draft.url)}" placeholder="https://example.com/long-page" autocomplete="off" autofocus></label>
      <label>Custom alias <small>(optional, leave empty to auto-generate)</small><input class="f" name="alias" value="${esc(draft.alias)}" autocomplete="off"></label>
      <div class="actions"><button>Check and continue</button></div></form>`;
    $('#f1').onsubmit = async (e) => { e.preventDefault(); Object.assign(draft, Object.fromEntries(new FormData(e.target)));
      try { const v = await api('validate', 'POST', draft); if (v.errors.length) return ($('#msgs').innerHTML = notes(v.errors, 'bad')); draft.warnings = v.warnings; step = 2; render(); } catch (x) { $('#msgs').innerHTML = notes([x.message], 'bad'); } };
  } else {
    $('#view').innerHTML = `<h1 class="s">Link options</h1><form class="form" id="f2">${notes(draft.warnings || [], 'warn')}<div id="msgs"></div>
      <div class="note ok">${esc(draft.url)}${draft.alias ? ' as /' + esc(draft.alias) : ''}</div>
      <label>Campaign<select class="f" name="campaign"><option value="">None</option>${camps.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
      <label>Tags <small>(comma separated)</small><input class="f" name="tags" placeholder="sale, instagram"></label>
      <div class="two"><label>Expires on<input class="f" type="date" name="expires"></label><label>Click limit<input class="f" type="number" min="1" name="maxClicks" placeholder="No limit"></label></div>
      <label>Password <small>(optional)</small><input class="f" type="text" name="password" autocomplete="off"></label>
      <div class="actions"><button>Create link</button><button type="button" class="quiet" id="back">Back</button></div></form>`;
    $('#back').onclick = () => { step = 1; render(); };
    $('#f2').onsubmit = async (e) => { e.preventDefault(); const o = Object.fromEntries(new FormData(e.target));
      try { const l = await api('links', 'POST', { ...draft, ...o }); draft = { done: l }; render(); } catch (x) { $('#msgs').innerHTML = notes(x.data?.errors || [x.message], 'bad'); } };
  }
}

async function campView() {
  const cs = await api('campaigns');
  $('#view').innerHTML = `<h1 class="s">Campaigns</h1><form class="form" id="cf"><div id="msgs"></div><div class="two"><input class="f" name="name" placeholder="Campaign name" required><div class="actions"><button>Add campaign</button></div></div></form>
  <div class="block scroll"><table><thead><tr><th>Campaign</th><th>Links</th><th>Clicks</th><th>Top link</th></tr></thead><tbody>${cs.map((c) => `<tr><td>${esc(c.name)}</td><td>${c.links}</td><td>${c.clicks}</td><td>${c.top ? '/' + esc(c.top) : '-'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No campaigns yet. Add one above.</td></tr>'}</tbody></table></div>`;
  $('#cf').onsubmit = async (e) => { e.preventDefault(); try { await api('campaigns', 'POST', Object.fromEntries(new FormData(e.target))); toast('Campaign added'); render(); } catch (x) { $('#msgs').innerHTML = notes([x.message], 'bad'); } };
}

function importView() {
  $('#view').innerHTML = `<h1 class="s">Bulk import</h1><form class="form" id="im" style="max-width:640px"><div id="msgs"></div>
    <label>Upload a CSV file<input class="f" type="file" id="file" accept=".csv,.txt"></label>
    <label>Or paste rows <small>url, alias, campaign, tags (alias, campaign and tags are optional)</small><textarea class="f" name="csv" rows="6" placeholder="https://example.com/a,summer,Diwali Sale,sale;offer"></textarea></label>
    <div class="actions"><button>Import links</button></div></form><div id="res" class="block"></div>`;
  $('#file').onchange = async (e) => { if (e.target.files[0]) $('#im').csv.value = await e.target.files[0].text(); };
  $('#im').onsubmit = async (e) => { e.preventDefault();
    try { const r = await api('import', 'POST', { csv: e.target.csv.value }); const ok = r.filter((x) => x.status === 'imported').length;
      $('#res').innerHTML = `<div class="note ok">${ok} of ${r.length} row(s) imported.</div><div class="scroll"><table><thead><tr><th>Row</th><th>Result</th><th>Details</th></tr></thead><tbody>${r.map((x) => `<tr><td>${x.row}</td><td>${esc(x.status)}</td><td>${esc(x.short || x.message)}</td></tr>`).join('')}</tbody></table></div>`; }
    catch (x) { $('#msgs').innerHTML = notes([x.message], 'bad'); } };
}

async function adminView() {
  const bl = await api('blocklist');
  $('#view').innerHTML = `<h1 class="s">Admin</h1><h3>Domain blocklist</h3><p class="muted">New links to these domains are rejected. Existing links to them are disabled, and their analytics are kept.</p>
  <form class="form" id="bf" style="margin:12px 0"><div id="msgs"></div><div class="two"><input class="f" name="domain" placeholder="bad-site.com" required><div class="actions"><button>Block domain</button></div></div></form>
  <div class="chips">${bl.map((d) => `<span class="chip">${esc(d)} <b data-del="${esc(d)}" style="cursor:pointer" title="Remove">x</b></span>`).join('') || '<p class="muted">No blocked domains.</p>'}</div>
  <p class="muted block">To disable one link, open it under Links (you see every user's links) and press Disable link.</p>`;
  $('#bf').onsubmit = async (e) => { e.preventDefault(); try { await api('blocklist', 'POST', Object.fromEntries(new FormData(e.target))); toast('Domain blocked'); render(); } catch (x) { $('#msgs').innerHTML = notes([x.message], 'bad'); } };
  $('#view').onclick = async (e) => { if (e.target.dataset.del) { await api('blocklist/' + encodeURIComponent(e.target.dataset.del), 'DELETE'); render(); } };
}

const views = { dash: dashView, links: linksView, new: newView, camp: campView, import: importView, admin: adminView };
async function render() { nav(); try { await views[view](); } catch (x) { if (token) $('#view').innerHTML = `<div class="note bad">${esc(x.message)}</div>`; } }
async function boot() { if (!token) return loginView(false); try { me = await api('me'); render(); } catch { loginView(false); } }

document.addEventListener('paste', (e) => { const i = $('input[name="url"]'); if (!i || document.activeElement === i) return; const t = (e.clipboardData?.getData('text') || '').trim(); if (t) { i.value = t; i.focus(); toast('Link pasted'); } });
setInterval(() => { if (me && (view === 'dash' || view === 'links') && !document.querySelector('.stats')) render(); }, 8000);
boot();
