// Census Bureau Gazetteer files: the authoritative list of US counties, incorporated places and
// county subdivisions (townships, New England towns), each with coordinates. Downloaded once, then local.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { P, ensureDir, haversineMiles } from './util.mjs';

const YEAR = '2024';
const BASE = `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${YEAR}_Gazetteer`;
const FILES = { place: `${YEAR}_Gaz_place_national`, cousub: `${YEAR}_Gaz_cousubs_national`, county: `${YEAR}_Gaz_counties_national`, zcta: `${YEAR}_Gaz_zcta_national` };

function firstZipEntry(buf) {
  const at = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (at < 0) throw new Error('not a zip file');
  const method = buf.readUInt16LE(at + 8);
  const nameLen = buf.readUInt16LE(at + 26), extraLen = buf.readUInt16LE(at + 28);
  // Sizes may live in the central directory when the data-descriptor flag is set.
  let compressed = buf.readUInt32LE(at + 18);
  if (buf.readUInt16LE(at + 6) & 0x08 || compressed === 0) {
    const cd = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    compressed = buf.readUInt32LE(cd + 20);
  }
  const start = at + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + compressed);
  return method === 8 ? inflateRawSync(raw) : raw;
}

async function loadTable(kind) {
  ensureDir(P.cache);
  const file = join(P.cache, `${FILES[kind]}.txt`);
  if (!existsSync(file)) {
    const r = await fetch(`${BASE}/${FILES[kind]}.zip`, { signal: AbortSignal.timeout(180000) });
    if (!r.ok) throw new Error(`Census download failed for ${kind}: HTTP ${r.status}`);
    writeFileSync(file, firstZipEntry(Buffer.from(await r.arrayBuffer())));
  }
  const lines = readFileSync(file, 'latin1').split(/\r?\n/);
  const head = lines[0].split('\t').map((h) => h.trim());
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split('\t');
    const row = {};
    head.forEach((h, j) => { row[h] = (cols[j] ?? '').trim(); });
    row.lat = parseFloat(row.INTPTLAT);
    row.lon = parseFloat(row.INTPTLONG);
    out.push(row);
  }
  return out;
}

const tables = {};
export const table = (kind) => (tables[kind] ??= loadTable(kind));

export const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida',
  GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico',
};
const NAME_TO_STATE = Object.fromEntries(Object.entries(STATE_NAMES).map(([k, v]) => [v.toLowerCase(), k]));
export const stateCode = (s) => {
  const t = String(s ?? '').trim();
  if (STATE_NAMES[t.toUpperCase()]) return t.toUpperCase();
  return NAME_TO_STATE[t.toLowerCase()] ?? '';
};

// "Columbus city" -> "Columbus"; used to compare names across data sources.
const SUFFIX = /\s+(city|town|township|charter township|village|borough|municipality|plantation|cdp|corporation|urban county|consolidated government|metro government|metropolitan government|unified government|county)(\s*\(balance\))?$/i;
export const baseName = (n) => String(n).replace(/\s*\(balance\)/i, '').replace(/\s*\([^)]*County\)/i, '').replace(SUFFIX, '').replace(SUFFIX, '').trim();
export const normName = (n) => baseName(n).toLowerCase().replace(/^(st|ste)\.?\s/, 'saint ').replace(/\bmt\.?\s/, 'mount ').replace(/[^a-z0-9]+/g, ' ').trim();

let cityIndex, sameName;
async function cityLookup() {
  if (cityIndex) return cityIndex;
  cityIndex = new Map();
  sameName = new Map(); // every place and subdivision that shares a name, for geocodeCityNear
  for (const kind of ['cousub', 'place']) { // places overwrite subdivisions when names collide
    for (const r of await table(kind)) {
      const key = `${normName(r.NAME)}|${r.USPS}`;
      const hit = { lat: r.lat, lon: r.lon, name: r.NAME, state: r.USPS };
      cityIndex.set(key, hit);
      if (!sameName.has(key)) sameName.set(key, []);
      // A subdivision's GEOID starts with its county's five digits.
      sameName.get(key).push({ hit, township: kind === 'cousub' && /township$/i.test(r.NAME), county: kind === 'cousub' ? r.GEOID.slice(0, 5) : '', active: r.FUNCSTAT === 'A' });
    }
  }
  return cityIndex;
}

export async function geocodeCity(city, state) {
  const idx = await cityLookup();
  return idx.get(`${normName(city)}|${stateCode(state)}`) ?? null;
}

/**
 * For a name a state uses more than once (Ohio has six Butler townships and a Butler village).
 * "X Township" only matches townships, and the county named beside it picks the one inside that county
 * (or, for a city or village, the nearest one).
 */
