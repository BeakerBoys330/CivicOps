// ATS checks, degree substitution, outcome stats and access-request drafting. No network or AI needed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { atsCheck, keyTerms } from '../src/atscheck.mjs';
import { cleanEvaluation, computeScore, outcomeStats, SUBSTITUTION } from '../src/pipeline.mjs';
import { MAX_SHARED, MAX_SINGLE, blockedWhy, boardFor, clean, draftWarnings, requestTargets, stripInventedLinks } from '../src/requests.mjs';

test('letters use everyday government names', () => {
  assert.equal(clean('Dayton city, OH'), 'City of Dayton');
  assert.equal(clean('Farmersville village, OH'), 'Village of Farmersville');
  assert.equal(clean('Bethel township (Miami County), OH'), 'Bethel Township, Miami County');
  assert.equal(clean('Miami Conservancy District, OH'), 'Miami Conservancy District');
});

const POSTING = `Utility Billing Clerk. Minimum Qualifications: High school diploma. Two years of customer service experience.
Experience with Microsoft Excel and utility billing software. Valid Ohio Driver's License required. Knowledge of utility billing,
customer service and cash handling. Preferred: Tyler Munis experience.`;
const CV = 'Jane Doe. Customer service representative 2018 - 2024. Microsoft Excel, cash handling, utility billing at City Water. Valid Ohio Driver\'s License.';

test('ATS check passes a clean resume and separates safe additions from real gaps', () => {
  const resume = `# Jane Doe
Dayton, OH · (937) 555-0100 · jane@example.com

## Summary
Customer service and utility billing professional.

## Experience
### Customer Service Representative, City Water, Dayton, OH
March 2018 - June 2024
- Handled utility billing questions and cash handling for customers.

## Licenses and Certifications
- Valid Ohio Driver's License
${' Words that pad the length to a normal resume.'.repeat(30)}`;
  const a = atsCheck(resume, POSTING, CV);
  assert.ok(a.checks.every((c) => c.ok), JSON.stringify(a.checks.filter((c) => !c.ok)));
  assert.ok(a.matched.includes('utility billing'));
  assert.ok(a.canAdd.some((t) => /excel/i.test(t)), `canAdd: ${a.canAdd}`);
  assert.ok(a.gaps.some((t) => /munis|tyler/i.test(t)), `gaps: ${a.gaps}`);
  assert.ok(!a.canAdd.some((t) => /munis/i.test(t)));
});

test('ATS check flags tables, symbol bullets and a missing contact line', () => {
  const a = atsCheck('# Jane\n\n| Skill | Years |\n|---|---|\n● Excel', POSTING, CV);
  const failed = a.checks.filter((c) => !c.ok).map((c) => c.name);
  assert.ok(failed.includes('No tables, columns or images'));
  assert.ok(failed.includes('Simple bullets and characters'));
  assert.ok(failed.includes('Email or phone near the top'));
  assert.ok(keyTerms(POSTING).length > 3);
});

test('a missing degree is not a blocker when the posting allows experience instead', () => {
  const posting = "Bachelor's degree in public administration. Additional qualifying experience may substitute for the required education on a year-for-year basis.";
  const ev = cleanEvaluation({ requirements: [{ requirement: "Bachelor's degree", kind: 'minimum', met: 'no', evidence: 'No degree listed.' }], gates: [], scores: { qualifications: 4, experience: 4, level: 4, pay: 3, eligibility: 4 } }, posting);
  assert.equal(ev.requirements[0].met, 'unknown');
  assert.equal(ev.requirements[0].substitutionAllowed, true);
  assert.equal(computeScore(ev).blockers.length, 0);
  // The experience route was checked and also fails: then it stays a blocker.
  const ev2 = cleanEvaluation({ requirements: [{ requirement: "Bachelor's degree", kind: 'minimum', met: 'no', path: 'none', evidence: 'No degree; 2 years of experience, 6 needed.' }], gates: [], scores: {} }, posting);
  assert.equal(computeScore(ev2).blockers.length, 1);
  // No substitution wording: a missing degree stays a blocker.
  const ev3 = cleanEvaluation({ requirements: [{ requirement: "Bachelor's degree", kind: 'minimum', met: 'no', evidence: 'No degree.' }], gates: [], scores: {} }, "Bachelor's degree required.");
  assert.equal(computeScore(ev3).blockers.length, 1);
  for (const s of ['or an equivalent combination of education and experience', "four years of experience may substitute for a bachelor's degree", 'in lieu of a degree']) assert.match(s, SUBSTITUTION);
});

