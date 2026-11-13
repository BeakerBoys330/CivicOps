'use strict';
// CivicOps dashboard. Scraped job data is untrusted, so everything shown passes through esc().
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : ''; } catch { return ''; } };
const link = (u, text, cls = '') => (safeUrl(u) ? `<a class="${cls}" href="${esc(safeUrl(u))}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(text));

const S = {
  view: location.hash.slice(1) || 'jobs', state: null, jobs: [], employers: [], ai: null, task: null,
  jf: { q: '', levels: new Set(), sort: 'best', onlyMatches: true, closingSoon: false, shown: 100 }, ef: { coverage: 'all', q: '' }, bench: {},
};
window.addEventListener('hashchange', () => {
  S.view = location.hash.slice(1) || 'jobs';
  if (!$('#drawerWrap').hidden) closeJob(); // a drawer left open would cover the page you just moved to
  render();
  $('#main').scrollIntoView();
});

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { code: data.code });
  return data;
}
function toast(msg, ok = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = `toast${ok ? ' ok' : ''}`; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ok ? 3500 : 9000);
}
const attempt = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message); } };

// Long jobs run on the server. The page polls one at a time and refreshes when it ends.
async function runTask(path, body, onDone) {
  let task;
  try { task = await api(path, body); } catch (e) { return toast(e.message); }
  S.task = task; showTask();
  const poll = async () => {
    try { task = await api(`/api/task/${task.id}`); } catch (e) { S.task = null; showTask(); return toast(e.message); }
    S.task = task; showTask();
    if (task.state === 'running') return setTimeout(poll, 900);
    S.task = null; showTask();
    if (task.state === 'failed') { toast(task.error); return; }
    await refresh();
    onDone?.(task.result);
  };
  setTimeout(poll, 500);
}
function showTask() {
  const b = $('#taskBar');
  if (!S.task) { b.hidden = true; return; }
  b.hidden = false;
  b.innerHTML = `<span class="spin" aria-hidden="true"></span><span>${esc(S.task.name)}: ${esc(S.task.message)}</span>`;
  $$('[data-task]').forEach((x) => { x.disabled = true; });
}

async function refresh() {
  const [state, jobs, employers] = await Promise.all([api('/api/state'), api('/api/jobs'), api('/api/employers')]);
  Object.assign(S, { state, jobs, employers });
  render();
  if (S.open) renderDrawer();
}

// ---------- Shared formatting ----------

const LEVELS = () => S.state.levels;
function pay(j) {
  if (j.salaryMin == null && j.salaryMax == null) return '<span class="muted">Not listed</span>';
  const f = (n) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${(+n).toFixed(2).replace(/\.00$/, '')}`);
  const unit = { hour: '/hr', year: '/yr', month: '/mo', week: '/wk', biweekly: '/2wk', day: '/day' }[j.salaryInterval] ?? '';
  return `<span class="nowrap num">${f(j.salaryMin ?? j.salaryMax)}${j.salaryMax && j.salaryMax !== j.salaryMin ? `–${f(j.salaryMax)}` : ''}${unit}</span>`;
}
function daysUntil(d) { return Math.round((new Date(`${d}T12:00:00`) - new Date(`${S.state.today}T12:00:00`)) / 86400000); }
/** "Nov 20", or "Oct 13, 2027" when the year is not this one (federal postings can stay open a year). */
function shortDate(d) {
  const year = d.slice(0, 4) === S.state.today.slice(0, 4) ? {} : { year: 'numeric' };
  return new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...year });
}
function closes(j) {
  if (!j.closes) return '<span class="muted">Not listed</span>';
  const n = daysUntil(j.closes);
  const label = shortDate(j.closes);
  if (n < 0) return `<span class="muted">Closed ${esc(label)}</span>`;
  if (n <= 3) return `<span class="tag bad nowrap">${n === 0 ? 'Today' : `${n}d left`}</span>`;
  if (n <= 10) return `<span class="tag warn nowrap">${esc(label)}</span>`;
  return `<span class="nowrap">${esc(label)}</span>`;
}
function scoreBadge(j) {
  const v = j.evaluation?.score ?? j.triage?.score;
  if (v == null) return j.embedScore != null ? `<span class="score none num" title="Similarity to your resume">${Math.round(j.embedScore * 100)}%</span>` : '<span class="score none">–</span>';
  const cls = v >= 4 ? 'hi' : v >= 3 ? 'mid' : 'lo';
  return `<span class="score ${cls}" title="${j.evaluation ? 'Full evaluation' : `Quick triage: ${esc(j.triage.reason)}`}">${(+v).toFixed(1)}</span>`;
}
const dist = (j) => (j.remote && j.distanceMi == null ? 'Remote' : j.distanceMi == null ? '<span class="muted" title="Location could not be mapped">?</span>' : `${Math.round(j.distanceMi)} mi`);

// ---------- Jobs ----------

function filteredJobs() {
  const f = S.jf;
  const q = f.q.trim().toLowerCase();
  let list = S.jobs.filter((j) => j.open && (!f.onlyMatches || j.matches));
  const counts = {};
  for (const j of list) counts[j.level] = (counts[j.level] ?? 0) + 1;
  if (f.levels.size) list = list.filter((j) => f.levels.has(j.level));
  if (q) list = list.filter((j) => `${j.title} ${j.employer} ${j.location}`.toLowerCase().includes(q));
  if (f.closingSoon) list = list.filter((j) => j.closes && daysUntil(j.closes) <= 10);
  const rank = (j) => j.evaluation?.score ?? j.triage?.score ?? (j.embedScore != null ? j.embedScore * 3 : -1);
  const sorters = {
    best: (a, b) => rank(b) - rank(a) || (a.distanceMi ?? 9999) - (b.distanceMi ?? 9999),
    newest: (a, b) => (b.posted ?? b.firstSeen ?? '').localeCompare(a.posted ?? a.firstSeen ?? ''),
    closing: (a, b) => (a.closes ?? '9999').localeCompare(b.closes ?? '9999'),
    distance: (a, b) => (a.distanceMi ?? 9999) - (b.distanceMi ?? 9999),
    pay: (a, b) => (b.annualPay ?? -1) - (a.annualPay ?? -1),
  };
  return { list: list.sort(sorters[f.sort]), counts };
}

const hasAiModel = () => Object.values(S.state.config.ai.roles).some((r) => r.provider && r.model);
/** "today", "yesterday" or "Nov 9" for a YYYY-MM-DD date. */
function dayLabel(d) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(d ?? '')) return d ?? '';
  const n = -daysUntil(d.slice(0, 10));
  if (n === 0) return 'today';
  if (n === 1) return 'yesterday';
  return shortDate(d);
}

// First run: the three steps that get jobs on the screen. The next one to do is highlighted.
function firstRun() {
  const loc = S.state.config.location;
  const hasEmployers = S.employers.length > 0;
  const steps = [
    { done: !!loc.label, title: 'Say where you want to work', detail: loc.label ? `${loc.label}, within ${loc.radiusMiles} miles` : 'A ZIP code or city, and how far you would travel.',
      action: '<a class="btn sm primary" href="#setup">Set location</a>' },
    { done: hasEmployers, title: 'Find government employers in range', detail: hasEmployers ? `${S.employers.length} employers found` : 'Federal, state, county, city, township and school employers. Takes a minute or two.',
      action: `<button class="btn sm primary" data-task data-act="discover">Find employers</button>`, wait: 'After step 1' },
    { done: false, title: 'Scan for jobs', detail: 'Reads every job page that allows it. The first scan takes a few minutes.',
      action: `<button class="btn sm primary" data-task data-act="scan">Scan now</button>`, wait: 'After step 2' },
  ];
  const next = steps.findIndex((x) => !x.done);
  return `<div class="start">
    <p>CivicOps finds open government jobs near you and keeps them in one list. Three steps get you there.</p>
    <ol class="steps">${steps.map((x, i) => `<li class="${x.done ? 'done' : i === next ? 'next' : ''}"><span class="n">${x.done ? '✓' : i + 1}</span><span class="body"><strong>${esc(x.title)}</strong><br><span class="muted small">${esc(x.detail)}</span></span>${x.done ? '' : i === next ? x.action : `<span class="muted small">${esc(x.wait)}</span>`}</li>`).join('')}</ol>
    <p class="muted small" style="margin-top:14px">Later, add your resume and connect an AI model to have each posting scored against your experience. Everything stays on this computer.</p>
  </div>`;
}

