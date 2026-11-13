// Polite fetching. Every automated request to a website goes through here so that:
//  - robots.txt is honored. No setting turns this off for a website. The only callers that pass
//    checkRobots: false are the USAJOBS and Wikidata data APIs, which are published for programs to use.
//  - each host is rate limited
//  - the tool identifies itself and never pretends to be a person's browser
//  - bot challenges are reported as "blocked", never worked around
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { sleep } from './util.mjs';

// A site owner who sees this tool in a log should be able to find out what it is. Set "homepage" in
// package.json to the project's address and it is added to the name the tool sends.
const pkg = (() => { try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')); } catch { return {}; } })();
export const PROJECT_URL = /^https:\/\/[^\s"<>]+$/.test(pkg.homepage ?? '') ? pkg.homepage : '';
export const USER_AGENT = `Mozilla/5.0 (compatible; CivicOps/${String(pkg.version ?? '0.1').split('.').slice(0, 2).join('.')}; personal government job search tool${PROJECT_URL ? `; +${PROJECT_URL}` : ''})`;
const ROBOT_TOKEN = 'civicops';
const HOST_DELAY_MS = 1200;
const nextSlot = new Map();
const robotsCache = new Map();

// Scraped pages can link or redirect anywhere. Job fetching must never reach your own network.
export function isPublicHttpUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  const kind = isIP(host);
  if (kind === 4) {
    const [a, b] = host.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || a >= 224) return false;
  } else if (kind === 6) {
    if (host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80') || host.startsWith('::ffff:')) return false;
  }
  return true;
}

async function waitForHost(host, delayMs = 0) {
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, slot + Math.max(HOST_DELAY_MS, delayMs));
  if (slot > now) await sleep(slot - now);
}

export function parseRobots(text) {
  const groups = [];
  let current = null, lastWasAgent = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (current && (key === 'allow' || key === 'disallow')) current.rules.push({ allow: key === 'allow', path: val });
      if (current && key === 'crawl-delay' && Number(val) > 0) current.crawlDelay = Number(val);
    }
  }
  return groups;
}

/**
 * The rules that apply to this tool: every group that names it, or else every "*" group.
 * RFC 9309 says groups for the same agent are read as one, so a later "Disallow" is never missed.
 * A blank "User-agent:" line names nobody.
 */
function groupFor(groups, agent) {
  const named = (a) => a && a !== '*' && (a === agent || a.startsWith(`${agent}/`) || a.startsWith(`${agent} `));
  let mine = groups.filter((g) => g.agents.some(named));
  if (!mine.length) mine = groups.filter((g) => g.agents.includes('*'));
  if (!mine.length) return null;
  return { rules: mine.flatMap((g) => g.rules), crawlDelay: Math.max(0, ...mine.map((g) => g.crawlDelay ?? 0)) };
}

/** The delay a site asks for, capped at one minute so one odd value cannot stall a whole scan. */
export function crawlDelayMs(groups, agent = ROBOT_TOKEN) {
  if (!Array.isArray(groups)) return 0;
  return Math.min((groupFor(groups, agent)?.crawlDelay ?? 0) * 1000, 60000);
}