test('outcome stats follow each application to its furthest stage', () => {
  const store = {
    a: { level: 'city', status: 'Rejected', appliedOn: '2026-01-01', outcomeReason: 'Interviewed, not selected', evaluation: { score: 4.2 }, history: [{ status: 'Applied', on: '2026-01-01' }, { status: 'Interview', on: '2026-01-20' }, { status: 'Rejected', on: '2026-02-01' }] },
    b: { level: 'county', status: 'Applied', appliedOn: '2026-01-05', evaluation: { score: 2.5 } },
    c: { level: 'city', status: 'New' },
  };
  const s = outcomeStats(store);
  assert.equal(s.total.applied, 2);
  assert.equal(s.total.interviewed, 1);
  assert.equal(s.byScore['Score 4 to 5'].interviewed, 1);
  assert.equal(s.reasons['Interviewed, not selected'], 1);
  assert.equal(s.medianDaysToFirstResponse, 19);
});

test('access request drafts flag invented contact details', () => {
  const facts = 'Recipient: Butler Township';
  const w = draftWarnings('Subject: Jobs\n\nCall me at 937-555-0199 or write hr@butler.example.gov.', facts);
  assert.equal(w.length, 2);
  const targets = requestTargets([{ name: 'Farmersville village, OH', coverage: 'blocked', lastResult: 'robots', website: 'https://example.gov/' }], { location: { state: 'OH' } });
  assert.ok(targets.some((t) => t.group === 'blocked-site' && /civicops/.test(t.ask)));
});

test('access request drafts flag legal wording and speaking for a group', () => {
  const facts = 'Recipient: Butler Township';
  const flagged = (text) => draftWarnings(`Subject: Jobs\n\n${text}`, facts).join(' ');
  assert.match(flagged('Pursuant to the Public Records Act, please reply within 10 business days.'), /legal wording/);
  assert.match(flagged('I am writing on behalf of the CivicOps project.'), /speaks for a group/);
  assert.match(flagged('We would like your jobs as a feed.'), /speaks for a group/);
  assert.deepEqual(draftWarnings('Subject: Jobs\n\nHello, I am looking for work. Could you tell me where openings are announced?\n\nThank you,\nPat', facts), []);
});

test('a web address the model made up is taken out of the draft, and a real one is kept', () => {
  const facts = 'Send to: the form on https://example.gov/contact';
  const made = stripInventedLinks('The project page is https://civicops.example. Use https://example.gov/contact, please.', facts);
  assert.equal(made.text, 'The project page is [link removed]. Use https://example.gov/contact, please.');
  assert.deepEqual(made.removed, ['https://civicops.example']);
  assert.deepEqual(stripInventedLinks('No links here.', facts), { text: 'No links here.', removed: [] });
});

test('a letter says only what the tool saw: a bot check never gets a robots.txt request', () => {
  const st = { location: { state: 'OH' } };
  const site = (over) => ({ name: 'Farmersville village, OH', level: 'city', coverage: 'blocked', website: 'https://example.gov/', ...over });
  const letter = (over) => requestTargets([site(over)], st).find((t) => t.group === 'blocked-site');
  assert.match(letter({ lastResult: 'robots' }).ask, /robots\.txt/);
  assert.doesNotMatch(letter({ lastResult: 'bot-check' }).ask, /robots|bot check/);
  assert.match(letter({ lastResult: 'bot-check' }).situation, /does not try to get past/);
  // Employers found before the reason was saved still carry it in their note.
  assert.equal(blockedWhy(site({ note: 'This site has a bot check, so it needs a person.' })), 'bot-check');
  assert.equal(blockedWhy(site({ note: 'This site asks automated tools not to read it.' })), 'robots');
  // Reason unknown: no letter at all, and the employer is counted as left out.
  const unknown = requestTargets([site({})], st);
  assert.equal(unknown.length, 0);
  assert.equal(unknown.omitted, 1);
});