// Once jobs are on the screen, the optional AI steps shrink to one line.
function aiNudge() {
  const todo = [];
  if (!S.state.hasCv) todo.push('<a href="#setup">Add your resume</a>');
  if (!hasAiModel()) todo.push('<a href="#ai">Connect an AI model</a>');
  if (!todo.length) return '';
  return `<div class="nudge"><span><strong>Want each job scored against your experience?</strong></span><span>${todo.join(' and ')}.</span></div>`;
}

function renderJobs() {
  const f = S.jf;
  if (!S.jobs.length) {
    $('#main').innerHTML = `<div class="head"><div><h1>Jobs</h1></div>${S.employers.length ? '<div class="actions"><button class="btn" data-act="add">Add a posting</button></div>' : ''}</div>${firstRun()}`;
    return;
  }
  const { list, counts } = filteredJobs();
  const lv = LEVELS();
  const linkOnly = S.employers.filter((e) => e.coverage === 'link-only' && e.level !== 'federal' && !e.lastCount).length;
  const canRank = hasAiModel() && S.state.hasCv;
  const last = S.state.meta.lastScan;
  $('#main').innerHTML = `
    <div class="head"><div><h1>Jobs</h1><p class="muted small" style="margin:3px 0 0">${list.length} open${f.onlyMatches ? ' matching your search' : ''}${last ? `. Last scanned ${esc(dayLabel(last))}` : ''}</p></div>
      <div class="actions">
        <button class="btn" data-task data-act="triage" ${canRank ? 'title="Scores the newest 25 postings against your resume"' : `disabled title="${S.state.hasCv ? 'Connect an AI model first' : 'Add your resume in Setup first'}"`}>Rank with AI</button>
        <button class="btn" data-act="add" title="Paste a posting from a board CivicOps cannot read">Add a posting</button>
        <button class="btn primary" data-task data-act="scan" ${S.employers.length ? '' : 'disabled title="Find employers first"'}>Scan now</button>
      </div></div>
    ${aiNudge()}
    ${linkOnly ? `<div class="notice"><strong>${linkOnly} employer boards have to be checked by hand.</strong> They block automated tools, so their jobs are not in this list. <a href="#employers" data-goto-linkonly>See the checklist</a>.</div>` : ''}
    <div class="filters">
      <input type="search" id="jq" placeholder="Search title, employer, place" aria-label="Search jobs" value="${esc(f.q)}">
      <select id="jsort" aria-label="Sort">
        ${[['best', 'Best match'], ['newest', 'Newest'], ['closing', 'Closing soonest'], ['distance', 'Nearest'], ['pay', 'Highest pay']].map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <label class="check" style="margin:0"><input type="checkbox" id="jm" ${f.onlyMatches ? 'checked' : ''}> My search only</label>
      <label class="check" style="margin:0"><input type="checkbox" id="jc" ${f.closingSoon ? 'checked' : ''}> Closing in 10 days</label>
    </div>
    <div class="chips" style="margin-bottom:12px">${Object.keys(lv).filter((k) => counts[k]).map((k) => `<button class="chip" data-level="${k}" aria-pressed="${f.levels.has(k)}">${esc(lv[k])}<span class="ct">${counts[k]}</span></button>`).join('')}</div>
    <div class="table-wrap"><table><thead><tr><th>Fit</th><th>Job</th><th class="hide-sm">Level</th><th class="r">Distance</th><th>Pay</th><th>Closes</th><th class="hide-sm">Status</th></tr></thead><tbody>
    ${list.slice(0, f.shown).map((j) => `<tr class="row" data-job="${esc(j.id)}">
      <td>${scoreBadge(j)}</td>
      <td><button class="t-title" data-job="${esc(j.id)}">${esc(j.title)}</button>${j.confidence === 'low' ? ' <span class="tag warn" title="Read from links on a web page. Check the posting.">unverified</span>' : ''}<br><span class="muted small">${esc(j.employer)}${j.grade ? ` · ${esc(j.grade)}` : ''}</span></td>
      <td class="hide-sm"><span class="tag">${esc(lv[j.level] ?? j.level)}</span></td>
      <td class="r num nowrap">${dist(j)}</td><td>${pay(j)}</td><td>${closes(j)}</td>
      <td class="hide-sm small">${j.status === 'New' ? '<span class="muted">New</span>' : esc(j.status)}</td></tr>`).join('')}
    ${list.length ? '' : `<tr><td colspan="7" class="empty">${f.onlyMatches && !f.q && !f.levels.size && !f.closingSoon ? 'No open jobs match the title words and pay in Setup. Clear "My search only" to see everything that was found.' : 'No jobs match these filters.'}</td></tr>`}
    </tbody></table></div>
    ${list.length > f.shown ? `<p style="margin-top:12px;text-align:center"><button class="btn" id="more">Show more (${list.length - f.shown} left)</button></p>` : ''}`;
  $('#jq').addEventListener('input', (e) => { f.q = e.target.value; f.shown = 100; rerenderKeepFocus('#jq'); });
  $('#jsort').addEventListener('change', (e) => { f.sort = e.target.value; renderJobs(); });
  $('#jm').addEventListener('change', (e) => { f.onlyMatches = e.target.checked; renderJobs(); });
  $('#jc').addEventListener('change', (e) => { f.closingSoon = e.target.checked; renderJobs(); });
  $('#more')?.addEventListener('click', () => { f.shown += 200; renderJobs(); });
  $$('.chip[data-level]').forEach((c) => c.addEventListener('click', () => { const v = c.dataset.level; if (f.levels.has(v)) f.levels.delete(v); else f.levels.add(v); renderJobs(); }));
  $('[data-goto-linkonly]')?.addEventListener('click', () => { S.ef.coverage = 'link-only'; });
}
function rerenderKeepFocus(sel) {
  const el = $(sel); const pos = el.selectionStart;
  renderJobs();
  const n = $(sel); n.focus(); n.setSelectionRange(pos, pos);
}

// ---------- Employers ----------

const COVERAGE = {
  scannable: { label: 'Read automatically', tag: 'good', help: 'CivicOps reads these every scan.' },
  'link-only': { label: 'Check by hand', tag: 'warn', help: 'These boards block automated tools or need a real browser. Open each one, then use Add a posting for jobs you like.' },
  blocked: { label: 'Site blocks tools', tag: 'warn', help: 'The website has a bot check or asks tools not to read it. CivicOps does not work around that.' },
  'no-jobs-page': { label: 'No jobs page found', tag: '', help: 'The site was reached, but no jobs page was recognized. If you find one, paste its address here.' },
  'no-website': { label: 'No website found', tag: '', help: 'No official website was found. Many small townships have none. If you know it, add it here.' },
  unreachable: { label: 'Site unreachable', tag: 'bad', help: 'The registered site did not respond. It may be down or no longer in use.' },
  'not-probed': { label: 'Not checked yet', tag: '', help: 'Run Find employers again to check these.' },
};

