// Drafts the messages that ask a local government how its job openings can be found, using your "write" model.
// Drafts only: CivicOps never sends a message. You review each one and send it yourself, in your own name.
//
// What keeps this safe to hand to strangers:
//  - A letter only states what the tool itself saw (a robots.txt rule, a bot check, no website found).
//  - By default letters go only to governments in your own area, a few at a time, nearest first.
//  - Letters to a company or a central office that serves every user (NEOGOV, a state HR office, a statewide
//    board, the NLx) are left out unless you ask for them with --project. One person asking is enough.
//  - Every draft is checked for invented contact details, legal wording, and speaking for the project.
import { existsSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chat, hasAi } from './ai/client.mjs';
import { STATE_NAMES } from './geo.mjs';
import { PROJECT_URL } from './net.mjs';
import { STATE_BOARDS } from './portals.mjs';
import { P, ensureDir, slug, today } from './util.mjs';

const TOOL = 'CivicOps, an open-source personal job search tool that reads public government job pages only when their robots.txt allows it, waits between requests, and links every job back to the original page';
const AGENT = 'civicops';
/** Letters written to one office each, nearest first. More than this starts to look like a mass mailing. */
export const MAX_SINGLE = 8;
/** Names listed on one shared letter. */
export const MAX_SHARED = 10;
const FALLBACK = 'where job openings are usually announced';

const host = (u) => { try { return new URL(u).origin; } catch { return u ?? ''; } };
/** Census names read oddly in a letter: "Dayton city" becomes "City of Dayton", "Butler township (Montgomery County)" becomes "Butler Township, Montgomery County". */
export const clean = (n) => {
  const s = String(n).replace(/, [A-Z]{2}$/, '');
  const m = s.match(/^(.+?) (city|village|town|borough)$/i);
  if (m) return `${m[2][0].toUpperCase()}${m[2].slice(1).toLowerCase()} of ${m[1]}`;
  const t = s.match(/^(.+?) township(?: \(([^)]+) County\))?$/i);
  if (t) return `${t[1]} Township${t[2] ? `, ${t[2]} County` : ''}`;
  return s.replace(/ \(([^)]+) County\)/, ', $1 County');
};

/**
 * The association whose job board takes postings from this kind of government in this state, or null.
 * A letter never suggests a board the employer cannot use: a school is not sent to a township association.
 */
export function boardFor(st, level) {
  if (!['county', 'city', 'township'].includes(level)) return null;
  return (STATE_BOARDS[st] ?? []).find((b) => b.level === level)?.name.split(':')[0].trim() ?? null;
}

/**
 * Why the tool could not read a site: 'robots', 'bot-check', or null when it is not known.
 * A letter must not tell an office its robots.txt blocks tools when a bot check did, so an unknown reason gets no letter.
 */
export function blockedWhy(j) {
  if (['robots', 'bot-check'].includes(j.lastResult)) return j.lastResult;
  if (/bot check/i.test(j.note ?? '')) return 'bot-check';
  if (/asks automated tools/i.test(j.note ?? '')) return 'robots';
  return null;
}

const PLURAL = { county: 'Counties', city: 'Cities and villages', township: 'Townships', school: 'School districts', special: 'Special districts', tribal: 'Tribal governments' };

/** One shared letter per association board, so the ask in it fits every employer on its list. */
function sharedGroups(items, st, omit) {
  const by = new Map();
  for (const j of items) {
    const board = boardFor(st, j.level);
    by.set(board, [...(by.get(board) ?? []), j]);
  }
  return [...by].map(([board, js]) => {
    const levels = [...new Set(js.map((j) => j.level))];
    const who = levels.length === 1 && PLURAL[levels[0]] ? PLURAL[levels[0]] : by.size > 1 ? 'Other governments' : 'Governments';
    omit(js.length - MAX_SHARED);
    return { board, who, names: js.slice(0, MAX_SHARED).map((j) => clean(j.name)) };
  });
}

/**
 * Everything worth asking about, grouped. Shared letters are written once and filled in per employer.
 * The returned list has an `omitted` count: employers left out to keep the number of messages small.
 * `project: true` adds the letters to companies and central offices, which one person should send, not every user.
 */
