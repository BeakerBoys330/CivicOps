// Statewide government job boards, and federal employers that hire outside USAJOBS.
// Run `node src/cli.mjs portals check` to re-test these links.
export const STATE_PORTALS = {
  AL: 'https://personnel.alabama.gov/',
  AK: 'https://www.governmentjobs.com/careers/alaska',
  AZ: 'https://www.azstatejobs.gov/',
  AR: 'https://www.ark.org/arstatejobs/index.php',
  CA: 'https://calcareers.ca.gov/',
  CO: 'https://www.governmentjobs.com/careers/colorado',
  CT: 'https://www.jobapscloud.com/CT/',
  DE: 'https://www.jobapscloud.com/DE/',
  DC: 'https://careers.dc.gov/',
  FL: 'https://jobs.myflorida.com/',
  GA: 'https://careers.georgia.gov/',
  HI: 'https://www.governmentjobs.com/careers/hawaii',
  ID: 'https://www.governmentjobs.com/careers/idaho',
  IL: 'https://work.illinois.gov/',
  IN: 'https://workforindiana.in.gov/',
  IA: 'https://www.governmentjobs.com/careers/iowa',
  KS: 'https://admin.ks.gov/services/state-employment-center',
  KY: 'https://careers.ky.gov/',
  LA: 'https://www.governmentjobs.com/careers/louisiana',
  ME: 'https://www.maine.gov/bhr/state-jobs/',
  MD: 'https://www.jobapscloud.com/MD/',
  MA: 'https://massanf.taleo.net/careersection/ex/jobsearch.ftl',
  MI: 'https://www.governmentjobs.com/careers/michigan',
  MN: 'https://mn.gov/mmb/careers/',
  MS: 'https://www.mspb.ms.gov/',
  MO: 'https://mocareers.mo.gov/',
  MT: 'https://statecareers.mt.gov/',
  NE: 'https://statejobs.nebraska.gov/',
  NV: 'https://nvapps.state.nv.us/NEATS/',
  NH: 'https://das.nh.gov/jobsearch/employment.aspx',
  NJ: 'https://nj.gov/csc/jobs/index.shtml',
  NM: 'https://www.spo.state.nm.us/view-job-opportunities-and-apply/',
  NY: 'https://statejobs.ny.gov/',
  NC: 'https://www.nc.gov/join-north-carolina',
  ND: 'https://www.omb.nd.gov/team-nd-careers/career-openings',
  OH: 'https://stateofohio.csod.com/ux/ats/careersite/1/home?c=stateofohio',
  OK: 'https://oklahoma.gov/about/employment.html',
  OR: 'https://oregon.wd5.myworkdayjobs.com/SOR_External_Career_Site',
  PA: 'https://www.pa.gov/agencies/employment/open-jobs',
  RI: 'https://www.governmentjobs.com/careers/rhodeisland',
  SC: 'https://careers.sc.gov/',
  SD: 'https://sd.gov/',
  TN: 'https://www.tn.gov/careers.html',
  TX: 'https://capps.taleo.net/careersection/808/jobsearch.ftl',
  UT: 'https://statejobs.utah.gov/',
  VT: 'https://careers.vermont.gov/',
  VA: 'https://www.jobs.virginia.gov/',
  WA: 'https://www.careers.wa.gov/',
  WV: 'https://www.governmentjobs.com/careers/wv',
  WI: 'https://wisc.jobs/',
  WY: 'https://www.governmentjobs.com/careers/wyoming',
};

/**
 * Statewide boards run by county associations, municipal leagues, township associations and school
 * agencies. Small governments that have no jobs page of their own often post here. Each posting is
 * mapped to its county or town, and postings outside your radius are dropped.
 *
 * read: 'ccao' | 'ota' | 'ccap' are dedicated readers. 'civicplus' reads the board's job feed.
 * 'page' reads the page with AI (or the link heuristic) and keeps postings that name a place.
 * 'link' means the board needs a real browser (scripts, a bot check, or no public list), so it goes
 * on the Check by hand list.
 * Every address was fetched and checked in November 2026, honoring robots.txt. Boards change, so
 * re-check them with `node src/cli.mjs scan` and fix entries with a pull request.
 */
