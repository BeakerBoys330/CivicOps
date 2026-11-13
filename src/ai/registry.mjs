// Every AI backend CivicOps can talk to. To add one, add a row here or use "custom" in your profile.
// kind: openai = OpenAI-compatible HTTP API | ollama = Ollama native API | anthropic = Anthropic Messages API | cli = local agent command
export const PROVIDERS = [
  // ---- Local runtimes ----
  { id: 'ollama', label: 'Ollama', kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', local: true, site: 'https://ollama.com' },
  { id: 'lmstudio', label: 'LM Studio', kind: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', local: true, site: 'https://lmstudio.ai' },
  { id: 'llamacpp', label: 'llama.cpp server', kind: 'openai', baseUrl: 'http://127.0.0.1:8080/v1', local: true, owners: ['llamacpp'], site: 'https://github.com/ggml-org/llama.cpp' },
  { id: 'llamafile', label: 'llamafile', kind: 'openai', baseUrl: 'http://127.0.0.1:8080/v1', local: true, owners: ['llamafile'], site: 'https://github.com/Mozilla-Ocho/llamafile' },
  { id: 'localai', label: 'LocalAI', kind: 'openai', baseUrl: 'http://127.0.0.1:8080/v1', local: true, owners: ['localai'], site: 'https://localai.io' },
  { id: 'ramalama', label: 'RamaLama', kind: 'openai', baseUrl: 'http://127.0.0.1:8080/v1', local: true, owners: ['ramalama'], site: 'https://ramalama.ai' },
  { id: 'mlx', label: 'MLX server (Apple silicon)', kind: 'openai', baseUrl: 'http://127.0.0.1:8080/v1', local: true, owners: ['mlx'], site: 'https://github.com/ml-explore/mlx-lm' },
  { id: 'jan', label: 'Jan', kind: 'openai', baseUrl: 'http://127.0.0.1:1337/v1', local: true, site: 'https://jan.ai' },
  { id: 'gpt4all', label: 'GPT4All', kind: 'openai', baseUrl: 'http://127.0.0.1:4891/v1', local: true, site: 'https://gpt4all.io' },
  { id: 'koboldcpp', label: 'KoboldCpp', kind: 'openai', baseUrl: 'http://127.0.0.1:5001/v1', local: true, owners: ['koboldcpp'], site: 'https://github.com/LostRuins/koboldcpp' },
  { id: 'textgen', label: 'Text Generation WebUI', kind: 'openai', baseUrl: 'http://127.0.0.1:5000/v1', local: true, site: 'https://github.com/oobabooga/text-generation-webui' },
  { id: 'tabbyapi', label: 'TabbyAPI', kind: 'openai', baseUrl: 'http://127.0.0.1:5000/v1', local: true, owners: ['tabbyapi'], site: 'https://github.com/theroyallab/tabbyAPI' },
  { id: 'vllm', label: 'vLLM', kind: 'openai', baseUrl: 'http://127.0.0.1:8000/v1', local: true, owners: ['vllm'], site: 'https://docs.vllm.ai' },
  { id: 'lemonade', label: 'Lemonade (AMD)', kind: 'openai', baseUrl: 'http://127.0.0.1:8000/api/v1', local: true, site: 'https://lemonade-server.ai' },
  { id: 'sglang', label: 'SGLang', kind: 'openai', baseUrl: 'http://127.0.0.1:30000/v1', local: true, site: 'https://github.com/sgl-project/sglang' },
  { id: 'xinference', label: 'Xinference', kind: 'openai', baseUrl: 'http://127.0.0.1:9997/v1', local: true, site: 'https://inference.readthedocs.io' },
  { id: 'msty', label: 'Msty', kind: 'ollama', baseUrl: 'http://127.0.0.1:10000', local: true, site: 'https://msty.app' },
  { id: 'anythingllm', label: 'AnythingLLM', kind: 'openai', baseUrl: 'http://127.0.0.1:3001/api/v1/openai', local: true, apiKeyEnv: 'ANYTHINGLLM_API_KEY', site: 'https://anythingllm.com' },
  { id: 'openwebui', label: 'Open WebUI', kind: 'openai', baseUrl: 'http://127.0.0.1:3000/api', local: true, apiKeyEnv: 'OPENWEBUI_API_KEY', site: 'https://openwebui.com' },
  // ---- Cloud, optional. Blocked while privacy is set to local-only. ----
  // keyUrl is where you create a key. models is a fallback list for services that do not list their models.
  { id: 'anthropic', label: 'Anthropic (Claude)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', local: false, apiKeyEnv: 'ANTHROPIC_API_KEY', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openai', label: 'OpenAI (GPT)', kind: 'openai', baseUrl: 'https://api.openai.com/v1', local: false, apiKeyEnv: 'OPENAI_API_KEY', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'gemini', label: 'Google Gemini', kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', local: false, apiKeyEnv: 'GEMINI_API_KEY', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'xai', label: 'xAI (Grok)', kind: 'openai', baseUrl: 'https://api.x.ai/v1', local: false, apiKeyEnv: 'XAI_API_KEY', keyUrl: 'https://console.x.ai' },
  { id: 'mistral', label: 'Mistral', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1', local: false, apiKeyEnv: 'MISTRAL_API_KEY', keyUrl: 'https://console.mistral.ai/api-keys' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com', local: false, apiKeyEnv: 'DEEPSEEK_API_KEY', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'cohere', label: 'Cohere', kind: 'openai', baseUrl: 'https://api.cohere.ai/compatibility/v1', local: false, apiKeyEnv: 'COHERE_API_KEY', keyUrl: 'https://dashboard.cohere.com/api-keys' },
  { id: 'perplexity', label: 'Perplexity (Sonar)', kind: 'openai', baseUrl: 'https://api.perplexity.ai', local: false, apiKeyEnv: 'PERPLEXITY_API_KEY', keyUrl: 'https://www.perplexity.ai/account/api', models: ['sonar', 'sonar-pro', 'sonar-reasoning-pro'] },
  // Hosts that run many open models (Llama, Qwen, DeepSeek, Gemma and others) behind one key.
  { id: 'openrouter', label: 'OpenRouter (hundreds of models)', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', local: false, apiKeyEnv: 'OPENROUTER_API_KEY', keyUrl: 'https://openrouter.ai/keys' },
  { id: 'groq', label: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', local: false, apiKeyEnv: 'GROQ_API_KEY', keyUrl: 'https://console.groq.com/keys' },
  { id: 'together', label: 'Together AI', kind: 'openai', baseUrl: 'https://api.together.xyz/v1', local: false, apiKeyEnv: 'TOGETHER_API_KEY', keyUrl: 'https://api.together.ai/settings/api-keys' },
  { id: 'fireworks', label: 'Fireworks AI', kind: 'openai', baseUrl: 'https://api.fireworks.ai/inference/v1', local: false, apiKeyEnv: 'FIREWORKS_API_KEY', keyUrl: 'https://fireworks.ai/account/api-keys' },
  { id: 'cerebras', label: 'Cerebras', kind: 'openai', baseUrl: 'https://api.cerebras.ai/v1', local: false, apiKeyEnv: 'CEREBRAS_API_KEY', keyUrl: 'https://cloud.cerebras.ai' },
  { id: 'huggingface', label: 'Hugging Face Inference', kind: 'openai', baseUrl: 'https://router.huggingface.co/v1', local: false, apiKeyEnv: 'HF_TOKEN', keyUrl: 'https://huggingface.co/settings/tokens' },
  // ---- Agent CLIs. Your prompt runs through a cloud service, so these count as cloud. ----
  // Sign in once with the official tool and CivicOps uses that sign-in, so a subscription you already
  // pay for (instead of a separate API key) can do the work. CivicOps never sees or stores your password
  // or tokens; the tool keeps its own sign-in. Usage counts against that plan's limits.
  { id: 'claude-cli', label: 'Claude Code CLI', kind: 'cli', command: 'claude', args: ['-p', '--disallowedTools', 'Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Task'], modelFlag: '--model', local: false, models: ['default'],
    signIn: 'Claude Pro or Max plan, or an Anthropic Console account', install: 'npm install -g @anthropic-ai/claude-code', login: 'claude (then type /login)', site: 'https://docs.claude.com/en/docs/claude-code/setup' },
  { id: 'codex-cli', label: 'Codex CLI', kind: 'cli', command: 'codex', args: ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-'], modelFlag: '--model', local: false, models: ['default'],
    signIn: 'ChatGPT Plus, Pro, Business or Enterprise plan', install: 'npm install -g @openai/codex', login: 'codex login', site: 'https://developers.openai.com/codex/cli' },
  { id: 'gemini-cli', label: 'Gemini CLI', kind: 'cli', command: 'gemini', args: [], modelFlag: '--model', local: false, models: ['default'],
    signIn: 'Google account (free tier available), or a Gemini API key', install: 'npm install -g @google/gemini-cli', login: 'gemini (then choose Login with Google)', site: 'https://github.com/google-gemini/gemini-cli' },
  { id: 'opencode-cli', label: 'OpenCode CLI (can use local models)', kind: 'cli', command: 'opencode', args: ['run'], modelFlag: '--model', local: false, models: ['default'],
    signIn: 'Several providers, including GitHub Copilot and local models', install: 'npm install -g opencode-ai', login: 'opencode auth login', site: 'https://opencode.ai' },
];

export const ROLE_INFO = {
  triage: 'Fast scoring of many postings. Use your smallest quick model.',
  extract: 'Reads messy career pages and pulls out job listings. A small model is fine.',
  evaluate: 'Deep review of one posting against your resume. Use your strongest model.',
  write: 'Tailored resumes, cover letters and essay drafts. Use your strongest model.',
  embed: 'Optional. Ranks postings by similarity to your resume without a chat model.',
};

function isPrivateHost(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1' || h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.home.arpa')) return true;
  const m = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const a = +m[1], b = +m[2];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
}

/** True when a URL stays on this machine or your private network (including Tailscale's address range). */
export function isLocalUrl(url) {
  try { return isPrivateHost(new URL(url).hostname); } catch { return false; }
}

/** All providers with the user's overrides and custom endpoints applied. "local" always comes from the real URL. */
export function allProviders(cfg) {
  const list = PROVIDERS.map((p) => ({ ...p, ...(cfg.ai?.providers?.[p.id] ?? {}) }));
  for (const c of cfg.ai?.custom ?? []) {
    list.push({ kind: 'openai', ...c, label: c.label || c.id, custom: true });
  }
  return list.map((p) => (p.kind === 'cli' ? { ...p, local: false } : { ...p, local: isLocalUrl(p.baseUrl) }));
}

export function getProvider(cfg, id) {
  const p = allProviders(cfg).find((x) => x.id === id);
  if (!p) throw new Error(`Unknown AI provider "${id}".`);
  return p;
}
