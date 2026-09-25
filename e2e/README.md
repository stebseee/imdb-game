# Automated 3-player tests

These tests open **three Chrome windows side by side** (Bot A = host, Bot B, Bot C),
each with the extension loaded. The **same three players play three rounds in a row**,
so their career stats build up. After every round the test checks the full running
totals for every bot:

- **Firebase**: wins / rounds / gave up, overall **and** per game mode, plus head-to-head
- **The winners board**: game-mode label, finish order, "Did not finish"
- **Each bot's 📊 profile**: wins / losses / gave up / win rate / round count

It also prints a stats table in Terminal after each round, so you can watch the
numbers build up. At the very end, the bots' player records and the test games are
deleted from Firebase. The bots start as brand-new players every run, so you
never need to wipe anything first.

## The three rounds

| Round | What happens | Winner |
|---|---|---|
| **1 · Fewest clicks** | B clicks once then gives up · C finishes in 3 clicks · A (host) finishes in 1 click, last | A |
| **2 · Fastest to finish** | Same moves, but C finishes *first* | C (faster, despite more clicks) |
| **3 · Everyone gives up** | B, C, then A give up | Nobody (no-contest) |

Expected running totals after each round (W = wins, L = losses, G = gave up):

| After | Bot A | Bot B | Bot C |
|---|---|---|---|
| Round 1 | 1W 0L 0G | 0W 1L 1G | 0W 1L 0G |
| Round 2 | 1W 1L 0G | 0W 2L 2G | 1W 1L 0G |
| Round 3 | 1W 1L 1G | 0W 2L 3G | 1W 1L 1G |

Round 1 also covers the old "host's own finish ends the round" bug. The rounds run
in order: if one fails, the later ones are skipped, because their totals depend on it.

## One-time setup (on your Mac)

You need **Node.js 18 or newer**. Check in Terminal:
```
node --version
```
If that errors or shows below v18, install the "LTS" version from https://nodejs.org first.

Then, from the project folder:
```
cd e2e
npm install
npx playwright install chromium
```

## Running the tests

From the `e2e` folder:
```
npm test
```
Three Chrome windows open and play. Results print in Terminal as each step passes or fails.

Other ways to run:

| Command | What it does |
|---|---|
| `npm run test:headless` | Run with no visible windows (faster) |
| `KEEP_TEST_DATA=1 npm test` | Keep the bots' records and the game in Firebase so you can inspect them |
| `DEBUG_CONSOLE=1 npm test` | Also print the extension's console messages |
| `REAL_IMDB=1 npm test` | Use the real IMDb site instead of stand-in pages (see below) |
| `npm run report` | Open the HTML report from the last run (includes screenshots of each window when a test fails) |

Tip: in VS Code, open the Terminal with **Terminal → New Terminal**, then type `cd e2e` before the commands.

## How the bots play

- **Stand-in IMDb pages.** Real IMDb shows a bot-verification page to automated
  browsers, which blocks the test. So each bot gets simple stand-in pages at the
  real `https://www.imdb.com/...` addresses. The extension loads on them exactly
  as normal (same panel, same code), and the page titles match IMDb's format so
  click paths still read "Tom Hanks → Apollo 13 → …". Firebase is real.
  This tests the game, not IMDb's page layout, so still do a quick manual check on
  the real site before a release (e.g. the page filters hiding sections).

- **Actor clicks** (the ones the game counts): the bot adds a link to the page and
  clicks it. The extension's real click handler counts it, and the test waits
  until Firebase shows the click before moving to the next page. This keeps runs
  consistent even when IMDb changes its page layout.
- **Movie pages** are visited directly. They're free, just like in the real game.
- The actor pair is fixed (Tom Hanks → Kevin Bacon) using the extension's debug
  "lock actor pair" setting, so every run takes the same route.
- The "Are you sure you want to give up?" popup is accepted automatically.

## If a test fails

- The Terminal output names the step that failed and what it was waiting for,
  e.g. `Bot C's click #2 (Morgan Freeman) to reach Firebase`.
- Run `npm run report` to see screenshots of all three windows at the moment it failed.
- Most failures point at the step that went wrong: a click or give-up that never
  reached Firebase, or a stat that doesn't match (the message shows expected vs actual).
- `REAL_IMDB=1 npm test` uses the real IMDb site instead of stand-in pages. Expect
  IMDb's verification page; you'd have to solve it by hand in each window, so this
  is only useful for occasional spot checks.

## Notes

- The tests use the **real Firebase** database (the same one the extension uses)
  and clean up after themselves.
- When zipping the extension for the Chrome Web Store, **leave out the `e2e/` and
  `postman/` folders**. They're for testing only.
- The small `data-testid` attributes on some extension buttons and stat cards are
  there so these tests can find them. They're invisible and don't change behaviour.
