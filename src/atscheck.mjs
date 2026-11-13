// Checks a tailored resume against the common reasons applicant tracking systems (ATS) misread a resume, plus how
// well it covers the posting's own terms. There is no single official ATS test; these are local, explainable rules.
// Missing terms are split into ones your CV supports (safe to add) and real gaps (never add them).

const STOP = new Set(('a an and are as at be by for from has have in is it its of on or that the this to with will you your our we who which must may can should able ability including include includes other such any all each per within upon into than then also more most very well work working position job candidate candidates applicant applicants employee employees duties duty responsible responsibilities required requirements requirement preferred qualifications qualification minimum experience years year knowledge skills skill strong excellent good related relevant equivalent combination following perform performs performing provide provides providing ensure various using use used city county township village state department office public government').split(' '));

const HEADINGS = {
  experience: /^#{1,3}\s*(professional |work |relevant )?(experience|employment|work history)/im,
  education: /^#{1,3}\s*education/im,
  skills: /^#{1,3}\s*(skills|licenses|certifications|licenses and certifications|qualifications)/im,
};

/** The part of a posting that lists what the employer wants. Falls back to the whole posting. */
export function requirementText(posting) {
  const t = String(posting ?? '');
  const start = t.search(/minimum qualifications|qualifications|requirements|knowledge,? skills|kssa|ksa|essential (duties|functions)|examples of (duties|work)|specialized experience/i);
  return start >= 0 ? t.slice(start, start + 6000) : t.slice(0, 6000);
}

/** Terms a screener or ATS would look for: licenses and certifications, named tools, and repeated phrases. */
export function keyTerms(posting, max = 25) {
  const text = requirementText(posting);
  const terms = new Map();
  const add = (t, w) => { const k = t.toLowerCase().replace(/\s+/g, ' ').trim(); if (k.length >= 3 && !STOP.has(k)) terms.set(k, (terms.get(k) ?? 0) + w); };
  for (const m of text.matchAll(/\b((?:[A-Z][\w.&/-]*\s){0,3}(?:License|Licence|Certification|Certificate|Certified|Permit|Endorsement))\b/g)) add(m[1], 5);
  for (const m of text.matchAll(/\b([A-Z]{2,6}(?:\+|\b))/g)) if (!/^(AND|OR|THE|FOR|WITH|NOT|ALL|EOE|ADA|USA|OF)$/.test(m[1])) add(m[1], 3);
  for (const m of text.matchAll(/\b(Microsoft (?:Word|Excel|Outlook|Office|Access)|Excel|AutoCAD|ArcGIS|GIS|SQL|Python|SAP|Workday|Tyler|Munis|QuickBooks|SCADA|Laserfiche|CAD)\b/g)) add(m[1], 4);
  const words = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length - 1; i++) {
    const [a, b] = [words[i], words[i + 1]];
    if (!STOP.has(a) && !STOP.has(b) && a.length > 2 && b.length > 2 && !/^\d+$/.test(a + b)) add(`${a} ${b}`, 1);
  }
  for (const w of words) if (!STOP.has(w) && w.length >= 5 && !/^\d+$/.test(w)) add(w, 0.5);
  return [...terms.entries()].filter(([, s]) => s >= 1.5).sort((a, b) => b[1] - a[1]).map(([t]) => t)
    // Drop single words already covered by a phrase that contains them.
    .filter((t, i, all) => t.includes(' ') || !all.slice(0, i).some((p) => p.includes(' ') && p.split(' ').includes(t)))
    .slice(0, max);
}

const has = (text, term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}`, 'i').test(text);

/**
 * resume: the employer-facing part of the tailored resume (Markdown). posting: posting text. cv: the source CV.
 * pdfText: text pulled back out of the generated PDF, when there is one.
 */
export function atsCheck(resume, posting, cv, { federal = false, pdfText = null } = {}) {
  const r = String(resume ?? '');
  const head = r.split('\n').slice(0, 8).join('\n');
  const words = r.split(/\s+/).filter(Boolean).length;
  const checks = [];
  const check = (name, ok, fix) => checks.push({ name, ok: !!ok, fix: ok ? '' : fix });
  check('Name at the top', /^#\s+\S/m.test(head), 'Start with your name as the first heading.');
  check('Email or phone near the top', /[\w.+-]+@[\w-]+\.\w+|\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/.test(head), 'Put your email and phone right under your name.');
  check('Standard section headings', HEADINGS.experience.test(r) && (HEADINGS.education.test(r) || HEADINGS.skills.test(r)), 'Use plain headings such as Experience, Education, and Licenses and Certifications.');
  check('No tables, columns or images', !/^\s*\|.*\|/m.test(r) && !/<img|!\[/.test(r) && !/\t/.test(r), 'Remove tables, columns and images. Many ATS read them out of order or skip them.');
  check('Simple bullets and characters', !/[●■◆►✓✔★•▪]/.test(r), 'Use plain "-" bullets. Symbol bullets can turn into garbage characters.');
  check('Dates on each job', (r.match(/\b(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|\d{1,2}\/\d{4}|\d{4})\s*(?:-|–|—|to)\s*(?:Present|Current|(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+)?\d{4}|\d{1,2}\/\d{4})/gi) ?? []).length >= 1, 'Give each job a start and end date, such as "March 2019 - Present".');
  check(federal ? 'Length suits a federal resume' : 'Length of one to two pages', federal ? words >= 400 && words <= 2400 : words >= 250 && words <= 1100, federal ? 'Federal resumes need detail but should respect the page limit (two pages unless the announcement says otherwise).' : 'Aim for one to two pages.');
  if (pdfText !== null) {
    const name = (head.match(/^#\s+(.+)$/m)?.[1] ?? '').trim();
    check('PDF text can be read by software', pdfText.length > 200 && (!name || pdfText.toLowerCase().includes(name.toLowerCase().split(/\s+/)[0])), 'The PDF text could not be read back. Upload the Word or text version instead, if the employer allows it.');
  }
  const terms = keyTerms(posting);
  const matched = terms.filter((t) => has(r, t));
  const missing = terms.filter((t) => !has(r, t));
  const canAdd = missing.filter((t) => has(cv, t));
  const gaps = missing.filter((t) => !has(cv, t));
  const formatScore = checks.filter((c) => c.ok).length / checks.length;
  const keywordScore = terms.length ? matched.length / terms.length : 1;
  return { score: Math.round(formatScore * 50 + keywordScore * 50), checks, terms, matched, canAdd, gaps };
}

/** Plain-language summary for the report file. */
export function atsReport(a) {
  const lines = [`## ATS check: ${a.score}/100`, '', 'Local checks for the common reasons an applicant tracking system misreads a resume. No tool can promise how a particular employer\'s system scores it.', ''];
  for (const c of a.checks) lines.push(`- ${c.ok ? 'Pass' : 'Fix'}: ${c.name}${c.ok ? '' : `. ${c.fix}`}`);
  lines.push('', `**Posting terms found in this resume (${a.matched.length} of ${a.terms.length}):** ${a.matched.join(', ') || 'none'}`);
  if (a.canAdd.length) lines.push('', `**In your resume but missing from this tailored version (safe to add if they apply):** ${a.canAdd.join(', ')}`);
  if (a.gaps.length) lines.push('', `**In the posting but not in your resume (do not add them; mention real experience only):** ${a.gaps.join(', ')}`);
  return lines.join('\n');
}
