// One chat() and embed() across every backend, with the privacy gate, JSON repair and context handling.
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { getSecret, loadConfig } from '../config.mjs';
import { allProviders, getProvider } from './registry.mjs';

export class AiError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

const trimSlash = (s) => String(s).replace(/\/+$/, '');
function authHeaders(p) {
  const key = getSecret(p.apiKeyEnv);
  return key ? { Authorization: `Bearer ${key}` } : {};
}

// ---------- Discovery ----------

function looksLikeEmbedding(id, type) {
  return type === 'embeddings' || /embed|bge-|minilm|nomic-embed/i.test(id);
}

async function listModels(p, timeoutMs = 2500) {
  const signal = AbortSignal.timeout(timeoutMs);
  if (p.kind === 'ollama') {
    const r = await fetch(`${trimSlash(p.baseUrl)}/api/tags`, { signal });
    if (!r.ok) return null;
    const j = await r.json();
    if (!Array.isArray(j.models)) return null;
    return j.models.map((m) => ({ id: m.name, embedding: looksLikeEmbedding(m.name), size: m.size }));
  }
  if (p.kind === 'anthropic') {
    const r = await fetch(`${trimSlash(p.baseUrl)}/v1/models?limit=100`, { signal, headers: { 'x-api-key': getSecret(p.apiKeyEnv), 'anthropic-version': '2023-06-01' } });
    if (!r.ok) return null;
    return ((await r.json()).data ?? []).map((m) => ({ id: m.id, embedding: false }));
  }
  const r = await fetch(`${trimSlash(p.baseUrl)}/models`, { signal, headers: authHeaders(p) });
  if (!r.ok) return null;
  const j = await r.json();
  // Most services wrap the list in { data: [...] }. Together returns a bare array.
  const list = Array.isArray(j) ? j : j.data;
  if (!Array.isArray(list)) return null;
  const models = list.filter((m) => m?.id).map((m) => ({ id: m.id, embedding: looksLikeEmbedding(m.id, m.type), owner: m.owned_by }));
  // LM Studio exposes extra detail: which models are loaded and how big their context can be.
  if (p.id === 'lmstudio') {
    try {
      const native = await fetch(`${trimSlash(p.baseUrl).replace(/\/v1$/, '')}/api/v0/models`, { signal: AbortSignal.timeout(timeoutMs) });
      if (native.ok) {
        const byId = new Map((await native.json()).data.map((m) => [m.id, m]));
        for (const m of models) {
          const n = byId.get(m.id);
          if (n) { m.loaded = n.state === 'loaded'; m.maxContext = n.max_context_length; m.quant = n.quantization; }
        }
      }
    } catch { /* optional detail only */ }
  }
  return models;
}

function commandExists(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8', timeout: 5000 });
  return r.status === 0;
}

/** Probe local runtimes and agent CLIs. Runtimes sharing a default port are told apart by what they report. */
export async function detectProviders(cfg = loadConfig(), { includeCloud = true } = {}) {
  const list = allProviders(cfg);
  const probed = new Map();
  const probe = (p) => {
    const key = `${p.kind}|${p.baseUrl}`;
    if (!probed.has(key)) probed.set(key, listModels(p, p.local ? 2500 : 6000).catch(() => null));
    return probed.get(key);
  };
  const out = [];
  await Promise.all(list.map(async (p) => {
    const row = { id: p.id, label: p.label, kind: p.kind, baseUrl: p.baseUrl, local: p.local, site: p.site, keyUrl: p.keyUrl, signIn: p.signIn, install: p.install, login: p.login, custom: !!p.custom, apiKeyEnv: p.apiKeyEnv, hasKey: !!getSecret(p.apiKeyEnv), available: false, models: [] };
    if (p.kind === 'cli') {
      row.available = commandExists(p.command);
      row.models = row.available ? p.models.map((id) => ({ id, embedding: false })) : [];
    } else if (p.local || (includeCloud && row.hasKey)) {
      const models = await probe(p);
      if (models) { row.available = true; row.models = models; }
      // Some services have no model list. Offer their known models; the Test button confirms the key works.
      else if (!p.local && row.hasKey && p.models?.length) { row.available = true; row.unverified = true; row.models = p.models.map((id) => ({ id, embedding: false })); }
    }
    out.push(row);
  }));
  // Several runtimes share port 8080 or 5000. Show only the one that matches, or one generic row.
  const groups = new Map();
  for (const r of out) if (r.available && r.local && !r.custom) (groups.get(r.baseUrl) ?? groups.set(r.baseUrl, []).get(r.baseUrl)).push(r);
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const owners = new Set(rows[0].models.map((m) => String(m.owner ?? '').toLowerCase()));
    const match = rows.find((r) => (list.find((p) => p.id === r.id).owners ?? []).some((o) => [...owners].some((x) => x.includes(o))));
    const keep = match ?? rows[0];
    if (!match) keep.note = `Answers on this port. It could also be ${rows.slice(1).map((r) => r.label).join(', ')}.`;
    for (const r of rows) if (r !== keep) { r.available = false; r.models = []; r.sharedPort = true; }
  }
  const order = new Map(list.map((p, i) => [p.id, i]));
  return out.sort((a, b) => order.get(a.id) - order.get(b.id));
}

