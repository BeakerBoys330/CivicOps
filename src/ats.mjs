// Recognize the hiring systems government employers use, and how far CivicOps can read each.
// scan = workday (public JSON) | html (read the page) | link (cannot be read automatically: you get a direct link)
const RULES = [
  { re: /governmentjobs\.com\/(careers|jobs)/i, ats: 'NEOGOV', scan: 'link', note: 'governmentjobs.com does not allow automated readers. Open the board, then copy its job list and use Paste list.' },
  { re: /schooljobs\.com/i, ats: 'NEOGOV SchoolJobs', scan: 'link', note: 'schooljobs.com does not allow automated readers. Open the board, then copy its job list and use Paste list.' },
  { re: /myworkdayjobs\.com|myworkdaysite\.com/i, ats: 'Workday', scan: 'workday' },
  { re: /jobapscloud\.com|jobaps\.com/i, ats: 'JobAps', scan: 'html' },
  { re: /taleo\.net/i, ats: 'Taleo', scan: 'link', note: 'Taleo pages need a real browser to display jobs.' },
  { re: /icims\.com/i, ats: 'iCIMS', scan: 'html' },
  { re: /applicantpro\.com/i, ats: 'ApplicantPro', scan: 'html' },
  { re: /applitrack\.com/i, ats: 'Frontline AppliTrack', scan: 'html' },
  { re: /paycomonline\.net/i, ats: 'Paycom', scan: 'link', note: 'Paycom pages need a real browser to display jobs.' },
  { re: /paylocity\.com/i, ats: 'Paylocity', scan: 'html' },
  { re: /ultipro\.com|ukg\.net/i, ats: 'UKG', scan: 'link', note: 'UKG pages need a real browser to display jobs.' },
  { re: /workforcenow\.adp\.com|recruiting\.adp\.com/i, ats: 'ADP', scan: 'link', note: 'ADP pages need a real browser to display jobs.' },
  { re: /isolvedhire\.com/i, ats: 'isolved', scan: 'html' },
  { re: /hrmdirect\.com/i, ats: 'ClearCompany', scan: 'html' },
  { re: /bamboohr\.com/i, ats: 'BambooHR', scan: 'html' },
  { re: /csod\.com/i, ats: 'Cornerstone', scan: 'link', note: 'Cornerstone pages need a real browser to display jobs. Open the board, then copy its job list and use Paste list.' },
  { re: /peopleadmin\.com/i, ats: 'PeopleAdmin', scan: 'html' },
  { re: /calopps\.org/i, ats: 'CalOpps', scan: 'link', note: 'CalOpps refuses automated readers.' },
  { re: /oraclecloud\.com\/hcmUI/i, ats: 'Oracle Cloud', scan: 'link', note: 'Oracle Cloud pages need a real browser to display jobs.' },
  { re: /jobs2web\.com|successfactors\./i, ats: 'SuccessFactors', scan: 'html' },
];

export function detectAts(url) {
  const r = RULES.find((x) => x.re.test(String(url)));
  return r ? { ats: r.ats, scan: r.scan, note: r.note } : null;
}