export const STATE_BOARDS = {
  AK: [{ name: 'Alaska Municipal League: Classifieds', url: 'https://www.akml.org/classifieds/', level: 'city', read: 'link' }],
  AZ: [{ name: 'League of Arizona Cities and Towns: Jobs', url: 'https://www.azleague.org/jobs.aspx', level: 'city', read: 'civicplus' }],
  CA: [{ name: 'League of California Cities: City Job Board', url: 'https://www.calcities.org/header-utility-items/city-job-board', level: 'city', read: 'link', note: 'This site has a bot check, so it needs a person.' }],
  CO: [{ name: 'Colorado Municipal League: Job Board', url: 'https://www.cml.org/utility-pages/job-board', level: 'city', read: 'link' }],
  CT: [
    { name: 'Connecticut Conference of Municipalities: Career Center', url: 'https://www.ccm-ct.org/Municipal-Career-Center', level: 'city', read: 'link' },
    { name: 'Connecticut Council of Small Towns: Job Classifieds', url: 'https://ctcost.org/classifieds.php?type=job', level: 'township', read: 'link' },
  ],
  FL: [{ name: 'Florida Association of Counties: Government Jobs', url: 'https://www.fl-counties.com/government-jobs', level: 'county', read: 'page' }],
  GA: [{ name: 'Association County Commissioners of Georgia: Marketplace', url: 'https://marketplace.accg.org/', level: 'county', read: 'link' }],
  IA: [
    { name: 'Iowa State Association of Counties: Classifieds', url: 'https://www.iowacounties.org/member-resources/bid-notices-classifieds/', level: 'county', read: 'page' },
    { name: 'Iowa League of Cities: Classifieds', url: 'https://iowaleague.org/classifieds/', level: 'city', read: 'link' },
  ],
  ID: [{ name: 'Idaho Association of Counties: Job Openings', url: 'https://idcounties.org/resources/job-openings/', level: 'county', read: 'page' }],
  IL: [{ name: 'Township Officials of Illinois: Classifieds', url: 'https://www.toi.org/township-perspective/township-classifieds/', level: 'township', read: 'link' }],
  MA: [{ name: 'Massachusetts Municipal Association: Job Ads', url: 'https://www.mma.org/municipal-marketplace/job-ads', level: 'city', read: 'link' }],
  MD: [{ name: 'Maryland Municipal League: Careers', url: 'https://www.mdmunicipal.org/md-municipal-careers', level: 'city', read: 'link' }],
  ME: [{ name: 'Maine Municipal Association: Career Center', url: 'https://www.memun.org/Municipal-Career-Center', level: 'city', read: 'page' }],
  MN: [
    { name: 'Minnesota Association of Townships: Employment Classifieds', url: 'https://mntownships.org/employment-opportunities-classifieds', level: 'township', read: 'page' },
    { name: 'League of Minnesota Cities: City Career Advantage', url: 'https://www.lmc.org/topics/city-career-advantage/', level: 'city', read: 'link' },
  ],
  MO: [{ name: 'Missouri Association of Counties: Employment', url: 'https://www.mocounties.com/employment', level: 'county', read: 'link' }],
  MS: [{ name: 'Mississippi Municipal League: Job Opportunities', url: 'https://www.mmlonline.com/job-opportunities/', level: 'city', read: 'link' }],
  NC: [{ name: 'North Carolina League of Municipalities: City Job Board', url: 'https://www.nclm.org/city-job-board/', level: 'city', read: 'link' }],
  ND: [
    { name: 'North Dakota Association of Counties: County Jobs', url: 'https://www.ndaco.org/about-counties/county-jobs/', level: 'county', read: 'link' },
    { name: 'North Dakota League of Cities: Career Opportunities', url: 'https://ndlc.org/municipal-career-opportunities/', level: 'city', read: 'link' },
  ],
  NE: [{ name: 'League of Nebraska Municipalities: Careers', url: 'https://www.lonm.org/classifieds/careers.html', level: 'city', read: 'page' }],
  NH: [{ name: 'New Hampshire Municipal Association: Classifieds', url: 'https://www.nhmunicipal.org/classifieds', level: 'city', read: 'link' }],
  NJ: [
    { name: 'New Jersey Association of Counties: Jobs', url: 'https://www.njac.org/cn/Links/?tpid=19121', level: 'county', read: 'page' },
    { name: 'New Jersey State League of Municipalities: Jobs', url: 'https://www.njlm.org/Jobs.aspx', level: 'city', read: 'page' },
  ],
  NM: [
    { name: 'New Mexico Municipal League: Jobs', url: 'https://www.nmml.org/Jobs.aspx', level: 'city', read: 'civicplus' },
    { name: 'New Mexico Counties: Employment Opportunities', url: 'https://www.nmcounties.org/employment-opportunities/', level: 'county', read: 'page' },
  ],
  NY: [
    { name: 'New York Conference of Mayors: Job Openings', url: 'https://www.nycom.org/component/content/article/1514-job-openings?catid=115', level: 'city', read: 'page' },
    { name: 'New York State Association of Counties: Job Board', url: 'https://www.nysac.org/member-services/job-board/', level: 'county', read: 'link' },
  ],
  OK: [{ name: 'Oklahoma Municipal League: Classified Listings', url: 'https://www.oml.org/classified-listings', level: 'city', read: 'page' }],
  SC: [{ name: 'South Carolina Association of Counties: County Jobs', url: 'https://www.sccounties.org/county-jobs', level: 'county', read: 'link' }],
  SD: [{ name: 'South Dakota Association of County Officials: Employment', url: 'https://www.sdcounties.org/services/employment-opportunities/', level: 'county', read: 'link' }],
  TN: [{ name: 'Tennessee Municipal League: Employment Opportunities', url: 'https://www.tml1.org/employment-opportunities', level: 'city', read: 'page' }],
  TX: [
    { name: 'Texas Municipal League: City Careers', url: 'https://www.tml.org/9/City-Careers', level: 'city', read: 'link' },
    { name: 'Texas Association of Counties: Job Roundup', url: 'https://imis.county.org/iMIS/TACMember/Job-Roundup/Job_Roundup.aspx', level: 'county', read: 'link', note: 'This site has a bot check, so it needs a person.' },
  ],
  UT: [
    { name: 'Utah League of Cities and Towns: Job Bank', url: 'https://www.ulct.utah.gov/ulct-job-bank/', level: 'city', read: 'page' },
    { name: 'Utah Association of Counties: Job Opportunities', url: 'https://www.utahcounties.org/connect-pages/job-opportunities', level: 'county', read: 'link' },
  ],
  VA: [
    { name: 'Virginia Association of Counties: Job Opportunities', url: 'https://www.vaco.org/publications-resources/job-opportunities/', level: 'county', read: 'page' },
    { name: 'Virginia Municipal League: Classifieds', url: 'https://www.vml.org/Classifieds', level: 'city', read: 'link' },
  ],
  VT: [{ name: 'Vermont League of Cities and Towns: Classifieds', url: 'https://www.vlct.org/classifieds', level: 'city', read: 'page' }],
  WI: [
    { name: 'Wisconsin Counties Association: County Job Listings', url: 'https://www.wicounties.org/the-counties/county-job-listings/', level: 'county', read: 'page' },
    { name: 'Wisconsin Towns Association: Classified Ads', url: 'https://www.wisctowns.com/resources/classified-ads/', level: 'township', read: 'link' },
  ],
  WY: [{ name: 'Wyoming Association of Municipalities: Municipal Jobs', url: 'https://wyomuni.org/municipal-jobs/', level: 'city', read: 'page' }],
  OH: [
    { name: 'County Commissioners Association of Ohio: County Jobs', url: 'https://ccao.org/aws/CCAO/pt/sp/county-jobs', level: 'county', read: 'ccao' },
    { name: 'Ohio Township Association: Careers', url: 'https://www.ohiotownships.org/news/careers', level: 'township', read: 'ota' },
    { name: 'Ohio law enforcement jobs (OhioMeansJobs)', url: 'https://ohiomeansjobs.ohio.gov/job-seekers/find-a-job/department-public-safety/', level: 'special', read: 'link', note: 'Police, sheriff and park district jobs statewide. The search needs a real browser.' },
    { name: 'Ohio Education Job Board (SchoolSpring)', url: 'https://ohiok12jobs.schoolspring.com/', level: 'school', read: 'link', note: 'K-12 jobs statewide, run by the Management Council. The list needs a real browser.' },
  ],
  PA: [
    { name: 'County Commissioners Association of Pennsylvania: Job Center', url: 'https://pacounties.org/about/job-postings', level: 'county', read: 'ccap' },
    { name: 'Pennsylvania Municipal League: Municipal Job Junction', url: 'https://www.pml.org/category/municipal-job-junction/', level: 'city', read: 'link', note: 'Borough, township and city jobs. Check the newest posts by hand.' },
    { name: 'PAREAP (Pennsylvania school jobs)', url: 'https://www.pareap.net/', level: 'school', read: 'link', note: 'Shared application site used by most Pennsylvania school districts.' },
  ],
  MI: [
    { name: 'Michigan Municipal League: Career Center', url: 'https://classifieds.mml.org/', level: 'city', read: 'link', note: 'This site has a bot check, so it needs a person.' },
    { name: 'Michigan Townships Association: Classifieds', url: 'https://michigantownships.org/classified/', level: 'township', read: 'link', note: 'The list loads with scripts, so it needs a real browser.' },
    { name: 'Michigan Association of Planning: Job Postings', url: 'https://associationdatabase.com/aws/MAP/pt/sp/job-postings', level: 'city', read: 'link', note: 'Planning and zoning jobs at cities, townships and counties.' },
  ],
  IN: [
    { name: 'Accelerate Indiana Municipalities: Municipal Jobs', url: 'https://aimindiana.org/comms/municipal-jobs/', level: 'city', read: 'link' },
    { name: 'Indiana Educator Job Board (IDOE)', url: 'https://app.hirenimble.com/jobs/state/in', level: 'school', read: 'link', note: 'Statewide school jobs. The board needs a real browser.' },
  ],
  KY: [
    { name: 'Kentucky Association of Counties: County Employment Hub', url: 'https://kaco.org/about/employment/county-employment-hub', level: 'county', read: 'link', note: 'The table loads with scripts, so it needs a real browser.' },
    { name: 'Kentucky League of Cities: Jobs in Our Cities', url: 'https://www.klc.org/Classifieds/', level: 'city', read: 'link', note: 'The list loads with scripts, so it needs a real browser.' },
  ],
  WV: [
    { name: 'West Virginia Municipal League: Classifieds', url: 'https://www.wvml.org/resources/league-classifieds', level: 'city', read: 'link', note: 'Check by hand. Few postings.' },
  ],
};

