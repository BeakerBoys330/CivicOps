import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertPrivacy, autoAssignRoles, extractJson, stripThinking } from '../src/ai/client.mjs';
import { allProviders, isLocalUrl } from '../src/ai/registry.mjs';
import { detectAts } from '../src/ats.mjs';
import { DEFAULT_CONFIG } from '../src/config.mjs';
import { USER_AGENT, crawlDelayMs, isPublicHttpUrl, parseRobots, robotsAllows } from '../src/net.mjs';
import { annualPay, cleanEvaluation, computeScore, factCheck, isOpen, markdownToHtml, matchesSearch } from '../src/pipeline.mjs';
import { heuristicJobs, parseCloseDate, parseJsonLd, parseRss, parseSalary } from '../src/sources.mjs';
import { haversineMiles, htmlToText, toIsoDate } from '../src/util.mjs';

const cfg = (over = {}) => ({ ...structuredClone(DEFAULT_CONFIG), ...over });

test('robots: the real governmentjobs.com file blocks this tool but allows Googlebot', () => {
  const groups = parseRobots(`User-agent: Googlebot
User-agent: bingbot
Allow: /


User-agent: *
Disallow: /`);
  assert.equal(robotsAllows(groups, '/careers/seattle'), false);
  assert.equal(robotsAllows(groups, '/careers/seattle', 'googlebot'), true);
});