const sizeHint = (id) => {
  const m = String(id).match(/(\d+(?:\.\d+)?)\s*b\b/i);
  return m ? parseFloat(m[1]) : null;
};

/** Sensible first assignment: strongest model for deep work, smallest for bulk work. */
export function autoAssignRoles(detected) {
  const p = detected.find((d) => d.available && d.local && d.models.some((m) => !m.embedding));
  if (!p) return null;
  const chat = p.models.filter((m) => !m.embedding);
  const ranked = [...chat].sort((a, b) => (sizeHint(a.id) ?? 0) - (sizeHint(b.id) ?? 0));
  // Biggest is not best: in testing on a home PC, 9B and 27B models each passed 10 minutes on one
  // posting, while 4B models took about a minute. Stay small and let people choose bigger after testing.
  const practical = ranked.filter((m) => (sizeHint(m.id) ?? 0) <= 8);
  const small = ranked[0].id, big = (practical.length ? practical[practical.length - 1] : ranked[ranked.length - 1]).id;
  const embed = detected.flatMap((d) => (d.available && d.local ? d.models.filter((m) => m.embedding).map((m) => ({ provider: d.id, model: m.id })) : []))[0];
  return {
    triage: { provider: p.id, model: small }, extract: { provider: p.id, model: small },
    evaluate: { provider: p.id, model: big }, write: { provider: p.id, model: big },
    embed: embed ?? { provider: '', model: '' },
  };
}

// ---------- Choosing a model ----------

const FALLBACK = { triage: ['extract', 'evaluate', 'write'], extract: ['triage', 'evaluate', 'write'], evaluate: ['write', 'triage', 'extract'], write: ['evaluate', 'triage', 'extract'], embed: [] };

export function resolveRole(cfg, role) {
  const roles = cfg.ai.roles ?? {};
  for (const r of [role, ...(FALLBACK[role] ?? [])]) {
    if (roles[r]?.provider && roles[r]?.model) return { ...roles[r], role: r };
  }
  return null;
}

export const hasAi = (cfg, role) => !!resolveRole(cfg, role);

// The one place that decides whether data may leave your network.
export function assertPrivacy(cfg, provider) {
  if (cfg.ai.privacy !== 'allow-cloud' && !provider.local) {
    throw new AiError(`${provider.label} sends data off this network, and privacy is set to local-only. Pick a local model or change privacy to allow-cloud.`, 'privacy');
  }
}

// ---------- Transports ----------

async function* sseLines(res) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { yield buf.slice(0, i).trim(); buf = buf.slice(i + 1); }
  }
  if (buf.trim()) yield buf.trim();
}

function httpError(p, status, text) {
  const detail = String(text).slice(0, 300);
  if (/context|too long|n_ctx|exceeds|maximum.*tokens|too many tokens/i.test(detail)) {
    return new AiError(`${p.label}: the prompt is larger than this model's context window. ${detail}`, 'context');
  }
  if (status === 400 && /response_format|json_schema|schema|format/i.test(detail)) return new AiError(detail, 'no-schema');
  if (status === 401 || status === 403) return new AiError(`${p.label} rejected the API key (HTTP ${status}).`, 'auth');
  return new AiError(`${p.label} returned HTTP ${status}: ${detail}`, 'http');
}

