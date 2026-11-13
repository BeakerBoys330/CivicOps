// Discovery answers: which governments are inside my radius, and where does each one post jobs?
//  1. Census Gazetteer         every county, city, village and township inside the radius
//  2. CISA .gov registry       official websites, plus school, special and tribal governments
//  3. Wikidata                 official websites for places that use .org, .us or .com
//  4. Optional: verified domain guesses, self-hosted SearXNG
//  5. Probe                    follow each website to its jobs page and identify the hiring system
import { lookup } from 'node:dns/promises';
import { existsSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { P, ensureDir, haversineMiles, htmlToText, pool, readJson, writeJson, decodeEntities, hash } from './util.mjs';
import { STATE_NAMES, baseName, geocodeCity, governmentsWithin, normName, statesWithin, table } from './geo.mjs';
import { detectAts } from './ats.mjs';
import { politeFetch } from './net.mjs';
import { ADJACENT_BOARDS, FEDERAL_OWN_BOARDS, STATE_BOARDS, STATE_PORTALS } from './portals.mjs';

const DOTGOV_URL = 'https://raw.githubusercontent.com/cisagov/dotgov-data/main/current-full.csv';
const GUESS_BUDGET_MS = 180000;
// Uses the system resolver, because Node's own resolver fails behind many VPNs and DNS filters.
const hostExists = (h) => Promise.race([lookup(h).then(() => true, () => false), new Promise((r) => { setTimeout(r, 3000, false).unref(); })]);

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function loadDotgov() {
  ensureDir(P.cache);
  const file = join(P.cache, 'dotgov-current-full.csv');
  const stale = !existsSync(file) || Date.now() - statSync(file).mtimeMs > 30 * 86400e3;
  if (stale) {
    try {
      const r = await fetch(DOTGOV_URL, { signal: AbortSignal.timeout(90000) });
      if (r.ok) writeFileSync(file, await r.text());
    } catch (e) { if (!existsSync(file)) throw new Error(`Could not download the .gov registry: ${e.message}`); }
  }
  return parseCsv(readFileSync(file, 'utf8')).slice(1).filter((r) => r.length >= 6)
    .map((r) => ({ domain: r[0].toLowerCase(), type: r[1], org: r[2], sub: r[3], city: r[4], state: r[5] }));
}

// The registry sometimes adds the state, as in "City of Dayton, Ohio". That has to go, or the name never matches.
export const stripGovWords = (n) => String(n).replace(/^(the\s+)?(city|town|village|township|borough|county|municipality)\s+of\s+/i, '').replace(/,\s*[a-z. ]+$/i, '').replace(/[,]?\s+(government|board of trustees|trustees|board of commissioners|commissioners)$/i, '');
const LOW_VALUE_DOMAIN = /(vote|elect|court|clerk|fire|police|sheriff|health|library|parks?|water|engineer|auditor|treasurer|recorder|prosecutor|coroner|911|ems)/i;

function chooseDomain(entries, name) {
  const key = normName(name).replace(/\s+/g, '');
  const scored = entries.map((e) => {
    let s = 0;
    if (!e.sub) s += 2;
    if (e.domain.replace(/[^a-z0-9]/g, '').includes(key)) s += 3;
    if (LOW_VALUE_DOMAIN.test(e.domain)) s -= 3;
    return { e, s: s - e.domain.length / 100 };
  });
  return scored.sort((a, b) => b.s - a.s)[0].e;
}

// "libertytwplickingoh.gov" names Licking County, so it cannot belong to Liberty Township in Fairfield County.
function domainNamesOtherCounty(domain, gov, counties) {
  const own = normName(gov.name.match(/\(([^)]+)\)/)?.[1] ?? '').replace(/\s+/g, '');
  const township = normName(gov.name.replace(/\s*\(.*$/, '')).replace(/\s+/g, '');
  const stem = domain.split('.')[0].replace(/[^a-z0-9]/g, '').replace(township, '');
  if (own && stem.includes(own)) return false;
  return (counties.get(gov.state) ?? []).some((c) => c !== own && c.length >= 5 && stem.includes(c));
}

/** Attach official .gov websites. Same-named townships are told apart using the registry's city. */
export async function matchDotgov(govs, dotgov) {
  const counties = new Map();
  for (const c of await table('county')) (counties.get(c.USPS) ?? counties.set(c.USPS, []).get(c.USPS)).push(normName(c.NAME).replace(/\s+/g, ''));
  const index = new Map();
  for (const g of govs) (index.get(`${normName(g.name.replace(/, [A-Z]{2}$/, ''))}|${g.state}|${g.level}`) ?? index.set(`${normName(g.name.replace(/, [A-Z]{2}$/, ''))}|${g.state}|${g.level}`, []).get(`${normName(g.name.replace(/, [A-Z]{2}$/, ''))}|${g.state}|${g.level}`)).push(g);
  const hits = new Map();
  for (const d of dotgov) {
    if (d.type !== 'City' && d.type !== 'County') continue;
    const org = stripGovWords(d.org);
    const n = normName(org);
    let levels;
    if (d.type === 'County') levels = ['county'];
    else if (/\b(township|twp)\b/i.test(d.org)) levels = ['township'];
    else if (/\bcity of\b|\bvillage of\b|\bcity$|\bvillage$/i.test(d.org)) levels = ['city'];
    else if (/\b(town of|town|borough)\b/i.test(d.org)) levels = ['township', 'city'];
    else continue; // "Columbus City Attorney" and similar sub-offices are not the employer's main site
    if (d.type === 'City' && !new RegExp(`^(the\\s+)?(city|town|village|township|borough)\\s+of\\s+|\\b(township|town|city|village|borough)$`, 'i').test(d.org.trim())) continue;
    for (const level of levels) {
      const cands = index.get(`${n}|${d.state}|${level}`);
      if (!cands?.length) continue;
      // Township names repeat statewide (Ohio has dozens of Washington Townships), and our candidates
      // only cover the radius. So a township must be proven near the registry's address, even when
      // just one candidate is in range. Without that, a same-named township across the state would match.
      const at = await geocodeCity(d.city, d.state);
      const nearest = at ? cands.map((g) => ({ g, m: haversineMiles(g.lat, g.lon, at.lat, at.lon) })).sort((a, b) => a.m - b.m)[0] : null;
      if (level === 'township' && (!nearest || nearest.m > 20)) continue;
      if (nearest && nearest.m > 40) continue;
      const target = nearest?.g ?? cands[0];
      if (level === 'township' && domainNamesOtherCounty(d.domain, target, counties)) continue;
      (hits.get(target.id) ?? hits.set(target.id, []).get(target.id)).push(d);
      break;
    }
  }
  for (const g of govs) {
    const entries = hits.get(g.id);
    if (entries) { g.website = `https://${chooseDomain(entries, g.name.replace(/, [A-Z]{2}$/, '')).domain}/`; g.websiteSource = '.gov registry'; }
  }
}

// School, special-district and tribal governments have no Gazetteer row. The registry supplies them directly.
async function dotgovOnlyGovernments(dotgov, center, radius, levels, states) {
  const map = { 'School district': 'school', 'Special district': 'special', Tribal: 'tribal' };
  const out = new Map();
  for (const d of dotgov) {
    const level = map[d.type];
    if (!level || !levels[level] || !states.includes(d.state)) continue;
    const at = await geocodeCity(d.city, d.state);
    if (!at) continue;
    const dist = haversineMiles(center.lat, center.lon, at.lat, at.lon);
    if (dist > radius) continue;
    const key = `${normName(d.org)}|${d.state}`;
    if (out.has(key)) continue;
    out.set(key, { id: `${level}-${hash(key, 10)}`, name: `${d.org}, ${d.state}`, level, state: d.state, lat: at.lat, lon: at.lon, distanceMi: Math.round(dist * 10) / 10, website: `https://${d.domain}/`, websiteSource: '.gov registry' });
  }
  return [...out.values()];
}

/** Census records carry a GNIS ID, and so does Wikidata (P590), which gives an exact join instead of name guessing. */
export async function matchWikidata(govs, center, radius) {
  const missing = govs.filter((g) => g.gnis);
  if (!missing.length) return 0;
  const km = Math.min(Math.round(radius * 1.609) + 40, 500);
  const q = `SELECT ?site ?gnis WHERE { SERVICE wikibase:around { ?item wdt:P625 ?coord . bd:serviceParam wikibase:center "Point(${center.lon} ${center.lat})"^^geo:wktLiteral . bd:serviceParam wikibase:radius "${km}" . } ?item wdt:P856 ?site . ?item wdt:P590 ?gnis . } LIMIT 20000`;
  const r = await politeFetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, { headers: { Accept: 'application/sparql-results+json' }, timeoutMs: 70000, checkRobots: false });
  if (!r.ok) return 0;
  const byGnis = new Map();
  for (const b of JSON.parse(r.text).results.bindings) {
    const site = b.site.value;
    const gnis = b.gnis.value.replace(/^0+/, '');
    // Prefer an https, non-social official site when an item lists more than one.
    if (/facebook\.com|twitter\.com|\/\/x\.com|instagram\.com|\/\/(www\.)?(visit|tourism|chamber|explore|discover)/i.test(site)) continue;
    if (!byGnis.has(gnis) || (site.startsWith('https') && !byGnis.get(gnis).startsWith('https'))) byGnis.set(gnis, site);
  }
  let n = 0;
  for (const g of missing) {
    const site = byGnis.get(g.gnis);
    if (!site) continue;
    // Some registered .gov domains have no live site, so keep this as a backup.
    if (g.website) { g.altWebsite = site; continue; }
    g.website = site; g.websiteSource = 'Wikidata'; n++;
  }
  return n;
}

