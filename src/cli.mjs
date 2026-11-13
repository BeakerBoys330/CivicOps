#!/usr/bin/env node
// Command line for CivicOps. Everything here is also available in the web dashboard (`serve`).
import { autoAssignRoles, benchmark, detectProviders } from './ai/client.mjs';
import { ROLE_INFO } from './ai/registry.mjs';
import { loadConfig, saveConfig, updateConfig } from './config.mjs';
import { coverageSummary, discover } from './discover.mjs';
import { resolveLocation } from './geo.mjs';
import { politeFetch } from './net.mjs';
import { annualPay, evaluate, exportTracker, isOpen, loadJobs, loadJurisdictions, matchesSearch, scan, tailor, triage, updateJob } from './pipeline.mjs';
import { ADJACENT_BOARDS, STATE_PORTALS, FEDERAL_OWN_BOARDS } from './portals.mjs';
import { LEVELS, pool } from './util.mjs';

const HELP = `CivicOps: government job search with local AI

  serve [--port 4173]          Open the dashboard (recommended)

  location <zip|"City, ST"> [--radius 50]
  discover                     Find every government in range and its jobs page
  scan [--level county]        Read jobs from every readable employer
  triage [--limit 50]          Rank and score new postings with AI
  list [--top 30]              Show matching open jobs
  evaluate <jobId>             Full evaluation report
  tailor <jobId> [--kind resume|cover|interview] [--force]
  outcomes                     How far your applications got, by score and level
  status <jobId> <status>      Update the tracker
  tracker                      Write data/applications.md

  ai detect                    Find local AI runtimes and models
  ai auto                      Assign detected models to tasks
  ai role <role> <provider> <model>
  ai bench [provider]          Test speed and JSON reliability of each model
  ai privacy <local-only|allow-cloud>

  portals check                Re-test built-in board links
  requests [--limit N]         Draft messages asking governments near you how their openings can be found
                               (saved to output/access-requests/; nothing is sent)
  requests --project           Also draft the questions for companies and central offices. One person
                               asking is enough, so check the project's issues before you send one.
`;

const argv = process.argv.slice(2);
const flag = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? (argv[i + 1] ?? true) : dflt; };
const has = (name) => argv.includes(`--${name}`);
const progress = (m) => { if (process.stderr.isTTY) process.stderr.write(`\r\x1b[K${String(m).slice(0, 110)}`); };
const endProgress = () => { if (process.stderr.isTTY) process.stderr.write('\r\x1b[K'); };

async function aiCommand(sub) {
  const cfg = loadConfig();
  if (sub === 'detect') {
    for (const p of await detectProviders(cfg)) {
      if (!p.available) continue;
      console.log(`\n${p.label} [${p.id}] ${p.local ? 'LOCAL' : 'CLOUD'} ${p.baseUrl ?? ''}${p.note ? `\n  ${p.note}` : ''}`);
      for (const m of p.models) console.log(`  - ${m.id}${m.embedding ? ' (embeddings)' : ''}${m.loaded ? ' (loaded)' : ''}`);
    }
    console.log('\nRoles:');
    for (const r of Object.keys(ROLE_INFO)) console.log(`  ${r.padEnd(9)} ${cfg.ai.roles[r].provider || '(none)'} ${cfg.ai.roles[r].model}`);
    return;
  }
  if (sub === 'auto') {
    const roles = autoAssignRoles(await detectProviders(cfg));
    if (!roles) { console.log('No local model found. Start Ollama, LM Studio or similar, then try again.'); process.exitCode = 1; return; }
    cfg.ai.roles = roles; saveConfig(cfg);
    for (const [k, v] of Object.entries(roles)) console.log(`  ${k.padEnd(9)} ${v.provider} ${v.model}`);
    return;
  }
  if (sub === 'role') {
    const [role, provider, model] = argv.slice(2);
    if (!ROLE_INFO[role]) throw new Error(`Roles: ${Object.keys(ROLE_INFO).join(', ')}`);
    cfg.ai.roles[role] = { provider, model }; saveConfig(cfg);
    console.log(`${role} -> ${provider} ${model}`);
    return;
  }
  if (sub === 'privacy') {
    const v = argv[2];
    if (!['local-only', 'allow-cloud'].includes(v)) throw new Error('Use local-only or allow-cloud.');
    updateConfig({ ai: { privacy: v } });
    console.log(`Privacy: ${v}`);
    return;
  }
  if (sub === 'bench') {
    const only = argv[2];
    const detected = (await detectProviders(cfg)).filter((p) => p.available && p.local && (!only || p.id === only));
    for (const p of detected) {
      for (const m of p.models.filter((x) => !x.embedding)) {
        progress(`Testing ${p.id} / ${m.id}`);
        const b = await benchmark(p.id, m.id, cfg);
        endProgress();
        console.log(b.ok
          ? `${p.id} / ${m.id}: ${b.seconds}s${b.tokensPerSec ? `, ${b.tokensPerSec} tok/s` : ''}, JSON ${b.validJson ? 'ok' : 'BAD'}, caught missing license: ${b.caughtMissingLicense ? 'yes' : 'NO'}\n   "${b.sample}"`
          : `${p.id} / ${m.id}: FAILED after ${b.seconds}s: ${b.error}`);
      }
    }
    return;
  }
  console.log(HELP);
}