export function requestTargets(list, cfg, { project = false } = {}) {
  const st = cfg.location.state;
  const stateName = STATE_NAMES[st] ?? st;
  const near = (a, b) => (a.distanceMi ?? 999) - (b.distanceMi ?? 999);
  const alsoPost = (j, verb) => { const b = boardFor(st, j.level); return b ? `, or also ${verb} openings on the ${b} job board` : ''; };
  const out = [];
  let omitted = 0;
  const omit = (n) => { if (n > 0) omitted += n; };
  const nearest = (items) => { const sorted = items.sort(near); omit(sorted.length - MAX_SINGLE); return sorted.slice(0, MAX_SINGLE); };

  if (project) {
    out.push({ group: 'source', project: true, form: true, name: 'NLx Research Hub (National Labor Exchange)',
      to: 'The NLx Research Hub data request form: https://www.naswa.org/national-labor-exchange/nlx-research-hub. Read its data use agreement before you accept it. It applies to you personally.',
      situation: 'The NLx collects job postings from every state job bank. Its API is free for approved users who sign a data use agreement. CivicOps has no NLx reader yet.',
      ask: `API access, read-only, to job postings in ${stateName}, to build and test a reader for an open-source government job search tool.` });
    const portal = list.find((j) => j.level === 'state' && j.coverage === 'link-only');
    if (portal) {
      out.push({ group: 'source', project: true, name: `${portal.name} central HR office`, to: `The State of ${stateName} central human resources office. Find its contact page from ${host(portal.website || portal.careersUrl)}.`,
        situation: `State jobs are listed on ${portal.careersUrl}, which uses ${portal.ats}. The tool cannot read it because the list needs a full web browser, and the tool found no public feed.`,
        ask: 'Whether an official public feed (RSS, XML or an API) of open state positions exists, or could be provided. Offer to follow any data agreement.' });
    }
    if (list.some((j) => /NEOGOV/.test(j.ats ?? ''))) {
      out.push({ group: 'source', project: true, name: 'NEOGOV (governmentjobs.com)', to: 'NEOGOV, through the contact or partnership form on neogov.com.',
        situation: 'Many cities and counties post only on governmentjobs.com. Its robots.txt allows named search engines only, so the tool does not read it.',
        ask: 'Whether personal job-search tools may read agencies\' public job RSS feeds, or whether NEOGOV offers an approved feed for them.' });
    }
    for (const j of list.filter((x) => x.statewide && x.coverage === 'link-only')) {
      out.push({ group: 'statewide-board', project: true, name: j.name, to: `Whoever runs the board, through the contact page on ${host(j.careersUrl)}.`,
        situation: `${j.note || 'The job list needs a full web browser.'} The tool cannot read it. The board lists openings at smaller governments that often have no job page of their own.`,
        ask: 'Whether the job board could also be published as an RSS or JSON feed.' });
    }
  }

  for (const j of nearest(list.filter((x) => x.coverage === 'link-only' && !x.statewide && !['federal', 'state', 'adjacent'].includes(x.level)))) {
    out.push({ group: 'employer-hr', office: true, name: clean(j.name), to: `${clean(j.name)} human resources. Find the HR email or contact form on ${host(j.website)}.`,
      situation: `Its jobs are posted on ${j.ats}, which the tool does not read (${/NEOGOV/.test(j.ats ?? '') ? 'that board does not allow tools like this one' : 'the board needs a full web browser'}).`,
      ask: `Whether they can publish open positions as an RSS feed${alsoPost(j, 'post')}.`, fallback: FALLBACK });
  }
  const blocked = list.filter((x) => x.coverage === 'blocked');
  omit(blocked.filter((j) => !blockedWhy(j)).length);
  for (const j of nearest(blocked.filter(blockedWhy))) {
    const bot = blockedWhy(j) === 'bot-check';
    out.push({ group: 'blocked-site', office: true, name: clean(j.name), to: `The clerk, administrator or webmaster listed on ${host(j.website)}.`,
      situation: bot ? 'The website has a bot check that stopped the tool. The tool does not try to get past bot checks.' : 'The website\'s robots.txt asks automated tools not to visit, so the tool skips it.',
      ask: `${bot ? 'Whether open positions are also published somewhere a simple reader can see them, such as an RSS feed' : `Adding an allow line for the user agent "${AGENT}" in robots.txt (a crawl delay is fine)`}${alsoPost(j, 'posting')}.`, fallback: FALLBACK });
  }
  for (const g of sharedGroups(list.filter((x) => x.coverage === 'no-website').sort(near), st, omit)) {
    out.push({ group: 'no-website', office: true, shared: g.names, name: `${g.who} with no website found`,
      to: 'The clerk or fiscal officer of each one. The county\'s website usually lists contact details for its local governments.',
      situation: 'The tool could not find a website for this government, so it cannot see any job openings.',
      ask: `Where job openings are usually announced${g.board ? `, and whether they could also post openings on the ${g.board} job board` : ''}.` });
  }
  for (const g of sharedGroups(list.filter((x) => x.coverage === 'no-jobs-page').sort(near), st, omit)) {
    out.push({ group: 'no-jobs-page', office: true, shared: g.names, name: `${g.who} with a website but no jobs page found`,
      to: 'The clerk or administrator listed on each website.',
      situation: 'The tool found the website but no page listing job openings.',
      ask: `Where job openings are announced (a page, news posts, the newspaper), and whether they could add a simple jobs page${g.board ? ` or post on the ${g.board} job board` : ''}.` });
  }
  out.omitted = omitted;
  return out;
}

