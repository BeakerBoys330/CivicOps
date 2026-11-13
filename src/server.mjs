// Local dashboard server. Bound to this computer only. Long jobs run as background tasks the page polls.
import { createReadStream, existsSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, extname, join } from 'node:path';
import { AiError, autoAssignRoles, benchmark, detectProviders } from './ai/client.mjs';
import { ROLE_INFO } from './ai/registry.mjs';
import { getSecret, loadConfig, saveConfig, setSecret } from './config.mjs';
import { discover, probeCareers } from './discover.mjs';
import { resolveLocation } from './geo.mjs';
import { detectAts } from './ats.mjs';
import * as pipe from './pipeline.mjs';
import { LEVEL_LABEL, P, STATUSES, hash, readText, today } from './util.mjs';

const tasks = new Map();
let running = null;

function startTask(name, fn) {
  if (running) throw Object.assign(new Error(`Please wait for "${tasks.get(running).name}" to finish.`), { status: 409 });
  const id = hash(`${name}${Date.now()}`, 8);
  const task = { id, name, state: 'running', message: 'Starting', startedAt: Date.now() };
  tasks.set(id, task);
  running = id;
  fn((message) => { task.message = String(message); })
    .then((result) => { task.state = 'done'; task.result = result; })
    .catch((e) => { task.state = 'failed'; task.error = e.message; task.code = e.code; })
    .finally(() => { running = null; task.finishedAt = Date.now(); });
  return task;
}

const publicJob = ({ description, pastedText, ...j }) => ({
  ...j, hasText: !!(pastedText || (description && description.length > 300)), annualPay: pipe.annualPay(j),
});

function jobsPayload(cfg) {
  const all = Object.values(pipe.loadJobs());
  return all.map((j) => ({ ...publicJob(j), open: pipe.isOpen(j), matches: pipe.matchesSearch(j, cfg) }));
}

function secretStatus(cfg, providers) {
  return { usajobs: !!getSecret('USAJOBS_API_KEY'), usajobsEmail: !!cfg.sources.usajobsEmail, providers: Object.fromEntries(providers.filter((p) => p.apiKeyEnv).map((p) => [p.id, p.hasKey])) };
}

const routes = {
  'GET /api/state': () => {
    const cfg = loadConfig();
    return {
      config: cfg, meta: pipe.loadMeta(), levels: LEVEL_LABEL, statuses: STATUSES, outcomeReasons: pipe.OUTCOME_REASONS, roleInfo: ROLE_INFO,
      hasCv: !!readText(P.cv).trim(), hasKey: !!getSecret('USAJOBS_API_KEY'), browser: !!pipe.findBrowser(), today: today(),
    };
  },
  'GET /api/jobs': () => jobsPayload(loadConfig()),
  'GET /api/employers': () => pipe.loadJurisdictions(),
  'GET /api/cv': () => ({ cv: readText(P.cv), proof: readText(P.proof) }),
  'POST /api/cv': (b) => {
    if (typeof b.cv === 'string') writeFileSync(P.cv, b.cv);
    if (typeof b.proof === 'string') writeFileSync(P.proof, b.proof);
    return { ok: true };
  },
  'POST /api/config': async (b) => {
    const cfg = loadConfig();
    if (b.locationQuery !== undefined && b.locationQuery !== cfg.location.query) {
      cfg.location = { ...cfg.location, ...(await resolveLocation(b.locationQuery)) };
    }
    if (b.radiusMiles !== undefined) {
      const r = +b.radiusMiles;
      if (!(r >= 1 && r <= 500)) throw new Error('Radius must be between 1 and 500 miles.');
      cfg.location.radiusMiles = r;
    }
    if (b.levels) cfg.levels = { ...cfg.levels, ...b.levels };
    if (b.search) cfg.search = { ...cfg.search, ...b.search };
    if (b.candidate) cfg.candidate = { ...cfg.candidate, ...b.candidate };
    if (b.sources) cfg.sources = { ...cfg.sources, ...b.sources };
    if (b.ai) {
      const { roles, providers, custom, ...rest } = b.ai;
      cfg.ai = { ...cfg.ai, ...rest };
      if (roles) cfg.ai.roles = { ...cfg.ai.roles, ...roles };
      if (providers) cfg.ai.providers = { ...cfg.ai.providers, ...providers };
      if (custom) cfg.ai.custom = custom;
    }
    return saveConfig(cfg);
  },
  'POST /api/secret': (b) => {
    if (!/^[A-Z][A-Z0-9_]+$/.test(b.name ?? '')) throw new Error('Invalid key name.');
    setSecret(b.name, String(b.value ?? '').trim());
    return { ok: true };
  },
  'GET /api/ai': async () => {
    const cfg = loadConfig();
    const providers = await detectProviders(cfg);
    return { providers, keys: secretStatus(cfg, providers) };
  },
  'POST /api/ai/auto': async () => {
    const cfg = loadConfig();
    const roles = autoAssignRoles(await detectProviders(cfg));
    if (!roles) throw new AiError('No local model was found. Start Ollama, LM Studio or another runtime, and load a model.');
    cfg.ai.roles = roles;
    saveConfig(cfg);
    return roles;
  },
  'POST /api/ai/bench': (b) => startTask(`Test ${b.model}`, async (say) => {
    say(`Testing ${b.model}. A model that is not loaded yet can take a while.`);
    return benchmark(b.provider, b.model, loadConfig());
  }),
  'POST /api/discover': () => startTask('Find employers', (say) => discover(loadConfig(), { onProgress: say }).then((l) => ({ employers: l.length }))),
  'POST /api/scan': () => startTask('Scan for jobs', (say) => pipe.scan(loadConfig(), { onProgress: say })),
  'POST /api/triage': (b) => startTask('AI triage', (say) => pipe.triage(loadConfig(), { limit: +b.limit || 25, onProgress: say })),
  'POST /api/evaluate': (b) => startTask(`Evaluate ${b.id}`, (say) => pipe.evaluate(loadConfig(), b.id, { force: !!b.force, onToken: (n) => say(`Model is writing: ${n} characters`) }).then(publicJob)),
  'POST /api/tailor': (b) => startTask(`Write ${b.kind}`, (say) => pipe.tailor(loadConfig(), b.id, { kind: b.kind, questions: b.questions, force: !!b.force, onToken: (n) => say(`Model is writing: ${n} characters`) }).then((r) => ({ doc: r.doc, markdown: r.markdown }))),
  'POST /api/job': (b) => publicJob(pipe.updateJob(b.id, b)),
  'POST /api/job/add': async (b) => publicJob(await pipe.addManualJob(loadConfig(), b)),
  'POST /api/job/list': (b) => pipe.addJobList(loadConfig(), b),
  'POST /api/employer': async (b) => {
    const list = pipe.loadJurisdictions();
    const j = list.find((x) => x.id === b.id);
    if (!j) throw new Error('Employer not found.');
    if (b.checked) j.checkedAt = today();
    if (b.careersUrl !== undefined) {
      const url = new URL(b.careersUrl).href;
      const ats = detectAts(url);
      Object.assign(j, { careersUrl: url, careersManual: true, ats: ats?.ats ?? 'Website page', scan: ats?.scan ?? 'html', coverage: ats?.scan === 'link' ? 'link-only' : 'scannable', note: ats?.note ?? '' });
    }
    if (b.website !== undefined) {
      Object.assign(j, { website: new URL(b.website).href, websiteManual: true, websiteSource: 'added by you', careersManual: false });
      await probeCareers(j);
    }
    pipe.saveJurisdictions(list);
    return j;
  },
  'GET /api/outcomes': () => ({ ...pipe.outcomeStats(), reasonsList: pipe.OUTCOME_REASONS }),
  'POST /api/requests': () => startTask('Draft access requests', async (say) => {
    const { draftRequests } = await import('./requests.mjs');
    return draftRequests(loadConfig(), pipe.loadJurisdictions(), { onProgress: say });
  }),
  'POST /api/location/check': async (b) => resolveLocation(b.query),
};

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.pdf': 'application/pdf', '.md': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml' };