function renderEmployers() {
  const f = S.ef;
  const counts = {};
  for (const e of S.employers) counts[e.coverage] = (counts[e.coverage] ?? 0) + 1;
  const q = f.q.toLowerCase();
  const rows = S.employers.filter((e) => (f.coverage === 'all' || e.coverage === f.coverage) && (!q || e.name.toLowerCase().includes(q)));
  $('#main').innerHTML = `
    <div class="head"><div><h1>Employers</h1><p class="muted small" style="margin:3px 0 0">${S.employers.length ? `${S.employers.length} government employers within ${esc(S.state.config.location.radiusMiles)} miles of ${esc(S.state.config.location.label || 'your location')}` : 'Every government that hires in your area, and how well its job page can be read.'}</p></div>
      <div class="actions"><button class="btn" data-act="pasteList">Paste a job list</button><button class="btn" data-act="addBoard">Add an employer</button><button class="btn primary" data-task data-act="discover" ${S.state.config.location.label ? '' : 'disabled title="Set your location in Setup first"'}>${S.employers.length ? 'Find employers again' : 'Find employers'}</button></div></div>
    <div class="stats">
      <button class="stat" data-cov="all" aria-pressed="${f.coverage === 'all'}"><b>${S.employers.length}</b><span>All employers</span></button>
      ${Object.keys(COVERAGE).filter((k) => counts[k]).map((k) => `<button class="stat" data-cov="${k}" aria-pressed="${f.coverage === k}"><b>${counts[k]}</b><span>${esc(COVERAGE[k].label)}</span></button>`).join('')}
    </div>
    ${f.coverage !== 'all' && COVERAGE[f.coverage] ? `<div class="notice info">${esc(COVERAGE[f.coverage].help)}</div>` : ''}
    <div class="filters"><input type="search" id="eq" placeholder="Search employers" aria-label="Search employers" value="${esc(f.q)}"></div>
    <div class="table-wrap"><table><thead><tr><th>Employer</th><th class="hide-sm">Level</th><th class="r">Distance</th><th>Coverage</th><th class="hide-sm">Hiring system</th><th>Last result</th><th></th></tr></thead><tbody>
    ${rows.slice(0, 400).map((e) => {
      const cov = COVERAGE[e.coverage] ?? { label: e.coverage, tag: '' };
      const manual = e.coverage === 'link-only' || e.coverage === 'blocked' || e.coverage === 'no-jobs-page';
      const needs = e.coverage === 'no-website' || e.coverage === 'unreachable';
      return `<tr><td><strong>${esc(e.name)}</strong>${e.careersUrl || e.website ? `<br>${link(e.careersUrl || e.website, 'Open jobs page', 'small')}` : ''}</td>
      <td class="hide-sm"><span class="tag">${esc(LEVELS()[e.level] ?? e.level)}</span></td>
      <td class="r num nowrap">${e.distanceMi == null ? '–' : `${Math.round(e.distanceMi)} mi`}</td>
      <td><span class="tag ${cov.tag}">${esc(cov.label)}</span></td>
      <td class="hide-sm small">${esc(e.ats ?? '–')}</td>
      <td class="small">${esc(e.lastResult ?? (e.checkedAt ? `Checked ${e.checkedAt}` : '–'))}${e.lastResult && e.checkedAt ? `<br><span class="muted">Checked ${esc(e.checkedAt)}</span>` : ''}</td>
      <td class="nowrap">${manual ? `<button class="btn sm" data-pastefor="${esc(e.id)}">Paste list</button> <button class="btn sm" data-checked="${esc(e.id)}">Checked today</button> ` : ''}${needs ? `<button class="btn sm" data-site="${esc(e.id)}">Add website</button>` : manual ? `<button class="btn sm" data-careers="${esc(e.id)}">Set jobs page</button>` : ''}</td></tr>`;
    }).join('')}
    ${rows.length ? '' : `<tr><td colspan="7" class="empty">${S.employers.length ? 'No employers match this view.' : S.state.config.location.label ? 'No employers listed yet. Choose Find employers to list the governments in range.' : 'Set your location in <a href="#setup">Setup</a>, then choose Find employers.'}</td></tr>`}
    </tbody></table></div>`;
  $$('.stat').forEach((b) => b.addEventListener('click', () => { f.coverage = b.dataset.cov; renderEmployers(); }));
  $('#eq').addEventListener('input', (e) => { f.q = e.target.value; const p = e.target.selectionStart; renderEmployers(); const n = $('#eq'); n.focus(); n.setSelectionRange(p, p); });
  $$('[data-pastefor]').forEach((b) => b.addEventListener('click', () => pasteListForm(S.employers.find((x) => x.id === b.dataset.pastefor))));
  $$('[data-checked]').forEach((b) => b.addEventListener('click', attempt(async () => { await api('/api/employer', { id: b.dataset.checked, checked: true }); await refresh(); })));
  $$('[data-site]').forEach((b) => b.addEventListener('click', attempt(async () => {
    const v = prompt('Official website address (https://...)'); if (!v) return;
    await api('/api/employer', { id: b.dataset.site, website: v }); await refresh();
  })));
  $$('[data-careers]').forEach((b) => b.addEventListener('click', attempt(async () => {
    const v = prompt('Jobs page address (https://...)'); if (!v) return;
    await api('/api/employer', { id: b.dataset.careers, careersUrl: v }); await refresh();
  })));
}

// ---------- Tracker ----------

function renderTracker() {
  const active = S.jobs.filter((j) => !['New', 'Skipped'].includes(j.status));
  const order = S.state.statuses;
  const deadlines = active.filter((j) => j.closes && daysUntil(j.closes) >= 0 && !['Applied', 'Referred', 'Exam', 'Interview', 'Eligible list', 'Offer', 'Hired', 'Rejected', 'Withdrawn', 'Closed'].includes(j.status)).sort((a, b) => a.closes.localeCompare(b.closes));
  const follow = active.filter((j) => j.followUp && daysUntil(j.followUp) <= 7).sort((a, b) => a.followUp.localeCompare(b.followUp));
  $('#main').innerHTML = `
    <div class="head"><div><h1>Tracker</h1><p class="muted small" style="margin:3px 0 0">Government hiring is slow, so note where each application stands. A copy is kept in data/applications.md.</p></div></div>
    ${deadlines.length ? `<div class="card"><h2>Upcoming deadlines</h2>${deadlines.slice(0, 8).map((j) => `<div style="display:flex;gap:10px;align-items:center;padding:3px 0">${closes(j)} <button class="t-title" data-job="${esc(j.id)}">${esc(j.title)}</button> <span class="muted small">${esc(j.employer)}</span></div>`).join('')}</div>` : ''}
    ${follow.length ? `<div class="card"><h2>Follow up this week</h2>${follow.map((j) => `<div style="padding:3px 0"><span class="num small">${esc(j.followUp)}</span> <button class="t-title" data-job="${esc(j.id)}">${esc(j.title)}</button></div>`).join('')}</div>` : ''}
    ${active.length ? order.filter((st) => active.some((j) => j.status === st)).map((st) => {
      const rows = active.filter((j) => j.status === st);
      return `<h2 style="margin-top:18px">${esc(st)} <span class="muted num">${rows.length}</span></h2><div class="table-wrap"><table><tbody>${rows.map((j) => `<tr class="row" data-job="${esc(j.id)}"><td style="width:50px">${scoreBadge(j)}</td><td><button class="t-title" data-job="${esc(j.id)}">${esc(j.title)}</button><br><span class="muted small">${esc(j.employer)}</span></td><td class="small nowrap">${j.appliedOn ? `Applied ${esc(j.appliedOn)}` : closes(j)}</td></tr>`).join('')}</tbody></table></div>`;
    }).join('') : '<div class="card empty">Nothing tracked yet. Open a job and set its status.</div>'}
    <div id="outcomes"></div>`;
  api('/api/outcomes').then((o) => { if (S.view === 'tracker' && o.total.applied) $('#outcomes').innerHTML = outcomesHtml(o); }).catch(() => {});
}

function outcomesHtml(o) {
  const row = (name, s) => `<tr><td>${esc(name)}</td><td class="r num">${s.applied}</td><td class="r num">${s.referredOrTested}</td><td class="r num">${s.interviewed}</td><td class="r num">${s.offers}</td><td class="r num">${s.hired}</td></tr>`;
  const table = (groups) => `<div class="table-wrap"><table><thead><tr><th></th><th class="r">Applied</th><th class="r">Referred or tested</th><th class="r">Interviewed</th><th class="r">Offers</th><th class="r">Hired</th></tr></thead><tbody>${Object.entries(groups).map(([k, s]) => row(k, s)).join('')}</tbody></table></div>`;
  const reasons = Object.entries(o.reasons).sort((a, b) => b[1] - a[1]);
  return `<div class="card" style="margin-top:18px"><h2>Outcomes</h2>
    <p class="muted small">How far your applications got. Use it to check whether high scores really lead to interviews. It never changes scoring.${o.note ? ` ${esc(o.note)}` : ''}</p>
    ${table({ 'All applications': o.total })}<h3>By evaluation score</h3>${table(o.byScore)}<h3>By level</h3>${table(o.byLevel)}
    ${reasons.length ? `<h3>Why applications ended</h3><ul class="tight">${reasons.map(([r, n]) => `<li>${esc(r)}: ${n}</li>`).join('')}</ul>` : ''}
    ${o.medianDaysToFirstResponse != null ? `<p class="small">Typical time from applying to the first step forward: ${Math.round(o.medianDaysToFirstResponse)} days.</p>` : ''}</div>`;
}

// ---------- AI ----------