const SYSTEM = `You draft short, polite, honest messages from a job seeker to a government office or a job board operator.
Rules:
- Use only the facts given. Never invent names, email addresses, phone numbers, job titles, dates, statistics, laws or promises.
- The sender is one private person looking for work, writing for themselves. Say "I", never "we" or "our". Do not
  claim to be a developer, a company, a reporter or an official, and do not speak for the CivicOps project.
- This is a friendly question that the office is free to decline. It is not a public records request, a complaint or
  a demand. Do not cite any law, right, deadline or obligation, and do not ask for a reply by a date.
- Mention the tool in one plain sentence. Do not exaggerate what it does.
- Include a web address only if it appears in the facts, exactly as written. Never make one up for the tool.
- Say only what the tool saw, in the words given. Do not describe the office's website or security beyond that.
- Ask for the one thing described. Add a fallback question only when the facts give one.
- Describe the purpose as finding work for the sender only. Do not claim the tool serves the public or other people.
- Greet the office by the name given (for example "Hello, City of Dayton Human Resources,"), or just "Hello," when the
  name is [Employer].
- Under 170 words. Plain text, no markdown, no emojis.
- Start with a line "Subject: ..." then a blank line, then the message. End with "Thank you," and the sender's name on the next line.
- If an employer name is given as [Employer], keep the literal text [Employer] wherever the name belongs.`;

const PHONE = /\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const SPEAKS_FOR = /\b(?:on behalf of|we at|I represent|we (?:are|would|request|ask|use|have)|our (?:team|organi[sz]ation|company|project|users|tool|members)|I am (?:a|the) (?:developer|maintainer|creator|author|founder|owner|reporter|journalist|researcher))\b/i;
const LEGAL = /\b(?:freedom of information|FOIA|public records? (?:act|law|request)|open records|sunshine law|pursuant to|you are (?:required|obligated)|(?:are|is) required by law|legal action|my attorney|lawsuit|within \d+ (?:business |calendar )?days)\b/i;

const LINK = /https?:\/\/[^\s)]+/g;
const tidy = (url) => url.replace(/[.,;:!?]+$/, '');

/**
 * A model sometimes makes up a web address for the tool or an office. One that was not in the facts could belong
 * to anyone, so it is taken out of the draft, not just flagged. Returns the cleaned draft and what was removed.
 */
export function stripInventedLinks(draft, facts) {
  const removed = [];
  const text = draft.replace(LINK, (m) => {
    if (facts.includes(tidy(m))) return m;
    removed.push(tidy(m));
    return `[link removed]${m.slice(tidy(m).length)}`;
  });
  return { text, removed };
}

/** Flags anything in a draft that could get the sender or the project in trouble: details that were not in the facts, legal wording, or speaking for a group. */
export function draftWarnings(draft, facts) {
  const warn = [];
  for (const m of draft.match(EMAIL) ?? []) if (!facts.includes(m)) warn.push(`email address "${m}" was not in the facts. Remove it or check it.`);
  for (const m of draft.match(PHONE) ?? []) if (!facts.includes(m)) warn.push(`phone number "${m}" was not in the facts. Remove it or check it.`);
  for (const m of draft.match(LINK) ?? []) if (!facts.includes(tidy(m))) warn.push(`link "${tidy(m)}" was not in the facts.`);
  const group = draft.match(SPEAKS_FOR);
  if (group) warn.push(`draft speaks for a group or the project ("${group[0]}"). You are writing as one private person, so reword it.`);
  const legal = draft.match(LEGAL);
  if (legal) warn.push(`draft uses legal wording ("${legal[0]}"). This is a friendly question, not a records request or a demand, so remove it.`);
  if (!/^Subject:/im.test(draft)) warn.push('the draft has no Subject line.');
  if (draft.split(/\s+/).length > 260) warn.push('the draft is long. Consider trimming it.');
  return warn;
}

