# Automated 3-player tests

These tests open **three Chrome windows side by side** (Bot A = host, Bot B, Bot C),
each with the extension loaded. Within each test file the **same three players play
every round**, so their career stats build up. After every round the test checks the
full running totals for every bot:

- **Firebase**: wins / rounds / gave up, overall **and** per game mode, plus head-to-head
- **The winners board**: game-mode label, finish order, "Did not finish"
- **Each bot's 📊 profile**: wins / losses / gave up / win rate / round count

It also prints a stats table in Terminal after each round, so you can watch the
numbers build up. At the end of each file, the bots' player records and the test
games are deleted from Firebase.

The bots are the **same three players every run**: each keeps a saved browser profile
in `e2e/.bot-profiles/` (git-ignored), so it signs in once and reuses that. Their stats
are reset to 0 at the start of each test file, so you never need to wipe anything first.

## What's covered

There are three test files. Each one resets the bots' stats first, so its totals start from 0.

**`three-players.spec.js`**: three rounds, each in a new game
| Round | What happens | Winner |
|---|---|---|
| 1 · Fewest clicks | B clicks once then gives up · C finishes in 3 clicks · A (host) finishes in 1 click, last | A |
| 2 · Fastest to finish | Same moves, but C finishes *first* | C (faster, despite more clicks) |
| 3 · Everyone gives up | B, C, then A give up | Nobody (no-contest) |

**`session.spec.js`**: five rounds in **one game session** (Play Again between rounds)
| Round | What happens | Winner |
|---|---|---|
| 1 · Fewest | Everyone finishes: C in 3 clicks, B in 2, A in 1 (A finishes last) | A (fewest clicks) |
| 2 · Fewest | B and C both 1 click (B first), A 2 clicks | B (tie → earlier finish) |
| 3 · Host switches to Fastest | C 3 clicks first, A 1 click, B 2 clicks | C (first to finish) |
| 4 · Host switches back to Fewest | C gives up; A and B both 2 clicks (A first) | A |
| 5 · Fewest | Everyone gives up | Nobody (round score unchanged) |

After each round it also checks the **in-game round score**: the Session Scoreboard, the
game's win tally and its round history.

**`edge-cases.spec.js`**: the less common ways a round can go
| Round | What happens | Expected |
|---|---|---|
| Time runs out, one finisher | A finishes; B and C never do | A wins · B and C lose, but it's **not** a give-up |
| Time runs out, nobody finished | Nobody plays | No-contest: nothing counts |
| Player leaves between rounds | C leaves; A and B play on | Next round is just A and B · C gets nothing |
| Player leaves mid-round | B clicks once, then leaves; A and C finish | A wins · B gets nothing from the round |
| Solo practice round | A plays alone | Nothing counts |

The timeout rounds use a test-only shortcut: the smallest real time limit is 5
minutes, so the test shortens the running round's limit in Firebase to 15–25 seconds.
The round then times out exactly as it would for real players.

After every round, all files check each bot's full running career stats in Firebase:
wins / rounds / gave up, overall and per mode, plus head-to-head. The expected numbers
come from a small "ledger" (`lib/ledger.js`) that applies the agreed scoring rules to
each round's facts (who played, who won, who gave up).

Round 1 of `three-players.spec.js` also covers the old "host's own finish ends the
round" bug. The rounds in a file run in order: if one fails, the later ones are skipped,
because their totals depend on it.

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
Three Chrome windows open and play. Results print in Terminal as each step passes or
fails. A full run of all three files takes about 5 minutes.

Other ways to run:

| Command | What it does |
|---|---|
| `npx playwright test session` | Run just one file (`session`, `edge-cases` or `three-players`) |
| `npm run test:headless` | Run with no visible windows (faster) |
| `KEEP_TEST_DATA=1 npm test` | Keep the bots' records and the game in Firebase so you can inspect them |
| `DEBUG_CONSOLE=1 npm test` | Also print the extension's console messages |
| `REAL_IMDB=1 npm test` | Use the real IMDb site instead of stand-in pages (see below) |
| `FRESH_BOTS=1 npm test` | Use brand-new throwaway bots instead of the saved ones (creates new sign-ins, so use sparingly) |
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
- **Easiest way to share a failure:** after any run with failures, open
  `e2e/last-failures.txt` in VS Code. It has each failed round's error plus the last
  lines it printed. Copy the whole file and paste it to Claude.
- Run `npm run report` to see screenshots of all three windows at the moment it failed.
- Most failures point at the step that went wrong: a click or give-up that never
  reached Firebase, or a stat that doesn't match (the message shows expected vs actual).
- **"Google is temporarily limiting Firebase sign-ins"** (or a bot popup saying
  "Failed to create game" / "Failed to join game"): too many sign-ins from your network
  in a short time. Wait about an hour and run again. The saved bot profiles keep this
  rare, since the bots only sign in on their very first run.
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