function sendFile(res, file, disposition) {
  if (!existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  const headers = { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
  if (disposition) headers['Content-Disposition'] = disposition;
  // A generated HTML resume should display as a document with no ability to run scripts.
  if (extname(file) === '.html' && file.startsWith(P.output)) headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'";
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 5e6) { reject(new Error('Request too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('Invalid request.')); }
    });
    req.on('error', reject);
  });
}

export async function startServer(port = 4173) {
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    // Stops a malicious website in your browser from reading or changing your local data.
    if (!allowed.has(req.headers.host ?? '')) return json(403, { error: 'Host not allowed.' });
    const origin = req.headers.origin;
    if (origin && !allowed.has(origin.replace(/^https?:\/\//, ''))) return json(403, { error: 'Origin not allowed.' });
    if (req.method === 'POST' && !String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(415, { error: 'JSON required.' });

    try {
      if (url.pathname.startsWith('/api/task/')) {
        const t = tasks.get(url.pathname.slice('/api/task/'.length));
        return t ? json(200, t) : json(404, { error: 'Unknown task.' });
      }
      const route = routes[`${req.method} ${url.pathname}`];
      if (route) {
        const body = req.method === 'POST' ? await readBody(req) : {};
        return json(200, await route(body));
      }
      if (req.method !== 'GET') return json(405, { error: 'Method not allowed.' });
      if (url.pathname.startsWith('/reports/')) return sendFile(res, join(P.reports, basename(decodeURIComponent(url.pathname))));
      if (url.pathname.startsWith('/output/')) return sendFile(res, join(P.output, basename(decodeURIComponent(url.pathname))));
      const name = url.pathname === '/' ? 'index.html' : basename(url.pathname);
      return sendFile(res, join(P.web, name));
    } catch (e) {
      return json(e.status ?? (e.code === 'privacy' ? 403 : 400), { error: e.message, code: e.code });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', (e) => reject(e.code === 'EADDRINUSE' ? new Error(`Port ${port} is in use. Try --port ${port + 1}`) : e));
    server.listen(port, '127.0.0.1', resolve);
  });
  console.log(`CivicOps is running at http://127.0.0.1:${port}  (Ctrl+C to stop)`);
  return server;
}
