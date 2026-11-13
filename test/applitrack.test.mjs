// Markup trimmed from two live AppliTrack boards (one district, one shared by a consortium), November 2026.
// District and school names are stand-ins.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appliTrackBoard, parseAppliTrack } from '../src/sources.mjs';

const posting = (id, suffix, title, fields) => `<ul class='postingsList' id='p${id}_${suffix}'><table class='title'><tr><td id='wrapword' style='width: 950px;'>${title}</td><td><span class='title2'> JobID: ${id} </span></td></tr></table><div style='position:relative;'>${fields}<span class="normal"><p>Starting rate is $18.21/hour</p></span></div></ul>`;
const field = (label, value) => `<li><span class="label" > ${label}: </span><br/>&nbsp;&nbsp;<span class='normal'>${value}</span><br/><br/></li>`;

test('reads AppliTrack postings with their dates, location and pay text', () => {
  const html = posting(770, '', 'Food Service Worker', field('Position Type', 'Food Service') + field('Date Posted', '11/2/2026') + field('Location', 'Oakwood High School') + field('Closing Date', '11/13/2026'))
    + posting(6701, '37911', 'VACANCY: Cook-5 hours', field('Location', 'Valley Middle School') + field('Closing Date', '04/30/2026 - Until Filled'));
  const rows = parseAppliTrack(html);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].jobId, rows[0].title, rows[0].posted, rows[0].location, rows[0].closes], ['770', 'Food Service Worker', '11/2/2026', 'Oakwood High School', '11/13/2026']);
  assert.match(rows[0].text, /\$18\.21\/hour/);
  assert.equal(rows[1].jobId, '6701');
  assert.equal(rows[1].closes, '04/30/2026 - Until Filled');
});

test('builds the show-all address, keeping a consortium member and a location filter', () => {
  assert.equal(appliTrackBoard('http://www.applitrack.com/oakwood/onlineapp/default.aspx').listUrl, 'https://www.applitrack.com/oakwood/onlineapp/jobpostings/view.asp?embed=1&all=1');
  const c = appliTrackBoard('https://www.applitrack.com/consortium/onlineapp/JobPostings/view.asp?choosedistrict=true&applitrackclient=37911');
  assert.match(c.listUrl, /all=1&choosedistrict=true&applitrackclient=37911$/);
  assert.equal(appliTrackBoard('https://www.applitrack.com/x/onlineapp/default.aspx?AppliTrackPostingSearch=location:%22Valley+View+Local+Schools%22').location, 'Valley View Local Schools');
  assert.equal(appliTrackBoard('https://www.applitrack.com/sharedboard/onlineapp/', 'Brookville').location, 'Brookville');
  assert.equal(appliTrackBoard('https://example.org/jobs'), null);
});