// Streaming means a slow local model cannot hit a "no response yet" timeout during long generations.
async function chatOpenAI(p, a) {
  const body = {
    model: a.model, stream: true, temperature: a.temperature, max_tokens: a.maxTokens,
    messages: [{ role: 'system', content: a.system }, { role: 'user', content: a.user }],
  };
  if (a.schema) body.response_format = { type: 'json_schema', json_schema: { name: 'result', strict: false, schema: a.schema } };
  const res = await fetch(`${trimSlash(p.baseUrl)}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(p) }, body: JSON.stringify(body), signal: a.signal,
  });
  if (!res.ok) throw httpError(p, res.status, await res.text());
  let text = '', usage = null, finish = null, tail = '';
  for await (const line of sseLines(res)) {
    if (!line.startsWith('data:')) { tail += line; continue; }
    const data = line.slice(5).trim();
    if (data === '[DONE]') break;
    let j;
    try { j = JSON.parse(data); } catch { continue; }
    if (j.error) throw httpError(p, 400, j.error.message ?? JSON.stringify(j.error));
    const choice = j.choices?.[0];
    if (choice?.delta?.content) { text += choice.delta.content; a.onToken?.(text.length); }
    else if (choice?.message?.content) text += choice.message.content;
    if (choice?.finish_reason) finish = choice.finish_reason;
    if (j.usage) usage = j.usage;
  }
  if (!text && tail) {
    // Some servers ignore stream:true and reply with one JSON object.
    try { const j = JSON.parse(tail); text = j.choices?.[0]?.message?.content ?? ''; usage = j.usage; finish = j.choices?.[0]?.finish_reason; } catch { /* handled below */ }
  }
  return { text, usage, finish };
}

async function chatOllama(p, a) {
  const body = {
    model: a.model, stream: true,
    messages: [{ role: 'system', content: a.system }, { role: 'user', content: a.user }],
    options: { temperature: a.temperature, num_predict: a.maxTokens, ...(a.numCtx ? { num_ctx: a.numCtx } : {}) },
  };
  if (a.schema) body.format = a.schema;
  const res = await fetch(`${trimSlash(p.baseUrl)}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: a.signal,
  });
  if (!res.ok) throw httpError(p, res.status, await res.text());
  let text = '', usage = null, finish = null;
  for await (const line of sseLines(res)) {
    if (!line) continue;
    const j = JSON.parse(line);
    if (j.error) throw httpError(p, 400, j.error);
    if (j.message?.content) { text += j.message.content; a.onToken?.(text.length); }
    if (j.done) { usage = { prompt_tokens: j.prompt_eval_count, completion_tokens: j.eval_count }; finish = j.done_reason; }
  }
  return { text, usage, finish };
}