export async function geocodeCityNear(city, state, county) {
  const plain = await geocodeCity(city, state);
  let all = sameName.get(`${normName(city)}|${stateCode(state)}`) ?? [];
  if (/\btownship$/i.test(String(city).trim()) && all.some((c) => c.township)) all = all.filter((c) => c.township);
  if (all.length < 2) return all[0]?.hit ?? plain;
  const center = county ? await geocodeCounty(county, state) : null;
  if (!center) return plain; // nothing to choose by, so the answer is the same as geocodeCity
  const inside = all.filter((c) => c.county === center.fips);
  if (inside.length) return (inside.find((c) => c.active) ?? inside[0]).hit;
  return all.map((c) => c.hit).sort((a, b) => haversineMiles(center.lat, center.lon, a.lat, a.lon) - haversineMiles(center.lat, center.lon, b.lat, b.lon))[0];
}

let countyIndex;
/** County center, for postings that name only a county ("Franklin County"). */
export async function geocodeCounty(county, state) {
  if (!countyIndex) {
    countyIndex = new Map();
    for (const r of await table('county')) countyIndex.set(`${normName(r.NAME)}|${r.USPS}`, { lat: r.lat, lon: r.lon, name: r.NAME, state: r.USPS, fips: r.GEOID });
  }
  return countyIndex.get(`${normName(county)}|${stateCode(state)}`) ?? null;
}

/** Accepts a ZIP code, "City, ST", or "lat,lon". Works offline after the first download. */
export async function resolveLocation(query) {
  const q = String(query ?? '').trim();
  if (!q) throw new Error('Enter a ZIP code or "City, ST".');
  let found = null;
  const coords = q.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (coords) {
    found = { lat: +coords[1], lon: +coords[2], label: q };
  } else if (/^\d{5}(-\d{4})?$/.test(q)) {
    const z = (await table('zcta')).find((r) => r.GEOID === q.slice(0, 5));
    if (!z) throw new Error(`ZIP code ${q} is not in the Census list. Try "City, ST".`);
    found = { lat: z.lat, lon: z.lon, label: `ZIP ${q.slice(0, 5)}` };
  } else {
    const m = q.match(/^(.+?)[,\s]+([A-Za-z]{2}|[A-Za-z ]{4,})$/);
    const st = m ? stateCode(m[2]) : '';
    if (!m || !st) throw new Error('Use a ZIP code or "City, ST" (for example "Dayton, OH").');
    const hit = await geocodeCity(m[1], st);
    if (!hit) throw new Error(`Could not find "${m[1]}" in ${STATE_NAMES[st]}. Check the spelling or use a ZIP code.`);
    found = { lat: hit.lat, lon: hit.lon, label: `${baseName(hit.name)}, ${st}` };
  }
  let nearest = null, best = Infinity;
  for (const c of await table('county')) {
    const d = haversineMiles(found.lat, found.lon, c.lat, c.lon);
    if (d < best) { best = d; nearest = c; }
  }
  return { query: q, ...found, state: nearest?.USPS ?? '' };
}

/** States a search radius can touch. County centers are padded because a county's edge is nearer than its center. */
export async function statesWithin(lat, lon, radius) {
  const set = new Set();
  for (const c of await table('county')) {
    if (haversineMiles(lat, lon, c.lat, c.lon) <= radius + 30) set.add(c.USPS);
  }
  return [...set].sort();
}

/**
 * Every active general-purpose government inside the radius.
 * FUNCSTAT A/B/C mean an active government; S (census-designated) and F (fictitious) have no government to hire anyone.
 */
export async function governmentsWithin(lat, lon, radius, levels) {
  const out = [];
  const add = (r, level, name) => {
    const distanceMi = haversineMiles(lat, lon, r.lat, r.lon);
    if (distanceMi > radius) return;
    out.push({
      id: `${level}-${r.GEOID}`, name, level, state: r.USPS, lat: r.lat, lon: r.lon,
      distanceMi: Math.round(distanceMi * 10) / 10, gnis: String(r.ANSICODE).replace(/^0+/, ''),
    });
  };
  if (levels.county) for (const r of await table('county')) add(r, 'county', `${r.NAME}, ${r.USPS}`);
  const active = (r) => ['A', 'B', 'C'].includes(r.FUNCSTAT);
  const seen = new Set();
  if (levels.city) {
    for (const r of await table('place')) {
      if (!active(r)) continue;
      seen.add(`${normName(r.NAME)}|${r.USPS}`);
      add(r, 'city', `${r.NAME.replace(/\s*\(balance\)/i, '')}, ${r.USPS}`);
    }
  }
  if (levels.township) {
    const countyByFips = new Map((await table('county')).map((c) => [c.GEOID, c.NAME]));
    for (const r of await table('cousub')) {
      if (!active(r)) continue;
      if (!/\b(township|town|plantation|gore|grant|location|borough)$/i.test(r.NAME)) continue;
      // A New England or NY "town" can share a name with a place. Same government, so keep one row.
      if (seen.has(`${normName(r.NAME)}|${r.USPS}`) && !/township$/i.test(r.NAME)) continue;
      const county = countyByFips.get(r.GEOID.slice(0, 5));
      add(r, 'township', `${r.NAME}${county ? ` (${county})` : ''}, ${r.USPS}`);
    }
  }
  return out.sort((a, b) => a.distanceMi - b.distanceMi);
}