// A guessed site only counts if the page itself names this place and its state or level of government.
function pageConfirmsGovernment(html, g) {
  const head = htmlToText(html).slice(0, 8000).toLowerCase();
  const name = baseName(g.name.replace(/, [A-Z]{2}$/, '')).toLowerCase();
  const stateWord = STATE_NAMES[g.state]?.toLowerCase();
  const titled = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').toLowerCase();
  // Township names repeat, so a guessed township site must also name its county.
  const county = g.name.match(/\(([^)]+?) County\)/)?.[1]?.toLowerCase();
  if (g.level === 'township' && county && !head.includes(county)) return false;
  return titled.includes(name) && (head.includes(stateWord) || new RegExp(`\\b${g.state.toLowerCase()}\\b`).test(head)) && /(township|village|city|county|town|borough|government|trustee|council|mayor|commission)/.test(head);
}

async function guessWebsite(g) {
  const s = normName(g.name.replace(/, [A-Z]{2}$/, '')).replace(/\s+/g, '');
  const st = g.state.toLowerCase();
  const stateWord = STATE_NAMES[g.state].toLowerCase().replace(/\s+/g, '');
  const stem = {
    township: [`${s}township`, `${s}twp`, `${s}township${st}`, `${s}twp${st}`, `${s}${stateWord}`],
    county: [`${s}county`, `${s}county${st}`, `${s}county${stateWord}`, `co${s}`],
    city: [`cityof${s}`, `${s}${st}`, `${s}${stateWord}`, `${s}${stateWord}usa`, `villageof${s}`, `${s}`],
  }[g.level] ?? [s];
  const hosts = stem.flatMap((x) => [`${x}.gov`, `${x}.org`]);
  // Most guesses do not exist. A DNS lookup rules those out at once, without any web request.
  const live = (await Promise.all(hosts.map((h) => hostExists(h).then((ok) => (ok ? h : null))))).filter(Boolean);
  for (const h of live.slice(0, 4)) {
    const r = await politeFetch(`https://${h}/`, { timeoutMs: 8000, retry: false });
    if (r.ok && pageConfirmsGovernment(r.text, g)) { g.website = r.url; g.websiteSource = 'verified guess'; return true; }
  }
  return false;
}