test('robots: longest match wins, wildcards and end anchors work, and empty disallow allows', () => {
  const g = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/jobs\nDisallow: /*.pdf$\nDisallow:');
  assert.equal(robotsAllows(g, '/private/x'), false);
  assert.equal(robotsAllows(g, '/private/jobs/1'), true);
  assert.equal(robotsAllows(g, '/a/file.pdf'), false);
  assert.equal(robotsAllows(g, '/a/file.pdf?x=1'), true);
  assert.equal(robotsAllows(g, '/jobs'), true);
  assert.equal(robotsAllows([], '/x'), true);
});

test('robots: rules for the same agent are read together, and only a group that names this tool is its own', () => {
  // A second "*" group further down still counts (RFC 9309).
  const split = parseRobots('User-agent: *\nDisallow: /admin\n\nUser-agent: Googlebot\nAllow: /\n\nUser-agent: *\nDisallow: /jobs\nCrawl-delay: 5');
  assert.equal(robotsAllows(split, '/jobs/1'), false);
  assert.equal(robotsAllows(split, '/admin'), false);
  assert.equal(crawlDelayMs(split), 5000);
  // A blank User-agent line, or a bot whose name is part of "civicops", is not this tool.
  const others = parseRobots('User-agent:\nAllow: /\n\nUser-agent: ops\nAllow: /\n\nUser-agent: *\nDisallow: /');
  assert.equal(robotsAllows(others, '/jobs'), false);
  // An allow line for civicops, the change the access letters ask for, is honored.
  const allowed = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: CivicOps\nAllow: /\nCrawl-delay: 10');
  assert.equal(robotsAllows(allowed, '/jobs'), true);
  assert.equal(crawlDelayMs(allowed), 10000);
  assert.match(USER_AGENT, /^Mozilla\/5\.0 \(compatible; CivicOps\/\d+\.\d+; personal government job search tool/);
});

test('scraped links can never reach your own network', () => {
  for (const u of ['http://localhost/x', 'http://127.0.0.1:1234/v1/models', 'http://192.168.1.1/', 'http://10.0.0.5/', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://printer.local/', 'file:///c:/x', 'ftp://a.gov/']) {
    assert.equal(isPublicHttpUrl(u), false, u);
  }
  assert.equal(isPublicHttpUrl('https://www.usajobs.gov/job/1'), true);
});

test('privacy gate blocks cloud and CLIs in local-only mode, and locality comes from the real URL', () => {
  const c = cfg();
  assert.equal(c.ai.privacy, 'local-only');
  const providers = allProviders(c);
  for (const id of ['anthropic', 'openai', 'claude-cli', 'codex-cli']) {
    assert.throws(() => assertPrivacy(c, providers.find((p) => p.id === id)), /local-only/);
  }
  assert.doesNotThrow(() => assertPrivacy(c, providers.find((p) => p.id === 'ollama')));
  // Pointing a "local" provider at a remote host must count as cloud.
  c.ai.providers = { ollama: { baseUrl: 'https://ollama.example.com' } };
  const moved = allProviders(c).find((p) => p.id === 'ollama');
  assert.equal(moved.local, false);
  assert.throws(() => assertPrivacy(c, moved), /local-only/);
  assert.equal(isLocalUrl('http://192.168.1.20:11434'), true);
  assert.equal(isLocalUrl('http://100.70.1.2:8000/v1'), true);
  assert.equal(isLocalUrl('https://api.openai.com/v1'), false);
});

test('auto-assign uses a practical strong model for deep work and the small one for bulk work', () => {
  const roles = autoAssignRoles([{ id: 'lmstudio', available: true, local: true, models: [{ id: 'x/big-27b' }, { id: 'z/mid-7b' }, { id: 'y/small-4b' }, { id: 'nomic-embed', embedding: true }] }]);
  assert.equal(roles.triage.model, 'y/small-4b');
  assert.equal(roles.evaluate.model, 'z/mid-7b');
  assert.equal(roles.embed.model, 'nomic-embed');
  assert.equal(autoAssignRoles([{ id: 'c', available: true, local: false, models: [{ id: 'gpt' }] }]), null);
});

test('JSON recovery handles thinking tags, fences, commentary and trailing commas', () => {
  assert.deepEqual(extractJson('<think>hmm {not json}</think>{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJson('Here you go: {"a":"b}c",} thanks'), { a: 'b}c' });
  assert.equal(extractJson('no json here'), null);
  assert.equal(stripThinking('<think>x</think>hello'), 'hello');
});

test('a failed minimum qualification caps the score no matter what the model scored', () => {
  const scores = { qualifications: 5, experience: 5, level: 5, pay: 5, eligibility: 5 };
  assert.equal(computeScore({ scores, requirements: [], gates: [] }).score, 5);
  assert.equal(computeScore({ scores, requirements: [], gates: [] }).verdict, 'Apply');
  const failed = computeScore({ scores, gates: [], requirements: [{ kind: 'minimum', met: 'no', requirement: 'PE license' }] });
  assert.equal(failed.score, 2);
  assert.match(failed.verdict, /Do not apply/);
  assert.equal(computeScore({ scores, requirements: [], gates: [{ status: 'blocker', gate: 'Residency', detail: 'x' }] }).score, 2);
  assert.equal(computeScore({ scores, gates: [], requirements: [{ kind: 'preferred', met: 'no', requirement: 'x' }] }).score, 5);
  assert.equal(computeScore({ scores: { qualifications: 99 } }).score <= 5, true);
});

test('an unconfirmed required certificate can never earn Apply, and score echoes are removed', () => {
  const scores = { qualifications: 5, experience: 5, level: 5, pay: 5, eligibility: 5 };
  const r = computeScore({ scores, gates: [], requirements: [{ kind: 'minimum', met: 'unknown', requirement: 'Peace officer certificate' }] });
  assert.equal(r.score, 3.5);
  assert.match(r.verdict, /confirming/);
  const cleaned = cleanEvaluation({
    requirements: [{ requirement: 'Level – grade fits', kind: 'minimum', met: 'no' }, { requirement: 'Experience with records', kind: 'minimum', met: 'yes', evidence: '' }],
    gates: [{ gate: 'eligibility', status: 'blocker', detail: 'x' }, { gate: 'Residency', status: 'check', detail: 'y' }],
  });
  assert.deepEqual(cleaned.requirements.map((x) => [x.requirement, x.met]), [['Experience with records', 'unknown']]);
  assert.deepEqual(cleaned.gates.map((g) => g.gate), ['Residency']);
});

test('fact check ignores any level of Needs your input heading', () => {
  assert.deepEqual(factCheck('Hello.\n\n### Needs your input\n- Confirm 40 hours', 'Hello'), []);
});

test('fact check catches invented numbers and credentials, but not your real ones', () => {
  const cv = 'Managed 12 staff and a $1,200,000 budget from 2019 to 2024. BS Civil Engineering.';
  assert.deepEqual(factCheck('Managed 12 staff and a $1,200,000 budget. 2019 to 2024.', cv), []);
  assert.ok(factCheck('Managed 15 staff.', cv).some((x) => x.includes('15')));
  assert.ok(factCheck('Saved $2,000,000.', cv).some((x) => x.includes('2,000,000')));
  assert.ok(factCheck('Licensed PE and PMP.', cv).some((x) => x.includes('PE')));
  assert.deepEqual(factCheck('Managed 12 staff.\n\n## Needs your input\n- Confirm 40 hours per week', cv), []);
});

test('pay and deadlines are read from free text', () => {
  assert.deepEqual(parseSalary('$25.50 - $30.00 per hour'), { salaryMin: 25.5, salaryMax: 30, salaryInterval: 'hour' });
  assert.deepEqual(parseSalary('Salary: $65,000 to $80,000 annually'), { salaryMin: 65000, salaryMax: 80000, salaryInterval: 'year' });
  assert.deepEqual(parseSalary('no pay here'), {});
  assert.equal(parseCloseDate('Closing date: 12/01/2026').closes, '2026-12-01');
  assert.equal(parseCloseDate('Apply by January 5, 2027').closes, '2027-01-05');
  assert.equal(parseCloseDate('Open until filled').openUntilFilled, true);
  assert.equal(toIsoDate('2026-11-18T00:00:00'), '2026-11-18');
});

test('filters: exclusions use whole words, and unknown pay is kept', () => {
  const c = cfg();
  c.search.minSalary = 50000;
  const job = (t, extra = {}) => ({ title: t, level: 'city', salaryInterval: null, salaryMin: null, salaryMax: null, ...extra });
  assert.equal(matchesSearch(job('Summer Intern'), c), false);
  assert.equal(matchesSearch(job('Internal Auditor'), c), true);
  assert.equal(matchesSearch(job('Clerk', { salaryMin: 15, salaryMax: 18, salaryInterval: 'hour' }), c), false);
  assert.equal(matchesSearch(job('Clerk'), c), true);
  assert.equal(annualPay({ salaryMax: 30, salaryInterval: 'hour' }), 62400);
  c.levels.city = false;
  assert.equal(matchesSearch(job('Clerk'), c), false);
  assert.equal(isOpen({ closes: '2020-01-01' }), false);
  assert.equal(isOpen({ closes: null }), true);
  assert.equal(isOpen({ gone: true }), false);
});

test('job link heuristic ignores menus and non-openings, and cleans PDF titles', () => {
  const html = `<nav><a href="/city-manager">City Manager</a><a href="/jobs/x">Police Officer</a></nav>
    <main><a href="/files/clerk-job-posting.pdf">Police Clerk - Job Posting.pdf (PDF, 165KB)</a>
    <a href="/files/clerk-job-description.pdf">Police Clerk - Job Description.pdf (PDF, 129KB)</a>
    <a href="/careers/benefits">Benefits</a><a href="/careers/operator">Water System Operator</a>
    <a href="/departments/police">Police Officer</a><a href="/careers/form">Employment Application</a></main>`;
  const titles = heuristicJobs(html, 'https://x.gov/', { name: 'X' }).map((j) => j.title);
  assert.deepEqual(titles, ['Police Clerk', 'Water System Operator']);
});

test('structured data and RSS feeds are parsed', () => {
  const ld = parseJsonLd(`<script type="application/ld+json">{"@type":"JobPosting","title":"GIS Analyst","url":"https://x.gov/1","datePosted":"2026-11-01","validThrough":"2026-12-01","baseSalary":{"value":{"minValue":60000,"maxValue":70000,"unitText":"YEAR"}},"description":"<p>Maps</p>"}</script>`, { name: 'X' });
  assert.equal(ld[0].title, 'GIS Analyst');
  assert.equal(ld[0].closes, '2026-12-01');
  assert.equal(ld[0].salaryInterval, 'year');
  const rss = parseRss('<rss><channel><item><title><![CDATA[Clerk &amp; Typist]]></title><link>https://x.gov/j</link><pubDate>Mon, 09 Nov 2026 07:49:27 -0500</pubDate></item></channel></rss>');
  assert.equal(rss[0].title, 'Clerk & Typist');
});

test('hiring systems are classified, and boards that disallow tools stay link-only', () => {
  assert.equal(detectAts('https://www.governmentjobs.com/careers/columbusoh').scan, 'link');
  assert.equal(detectAts('https://www.schooljobs.com/careers/x').scan, 'link');
  assert.equal(detectAts('https://oregon.wd5.myworkdayjobs.com/SOR').scan, 'workday');
  assert.equal(detectAts('https://example.gov/jobs'), null);
});

test('resume HTML escapes model output', () => {
  const html = markdownToHtml('# A <script>alert(1)</script>\n- <img src=x onerror=y>', 't');
  assert.ok(!html.includes('<script>alert'));
  assert.ok(!html.includes('<img'));
});

test('geometry and text helpers', () => {
  assert.ok(Math.abs(haversineMiles(39.96, -83, 39.76, -84.19) - 65) < 5);
  assert.equal(htmlToText('<p>Hi&nbsp;<b>there</b></p><script>x</script>'), 'Hi there');
});