async function main() {
  const cmd = argv[0];
  switch (cmd) {
    case 'location': {
      const loc = await resolveLocation(argv[1]);
      const cfg = loadConfig();
      cfg.location = { ...cfg.location, ...loc, radiusMiles: +flag('radius', cfg.location.radiusMiles) };
      saveConfig(cfg);
      console.log(`${cfg.location.label} (${cfg.location.state}), ${cfg.location.radiusMiles} miles`);
      return;
    }
    case 'discover': {
      const list = await discover(loadConfig(), { onProgress: progress });
      endProgress();
      console.log(`${list.length} employers`);
      console.log(coverageSummary(list));
      return;
    }
    case 'scan': {
      const r = await scan(loadConfig(), { onProgress: progress, onlyLevel: flag('level') });
      endProgress();
      console.log(r);
      return;
    }
    case 'triage': {
      const r = await triage(loadConfig(), { limit: +flag('limit', 50), onProgress: progress });
      endProgress();
      console.log(r);
      return;
    }
    case 'list': {
      const cfg = loadConfig();
      const jobs = Object.values(loadJobs()).filter((j) => isOpen(j) && matchesSearch(j, cfg));
      jobs.sort((a, b) => (b.evaluation?.score ?? b.triage?.score ?? 0) - (a.evaluation?.score ?? a.triage?.score ?? 0) || (a.distanceMi ?? 999) - (b.distanceMi ?? 999));
      for (const j of jobs.slice(0, +flag('top', 30))) {
        const pay = annualPay(j);
        console.log(`${(j.evaluation?.score ?? j.triage?.score ?? '-').toString().padEnd(4)}${j.level.padEnd(9)}${(j.distanceMi ?? '?').toString().padStart(6)} mi  ${j.title.slice(0, 48).padEnd(50)}${j.employer.slice(0, 32).padEnd(34)}${pay ? `$${Math.round(pay / 1000)}k` : ''}  ${j.id}`);
      }
      console.log(`\n${jobs.length} matching open jobs`);
      return;
    }
    case 'evaluate': {
      const j = await evaluate(loadConfig(), argv[1], { force: argv.includes('--force'), onToken: (n) => progress(`Generating... ${n} characters`) });
      endProgress();
      console.log(`${j.evaluation.score}/5 ${j.evaluation.verdict}\nreports/${j.report}`);
      if (j.evaluation.blockers.length) console.log(`Blockers:\n- ${j.evaluation.blockers.join('\n- ')}`);
      return;
    }
    case 'tailor': {
      const r = await tailor(loadConfig(), argv[1], { kind: flag('kind', 'resume'), force: has('force'), onToken: (n) => progress(`Generating... ${n} characters`) });
      endProgress();
      console.log(`output/${r.doc.md}${r.doc.pdf ? `\noutput/${r.doc.pdf} (${r.doc.pages} pages)` : `\nNo PDF: ${r.doc.pdfError}`}`);
      if (r.doc.issues.length) console.log(`Fact check:\n- ${r.doc.issues.join('\n- ')}\nFix these, or re-run with --force if they are correct.`);
      if (r.doc.needsInput) console.log('The model listed items that need your input at the end of the file.');
      return;
    }
    case 'status': {
      console.log(updateJob(argv[1], { status: argv.slice(2).join(' ') }).status);
      return;
    }
    case 'tracker': {
      console.log(`${exportTracker()} applications written to data/applications.md`);
      return;
    }
    case 'employers': {
      for (const j of loadJurisdictions().filter((x) => !flag('coverage') || x.coverage === flag('coverage')).slice(0, +flag('top', 100))) {
        console.log(`${j.coverage.padEnd(13)}${j.level.padEnd(9)}${j.name.slice(0, 40).padEnd(42)}${(j.ats ?? '').padEnd(16)}${j.careersUrl ?? j.website ?? ''}`);
      }
      return;
    }
    case 'ai': return aiCommand(argv[1]);
    case 'outcomes': {
      const { outcomeStats } = await import('./pipeline.mjs');
      const o = outcomeStats();
      const line = (name, s) => `${name.padEnd(22)} applied ${s.applied}, referred or tested ${s.referredOrTested}, interviewed ${s.interviewed}, offers ${s.offers}, hired ${s.hired}`;
      console.log(line('All applications', o.total));
      for (const [k, s] of Object.entries(o.byScore)) console.log(line(k, s));
      for (const [k, s] of Object.entries(o.byLevel)) console.log(line(k, s));
      for (const [r, n] of Object.entries(o.reasons)) console.log(`Ended: ${r} (${n})`);
      if (o.note) console.log(o.note);
      return;
    }
    case 'requests': {
      const { draftRequests } = await import('./requests.mjs');
      const r = await draftRequests(loadConfig(), loadJurisdictions(), { limit: +flag('limit', Infinity), project: has('project'), onProgress: progress });
      endProgress();
      console.log(`${r.count} drafts in output/access-requests/. Nothing was sent.`);
      console.log('Read output/access-requests/README.md before you send any of them. You send each one yourself, in your own name.');
      if (r.omitted) console.log(`${r.omitted} more employers were left out to keep the list short.`);
      return;
    }
    case 'portals': {
      const rows = [...Object.entries(STATE_PORTALS).map(([k, url]) => ({ name: k, url })), ...FEDERAL_OWN_BOARDS, ...ADJACENT_BOARDS];
      // The same rules as a scan: a site that asks tools to stay away is not visited, so open that link yourself.
      let skipped = 0;
      await pool(rows, 8, async (r) => {
        const res = await politeFetch(r.url, { timeoutMs: 20000 });
        if (res.blocked === 'robots') { skipped++; console.log(`${r.name}: not checked, the site asks tools not to visit. Open it yourself: ${r.url}`); }
        else if (!res.ok) console.log(`${r.name}: ${res.blocked ?? res.error ?? res.status} ${r.url}`);
      });
      console.log(`Checked ${rows.length - skipped} of ${rows.length} links. Only problems are listed above.`);
      return;
    }
    case 'serve': {
      const { startServer } = await import('./server.mjs');
      await startServer(+flag('port', 4173));
      return;
    }
    default:
      console.log(HELP);
      if (LEVELS.includes(cmd)) console.log(`Tip: scan --level ${cmd}`);
  }
}

main().catch((e) => { endProgress(); console.error(`Error: ${e.message}`); process.exitCode = 1; });