async function searxWebsite(g, baseUrl) {
  try {
    const q = `${baseName(g.name.replace(/, [A-Z]{2}$/, ''))} ${g.level} ${STATE_NAMES[g.state]} official website`;
    const r = await fetch(`${baseUrl.replace(/\/+$/, '')}/search?format=json&q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return false;
    for (const hit of ((await r.json()).results ?? []).slice(0, 5)) {
      if (/wikipedia|facebook|yelp|mapquest|census|niche\.com|linkedin/i.test(hit.url)) continue;
      const page = await politeFetch(hit.url, { timeoutMs: 10000 });
      if (page.ok && pageConfirmsGovernment(page.text, g)) { g.website = new URL(page.url).origin + '/'; g.websiteSource = 'SearXNG (verified)'; return true; }
    }
  } catch { /* optional source */ }
  return false;
}

const JOB_LINK = /\b(jobs?|careers?|employment|job openings?|job opportunities|join our team|work (for|with) us|now hiring|vacanc(y|ies))\b/i;
const HR_LINK = /\b(human resources|personnel|hr department)\b/i;
const COMMON_PATHS = ['/jobs', '/careers', '/employment', '/Jobs.aspx', '/employment-opportunities', '/job-opportunities', '/human-resources'];

export function extractLinks(html, baseUrl) {
  const out = [];
  const re = /<a\b[^>]*?href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    try {
      const u = new URL(decodeEntities(m[1]), baseUrl);
      if (u.protocol === 'http:' || u.protocol === 'https:') out.push({ url: u.href, text });
    } catch { /* malformed link */ }
  }
  return out;
}

const siteOf = (url) => new URL(url).hostname.replace(/^www\./, '').split('.').slice(-2).join('.');

function rankJobLinks(links, homeUrl) {
  const scored = [];
  const seen = new Set();
  const home = siteOf(homeUrl);
  for (const l of links) {
    if (seen.has(l.url) || /\.(pdf|docx?|jpg|png)(\?|$)/i.test(l.url) || /facebook\.|linkedin\.|indeed\.|ziprecruiter\./i.test(l.url)) continue;
    // A link to another site only counts if it is a hiring system. Otherwise "Dublin city" can
    // end up reading the local tourism bureau's job page.
    if (!detectAts(l.url) && siteOf(l.url) !== home) continue;
    let s = 0;
    if (detectAts(l.url)) s += 10;
    if (JOB_LINK.test(l.text)) s += 5;
    if (/job|career|employment/i.test(new URL(l.url).pathname)) s += 3;
    if (HR_LINK.test(l.text)) s += 2;
    if (/summer|volunteer|benefit|application form|equal employment|job description/i.test(l.text)) s -= 3;
    if (s > 0) { seen.add(l.url); scored.push({ ...l, s }); }
  }
  return scored.sort((a, b) => b.s - a.s);
}

// A homepage may link to one posting. Point at the employer's whole board instead.
function boardUrl(url) {
  const m = String(url).match(/^(https?:\/\/(?:www\.)?(?:governmentjobs|schooljobs)\.com\/careers\/[^/?#]+)/i);
  return m ? m[1] : url;
}

function setAtsResult(j, url, ats) {
  j.careersUrl = boardUrl(url); j.ats = ats.ats; j.scan = ats.scan; j.note = ats.note ?? '';
  j.coverage = ats.scan === 'link' ? 'link-only' : 'scannable';
}

/** Follow a government's website to its jobs page. Uses at most a few requests per site. */
export async function probeCareers(j) {
  if (j.careersManual) return j;
  if (!j.website) { j.coverage = 'no-website'; return j; }
  const direct = detectAts(j.website);
  if (direct) { setAtsResult(j, j.website, direct); return j; }
  let home = await politeFetch(j.website);
  // Dead or misconfigured sites are common. Try the www form, then the backup from Wikidata.
  if (!home.ok && !home.blocked && !home.text) {
    const u = new URL(j.website);
    const www = u.hostname.startsWith('www.') ? null : `${u.protocol}//www.${u.hostname}${u.pathname}`;
    for (const alt of [www, j.altWebsite].filter(Boolean)) {
      const r = await politeFetch(alt);
      if (r.ok) { home = r; j.website = r.url; if (alt === j.altWebsite) j.websiteSource = 'Wikidata'; break; }
    }
  }
  if (home.blocked) {
    j.coverage = 'blocked'; j.careersUrl = j.website; j.lastResult = home.blocked;
    j.note = home.blocked === 'robots' ? 'This site asks automated tools not to read it.' : 'This site has a bot check, so it needs a person.';
    return j;
  }
  if (!home.ok && !home.text) { j.coverage = 'unreachable'; j.note = home.error || `HTTP ${home.status}`; return j; }
  const links = extractLinks(home.text, home.url);
  const civic = /civicplus|civicengage|CivicLive/i.test(home.text);
  const ranked = rankJobLinks(links, home.url);
  for (const l of ranked.slice(0, 3)) {
    const ats = detectAts(l.url);
    if (ats) { setAtsResult(j, l.url, ats); return j; }
    const page = await politeFetch(l.url);
    if (page.blocked) continue;
    if (!page.ok) continue;
    const inner = detectAts(page.url);
    if (inner) { setAtsResult(j, page.url, inner); return j; }
    const innerRanked = rankJobLinks(extractLinks(page.text, page.url), page.url);
    const innerAts = innerRanked.find((x) => detectAts(x.url));
    if (innerAts) { setAtsResult(j, innerAts.url, detectAts(innerAts.url)); return j; }
    // An HR landing page often links one level further to the actual jobs list.
    const better = innerRanked.find((x) => JOB_LINK.test(x.text) && x.url !== page.url && new URL(x.url).host === new URL(page.url).host && !JOB_LINK.test(l.text));
    j.careersUrl = better?.url ?? page.url; j.scan = 'html'; j.ats = civic ? 'CivicPlus' : 'Website page'; j.coverage = 'scannable'; j.note = '';
    return j;
  }
  const origin = new URL(home.url).origin;
  for (const path of (civic ? ['/Jobs.aspx', ...COMMON_PATHS] : COMMON_PATHS)) {
    const page = await politeFetch(origin + path, { timeoutMs: 12000 });
    if (page.ok && !page.binary && JOB_LINK.test(htmlToText(page.text).slice(0, 4000))) {
      j.careersUrl = page.url; j.scan = 'html'; j.ats = civic ? 'CivicPlus' : 'Website page'; j.coverage = 'scannable'; j.note = '';
      return j;
    }
  }
  j.coverage = 'no-jobs-page'; j.careersUrl = home.url;
  j.note = 'The website has no obvious jobs page. Small governments often post openings as news items or in the local paper.';
  return j;
}

/** Statewide association and school boards for every state the search radius touches. */
export function stateBoardRows(cfg, states) {
  const rows = [];
  for (const st of states) {
    for (const b of STATE_BOARDS[st] ?? []) {
      if (cfg.levels[b.level] === false) continue;
      const link = b.read === 'link';
      rows.push({
        id: `board-${st}-${hash(b.url, 8)}`, name: b.name, level: b.level, state: st, distanceMi: null, statewide: true,
        website: b.url, careersUrl: b.url, websiteSource: 'built-in list', ats: 'Statewide board', board: b.read,
        scan: link ? 'link' : 'board', coverage: link ? 'link-only' : 'scannable',
        note: b.note ?? 'Statewide board. Only postings inside your distance are kept.',
      });
    }
  }
  return rows;
}

function fixedBoards(cfg, states, center) {
  const rows = [];
  if (cfg.levels.state) {
    for (const st of states) {
      const url = STATE_PORTALS[st];
      if (!url) continue;
      const ats = detectAts(url);
      rows.push({
        id: `state-${st}`, name: `State of ${STATE_NAMES[st]}`, level: 'state', state: st, distanceMi: null,
        website: url, careersUrl: url, websiteSource: 'built-in list', ats: ats?.ats ?? 'State portal', scan: ats?.scan ?? 'html', note: ats?.note ?? '',
        coverage: ats?.scan === 'link' ? 'link-only' : 'scannable',
      });
    }
  }
  rows.push(...stateBoardRows(cfg, states));
  if (cfg.levels.federal) {
    rows.push({ id: 'federal-usajobs', name: 'USAJOBS (all federal agencies)', level: 'federal', state: 'US', distanceMi: null, website: 'https://www.usajobs.gov/', careersUrl: 'https://www.usajobs.gov/', websiteSource: 'built-in list', ats: 'USAJOBS', scan: 'usajobs', coverage: 'scannable', note: '' });
    for (const b of FEDERAL_OWN_BOARDS) {
      rows.push({ id: `federal-${hash(b.name, 8)}`, name: b.name, level: 'federal', state: 'US', distanceMi: null, website: b.url, careersUrl: b.url, websiteSource: 'built-in list', ats: 'Own site', scan: 'link', coverage: 'link-only', note: 'Hires outside USAJOBS. Worth a manual look if it interests you.' });
    }
  }
  // Government-adjacent employers such as the Postal Service. On unless the level is switched off in Setup.
  if (cfg.levels.adjacent !== false) {
    for (const b of ADJACENT_BOARDS) {
      if (b.states && !b.states.some((st) => states.includes(st))) continue; // a regional employer nowhere near you
      rows.push({ id: `adjacent-${hash(b.name, 8)}`, name: b.name, level: 'adjacent', state: 'US', distanceMi: null, website: b.url, careersUrl: b.url, websiteSource: 'built-in list', ats: 'Own site', scan: 'link', coverage: 'link-only', note: b.note });
    }
  }
  for (const b of cfg.sources.extraBoards ?? []) {
    const ats = detectAts(b.url);
    const dist = b.lat != null ? haversineMiles(center.lat, center.lon, b.lat, b.lon) : null;
    // Several districts can share one board, told apart by boardFilter, so the filter is part of the id.
    const key = b.boardFilter ? `${b.url}#${b.boardFilter}` : b.url;
    rows.push({ id: `extra-${hash(key, 10)}`, name: b.name, level: b.level || 'special', state: b.state || '', distanceMi: dist, website: b.url, careersUrl: b.url, careersManual: true, websiteSource: 'added by you', ats: ats?.ats ?? 'Website page', scan: ats?.scan ?? 'html', coverage: ats?.scan === 'link' ? 'link-only' : 'scannable', note: ats?.note ?? '', ...(b.boardFilter ? { boardFilter: b.boardFilter } : {}) });
  }
  return rows;
}

export async function discover(cfg, { onProgress = () => {}, skipProbe = false } = {}) {
  const { lat, lon, radiusMiles: radius } = cfg.location;
  if (lat == null) throw new Error('Set your location first.');
  onProgress('Loading Census list of governments');
  await table('county');
  const states = await statesWithin(lat, lon, radius);
  const govs = await governmentsWithin(lat, lon, radius, cfg.levels);
  onProgress(`Found ${govs.length} governments. Matching official websites`);
  const dotgov = (await loadDotgov()).filter((d) => states.includes(d.state));
  await matchDotgov(govs, dotgov);
  const extras = await dotgovOnlyGovernments(dotgov, { lat, lon }, radius, cfg.levels, states);
  if (cfg.sources.wikidata) {
    onProgress('Looking up remaining websites on Wikidata');
    await matchWikidata(govs, { lat, lon }, radius);
  }
  if (cfg.sources.searxngUrl) {
    const left = govs.filter((g) => !g.website);
    onProgress(`Searching SearXNG for ${left.length} websites`);
    await pool(left, 4, (g) => searxWebsite(g, cfg.sources.searxngUrl));
  }
  if (cfg.sources.guessDomains) {
    // Cities and counties first, since they hire the most. Stop at the time budget and report what was skipped.
    const rank = { county: 0, city: 1, township: 2 };
    const left = govs.filter((g) => !g.website).sort((a, b) => (rank[a.level] ?? 3) - (rank[b.level] ?? 3) || a.distanceMi - b.distanceMi);
    const deadline = Date.now() + GUESS_BUDGET_MS;
    // Kept deliberately slow: a burst of lookups can overwhelm a local DNS service and make real sites look down.
    await pool(left, 1, (g) => (Date.now() < deadline ? guessWebsite(g) : false), (done, total) => onProgress(`Trying likely website names ${done}/${total}`));
  }
  const previous = new Map((readJson(P.jurisdictions, []) ?? []).map((j) => [j.id, j]));
  const merged = [...fixedBoards(cfg, states, { lat, lon }), ...govs, ...extras].map((j) => {
    const old = previous.get(j.id);
    if (!old) return j;
    // Keep your manual edits and scan history. If you set a website by hand, it outranks every source.
    const keep = { lastScan: old.lastScan, lastCount: old.lastCount, lastResult: old.lastResult, checkedAt: old.checkedAt };
    if (old.careersManual) Object.assign(keep, { careersManual: true, careersUrl: old.careersUrl, scan: old.scan, ats: old.ats, coverage: old.coverage, note: old.note });
    if (old.websiteManual) Object.assign(keep, { websiteManual: true, website: old.website, websiteSource: old.websiteSource });
    return { ...j, ...keep };
  });
  if (!skipProbe) {
    const todo = merged.filter((j) => !j.coverage);
    onProgress(`Checking ${todo.length} websites for jobs pages`);
    await pool(todo, 10, probeCareers, (done, total, j) => onProgress(`Checking websites ${done}/${total}: ${j.name}`));
  }
  for (const j of merged) j.coverage ??= j.website ? 'not-probed' : 'no-website';
  writeJson(P.jurisdictions, merged);
  return merged;
}

export function coverageSummary(list) {
  const c = {};
  for (const j of list) c[j.coverage] = (c[j.coverage] ?? 0) + 1;
  return c;
}
