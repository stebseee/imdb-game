# Automated 3-player tests

These tests open **three Chrome windows side by side** (Bot A = host, Bot B, Bot C),
each with the extension loaded, and play a full round on the real IMDb site. At the end they check:

- **Firebase**: who won, and every bot's career stats (overall and per game mode)
- **The winners board**: game-mode label, finish order, "Did not finish"
- **Each bot's 📊 profile**: wins / losses / gave up / win rate / round count

Every run uses brand-new browser profiles, so the bots always start at 0 stats.
You don't need to wipe Firebase first. The bots' player records and the test game
are deleted automatically at the end.

## The scenarios

| Test | What happens | Expected result |
|---|---|---|
| **Fewest clicks** | B clicks once then gives up · C finishes in 3 clicks · A (host) finishes in 1 click last | A wins · B: loss + give-up · C: loss |
| **Fastest to finish** | Same moves, but C finishes *first* | C wins (faster, despite more clicks) · A: loss · B: loss + give-up |
| **Everyone gives up** | B, C, then A give up | No-contest: no wins or losses, 1 give-up each |

The first test also covers the old "host's own finish ends the round" bug.

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
| `npx playwright test -g "Fewest"` | Run just one scenario (match part of its name) |
| `npm run test:headless` | Run with no visible windows (faster) |
| `KEEP_TEST_DATA=1 npm test` | Keep the bots' records and the game in Firebase so you can inspect them |
| `DEBUG_CONSOLE=1 npm test` | Also print the extension's console messages |
| `npm run report` | Open the HTML report from the last run (includes screenshots of each window when a test fails) |

Tip: in VS Code, open the Terminal with **Terminal → New Terminal**, then type `cd e2e` before the commands.

## How the bots play

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
- **IMDb hiccups**: IMDb sometimes loads slowly or shows a robot check to automated
  browsers. If a run fails on a page load, just run it again. A failure that repeats
  in the same place is worth investigating.
- A cookie banner (UK/EU) is accepted automatically.

## Notes

- The tests use the **real Firebase** database (the same one the extension uses)
  and clean up after themselves.
- When zipping the extension for the Chrome Web Store, **leave out the `e2e/` and
  `postman/` folders**. They're for testing only.
- The small `data-testid` attributes on some extension buttons and stat cards are
  there so these tests can find them. They're invisible and don't change behaviour.