test('letters go to nearby governments only, a few at a time, unless --project is used', () => {
  const st = { location: { state: 'OH' } };
  const list = [
    { name: 'State of Ohio', level: 'state', coverage: 'link-only', ats: 'Cornerstone', careersUrl: 'https://jobs.example.gov/', website: 'https://example.gov/' },
    { name: 'Ohio Example League: Jobs', level: 'city', statewide: true, coverage: 'link-only', careersUrl: 'https://league.example.org/jobs' },
    ...Array.from({ length: MAX_SINGLE + 3 }, (_, i) => ({ name: `Town${i} city, OH`, level: 'city', coverage: 'link-only', ats: 'NEOGOV', website: `https://town${i}.example.gov/`, distanceMi: i })),
    ...Array.from({ length: MAX_SHARED + 4 }, (_, i) => ({ name: `Hamlet${i} village, OH`, level: 'city', coverage: 'no-website', distanceMi: i })),
  ];
  const mine = requestTargets(list, st);
  assert.ok(mine.every((t) => t.office && !t.project), 'default letters go to local government offices only');
  assert.ok(!mine.some((t) => /NLx|NEOGOV \(|central HR|League/.test(t.name)));
  assert.equal(mine.filter((t) => t.group === 'employer-hr').length, MAX_SINGLE);
  assert.equal(mine.find((t) => t.group === 'employer-hr').name, 'City of Town0'); // nearest first
  assert.equal(mine.find((t) => t.group === 'no-website').shared.length, MAX_SHARED);
  assert.equal(mine.omitted, 3 + 4);
  const all = requestTargets(list, st, { project: true });
  assert.deepEqual(all.filter((t) => t.project).map((t) => t.name), ['NLx Research Hub (National Labor Exchange)', 'State of Ohio central HR office', 'NEOGOV (governmentjobs.com)', 'Ohio Example League: Jobs']);
  // Nobody is asked to switch off a bot check or to make an exception to robots.txt on a guess.
  assert.ok(all.filter((t) => t.project).every((t) => !/user agent|bot check/.test(t.ask)));
});

test('a letter only suggests a job board that takes that kind of employer', () => {
  assert.equal(boardFor('OH', 'township'), 'Ohio Township Association');
  assert.equal(boardFor('OH', 'county'), 'County Commissioners Association of Ohio');
  assert.equal(boardFor('OH', 'city'), null);   // Ohio has no city board on the list
  assert.equal(boardFor('OH', 'school'), null); // a school is never sent to a township or county board
  assert.equal(boardFor('ZZ', 'county'), null);
  const list = [
    { name: 'Butler township (Montgomery County), OH', level: 'township', coverage: 'blocked', lastResult: 'robots', website: 'https://butler.example.gov/' },
    { name: 'Valley View Local Schools, OH', level: 'school', coverage: 'blocked', lastResult: 'bot-check', website: 'https://schools.example.org/' },
    { name: 'Harrison township (Montgomery County), OH', level: 'township', coverage: 'no-website' },
    { name: 'Phillipsburg village, OH', level: 'city', coverage: 'no-website' },
  ];
  const ohio = requestTargets(list, { location: { state: 'OH' } });
  const ask = (name) => ohio.find((t) => t.name === name).ask;
  assert.match(ask('Butler Township, Montgomery County'), /Ohio Township Association job board/);
  assert.doesNotMatch(ask('Valley View Local Schools'), /Association|job board/);
  // Townships and villages get separate shared letters, because only one of them has a board to point to.
  assert.deepEqual(ohio.find((t) => t.name === 'Townships with no website found').shared, ['Harrison Township, Montgomery County']);
  assert.doesNotMatch(ask('Cities and villages with no website found'), /Association/);
  // The same employers in another state never get an Ohio board.
  const texas = requestTargets(list.map((j) => ({ ...j, name: j.name.replace(', OH', ', TX') })), { location: { state: 'TX' } });
  assert.ok(texas.every((t) => !/Ohio|CCAO/.test(`${t.ask} ${t.to}`)));
});
