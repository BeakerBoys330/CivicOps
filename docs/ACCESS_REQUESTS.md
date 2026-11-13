# Asking how to find job openings CivicOps cannot read

CivicOps reads a site only when the site allows it. When a local government's site blocks automated readers, hides its
list behind scripts, or has no jobs page, the honest fix is to ask the people who run it. This page covers what to ask,
who to ask, and what not to do.

**CivicOps never contacts anyone.** It can draft a message for you. You decide whether to send it, you send it from your
own email in your own name, and you are responsible for what it says.

## Ground rules

Please follow these. They protect you, the offices you write to, and everyone else who uses this tool.

- **It is optional.** CivicOps works without any of this. Write only to a place you would really like to work.
- **You write as one private person.** You do not speak for the CivicOps project, and the project has no arrangement
  with any government office or company. Do not say or imply otherwise.
- **Say only what is true.** The drafts are written by an AI model and can be wrong. Read each one and fix or delete
  anything that is not true for you. Do not send a draft that tells an office something about its website that you
  have not seen for yourself.
- **One message per office.** No repeats, no reminders, no copies to several people at the same office. `requests`
  drafts at most 8 single letters and lists at most 10 names on a shared one, nearest first, to keep this small.
- **A friendly question, not a demand.** These are not public records requests or complaints. An office may say no or
  not answer, and that is its choice.
- **Never work around a "no".** If a site's `robots.txt` or a bot check stops the tool, CivicOps skips the site and
  there is no setting to change that. Check those jobs by hand.
- **Messages to a government office may be kept as public records.** Include only what you are comfortable sharing.

## How CivicOps behaves on a site

This is what the drafts tell an office, so it has to be true. The `robots.txt` handling is covered by the test suite.

- It identifies itself as `Mozilla/5.0 (compatible; CivicOps/0.1; personal government job search tool)`, followed by
  the project's address when `homepage` is set in `package.json`. It never pretends to be a person's browser.
- It reads `robots.txt` first and follows the rules for the name `civicops`, or the rules for `*` when a site does not
  name it. When a failing site cannot serve its rules, the site is not read.
- It waits at least 1.2 seconds between requests to one site and honors `Crawl-delay` up to 60 seconds.
- A bot check is reported as "blocked". It is never worked around.
- The only requests that skip the `robots.txt` check go to two public data services built for programs: the USAJOBS
  API and the Wikidata query service.

## What you can ask as a job seeker

`node src/cli.mjs requests` drafts these for governments in your own area and saves them to `output/access-requests/`,
with a `README.md` that repeats the ground rules. Nothing is sent.

| Situation (as shown on the Employers page) | Ask for | Who to ask |
|---|---|---|
| **A city, county or district posts only on a board the tool cannot read** (NEOGOV, or one that needs a full web browser) | Whether open positions could also be published as an RSS feed, or posted on the state association board | Its human resources office |
| **A site whose `robots.txt` asks tools to stay away** | An allow line for the user agent `civicops` (a crawl delay is fine), or posting on the state association board | The clerk, administrator or webmaster listed on the site |
| **A site with a bot check** | Whether openings are also published somewhere a simple reader can see, such as an RSS feed. Do not ask an office to switch off its bot check. | The clerk, administrator or webmaster |
| **A government with no website, or no jobs page** | Where openings are announced (newspaper, town hall, association board) | The clerk or fiscal officer, by phone or email |
| **USAJOBS** (works without a key; a key adds exact radius search) | Your own free API key | [USAJOBS API key request](https://developer.usajobs.gov/apirequest/) |
| **School districts on Frontline AppliTrack** | Nothing. Add the district under Employers. | |

If the reason a site could not be read is not known, CivicOps drafts nothing for it.

### A message you can adapt

> Subject: Question about how job openings are posted
>
> Hello,
>
> I am looking for work with local governments near [town]. I use a small personal tool called CivicOps that checks
> government job pages for me. It follows each site's robots.txt rules, so it currently skips [site] [because the site
> asks automated tools not to visit / because the job list only appears in a full web browser].
>
> Would [employer] consider one of these?
> - Publishing open positions as an RSS feed, or
> - Allowing the user agent "civicops" in robots.txt (a crawl delay is fine), or
> - Also posting openings on [state association board, for example the Ohio Township Association careers page].
>
> If none of these work, could you tell me where openings are usually announced?
>
> Thank you,
> [Your name]

Keep only the lines that fit. The robots.txt line belongs only in a message to a site whose `robots.txt` is the reason.

## Project-level questions: one person, not every user

Some questions go to a company or a central office that serves every CivicOps user. The answer is the same for all of
us, so **one person should ask, once**, and share the answer. Hundreds of people sending the same message would be a
nuisance and would not help. `requests` leaves these out unless you add `--project`.

Before you send one, look through the project's GitHub issues to see whether someone already has. Afterwards, post the
answer there.

| Source | What stops the tool | Ask for | Where |
|---|---|---|---|
| **NEOGOV** (governmentjobs.com, schooljobs.com) | Its `robots.txt` allows named search engines only (checked November 2026) | Whether personal job-search tools may read agencies' public RSS feeds, or whether an approved feed exists | NEOGOV, through the contact or partnership form on its website |
| **A state's central job board** (for example the State of Ohio board, on Cornerstone) | The list needs a full web browser, and no public feed was found | Whether an official feed (RSS, XML or an API) exists | The state's central HR office |
| **Statewide association boards the tool cannot read** | The list is drawn by scripts, or the site has a bot check | Whether the board could also be published as an RSS or JSON feed | Whoever runs the board, through its contact page |
| **National Labor Exchange (NLx)**: postings from every state job bank | Needs an approved account. CivicOps has no NLx reader yet, so this is for a contributor who wants to build one. | Read-only API access through the NLx Research Hub. It comes with a data use agreement that applies to the person who signs it, so read it first. | [NLx Research Hub](https://www.naswa.org/national-labor-exchange/nlx-research-hub) |
| **CareerOneStop Jobs API** (U.S. Department of Labor, also NLx data) | Access is reviewed. No reader yet. | Jobs API access | See its [Jobs API notice](https://cloudfront.careeronestop.org/Developers/WebAPI/jobs-api-updates.aspx) |

### A message for a statewide board

> Subject: RSS feed for the [association] job board?
>
> Hello,
>
> Your job board is one of the best places to find openings at smaller [cities / counties / townships], many of which
> have no job page of their own. I use an open-source, personal job search tool, CivicOps, that reads public job boards
> only when their robots.txt allows it. The tool cannot read your board because [the list loads with scripts / the site
> has a bot check, which the tool does not try to get past].
>
> Would you consider also publishing the job board as an RSS or JSON feed? The tool waits between requests and links
> every job back to your board.
>
> Thank you,
> [Your name]

### A message for a state HR office

> Subject: Public feed of state job postings
>
> Hello,
>
> Is there an official public feed (RSS, XML or an API) of open State of [state] positions? I use a personal job search
> tool that reads only sources that allow it, and I would rather use an approved feed than a workaround. If a data
> agreement is needed, I am happy to follow it.
>
> Thank you,
> [Your name]

## After you get an answer

- **A feed address:** add it under Employers > Add an employer. CivicOps reads RSS and CivicPlus feeds automatically.
- **A robots.txt change:** run Find employers again, then Scan. The employer stops showing as blocked once the site
  allows `civicops`.
- **"We post in the newspaper" or "at the town hall":** note it on the employer, and check by hand.
- **"No":** leave it there. Check that employer's jobs by hand.

Please share what you learn in a GitHub issue, so the next person in your state does not have to ask again.
