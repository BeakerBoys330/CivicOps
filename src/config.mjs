// User configuration, stored in config/profile.json. Created on first run; never leaves this machine.
import { P, readJson, writeJson } from './util.mjs';

export const DEFAULT_CONFIG = {
  location: { query: '', label: '', lat: null, lon: null, state: '', radiusMiles: 50 },
  levels: { federal: true, state: true, county: true, city: true, township: true, school: false, special: true, tribal: false, adjacent: true },
  search: {
    titles: [],          // words or phrases a job title should contain, e.g. "analyst", "planner"
    exclude: ['intern', 'seasonal'], // titles containing these are hidden
    minSalary: 0,        // annual dollars; 0 means no minimum. Hourly pay is annualized at 2,080 hours.
    includeRemoteFederal: true,
    federalLookbackDays: 30,
  },
  candidate: {
    name: '', usCitizen: null, veteran: null, veteransPreference: '', clearance: '',
    currentFederalEmployee: false, currentGrade: '', licenses: [], willingToRelocate: false, notes: '',
  },
  ai: {
    privacy: 'local-only', // 'local-only' never sends your CV off this network. 'allow-cloud' permits cloud providers and agent CLIs.
    roles: {
      triage: { provider: '', model: '' },   // fast and cheap: scores many postings
      extract: { provider: '', model: '' },  // reads unstructured career pages
      evaluate: { provider: '', model: '' }, // deep, one posting at a time
      write: { provider: '', model: '' },    // resumes, cover letters, essays
      embed: { provider: '', model: '' },    // optional: ranks postings against your CV by similarity
    },
    providers: {},        // per-provider overrides: { "ollama": { "baseUrl": "http://192.168.1.20:11434" } }
    custom: [],           // your own endpoints: [{ id, label, baseUrl, apiKeyEnv, kind: "openai" | "ollama" }]
    temperature: 0.2,
    maxOutputTokens: 3000,
    jobTextChars: 14000,  // how much posting text is sent to a model; lower this for small context windows
    concurrency: 1,       // parallel AI requests; most local machines do best with 1
    requestTimeoutSec: 600,
  },
  sources: {
    usajobsEmail: '',     // the email you registered with USAJOBS; only used with an API key
    wikidata: true,       // look up official websites for places that have no .gov domain
    guessDomains: false,  // experimental: try likely website names. Slow, and heavy DNS use can disrupt other lookups.
    searxngUrl: '',       // optional self-hosted SearXNG, used to find remaining websites
    extraBoards: [],      // your own additions: [{ name, level, url, state }]
  },
};

function merge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over ?? {})) out[k] = k in base ? merge(base[k], over[k]) : over[k];
  return out;
}

export function loadConfig() { return merge(DEFAULT_CONFIG, readJson(P.profile, {})); }
export function saveConfig(cfg) { writeJson(P.profile, cfg); return cfg; }
export function updateConfig(patch) { return saveConfig(merge(loadConfig(), patch)); }

// API keys come from environment variables first, then config/secrets.json. Never from profile.json.
export function getSecret(name) {
  if (!name) return '';
  return process.env[name] || readJson(P.secrets, {})[name] || '';
}
export function setSecret(name, value) {
  const s = readJson(P.secrets, {});
  if (value) s[name] = value; else delete s[name];
  writeJson(P.secrets, s);
}