// USAJOBS does not cover everything. These federal employers post mainly or only on their own sites.
export const FEDERAL_OWN_BOARDS = [
  { name: 'U.S. Courts (Judiciary)', url: 'https://www.uscourts.gov/careers' },
  { name: 'FBI', url: 'https://www.fbijobs.gov/' },
  { name: 'CIA', url: 'https://www.cia.gov/careers/' },
  { name: 'U.S. Intelligence Community', url: 'https://www.intelligencecareers.gov/' },
  { name: 'U.S. House of Representatives', url: 'https://www.house.gov/employment' },
  { name: 'U.S. Senate', url: 'https://www.senate.gov/employment/' },
];

// Government-adjacent employers: created by Congress and doing public work, but hiring on their own sites, not USAJOBS.
// They have their own level ("adjacent") so a search can include or leave them out. Each is a link to check by hand.
export const ADJACENT_BOARDS = [
  { name: 'U.S. Postal Service', url: 'https://about.usps.com/careers/', note: 'Post offices and mail plants hire through the USPS careers site, not USAJOBS. Search it by your city or ZIP code.' },
  { name: 'Amtrak', url: 'https://careers.amtrak.com/', note: 'The national passenger railroad hires on its own careers site.' },
  { name: 'Federal Reserve System', url: 'https://www.federalreserve.gov/careers.htm', note: 'The Board and the twelve regional Reserve Banks each post their own openings.' },
  { name: 'Tennessee Valley Authority', url: 'https://www.tva.com/careers', note: 'A federal power corporation serving Tennessee and parts of six nearby states.', states: ['TN', 'AL', 'MS', 'KY', 'GA', 'NC', 'VA'] },
  { name: 'Smithsonian Institution', url: 'https://www.si.edu/careers', note: 'Some Smithsonian jobs are on USAJOBS. Its trust-funded jobs are only on its own site.' },
];