async function renderAi() {
  $('#main').innerHTML = `<div class="head"><h1>AI models</h1></div><div class="card muted">Looking for local AI on this computer...</div>`;
  try { S.ai = await api('/api/ai'); } catch (e) { toast(e.message); return; }
  if (S.view !== 'ai') return;
  drawAi();
}
function drawAi() {
  const cfg = S.state.config;
  const provs = S.ai.providers;
  const local = provs.filter((p) => p.local && p.available);
  const missing = provs.filter((p) => p.local && !p.available && !p.sharedPort);
  const remote = provs.filter((p) => !p.local);
  const cloudOk = cfg.ai.privacy === 'allow-cloud';
  const usable = provs.filter((p) => p.available && p.models.length);
  const roleRow = (r) => {
    const cur = cfg.ai.roles[r] ?? {};
    const wantEmbed = r === 'embed';
    const options = usable.flatMap((p) => p.models.filter((m) => m.embedding === wantEmbed || (!wantEmbed && p.kind === 'cli')).map((m) => {
      const v = `${p.id}|${m.id}`;
      const blocked = !p.local && !cloudOk;
      return `<option value="${esc(v)}" ${cur.provider === p.id && cur.model === m.id ? 'selected' : ''} ${blocked ? 'disabled' : ''}>${esc(p.label)}: ${esc(m.id)}${p.local ? '' : blocked ? ' (blocked by privacy)' : ' (cloud)'}</option>`;
    }));
    const known = usable.some((p) => p.id === cur.provider && p.models.some((m) => m.id === cur.model));
    const stale = cur.provider && !known ? `<option selected value="${esc(cur.provider)}|${esc(cur.model)}">${esc(cur.provider)}: ${esc(cur.model)} (offline)</option>` : '';
    return `<label class="field"><span style="text-transform:capitalize">${r}</span><span class="hint">${esc(S.state.roleInfo[r])}</span><select data-role="${r}"><option value="">${wantEmbed ? 'None' : 'Not set'}</option>${stale}${options.join('')}</select></label>`;
  };
  $('#main').innerHTML = `
    <div class="head"><div><h1>AI models</h1><p class="muted small" style="margin:3px 0 0">Use different models for different jobs, on this computer or your own network.</p></div>
      <div class="actions"><button class="btn" id="aiRe">Check again</button><button class="btn primary" id="aiAuto" ${local.length ? '' : 'disabled'}>Assign automatically</button></div></div>
    <div class="card"><h2>Privacy</h2>
      <label class="check"><input type="radio" name="priv" value="local-only" ${!cloudOk ? 'checked' : ''}> <span><strong>Local only.</strong> Your resume and data never leave this computer or your private network.</span></label>
      <label class="check"><input type="radio" name="priv" value="allow-cloud" ${cloudOk ? 'checked' : ''}> <span><strong>Allow cloud.</strong> Cloud models and agent CLIs can be chosen. Your resume is sent to whichever you pick.</span></label>
    </div>
    <div class="card"><h2>Which model does what</h2><div class="grid2">${Object.keys(S.state.roleInfo).map(roleRow).join('')}</div></div>
    <div class="card"><h2>Running now</h2>
      ${local.length ? local.map((p) => `<div class="provider"><div class="provider-head">${esc(p.label)} <span class="tag good">Running</span> <span class="muted small" style="font-weight:400">${esc(p.baseUrl)}</span></div>${p.note ? `<div class="muted small">${esc(p.note)}</div>` : ''}
        ${p.models.map((m) => { const b = S.bench[`${p.id}|${m.id}`]; return `<div class="model-row"><code>${esc(m.id)}</code>${m.embedding ? '<span class="tag">embeddings</span>' : ''}${m.loaded ? '<span class="tag info">loaded</span>' : ''}${m.embedding ? '' : `<button class="btn sm" data-task data-bench="${esc(p.id)}|${esc(m.id)}">Test</button>`}${b ? `<span class="bench">${benchText(b)}</span>` : ''}</div>`; }).join('')}</div>`).join('') : '<p class="muted">No local AI found yet. Start one of the programs below and load a model, then choose Check again.</p>'}
    </div>
    <div class="card"><details ${local.length ? '' : 'open'}><summary>Other local AI programs (${missing.length})</summary>
      <p class="muted small" style="margin-top:8px">Each is checked at its usual address. To use one running elsewhere, such as a stronger PC on your network, change the address.</p>
      ${missing.map((p) => `<div class="provider"><div class="provider-head">${link(p.site, p.label)} <span class="tag">Not running</span></div><div style="display:flex;gap:8px;margin-top:5px"><input type="text" aria-label="${esc(p.label)} address" value="${esc(p.baseUrl)}" data-url="${esc(p.id)}"><button class="btn sm" data-saveurl="${esc(p.id)}">Save</button></div></div>`).join('')}
    </details></div>
    <div class="card"><details><summary>Add your own server</summary>
      <p class="muted small" style="margin-top:8px">Anything that speaks the OpenAI API, or Ollama's: a stronger PC on your network, or a cloud service not listed above (for example Azure OpenAI or a company gateway). A private-network address counts as local. Anything else counts as cloud.</p>
      <div class="grid3"><label class="field">Name<input type="text" id="cxName" placeholder="Basement GPU"></label><label class="field">Address<input type="url" id="cxUrl" placeholder="http://192.168.1.20:8000/v1"></label><label class="field">Type<select id="cxKind"><option value="openai">OpenAI compatible</option><option value="ollama">Ollama</option></select></label></div>
      <label class="field">API key (optional)<input type="password" id="cxKey" autocomplete="off" placeholder="Only if the server needs one"><span class="hint">Sent as a Bearer token. Saved on this computer only.</span></label>
      <button class="btn" id="cxAdd">Add server</button>
      ${(cfg.ai.custom ?? []).map((c) => `<div class="model-row"><code>${esc(c.label)} ${esc(c.baseUrl)}</code><button class="btn sm" data-rmcustom="${esc(c.id)}">Remove</button></div>`).join('')}
    </details></div>
    <div class="card"><details ${cloudOk && !remote.some((p) => p.available) ? 'open' : ''}><summary>Sign in with an AI plan you already have (${remote.filter((p) => p.kind === 'cli').length})</summary>
      ${cloudOk ? '' : '<div class="notice" style="margin-top:8px">Blocked while privacy is set to Local only. Choose Allow cloud above to use these.</div>'}
      <p class="muted small" style="margin-top:8px">Use a Claude, ChatGPT or Google plan instead of paying for an API key. Install the company's official command-line tool, sign in once in a terminal, then choose Check again. CivicOps runs that tool with its file, shell and web tools turned off, and never sees your password or sign-in tokens. Usage counts against your plan's limits. Websites such as chatgpt.com or claude.ai cannot be connected directly; these tools are the supported way to use a plan.</p>
      ${remote.filter((p) => p.kind === 'cli').map((p) => `<div class="provider"><div class="provider-head">${p.site ? link(p.site, p.label) : esc(p.label)} ${p.available ? '<span class="tag good">Installed</span>' : '<span class="tag">Not installed</span>'}</div>
        ${p.signIn ? `<div class="muted small">Works with: ${esc(p.signIn)}</div>` : ''}
        ${p.install ? `<div class="small" style="margin-top:4px">1. Install: <code>${esc(p.install)}</code> (needs Node.js)<br>2. Sign in: run <code>${esc(p.login)}</code> in a terminal and follow the browser prompt<br>3. Choose Check again at the top of this page</div>` : ''}</div>`).join('')}
    </details></div>
    <div class="card"><details><summary>Cloud AI services with an API key (${remote.filter((p) => p.kind !== 'cli').length})</summary>
      ${cloudOk ? '' : '<div class="notice" style="margin-top:8px">Blocked while privacy is set to Local only. Choose Allow cloud above to use these.</div>'}
      <p class="muted small" style="margin-top:8px">To connect one: create a key on the service's site (Get a key), paste it here and choose Save, then pick its models under Which model does what. Keys stay in <code>config/secrets.json</code> on this computer, or set them as environment variables. Each service bills you for what you use. You can mix local and cloud, for example a local model for triage and a cloud model for evaluation.</p>
      ${remote.filter((p) => p.kind !== 'cli').map((p) => `<div class="provider"><div class="provider-head">${esc(p.label)} ${p.available ? (p.unverified ? '<span class="tag warn">Key saved, use Test to check it</span>' : '<span class="tag good">Ready</span>') : p.kind === 'cli' ? '<span class="tag">Not installed</span>' : p.hasKey ? '<span class="tag warn">Key not accepted</span>' : '<span class="tag">No key</span>'} ${p.keyUrl ? `<span class="small" style="font-weight:400">${link(p.keyUrl, 'Get a key')}</span>` : ''}</div>
        ${p.apiKeyEnv ? `<div style="display:flex;gap:8px;margin-top:5px"><input type="password" aria-label="${esc(p.label)} API key" placeholder="${p.hasKey ? 'Key saved. Enter a new one to replace it.' : `Paste your own ${esc(p.apiKeyEnv)}`}" data-key="${esc(p.apiKeyEnv)}" autocomplete="off"><button class="btn sm" data-savekey="${esc(p.apiKeyEnv)}">Save</button></div>` : ''}</div>`).join('')}
    </details></div>
    <div class="card"><h2>Model settings</h2><div class="grid2">
      <label class="field">Max output tokens<input type="number" min="200" max="32000" step="100" data-aiopt="maxOutputTokens" value="${esc(cfg.ai.maxOutputTokens)}"><span class="hint">Raise this if a model that thinks before answering gets cut off.</span></label>
      <label class="field">Posting characters sent to the model<input type="number" min="1000" max="100000" step="1000" data-aiopt="jobTextChars" value="${esc(cfg.ai.jobTextChars)}"><span class="hint">Lower this for small context windows. It also halves automatically on a context error.</span></label>
      <label class="field">Requests at once<input type="number" min="1" max="16" data-aiopt="concurrency" value="${esc(cfg.ai.concurrency)}"><span class="hint">Most home PCs do best with 1.</span></label>
      <label class="field">Timeout per request (seconds)<input type="number" min="30" max="7200" step="30" data-aiopt="requestTimeoutSec" value="${esc(cfg.ai.requestTimeoutSec)}"></label>
      <label class="field">Temperature<input type="number" min="0" max="1.5" step="0.1" data-aiopt="temperature" value="${esc(cfg.ai.temperature)}"></label>
    </div></div>`;
  $('#aiRe').addEventListener('click', renderAi);
  $('#aiAuto').addEventListener('click', attempt(async () => { await api('/api/ai/auto', {}); await refresh(); toast('Models assigned', true); }));
  $$('input[name=priv]').forEach((r) => r.addEventListener('change', attempt(async () => {
    if (r.value === 'allow-cloud' && !confirm('Allow cloud? When you choose a cloud model, your resume and posting text are sent to that company.')) { drawAi(); return; }
    await api('/api/config', { ai: { privacy: r.value } }); await refresh();
  })));
  $$('[data-role]').forEach((s) => s.addEventListener('change', attempt(async () => {
    const [provider, ...rest] = s.value.split('|');
    await api('/api/config', { ai: { roles: { [s.dataset.role]: { provider: provider || '', model: rest.join('|') } } } });
    S.state = await api('/api/state');
  })));
  $$('[data-bench]').forEach((b) => b.addEventListener('click', () => {
    const [provider, ...rest] = b.dataset.bench.split('|'); const model = rest.join('|');
    runTask('/api/ai/bench', { provider, model }, (r) => { S.bench[b.dataset.bench] = r; if (S.view === 'ai') drawAi(); });
  }));
  $$('[data-saveurl]').forEach((b) => b.addEventListener('click', attempt(async () => {
    const v = $(`[data-url="${CSS.escape(b.dataset.saveurl)}"]`).value.trim();
    new URL(v);
    await api('/api/config', { ai: { providers: { [b.dataset.saveurl]: { baseUrl: v } } } });
    await refresh();
  })));
  $$('[data-savekey]').forEach((b) => b.addEventListener('click', attempt(async () => {
    const v = $(`[data-key="${CSS.escape(b.dataset.savekey)}"]`).value;
    if (!v) return;
    await api('/api/secret', { name: b.dataset.savekey, value: v }); toast('Key saved on this computer', true); await refresh();
  })));
  $('#cxAdd').addEventListener('click', attempt(async () => {
    const label = $('#cxName').value.trim(); const baseUrl = $('#cxUrl').value.trim();
    if (!label || !baseUrl) throw new Error('Enter a name and an address.');
    new URL(baseUrl);
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const key = $('#cxKey').value.trim();
    const apiKeyEnv = key ? `CUSTOM_${slug.toUpperCase().replace(/-/g, '_')}_API_KEY` : undefined;
    if (key) await api('/api/secret', { name: apiKeyEnv, value: key });
    const custom = [...(cfg.ai.custom ?? []), { id: `custom-${slug}`, label, baseUrl, kind: $('#cxKind').value, ...(apiKeyEnv ? { apiKeyEnv } : {}) }];
    await api('/api/config', { ai: { custom } }); await refresh();
  }));
  $$('[data-rmcustom]').forEach((b) => b.addEventListener('click', attempt(async () => {
    await api('/api/config', { ai: { custom: cfg.ai.custom.filter((c) => c.id !== b.dataset.rmcustom) } }); await refresh();
  })));
  $$('[data-aiopt]').forEach((i) => i.addEventListener('change', attempt(async () => {
    await api('/api/config', { ai: { [i.dataset.aiopt]: +i.value } }); S.state = await api('/api/state');
  })));
}
function benchText(b) {
  if (!b.ok) return `Failed after ${b.seconds}s: ${esc(b.error)}`;
  return `${b.seconds}s${b.tokensPerSec ? `, ${b.tokensPerSec} tokens/sec` : ''}. Structured output: ${b.validJson ? 'works' : 'FAILED'}. Spotted a missing license in the test: ${b.caughtMissingLicense ? 'yes' : 'NO'}.`;
}

