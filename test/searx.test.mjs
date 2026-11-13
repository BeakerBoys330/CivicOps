// Runs the SearXNG path against a simulated local search server, so it needs no network.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { scanViaSearch } from '../src/sources.mjs';

test('search index path keeps only real postings on that employer board', async () => {
  let seenQuery = '';
  const server = createServer((req, res) => {
    seenQuery = new URL(req.url, 'http://x').searchParams.get('q');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ results: [
      { url: 'https://www.governmentjobs.com/careers/columbusoh/jobs/5123456/police-officer', title: 'Police Officer | Job Details tab', content: '$60,000 to $90,000 annually' },
      { url: 'https://www.governmentjobs.com/careers/columbusoh/jobs/5123456/police-officer', title: 'Duplicate', content: '' },
      { url: 'https://www.governmentjobs.com/careers/columbusoh', title: 'All jobs (board page, not a posting)', content: '' },
      { url: 'https://www.governmentjobs.com/careers/dayton/jobs/999/clerk', title: 'Other employer', content: '' },
      { url: 'https://evil.example/governmentjobs.com/careers/columbusoh/jobs/1', title: 'Lookalike', content: '' },
    ] }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const j = { id: 'x', name: 'Columbus city, OH', level: 'city', state: 'OH', careersUrl: 'https://www.governmentjobs.com/careers/columbusoh' };
    const jobs = await scanViaSearch(j, { sources: { searxngUrl: base } });
    assert.match(seenQuery, /^site:governmentjobs\.com\/careers\/columbusoh\/jobs$/);
    assert.equal(jobs.length, 1, JSON.stringify(jobs.map((x) => x.url)));
    assert.equal(jobs[0].title, 'Police Officer');
    assert.equal(jobs[0].confidence, 'low');
    assert.equal(jobs[0].salaryMin, 60000);
  } finally { server.close(); }
});
