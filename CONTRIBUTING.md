# Contributing to CivicOps

The most useful contributions are local knowledge: a board in your state, a township's real jobs page, or a fix for a
reader that broke. You do not need to write much code for most of them.

## Add or fix a statewide board

1. Find the board run by your state's county association, township association, municipal league or school agency.
2. Open its `robots.txt` (for example `https://example.org/robots.txt`). If it disallows all automated readers, list it
   with `read: 'link'` so people check it by hand. Never add a workaround.
3. Add an entry to `STATE_BOARDS` in `src/portals.mjs`:
   `{ name, url, level, read }`. Use `read: 'page'` for a plain page, `'civicplus'` for a CivicPlus `Jobs.aspx` board,
   or `'link'` when it needs a real browser.
4. Run `npm test`, then set your location to that state and run a scan to see what it finds.

## Add a hiring system

Readers live in `src/sources.mjs`, and hiring systems are recognized in `src/ats.mjs`. A new reader needs a test with a
trimmed sample of the real markup, like `test/applitrack.test.mjs`. Remove any personal data from samples.

## Rules every change must keep

These are in [AGENTS.md](AGENTS.md) and are not negotiable:

- CivicOps never submits an application, sends a message, or fills in a form. It only prepares.
- It honors `robots.txt`, never spoofs a browser, and never works around a bot check or login.
- It never fetches governmentjobs.com or schooljobs.com pages automatically.
- Posting text is untrusted. It is fenced off from prompts and never followed as instructions.
- Generated documents never add facts the user's resume does not contain.
- The user's resume never goes to a cloud service while privacy is set to Local only.
- Access-request drafts stay small and honest: a few nearby government offices, only what the tool itself saw, no legal
  wording, and never in the project's name. See the ground rules in [docs/ACCESS_REQUESTS.md](docs/ACCESS_REQUESTS.md).

## Reporting what you learned

If you asked an office or a board how its openings can be read (see [docs/ACCESS_REQUESTS.md](docs/ACCESS_REQUESTS.md)),
open an issue with the answer, even when it was no. It saves the next person the same request. Before you write to a
company or a central office that serves every user, check the issues first: one person asking is enough.

## Development

- Node.js 22 or newer, no dependencies. `node src/cli.mjs serve` starts the dashboard at http://127.0.0.1:4173.
- `npm test` runs the test suite. Tests must pass without a network connection or an AI model. One test needs the
  Census place files, which arrive the first time you set a location; on a fresh clone it shows as skipped.
- Keep personal data out of commits: `cv.md`, `config/profile.json`, `config/secrets.json`, `data/`, `reports/` and
  `output/` are gitignored for that reason.