const BEFORE_SENDING = [
  '## Before you send anything',
  '',
  '- **These are optional.** CivicOps works without them. Send one only to a place you would really like to work.',
  '- **CivicOps has sent nothing.** You send each message yourself, from your own email, in your own name, and you are responsible for what it says.',
  '- **Read every draft first.** An AI model wrote them and can get details wrong. Fix or delete anything that is not true for you.',
  '- **You are writing as one private person.** You do not speak for the CivicOps project, and the project has no arrangement with any office or company.',
  '- **One message per office.** Do not send repeats or reminders. An office may say no or not answer, and that is its choice.',
  '- **Keep it a friendly question.** These are not public records requests, complaints or demands, and should not be turned into one.',
  '- **Messages to a government office may be kept as public records.** Include only what you are comfortable sharing.',
  '- **If an office says no,** leave the site alone and check its jobs by hand. Never work around a block.',
  '',
];

export async function draftRequests(cfg, list, { onProgress = () => {}, limit = Infinity, project = false } = {}) {
  if (!hasAi(cfg, 'write')) throw new Error('Set a writing model on the AI models page first.');
  const sender = cfg.candidate?.name?.trim() || '[Your name]';
  const dir = ensureDir(join(P.output, 'access-requests'));
  // Drafts from an earlier run would sit beside the new ones and get sent by mistake. Keep them, out of the way.
  const old = readdirSync(dir).filter((f) => /^\d\d-.*\.md$/.test(f));
  if (old.length) {
    const keep = ensureDir(join(dir, 'previous'));
    for (const f of old) renameSync(join(dir, f), join(keep, f));
  }
  const all = requestTargets(list, cfg, { project });
  const targets = all.slice(0, limit);
  const index = [`# Access request drafts (${today()})`, '', 'Drafted by your writing model. Nothing has been sent.', '', ...BEFORE_SENDING, '## Drafts', ''];
  let n = 0;
  for (const t of targets) {
    n++;
    onProgress(`Drafting ${n}/${targets.length}: ${t.name}`);
    const who = t.shared ? '[Employer]' : t.name;
    const facts = [`Recipient: ${who}`, `What the tool saw: ${t.situation}`, `What to ask for: ${t.ask}`,
      t.fallback ? `Fallback question, if they cannot do that: ${t.fallback}?` : '',
      `The tool: ${TOOL}.`, PROJECT_URL ? `Project page: ${PROJECT_URL}` : '', `Sender's name: ${sender}`,
      t.form ? 'Format: a short project description to paste into a web request form, not an email (start with "Subject: Project description" anyway).' : ''].filter(Boolean).join('\n');
    let draft = '', error = '';
    try {
      const r = await chat({ cfg, role: 'write', system: SYSTEM, user: facts, maxTokens: 900, temperature: 0.3 });
      draft = String(r.text ?? '').trim();
    } catch (e) { error = e.message; }
    const links = stripInventedLinks(draft, facts);
    draft = links.text;
    const warn = draft ? draftWarnings(draft, facts) : [];
    for (const l of links.removed) warn.push(`model made up a web address ("${l}"), which was removed. Reword or delete the sentence marked [link removed].`);
    const file = `${String(n).padStart(2, '0')}-${t.group}-${slug(t.name, 40)}.md`;
    const body = [`# ${t.name}`, '*Draft only. Nothing has been sent. Check every sentence is true for you before you send it.*',
      t.project ? '**Project-level request.** The answer is the same for every CivicOps user, so one person asking is enough. Check the project\'s issues first to see whether someone already has, and share the answer there.' : '',
      `**Send to:** ${t.to}`, `**Asking for:** ${t.ask}`,
      warn.length ? `**Check before sending:**\n${warn.map((w) => `- The ${w}`).join('\n')}` : '',
      t.shared ? `**For each of these you choose to write to, replace [Employer] with the name:**\n${t.shared.map((s) => `- [ ] ${s}`).join('\n')}` : '',
      '## Draft', error ? `The model could not draft this one: ${error}` : draft].filter(Boolean).join('\n\n') + '\n';
    writeFileSync(join(dir, file), body);
    index.push(`- [ ] [${t.name}](${file})${warn.length ? ' (check flagged details)' : ''}${error ? ' (failed, see file)' : ''}`);
  }
  if (all.omitted) index.push('', `${all.omitted} more ${all.omitted === 1 ? 'employer was' : 'employers were'} left out to keep this list short (the nearest come first), or because the reason the tool could not read the site is not known.`);
  if (old.length && existsSync(join(dir, 'previous'))) index.push('', `Drafts from your last run were moved to the \`previous\` folder.`);
  writeFileSync(join(dir, 'README.md'), index.join('\n') + '\n');
  return { count: targets.length, omitted: all.omitted, dir };
}
