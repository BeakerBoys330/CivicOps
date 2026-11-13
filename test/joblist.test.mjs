// Job lists copied from a person's own browser. These samples are hand-written and only approximate the real boards.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseJobList } from '../src/sources.mjs';
import { parseRobots, crawlDelayMs } from '../src/net.mjs';
import { stripGovWords } from '../src/discover.mjs';

test('keeps only exact NEOGOV postings when a list has them, with row details', () => {
  const html = `<nav><a href="https://www.governmentjobs.com/careers/daytonoh">Home</a><a href="/careers/daytonoh/alerts">Job Alerts</a></nav>
    <ul><li><a href="/careers/daytonoh/jobs/5012345/water-plant-operator">Water Plant Operator</a><div>Dayton, OH</div><div>$25.50 - $30.00 Hourly</div></li>
    <li><a href="/careers/daytonoh/jobs/5012346/account-clerk">Account Clerk &amp; Cashier</a><div>Full Time</div></li>
    <li><a href="/careers/daytonoh/jobs/5012346/account-clerk">Apply</a></li></ul>
    <a href="https://evil.example/governmentjobs.com/jobs/99">Fake Lookalike Job</a>`;
  const jobs = parseJobList(html, 'https://www.governmentjobs.com/careers/daytonoh');
  assert.deepEqual(jobs.map((j) => j.title), ['Water Plant Operator', 'Account Clerk & Cashier']);
  assert.equal(jobs[0].city, 'Dayton');
  assert.equal(jobs[0].salaryMin, 25.5);
  assert.equal(jobs[0].exact, true);
});

test('reads a Cornerstone style card where the link wraps the whole card', () => {
  const html = `<a href="https://stateofohio.csod.com/ux/ats/careersite/1/home/requisition/777?c=stateofohio"><p>Program Administrator 2</p><p>Columbus, OH</p></a>`;
  const [job, ...rest] = parseJobList(html);
  assert.equal(rest.length, 0);
  assert.equal(job.title, 'Program Administrator 2');
  assert.equal(job.state, 'OH');
});

test('falls back to job-like links on small government pages, and drops unsafe links and menus', () => {
  const html = `<a href="https://example.gov/about">About the village</a><a href="https://example.gov/employment">Employment</a>
    <a href="https://example.gov/jobs/road-crew.pdf">Road Crew Laborer</a><a href="javascript:alert(1)">Job posting script</a>`;
  const jobs = parseJobList(html);
  assert.deepEqual(jobs.map((j) => j.title), ['Road Crew Laborer']);
  assert.equal(jobs[0].exact, false);
});

test('registry names that add the state still match', () => {
  assert.equal(stripGovWords('City of Dayton, Ohio'), 'Dayton');
  assert.equal(stripGovWords('Village of Farmersville'), 'Farmersville');
  assert.equal(stripGovWords('Municipality of Anchorage, Alaska'), 'Anchorage');
});

test('honors Crawl-delay, with a ceiling', () => {
  assert.equal(crawlDelayMs(parseRobots('User-agent: *\nCrawl-delay: 10\n')), 10000);
  assert.equal(crawlDelayMs(parseRobots('User-agent: *\nDisallow: /x\n')), 0);
  assert.equal(crawlDelayMs(parseRobots('User-agent: *\nCrawl-delay: 9999\n')), 60000);
});