// ---------- Setup ----------

async function renderSetup() {
  const c = S.state.config;
  const { cv, proof } = await api('/api/cv');
  if (S.view !== 'setup') return;
  const yn = (name, v) => `<select id="${name}"><option value="" ${v == null ? 'selected' : ''}>Prefer not to say</option><option value="yes" ${v === true ? 'selected' : ''}>Yes</option><option value="no" ${v === false ? 'selected' : ''}>No</option></select>`;
  $('#main').innerHTML = `
    <div class="head"><div><h1>Setup</h1><p class="muted small" style="margin:3px 0 0">Only the first box is needed to start. All of this stays in files on this computer.</p></div></div>
    <div class="card"><h2>Where to look</h2><div class="grid2">
      <label class="field">ZIP code or city<input type="text" id="loc" value="${esc(c.location.query)}" placeholder='43215 or "Dayton, OH"'><span class="hint">${c.location.label ? `Now set to ${esc(c.location.label)}` : ''}</span></label>
      <label class="field">Distance in miles<input type="number" id="radius" min="1" max="500" value="${esc(c.location.radiusMiles)}"><span class="hint">Larger distances mean more employers and longer scans. Run Find employers again after changing this.</span></label></div>
      <h3>Levels of government</h3><div class="grid3">${Object.entries(S.state.levels).map(([k, l]) => `<label class="check"><input type="checkbox" data-lv="${k}" ${(c.levels[k] ?? k === 'adjacent') ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>
    </div>
    <div class="card"><h2>What to look for</h2><div class="grid2">
      <label class="field">Title words to include<input type="text" id="titles" value="${esc((c.search.titles ?? []).join(', '))}" placeholder="analyst, planner, GIS"><span class="hint">Separate with commas. Leave blank to see every job.</span></label>
      <label class="field">Title words to hide<input type="text" id="exclude" value="${esc((c.search.exclude ?? []).join(', '))}"></label>
      <label class="field">Minimum annual pay<input type="number" id="minSalary" min="0" step="1000" value="${esc(c.search.minSalary)}"><span class="hint">Jobs that do not list pay are kept. Hourly pay is converted at 2,080 hours.</span></label>
      <label class="field">How far back to read federal postings (days)<input type="number" id="lookback" min="1" max="120" value="${esc(c.search.federalLookbackDays)}"></label></div>
      <label class="check"><input type="checkbox" id="remoteFed" ${c.search.includeRemoteFederal ? 'checked' : ''}> Include remote federal jobs located anywhere</label>
    </div>
    <div class="card"><h2>Your resume</h2>
      <p class="muted small">Optional. The AI steps compare postings with it, and tailored documents use only what is written here.</p>
      <label class="field">Your name<input type="text" id="name" autocomplete="name" value="${esc(c.candidate.name)}"><span class="hint">Optional. Signs the letters CivicOps drafts for you. Nothing is sent for you.</span></label>
      <label class="field">Resume text<textarea id="cv" rows="12" placeholder="Paste your full resume. Plain text or Markdown both work.">${esc(cv)}</textarea><span class="hint">Saved as cv.md. Include dates and hours per week, since federal applications ask for them.</span></label>
      <label class="field">More proof points (optional)<textarea id="proof" rows="4" placeholder="Results, projects, or numbers not in your resume.">${esc(proof)}</textarea></label>
    </div>
    <div class="card"><h2>Eligibility</h2><p class="muted small">Used to spot blockers in postings. Leave anything blank. Nothing is ever sent to an employer.</p><div class="grid3">
      <label class="field">US citizen${yn('citizen', c.candidate.usCitizen)}</label>
      <label class="field">Veteran${yn('veteran', c.candidate.veteran)}</label>
      <label class="field">Veterans' preference type<input type="text" id="vp" value="${esc(c.candidate.veteransPreference)}"></label>
      <label class="field">Active clearance<input type="text" id="clearance" value="${esc(c.candidate.clearance)}"></label>
      <label class="field">Current federal grade<input type="text" id="grade" value="${esc(c.candidate.currentGrade)}" placeholder="GS-11"></label>
      <label class="field">Licenses and certifications<input type="text" id="licenses" value="${esc((c.candidate.licenses ?? []).join(', '))}"></label></div>
      <label class="check"><input type="checkbox" id="fedEmp" ${c.candidate.currentFederalEmployee ? 'checked' : ''}> I am a current federal employee</label>
      <label class="check"><input type="checkbox" id="relocate" ${c.candidate.willingToRelocate ? 'checked' : ''}> Willing to relocate</label>
      <label class="field" style="margin-top:10px">Other notes for the AI<textarea id="notes" rows="2">${esc(c.candidate.notes)}</textarea></label>
    </div>
    <div class="card"><h2>Job sources</h2>
      <p class="small">Federal jobs work with no key, using a public USAJOBS feed. A free API key from <a href="https://developer.usajobs.gov/apirequest/" target="_blank" rel="noopener noreferrer">developer.usajobs.gov</a> gives exact radius search and faster scans. <span class="tag ${S.state.hasKey ? 'good' : ''}">${S.state.hasKey ? 'Key saved' : 'No key'}</span></p>
      <div class="grid2"><label class="field">USAJOBS API key<input type="password" id="usaKey" autocomplete="off" placeholder="${S.state.hasKey ? 'Saved. Enter a new one to replace it.' : 'Optional'}"></label>
      <label class="field">Email registered with USAJOBS<input type="text" id="usaEmail" value="${esc(c.sources.usajobsEmail)}"><span class="hint">USAJOBS requires it with API calls, and it goes nowhere else.</span></label></div>
      <details class="adv"><summary>Advanced: how employer websites are found</summary>
      <label class="field">Your SearXNG address (optional)<input type="url" id="searx" value="${esc(c.sources.searxngUrl)}" placeholder="http://127.0.0.1:8888"><span class="hint">A self-hosted search engine with its JSON format turned on. It finds more employer websites, and shows search-indexed listings from boards that block automated tools.</span></label>
      <label class="check"><input type="checkbox" id="wikidata" ${c.sources.wikidata ? 'checked' : ''}> Use Wikidata to find official websites</label>
      <label class="check"><input type="checkbox" id="guess" ${c.sources.guessDomains ? 'checked' : ''}> Experimental: try likely website names. Adds up to 3 minutes and may disrupt lookups on some networks. SearXNG works better.</label>
      </details>
    </div>
    <div class="savebar"><button class="btn primary" id="save">Save changes</button><span class="muted small" id="saveNote">Changes on this page are kept when you choose Save changes.</span></div>`;
  const list = (id) => $(id).value.split(',').map((s) => s.trim()).filter(Boolean);
  const tri = (id) => ({ yes: true, no: false }[$(id).value] ?? null);
  $('#main').addEventListener('input', () => { const n = $('#saveNote'); if (n) n.textContent = 'You have unsaved changes.'; }, { once: true });
  $('#save').addEventListener('click', attempt(async () => {
    const before = { label: c.location.label, radius: c.location.radiusMiles, levels: JSON.stringify(c.levels) };
    const levels = {};
    $$('[data-lv]').forEach((x) => { levels[x.dataset.lv] = x.checked; });
    await api('/api/config', {
      locationQuery: $('#loc').value.trim(), radiusMiles: +$('#radius').value, levels,
      search: { titles: list('#titles'), exclude: list('#exclude'), minSalary: +$('#minSalary').value || 0, federalLookbackDays: +$('#lookback').value || 30, includeRemoteFederal: $('#remoteFed').checked },
      candidate: { name: $('#name').value.trim(), usCitizen: tri('#citizen'), veteran: tri('#veteran'), veteransPreference: $('#vp').value, clearance: $('#clearance').value, currentGrade: $('#grade').value, licenses: list('#licenses'), currentFederalEmployee: $('#fedEmp').checked, willingToRelocate: $('#relocate').checked, notes: $('#notes').value },
      sources: { usajobsEmail: $('#usaEmail').value.trim(), searxngUrl: $('#searx').value.trim(), wikidata: $('#wikidata').checked, guessDomains: $('#guess').checked },
    });
    await api('/api/cv', { cv: $('#cv').value, proof: $('#proof').value });
    if ($('#usaKey').value) await api('/api/secret', { name: 'USAJOBS_API_KEY', value: $('#usaKey').value });
    await refresh();
    // Say what to do next, since saving a location is only the first step.
    const now = S.state.config;
    const moved = now.location.label !== before.label || now.location.radiusMiles !== before.radius || JSON.stringify(now.levels) !== before.levels;
    if (!now.location.label) toast('Saved. Add a ZIP code or city to start finding jobs.', true);
    else if (!S.employers.length) { location.hash = 'jobs'; toast('Saved. Next, choose Find employers.', true); }
    else if (moved) toast('Saved. Run Find employers again (Employers page) to match the new area.', true);
    else toast('Saved', true);
  }));
}

// ---------- Job drawer ----------

function openJob(id) { S.open = id; S.lastFocus = document.activeElement; renderDrawer(); $('#drawerWrap').hidden = false; $('.close')?.focus(); }
function closeJob() { S.open = null; $('#drawerWrap').hidden = true; S.lastFocus?.focus?.(); }

function evaluationHtml(j) {
  const e = j.evaluation;
  if (!e) return '';
  const cls = e.score >= 4 ? 'hi' : e.score >= 3 ? 'mid' : 'lo';
  const statusTag = { yes: ['good', 'Met'], partial: ['warn', 'Partial'], no: ['bad', 'Not met'], unknown: ['', 'Unknown'], clear: ['good', 'Clear'], check: ['warn', 'Check'], blocker: ['bad', 'Blocker'] };
  const tag = (s) => { const [c, l] = statusTag[s] ?? ['', s]; return `<span class="tag ${c}">${esc(l)}</span>`; };
  const ul = (a) => (a?.length ? `<ul class="tight">${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">Not stated.</p>');
  return `<div class="card">
    <div class="verdict"><span class="score ${cls} big">${(+e.score).toFixed(1)}</span><div><strong>${esc(e.verdict)}</strong><br><span class="muted small">${esc(e.model)}, ${esc(e.at)}${j.report ? ` · <a href="/reports/${encodeURIComponent(j.report)}" target="_blank">Full report</a>` : ''}</span></div></div>
    <p class="small muted">AI-assisted. Confirm requirements and deadlines against the posting.</p>
    ${e.truncated ? '<p class="notice small">The posting was cut to fit this model, so later sections may be missing.</p>' : ''}
    ${e.blockers?.length ? `<div class="notice bad"><strong>Blockers</strong>${ul(e.blockers)}</div>` : ''}
    <p>${esc(e.summary)}</p>
    <div class="bars">${Object.entries(e.scores ?? {}).map(([k, v]) => `<div class="bar"><span style="text-transform:capitalize">${esc(k)}</span><i><b style="width:${Math.min(100, (+v || 0) * 20)}%"></b></i><span class="num">${esc(v)}/5</span></div>`).join('')}</div>
    <h3>Requirements</h3><div class="table-wrap"><table><tbody>${(e.requirements ?? []).map((r) => `<tr><td>${esc(r.requirement)}${r.kind === 'minimum' ? ' <span class="tag">minimum</span>' : ''}<br><span class="muted small">${esc(r.evidence)}</span>${r.substitutionAllowed ? `<br><span class="small">Experience may substitute for education${r.substitution ? `: "${esc(r.substitution)}"` : ''}${r.path && r.path !== 'none' ? `. You qualify through ${esc(r.path)}.` : ''}</span>` : ''}</td><td>${tag(r.met)}</td></tr>`).join('')}</tbody></table></div>
    <h3>Eligibility</h3><div class="table-wrap"><table><tbody>${(e.gates ?? []).map((g) => `<tr><td><strong>${esc(g.gate)}</strong><br><span class="muted small">${esc(g.detail)}</span></td><td>${tag(g.status)}</td></tr>`).join('')}</tbody></table></div>
    <h3>Pay and benefits</h3><p>${esc(e.pay_and_benefits)}</p>
    <h3>How to apply well</h3>${ul(e.application_strategy)}
    <h3>What selection looks like</h3>${ul(e.selection_process)}
    <h3>Posting check</h3><p>${esc(e.posting_check)}</p>
    <h3>Biggest gaps</h3>${ul(e.biggest_gaps)}
  </div>`;
}

function docsHtml(j) {
  if (!j.documents?.length) return '';
  const label = { resume: 'Resume', cover: 'Cover letter', answers: 'Application answers', interview: 'Interview prep' };
  const atsHtml = (a) => `<div class="small" style="margin-top:6px"><strong>ATS check: ${esc(a.score)}/100</strong> <span class="muted">(${esc(a.matched)} of ${esc(a.terms)} posting terms used)</span>
    ${a.failed.length ? `<ul class="tight">${a.failed.map((f) => `<li>Fix: ${esc(f)}</li>`).join('')}</ul>` : '<div class="muted">Layout checks passed.</div>'}
    ${a.canAdd.length ? `<div>In your resume but missing from this tailored version, safe to add if they apply: ${esc(a.canAdd.join(', '))}</div>` : ''}
    ${a.gaps.length ? `<div class="muted">In the posting but not in your resume (do not add these): ${esc(a.gaps.join(', '))}</div>` : ''}</div>`;
  const fitHtml = (f) => `<details style="margin-top:6px"><summary class="small"><strong>How this resume fits the job</strong> (${f.length} requirements)</summary><ul class="tight small">${f.map((x) => `<li>${esc(x.replace(/\*\*/g, ''))}</li>`).join('')}</ul></details>`;
  return `<div class="card"><h2>Your documents</h2>${j.documents.map((d) => `<div style="margin-bottom:12px"><strong>${esc(label[d.kind] ?? d.kind)}</strong> <span class="muted small">${esc(d.model)}, ${esc(d.at)}</span><br>
    <a href="/output/${encodeURIComponent(d.md)}" target="_blank">Text</a>${!['answers', 'interview'].includes(d.kind) ? ` · <a href="/output/${encodeURIComponent(d.html)}" target="_blank">Web page</a>` : ''}${d.pdf ? ` · <a href="/output/${encodeURIComponent(d.pdf)}" target="_blank">PDF (${esc(d.pages)} pages)</a>` : ''}
    ${d.ats ? atsHtml(d.ats) : ''}${d.fit?.length ? fitHtml(d.fit) : ''}
    ${d.pageWarning ? `<div class="notice small" style="margin-top:6px">${esc(d.pageWarning)}</div>` : ''}
    ${d.needsInput ? '<div class="notice info small" style="margin-top:6px">The model listed items needing your input at the end of the text file.</div>' : ''}
    ${d.issues?.length ? `<div class="notice bad small" style="margin-top:6px"><strong>Fact check: possibly invented details</strong><ul class="tight">${d.issues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${d.kind !== 'answers' ? `No PDF was made. Correct the text, or if these are accurate, <button class="btn sm" data-force="${esc(d.kind)}">Regenerate and allow PDF</button>` : 'Check these before using this text.'}</div>` : ''}
    ${!d.issues?.length && d.pdfError ? `<div class="notice small" style="margin-top:6px">${esc(d.pdfError)}</div>` : ''}</div>`).join('')}</div>`;
}

const ENDED = ['Rejected', 'Withdrawn', 'Closed'];
function trackHtml(j) {
  const reasons = S.state.outcomeReasons ?? [];
  return `<div class="card"><h2>Track it</h2><div class="grid2">
      <label class="field">Status<select id="dStatus">${S.state.statuses.map((s) => `<option ${s === j.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
      <label class="field">Follow up on<input type="date" id="dFollow" value="${esc(j.followUp ?? '')}"></label>
      <label class="field" id="dReasonWrap" ${ENDED.includes(j.status) ? '' : 'hidden'}>Why it ended<select id="dReason"><option value="">Not sure</option>${reasons.map((r) => `<option ${r === j.outcomeReason ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
      <label class="field" id="dRankWrap" ${j.status === 'Eligible list' ? '' : 'hidden'}>Rank or score on the list<input type="text" id="dRank" value="${esc(j.listRank ?? '')}" placeholder="For example 3 of 40, or 92.5"></label></div>
      <label class="field">Notes<textarea id="dNotes" rows="2">${esc(j.notes ?? '')}</textarea></label>
      <button class="btn" id="dSave">Save</button>
      ${j.history?.length ? `<p class="muted small" style="margin-top:8px">History: ${j.history.map((h) => `${esc(h.status)} ${esc(h.on)}`).join(' · ')}</p>` : ''}
    </div>`;
}

function renderDrawer() {
  const j = S.jobs.find((x) => x.id === S.open);
  if (!j) return closeJob();
  const hasAi = Object.values(S.state.config.ai.roles).some((r) => r.provider && r.model);
  const blocked = !S.state.hasCv ? 'Add your resume in Setup first' : !hasAi ? 'Connect an AI model first' : '';
  const dis = blocked ? `disabled title="${esc(blocked)}"` : '';
  $('#drawer').innerHTML = `
    <button class="btn sm close" id="dClose">Close</button>
    <h1>${esc(j.title)}</h1><p class="muted" style="margin:3px 0 0">${esc(j.employer)}</p>
    <div class="facts">
      <div><span>Level</span>${esc(LEVELS()[j.level] ?? j.level)}</div><div><span>Location</span>${esc(j.location)}${j.distanceMi != null ? ` (${Math.round(j.distanceMi)} mi)` : ''}</div>
      <div><span>Pay</span>${pay(j)}</div><div><span>Closes</span>${closes(j)}</div>
      ${j.grade ? `<div><span>Grade</span>${esc(j.grade)}</div>` : ''}${j.series ? `<div><span>Series</span>${esc(j.series)}</div>` : ''}
      ${j.clearance ? `<div><span>Clearance</span>${esc(j.clearance)}</div>` : ''}${j.hiringPaths?.length ? `<div style="grid-column:1/-1"><span>Who may apply</span>${esc([].concat(j.hiringPaths).join(', '))}</div>` : ''}
      <div><span>Found through</span>${esc(j.source)}</div>
    </div>
    ${j.confidence === 'low' ? '<div class="notice small">This was recognized from a link on a web page and may not be a current opening. Check the posting.</div>' : ''}
    ${j.triage ? `<p class="small"><strong>Quick triage ${esc(j.triage.score)}/5:</strong> ${esc(j.triage.reason)}</p>` : ''}
    <div class="actions" style="margin-bottom:14px">
      ${j.url ? link(j.url, 'Open posting', 'btn primary') : ''}
      ${j.liveness?.closed ? `<div class="notice" style="flex-basis:100%">This posting looks closed: ${esc(j.liveness.reason)} (checked ${esc(j.liveness.checked)}). Open the posting to confirm.</div>` : ''}
      <button class="btn" data-task id="dEval" ${dis}>${j.liveness?.closed ? 'Evaluate anyway' : j.evaluation ? 'Evaluate again' : 'Evaluate'}</button>
      <button class="btn" data-task id="dResume" ${dis}>Tailor resume</button>
      <button class="btn" data-task id="dCover" ${dis}>Cover letter</button>
      <button class="btn" data-task id="dInterview" ${dis}>Interview prep</button>
    </div>
    ${blocked ? `<p class="muted small">${esc(blocked)} to use AI features.</p>` : ''}
    <p class="small muted">CivicOps never applies for you. You review everything and submit it yourself on the employer's site.</p>
    ${evaluationHtml(j)}${docsHtml(j)}
    ${trackHtml(j)}
    <div class="card"><details ${j.hasText ? '' : 'open'}><summary>Posting text ${j.hasText ? '<span class="tag good">Available</span>' : '<span class="tag">Not read yet</span>'}</summary>
      <p class="muted small" style="margin-top:8px">If the posting cannot be read automatically, paste it here. Evaluation will then use this text.</p>
      <textarea id="dPaste" rows="5" placeholder="Paste the full posting"></textarea><button class="btn" id="dPasteSave" style="margin-top:6px">Save text</button>
    </details></div>
    <div class="card"><details><summary>Draft application answers</summary>
      <p class="muted small" style="margin-top:8px">Paste supplemental or essay questions. You get drafts built only from your resume, with marks where your own words are needed. Your application is yours to sign, so review every answer.</p>
      <textarea id="dQ" rows="5" placeholder="Paste the questions here"></textarea><button class="btn" data-task id="dAns" style="margin-top:6px" ${dis}>Draft answers</button>
    </details></div>`;
  $('#dClose').addEventListener('click', closeJob);
  $('#dEval').addEventListener('click', () => runTask('/api/evaluate', { id: j.id, force: !!j.liveness?.closed }));
  $('#dResume').addEventListener('click', () => runTask('/api/tailor', { id: j.id, kind: 'resume' }));
  $('#dCover').addEventListener('click', () => runTask('/api/tailor', { id: j.id, kind: 'cover' }));
  $('#dInterview').addEventListener('click', () => runTask('/api/tailor', { id: j.id, kind: 'interview' }));
  $('#dStatus').addEventListener('change', () => {
    $('#dReasonWrap').hidden = !ENDED.includes($('#dStatus').value);
    $('#dRankWrap').hidden = $('#dStatus').value !== 'Eligible list';
  });
  $('#dAns').addEventListener('click', () => runTask('/api/tailor', { id: j.id, kind: 'answers', questions: $('#dQ').value }));
  $$('[data-force]').forEach((b) => b.addEventListener('click', () => runTask('/api/tailor', { id: j.id, kind: b.dataset.force, force: true })));
  $('#dSave').addEventListener('click', attempt(async () => {
    await api('/api/job', { id: j.id, status: $('#dStatus').value, notes: $('#dNotes').value, followUp: $('#dFollow').value, outcomeReason: $('#dReason').value, listRank: $('#dRank').value });
    await refresh(); toast('Saved', true);
  }));
  $('#dPasteSave').addEventListener('click', attempt(async () => {
    await api('/api/job', { id: j.id, pastedText: $('#dPaste').value }); await refresh(); toast('Posting text saved', true);
  }));
  if (S.task) showTask();
}

function addPostingForm() {
  S.open = null;
  $('#drawer').innerHTML = `<button class="btn sm close" id="dClose">Close</button><h1>Add a posting</h1>
    <p class="muted small" style="margin-top:4px">For jobs on boards CivicOps cannot read, such as governmentjobs.com. Paste the posting and it gets the same evaluation and tailoring as everything else.</p>
    <label class="field">Posting text<textarea id="aText" rows="10"></textarea></label>
    <div class="grid2"><label class="field">Job title<input type="text" id="aTitle"><span class="hint">Can be left blank if an AI model is set up.</span></label><label class="field">Employer<input type="text" id="aEmp"></label>
    <label class="field">Posting address<input type="url" id="aUrl"></label><label class="field">Closing date<input type="date" id="aClose"></label>
    <label class="field">Level<select id="aLevel">${Object.entries(LEVELS()).map(([k, l]) => `<option value="${k}" ${k === 'city' ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label><label class="field">Location<input type="text" id="aLoc"></label></div>
    <button class="btn primary" id="aSave">Add posting</button>`;
  $('#drawerWrap').hidden = false;
  $('#dClose').addEventListener('click', closeJob);
  $('#aSave').addEventListener('click', attempt(async () => {
    const job = await api('/api/job/add', { text: $('#aText').value, title: $('#aTitle').value.trim(), employer: $('#aEmp').value.trim(), url: $('#aUrl').value.trim(), closes: $('#aClose').value, level: $('#aLevel').value, location: $('#aLoc').value.trim() });
    await refresh(); openJob(job.id);
  }));
}

function pasteListForm(employer = {}) {
  S.open = null;
  let html = '';
  $('#drawer').innerHTML = `<button class="btn sm close" id="dClose">Close</button><h1>Paste a job list</h1>
    <p class="muted small" style="margin-top:4px">For boards CivicOps cannot read, such as governmentjobs.com or Cornerstone. Open the board in your own browser, press Ctrl+A then Ctrl+C on the job list, and paste here. Jobs on later result pages need their own paste.</p>
    <div class="grid2"><label class="field">Employer<input type="text" id="lEmp" value="${esc(employer.name ?? '')}"></label>
    <label class="field">Level<select id="lLevel">${Object.entries(LEVELS()).map(([k, l]) => `<option value="${k}" ${k === (employer.level ?? 'city') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label></div>
    <label class="field">Job list<textarea id="lPaste" rows="4" placeholder="Click here and press Ctrl+V"></textarea></label>
    <p class="small" id="lFound" role="status"></p><div id="lRows"></div>
    <button class="btn primary" id="lSave" disabled>Add jobs</button>`;
  $('#drawerWrap').hidden = false;
  $('#dClose').addEventListener('click', closeJob);
  $('#lPaste').addEventListener('paste', attempt(async (e) => {
    e.preventDefault();
    html = e.clipboardData.getData('text/html');
    $('#lPaste').value = e.clipboardData.getData('text/plain').slice(0, 400);
    const { found } = html ? await api('/api/job/list', { html, dryRun: true }) : { found: [] };
    $('#lFound').textContent = found.length ? `Found ${found.length} job${found.length === 1 ? '' : 's'}. Check the list before adding it.` : 'No job links found. Copy from the page that lists the jobs, not from a plain text source.';
    $('#lRows').innerHTML = found.slice(0, 200).map((f) => `<div class="small" style="padding:2px 0">${esc(f.title)}${f.location ? ` <span class="muted">${esc(f.location)}</span>` : ''}</div>`).join('');
    $('#lSave').disabled = !found.length;
  }));
  $('#lSave').addEventListener('click', attempt(async () => {
    const r = await api('/api/job/list', { html, employer: $('#lEmp').value.trim(), level: $('#lLevel').value });
    await refresh(); closeJob(); toast(`${r.added} new jobs added, ${r.found - r.added} already here`, true);
  }));
}

function addBoardForm() {
  S.open = null;
  $('#drawer').innerHTML = `<button class="btn sm close" id="dClose">Close</button><h1>Add an employer</h1>
    <p class="muted small" style="margin-top:4px">Add a board CivicOps missed, such as a transit authority, port, or library system. It stays in your list and is scanned when possible.</p>
    <label class="field">Employer name<input type="text" id="bName"></label><label class="field">Jobs page address<input type="url" id="bUrl" placeholder="https://"></label>
    <div class="grid2"><label class="field">Level<select id="bLevel">${Object.entries(LEVELS()).map(([k, l]) => `<option value="${k}" ${k === 'special' ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label><label class="field">State<input type="text" id="bState" maxlength="2" value="${esc(S.state.config.location.state)}"></label></div>
    <button class="btn primary" id="bSave" data-task>Add and refresh</button>`;
  $('#drawerWrap').hidden = false;
  $('#dClose').addEventListener('click', closeJob);
  $('#bSave').addEventListener('click', attempt(async () => {
    const url = $('#bUrl').value.trim(); new URL(url);
    const name = $('#bName').value.trim(); if (!name) throw new Error('Enter the employer name.');
    const extraBoards = [...(S.state.config.sources.extraBoards ?? []), { name, url, level: $('#bLevel').value, state: $('#bState').value.toUpperCase() }];
    await api('/api/config', { sources: { extraBoards } });
    closeJob();
    runTask('/api/discover', {});
  }));
}

// ---------- Shell ----------

function render() {
  if (!S.state) return;
  $$('#nav button').forEach((b) => { if (b.dataset.view === S.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  const c = S.state.config;
  const eval_ = c.ai.roles.evaluate;
  $('#railFoot').innerHTML = `<strong>${esc(c.location.label || 'No location set')}</strong>${c.location.label ? `${esc(c.location.radiusMiles)} miles<br>` : ''}<span title="AI model used for evaluation">${eval_.model ? esc(eval_.model) : 'No AI model'}</span><br>${c.ai.privacy === 'local-only' ? 'Local only' : 'Cloud allowed'}`;
  ({ jobs: renderJobs, employers: renderEmployers, tracker: renderTracker, ai: renderAi, setup: renderSetup }[S.view] ?? renderJobs)();
  if (S.task) showTask();
}

document.addEventListener('click', (e) => {
  const nav = e.target.closest('#nav button');
  if (nav) { location.hash = nav.dataset.view; return; }
  const act = e.target.closest('[data-act]');
  if (act && !act.disabled) {
    const a = act.dataset.act;
    if (a === 'discover') return runTask('/api/discover', {});
    if (a === 'scan') return runTask('/api/scan', {});
    if (a === 'triage') return runTask('/api/triage', { limit: 25 });
    if (a === 'add') return addPostingForm();
    if (a === 'addBoard') return addBoardForm();
    if (a === 'pasteList') return pasteListForm();
  }
  const row = e.target.closest('[data-job]');
  if (row && !e.target.closest('a')) openJob(row.dataset.job);
});
$('#scrim').addEventListener('click', closeJob);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#drawerWrap').hidden) closeJob(); });

refresh().catch((e) => toast(e.message));
