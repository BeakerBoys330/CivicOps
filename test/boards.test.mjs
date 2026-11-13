// Statewide board readers. Markup is trimmed from the live CCAO, OTA and CCAP pages, November 2026.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCcao, parseCcap, parseCloseDate, parseOta, postingClosed } from '../src/sources.mjs';

test('deadlines without a year, and closed wording, are caught before evaluation', () => {
  // A township posting read on 2026-11-09, three days after its deadline.
  assert.equal(parseCloseDate('Accepting applications until Friday, November 6th.', '2026-11-09').closes, '2026-11-06');
  assert.equal(parseCloseDate('Applications due by January 5th', '2026-12-20').closes, '2027-01-05');
  assert.equal(parseCloseDate('Closing date: November 20, 2026').closes, '2026-11-20');
  assert.deepEqual(postingClosed('Accepting applications until Friday, November 6th.', '2026-11-09'), { closed: true, reason: 'its deadline was 2026-11-06', closes: '2026-11-06' });
  assert.equal(postingClosed('This position has been filled. Thank you.').closed, true);
  assert.equal(postingClosed('Open until filled.').closed, false);
});
import { existsSync, readdirSync } from 'node:fs';
import { STATE_BOARDS } from '../src/portals.mjs';
import { P } from '../src/util.mjs';

test('CCAO: reads county sections, employers, deadlines and unwraps safe links', () => {
  const html = `<div>• County Jobs</div><p>Special Attorney</p><p>Employer: Ohio Auditor of State</p><p>Application Deadline: November 26, 2026</p>
    <h3>Allen County Jobs</h3><p><a href="https://jobseeker.example.gov/1">Agency Intern</a></p><p>Employer: Allen County Job and Family Services</p><p>Application Deadline: November 29, 2026</p>
    <h3>Athens County Jobs</h3><p>No jobs currently listed.</p>
    <h3>Knox County Jobs</h3><p><a href="https://nam10.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.org%2Fplanner&amp;data=x">Planning Director</a></p><p>Knox County Board of Commissioners</p><p>Application Deadline: Open until filled</p>`;
  const rows = parseCcao(html, 'https://ccao.org/aws/CCAO/pt/sp/county-jobs');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { title: 'Agency Intern', employer: 'Allen County Job and Family Services', county: 'Allen', url: 'https://jobseeker.example.gov/1', closes: '2026-11-29' });
  assert.equal(rows[1].employer, 'Knox County Board of Commissioners');
  assert.equal(rows[1].url, 'https://example.org/planner');
  assert.equal(rows[1].closes, null);
});

test('OTA: splits title, township and county, and pairs each with its Read Post link', () => {
  const html = `<h2>Zoning Inspector - Butler Township, Montgomery County</h2><p>Butler Township is seeking a Zoning Inspector.</p><a href="/news/zoning-inspector">Read Post</a>
    <h2>Township Administrator – Miami Township, Hamilton County</h2><a href="/news/admin">Read Post</a>`;
  const rows = parseOta(html, 'https://www.ohiotownships.org/news/careers');
  assert.deepEqual(rows.map((r) => [r.title, r.place, r.county, r.url]), [
    ['Zoning Inspector', 'Butler Township', 'Montgomery','https://www.ohiotownships.org/news/zoning-inspector'],
    ['Township Administrator', 'Miami Township', 'Hamilton', 'https://www.ohiotownships.org/news/admin'],
  ]);
});

test('CCAP: takes the county from each posting address', () => {
  const html = `<a href="/about/county-postings/allegheny-county/job-postings/chief-medical-examiner">Chief Medical Examiner</a>
    <a href="/about/county-postings/mc-kean-county/clerk">Clerk</a><a href="/about/job-postings">Jobs Center</a>`;
  const rows = parseCcap(html, 'https://pacounties.org/about/job-postings');
  assert.deepEqual(rows.map((r) => [r.title, r.county]), [['Chief Medical Examiner', 'Allegheny'], ['Clerk', 'Mc Kean']]);
});

test('placeOf: explicit forms win, all-caps names work, other states are skipped', async (t) => {
  // This one needs the Census place files (about 14 MB). They arrive the first time you set a location,
  // so a fresh clone skips the test instead of downloading them.
  const have = existsSync(P.cache) ? readdirSync(P.cache) : [];
  if (!['place', 'cousubs', 'counties'].every((k) => have.some((f) => f.includes(`_Gaz_${k}_national`)))) return t.skip('Census place files are not downloaded yet');
  const { placeOf } = await import('../src/sources.mjs');
  assert.equal((await placeOf({ title: 'JACKSON COUNTY - INVESTIGATOR' }, 'IA'))?.kind, 'county');
  assert.match((await placeOf({ title: 'Director of People Operations – Charlotte County, Florida' }, 'FL'))?.name ?? '', /Charlotte County/);
  assert.equal(await placeOf({ title: 'City Clerk, City of Washburn, Wisconsin' }, 'MN'), null);
  // Ohio has six Butler townships and a Butler village. "Township" and the county pick the one north of Dayton.
  const butler = await placeOf({ title: 'Zoning Inspector', place: 'Butler Township', county: 'Montgomery' }, 'OH');
  assert.equal(butler?.name, 'Butler township');
  assert.ok(Math.abs(butler.lat - 39.87) < 0.15 && Math.abs(butler.lon + 84.2) < 0.2, `${butler.lat}, ${butler.lon}`);
  // Without a county the old single answer still comes back, so nothing that worked before changes.
  assert.equal((await placeOf({ title: 'Clerk', place: 'Butler' }, 'OH'))?.name, 'Butler village');
});

test('every statewide board entry is complete and uses a known reader', () => {
  for (const [st, boards] of Object.entries(STATE_BOARDS)) {
    assert.match(st, /^[A-Z]{2}$/);
    for (const b of boards) {
      assert.ok(b.name && /^https:\/\//.test(b.url), `${st}: ${b.name}`);
      assert.ok(['ccao', 'ota', 'ccap', 'civicplus', 'page', 'link'].includes(b.read), `${st}: ${b.name} reader`);
      assert.ok(['county', 'city', 'township', 'school', 'special'].includes(b.level), `${st}: ${b.name} level`);
      assert.doesNotMatch(b.url, /governmentjobs\.com|schooljobs\.com/);
    }
  }
});

test('government-adjacent employers such as the Postal Service are in the search by default', async () => {
  const { ADJACENT_BOARDS, FEDERAL_OWN_BOARDS } = await import('../src/portals.mjs');
  const { DEFAULT_CONFIG } = await import('../src/config.mjs');
  const { LEVELS, LEVEL_LABEL } = await import('../src/util.mjs');
  assert.equal(DEFAULT_CONFIG.levels.adjacent, true);
  assert.ok(LEVELS.includes('adjacent') && LEVEL_LABEL.adjacent);
  assert.ok(ADJACENT_BOARDS.some((b) => /Postal Service/.test(b.name)));
  for (const b of ADJACENT_BOARDS) assert.ok(b.name && b.note && /^https:\/\//.test(b.url), b.name);
  // Listed once: not also under Federal.
  assert.ok(!FEDERAL_OWN_BOARDS.some((f) => ADJACENT_BOARDS.some((a) => a.name === f.name)));
});
