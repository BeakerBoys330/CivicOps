// Shared helpers: paths, atomic JSON storage, text cleanup, geometry.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = process.env.CIVIC_OPS_ROOT
  ? resolve(process.env.CIVIC_OPS_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const P = {
  root: ROOT,
  config: join(ROOT, 'config'),
  profile: join(ROOT, 'config', 'profile.json'),
  secrets: join(ROOT, 'config', 'secrets.json'),
  data: join(ROOT, 'data'),
  cache: join(ROOT, 'data', 'cache'),
  jobs: join(ROOT, 'data', 'jobs.json'),
  jurisdictions: join(ROOT, 'data', 'jurisdictions.json'),
  meta: join(ROOT, 'data', 'meta.json'),
  tracker: join(ROOT, 'data', 'applications.md'),
  reports: join(ROOT, 'reports'),
  output: join(ROOT, 'output'),
  modes: join(ROOT, 'modes'),
  cv: join(ROOT, 'cv.md'),
  proof: join(ROOT, 'proof-points.md'),
  web: join(ROOT, 'web'),
};

export function ensureDir(p) { mkdirSync(p, { recursive: true }); return p; }

export function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  // Notepad and PowerShell can add an invisible byte-order mark when saving, so strip it.
  try { return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')); }
  catch (e) { throw new Error(`Could not parse ${path}: ${e.message}`); }
}

// Write to a temp file then rename, so a crash mid-write cannot corrupt your data.
export function writeJson(path, value) {
  ensureDir(dirname(path));
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, path);
}

export function readText(path, fallback = '') {
  return existsSync(path) ? readFileSync(path, 'utf8').replace(/^﻿/, '') : fallback;
}

export const hash = (s, n = 12) => createHash('sha256').update(String(s)).digest('hex').slice(0, n);

export const slug = (s, n = 50) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, n) || 'item';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', bull: '*', hellip: '...' };
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(html) {
  return decodeEntities(String(html ?? '')
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?(p|div|li|ul|ol|tr|table|h[1-6]|br|section|article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function haversineMiles(aLat, aLon, bLat, bLon) {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Run async work over items with a concurrency cap; one failing item never stops the rest.
export async function pool(items, limit, fn, onProgress) {
  let i = 0, done = 0;
  const results = new Array(items.length);
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await fn(items[idx], idx); }
      catch (e) { results[idx] = { error: e.message }; }
      done++;
      onProgress?.(done, items.length, items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

// The local calendar date. toISOString() is UTC, which is already tomorrow on a US evening.
export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Parse the assorted date styles posted by government sites. Returns YYYY-MM-DD or null.
export function toIsoDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export const LEVELS = ['federal', 'state', 'county', 'city', 'township', 'school', 'special', 'tribal', 'adjacent'];
export const LEVEL_LABEL = {
  federal: 'Federal', state: 'State', county: 'County', city: 'City / village', township: 'Township / town',
  school: 'School district', special: 'Special district', tribal: 'Tribal', adjacent: 'Government-adjacent',
};
export const STATUSES = ['New', 'Saved', 'Evaluated', 'Applying', 'Applied', 'Referred', 'Exam', 'Interview', 'Eligible list', 'Offer', 'Hired', 'Rejected', 'Withdrawn', 'Skipped', 'Closed'];