async function chatAnthropic(p, a) {
  const res = await fetch(`${trimSlash(p.baseUrl)}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': getSecret(p.apiKeyEnv), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: a.model, max_tokens: a.maxTokens, system: a.system, messages: [{ role: 'user', content: a.user }] }),
    signal: a.signal,
  });
  if (!res.ok) throw httpError(p, res.status, await res.text());
  const j = await res.json();
  return {
    text: (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join(''),
    usage: { prompt_tokens: j.usage?.input_tokens, completion_tokens: j.usage?.output_tokens },
    finish: j.stop_reason === 'max_tokens' ? 'length' : j.stop_reason,
  };
}

// The prompt goes in over stdin. Job postings are untrusted, so agent tools stay disabled and the
// working directory is a temp folder rather than this project.
function chatCli(p, a) {
  return new Promise((resolve, reject) => {
    const args = [...p.args];
    if (a.model && a.model !== 'default') {
      if (!/^[\w.:/-]+$/.test(a.model)) return reject(new AiError('Invalid model name.', 'config'));
      args.unshift(p.modelFlag, a.model);
    }
    const child = spawn(p.command, args, { cwd: tmpdir(), shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'], signal: a.signal });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; a.onToken?.(out.length); });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => reject(new AiError(`${p.label} could not start: ${e.message}`, 'http')));
    child.on('close', (code) => (code === 0 ? resolve({ text: out, usage: null, finish: 'stop' }) : reject(new AiError(`${p.label} exited with code ${code}: ${err.slice(0, 300)}`, 'http'))));
    child.stdin.end(`${a.system}\n\n${a.user}`);
  });
}

const TRANSPORT = { openai: chatOpenAI, ollama: chatOllama, anthropic: chatAnthropic, cli: chatCli };

// ---------- Public API ----------

export const stripThinking = (t) => String(t ?? '').replace(/<think(ing)?>[\s\S]*?<\/think(ing)?>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();

/** Pull the first complete JSON value out of a model reply that may include fences or commentary. */
export function extractJson(text) {
  const t = stripThinking(text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch { /* scan below */ }
  const start = t.search(/[{[]/);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      if (--depth === 0) {
        const candidate = t.slice(start, i + 1);
        try { return JSON.parse(candidate); }
        catch { try { return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1')); } catch { return null; } }
      }
    }
  }
  return null;
}

/**
 * Chat with the model assigned to a role.
 * With a schema: uses structured output where the server supports it, then falls back to parsing,
 * then asks the model once to repair invalid JSON. Result: { text, json, provider, model, ms, usage }.
 */
export async function chat({ role, system, user, schema, maxTokens, temperature, cfg = loadConfig(), onToken, override }) {
  const assignment = override ?? resolveRole(cfg, role);
  if (!assignment) throw new AiError('No AI model is set up yet. Open the AI tab, or run: node src/cli.mjs ai auto', 'not-configured');
  const provider = getProvider(cfg, assignment.provider);
  assertPrivacy(cfg, provider);
  const send = TRANSPORT[provider.kind];
  const base = {
    model: assignment.model, system, user, schema, onToken,
    temperature: temperature ?? cfg.ai.temperature, maxTokens: maxTokens ?? cfg.ai.maxOutputTokens,
    numCtx: cfg.ai.providers?.[provider.id]?.numCtx,
  };
  const call = (a) => send(provider, { ...base, ...a, signal: AbortSignal.timeout((cfg.ai.requestTimeoutSec ?? 600) * 1000) });
  const started = Date.now();
  let r;
  try {
    r = await call({});
  } catch (e) {
    if (e.code === 'no-schema') r = await call({ schema: null });
    else if (e.name === 'TimeoutError') throw new AiError(`${provider.label} took longer than ${cfg.ai.requestTimeoutSec}s. Try a smaller model or raise the timeout.`, 'timeout');
    else if (e.cause?.code === 'ECONNREFUSED' || e.message === 'fetch failed') throw new AiError(`Could not reach ${provider.label} at ${provider.baseUrl}. Is it running?`, 'offline');
    else throw e;
  }
  let text = stripThinking(r.text);
  let json = null;
  if (schema) {
    json = extractJson(r.text);
    if (json === null) {
      if (r.finish === 'length') throw new AiError(`The model hit its output limit before finishing (${base.maxTokens} tokens). Raise "max output tokens" or use a model that does less hidden reasoning.`, 'length');
      const repair = await call({
        schema: null, system: 'You repair invalid JSON. Reply with valid JSON only and no commentary.',
        user: `Convert this into valid JSON that matches the schema.\n\nSCHEMA:\n${JSON.stringify(schema)}\n\nTEXT:\n${text.slice(0, 12000)}`,
      });
      json = extractJson(repair.text);
      if (json === null) throw new AiError(`${provider.label} / ${assignment.model} did not return valid JSON, even after a repair attempt.`, 'bad-json');
    }
  }
  return { text, json, provider: provider.id, model: assignment.model, ms: Date.now() - started, usage: r.usage, finish: r.finish };
}

export async function embed(texts, { cfg = loadConfig() } = {}) {
  const a = resolveRole(cfg, 'embed');
  if (!a) return null;
  const p = getProvider(cfg, a.provider);
  assertPrivacy(cfg, p);
  const signal = AbortSignal.timeout(120000);
  if (p.kind === 'ollama') {
    const r = await fetch(`${trimSlash(p.baseUrl)}/api/embed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: a.model, input: texts }), signal });
    if (!r.ok) throw httpError(p, r.status, await r.text());
    return (await r.json()).embeddings;
  }
  const r = await fetch(`${trimSlash(p.baseUrl)}/embeddings`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(p) }, body: JSON.stringify({ model: a.model, input: texts }), signal });
  if (!r.ok) throw httpError(p, r.status, await r.text());
  return (await r.json()).data.map((d) => d.embedding);
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const BENCH_SCHEMA = { type: 'object', properties: { score: { type: 'number' }, blocker: { type: 'boolean' }, reason: { type: 'string' } }, required: ['score', 'blocker', 'reason'] };
const BENCH_JOB = 'Posting: Civil Engineer II, Franklin County Engineer. Requires a bachelor\'s degree in civil engineering and a current state PE license. Candidate: BS Civil Engineering, 6 years in road design, EIT only, no PE license.';

/** Measures speed and whether a model can actually return the structured output this tool depends on. */
export async function benchmark(providerId, model, cfg = loadConfig()) {
  const started = Date.now();
  try {
    const r = await chat({
      cfg, override: { provider: providerId, model }, schema: BENCH_SCHEMA, maxTokens: 1500,
      system: 'You screen government job applicants. Reply with JSON only: score (1-5 fit), blocker (true if a mandatory requirement is unmet), reason (one sentence).',
      user: BENCH_JOB,
    });
    const tokens = r.usage?.completion_tokens;
    const valid = typeof r.json?.score === 'number' && typeof r.json?.blocker === 'boolean';
    return {
      provider: providerId, model, ok: true, seconds: +((Date.now() - started) / 1000).toFixed(1),
      tokensPerSec: tokens ? +(tokens / (r.ms / 1000)).toFixed(1) : null,
      validJson: valid, caughtMissingLicense: r.json?.blocker === true, sample: r.json?.reason ?? '',
    };
  } catch (e) {
    return { provider: providerId, model, ok: false, seconds: +((Date.now() - started) / 1000).toFixed(1), error: e.message };
  }
}