function ruleMatches(path, rule) {
  const anchored = rule.endsWith('$');
  const body = anchored ? rule.slice(0, -1) : rule;
  const re = new RegExp('^' + body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return re.test(path);
}

// RFC 9309: the most specific group applies, then the longest matching rule wins; ties favor allow.
export function robotsAllows(groups, path, agent = ROBOT_TOKEN) {
  const group = groupFor(groups, agent);
  if (!group) return true;
  let best = null;
  for (const r of group.rules) {
    if (!r.path) continue;
    if (ruleMatches(path, r.path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return best ? best.allow : true;
}

async function loadRobots(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  const promise = (async () => {
    try {
      await waitForHost(new URL(origin).host);
      const r = await fetch(origin + '/robots.txt', { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20000) });
      if (r.ok) return parseRobots(await r.text());
      if (r.status >= 500) return 'unreachable';
      return []; // 4xx: RFC 9309 treats a missing robots file as "no restrictions"
    } catch { return 'unreachable'; }
  })();
  robotsCache.set(origin, promise);
  return promise;
}

function looksLikeChallenge(status, text) {
  if (status === 403 || status === 503 || status === 429) {
    return /cloudflare|attention required|just a moment|captcha|access denied|request could not be satisfied|incapsula|akamai/i.test(text.slice(0, 6000));
  }
  // Some bot checks answer 200 with a script-only page, such as the "Client Challenge" interstitial.
  return /<title>\s*(client challenge|just a moment\.*|attention required)/i.test(text.slice(0, 3000));
}

/**
 * Fetch one public page politely.
 * Returns { ok, status, text, url, blocked? , error? }. blocked is 'robots' | 'bot-check' | 'unsafe-url'.
 */
export async function politeFetch(url, opts = {}) {
  const r = await fetchOnce(url, opts);
  // Slow government servers often miss the 10-second connection limit once, then answer. Retry one time.
  if (opts.retry !== false && (r.error === 'UND_ERR_CONNECT_TIMEOUT' || r.error === 'EAI_AGAIN' || r.error === 'ECONNRESET')) {
    await sleep(1500);
    return fetchOnce(url, opts);
  }
  return r;
}

async function fetchOnce(url, { method = 'GET', headers = {}, body, timeoutMs = 25000, checkRobots = true, wantBinary = false } = {}) {
  if (!isPublicHttpUrl(url)) return { ok: false, status: 0, text: '', url, blocked: 'unsafe-url' };
  const u = new URL(url);
  let askedDelay = 0;
  if (checkRobots) {
    const robots = await loadRobots(u.origin);
    if (robots === 'unreachable') return { ok: false, status: 0, text: '', url, error: 'site unreachable' };
    if (!robotsAllows(robots, u.pathname + u.search)) return { ok: false, status: 0, text: '', url, blocked: 'robots' };
    askedDelay = crawlDelayMs(robots);
  }
  await waitForHost(u.host, askedDelay);
  try {
    let current = url, res;
    // Follow redirects by hand so each hop gets the safety and robots checks too.
    for (let hop = 0; hop < 6; hop++) {
      res = await fetch(current, { method, headers: { 'User-Agent': USER_AGENT, Accept: '*/*', ...headers }, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      if (res.status < 300 || res.status >= 400 || !res.headers.get('location')) break;
      const next = new URL(res.headers.get('location'), current).href;
      if (!isPublicHttpUrl(next)) return { ok: false, status: res.status, text: '', url: current, blocked: 'unsafe-url' };
      const nu = new URL(next);
      if (checkRobots && nu.origin !== new URL(current).origin) {
        const robots = await loadRobots(nu.origin);
        if (robots === 'unreachable') return { ok: false, status: 0, text: '', url: next, error: 'site unreachable' };
        if (!robotsAllows(robots, nu.pathname + nu.search)) return { ok: false, status: 0, text: '', url: next, blocked: 'robots' };
        await waitForHost(nu.host);
      }
      current = next;
    }
    const type = res.headers.get('content-type') || '';
    const binary = /pdf|octet-stream|msword|officedocument|image\//i.test(type);
    if (binary && wantBinary && res.ok) {
      return { ok: true, status: res.status, text: '', url: current, contentType: type, binary, buffer: Buffer.from(await res.arrayBuffer()) };
    }
    const text = binary ? '' : await res.text();
    if (looksLikeChallenge(res.status, text)) return { ok: false, status: res.status, text: '', url: current, blocked: 'bot-check' };
    return { ok: res.ok, status: res.status, text, url: current, contentType: type, binary };
  } catch (e) {
    return { ok: false, status: 0, text: '', url, error: e.cause?.code || e.message };
  }
}

export async function politeJson(url, opts) {
  const r = await politeFetch(url, opts);
  if (!r.ok) return { ...r, json: null };
  try { return { ...r, json: JSON.parse(r.text) }; }
  catch { return { ...r, ok: false, json: null, error: 'response was not JSON' }; }
}
