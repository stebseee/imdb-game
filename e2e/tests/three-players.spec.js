// three-players.spec.js — 3 bots play 3 rounds of IMDB Click Race.
//
// The SAME three players (Bot A = host, Bot B, Bot C) play all three rounds, so
// their career stats build up. After each round the test checks the full running
// totals for every bot:
//   - Firebase: wins / rounds / gave up, overall AND per mode, plus head-to-head
//   - The winners board (mode label, finish order, "Did not finish")
//   - Each bot's 📊 profile cards
// and prints a stats table so you can watch them build up. At the end the bots'
// player records and the test games are deleted (set KEEP_TEST_DATA=1 to keep them).
//
// Rounds run in order; if one fails, the later rounds are skipped (their expected
// totals depend on it).

const { test, expect } = require('@playwright/test');
const { Bot } = require('../lib/bot');
const {
  ACTORS, TITLES,
  startThreePlayerRound, waitForRoundRecorded,
  expectCareerTotals, printStatsTable, expectProfileCardsFor, expectWinnersBoard, cleanupTestData,
} = require('../lib/game');

test.describe.configure({ mode: 'serial' });

let A, B, C;
let bots = [];
let botsByKey = {};
const codes = []; // every game created, for cleanup

test.beforeAll(async () => {
  test.setTimeout(2 * 60 * 1000);
  A = await Bot.launch('Bot A', 0); // host
  B = await Bot.launch('Bot B', 1);
  C = await Bot.launch('Bot C', 2);
  bots = [A, B, C];
  botsByKey = { A, B, C };
});

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    for (const bot of bots) {
      const png = await bot.screenshot();
      if (png) await testInfo.attach(`${bot.name} at failure`, { body: png, contentType: 'image/png' });
    }
  }
  if (bots.every(b => b.pid)) await printStatsTable(botsByKey, `Stats after: ${testInfo.title}`);
});

test.afterAll(async () => {
  for (const bot of bots) await bot.close();
  await cleanupTestData(bots, codes);
});

// C takes the long way round: 3 actor clicks, with free movie pages in between.
async function slowRoute(bot) {
  await bot.visit(TITLES.apollo13);
  await bot.actorClick(ACTORS.meg, { expectClicks: 1 });
  await bot.visit(TITLES.sleepless);
  await bot.actorClick(ACTORS.morgan, { expectClicks: 2 });
  await bot.visit(TITLES.shawshank);
  await bot.actorClick(ACTORS.target, { expectClicks: 3, finishing: true });
}

test('Round 1 — Fewest clicks: A (host) wins in 1 click, B gives up, C finishes in 3 clicks and loses', async () => {
  const code = await startThreePlayerRound(bots, { mode: 'fewest' });
  codes.push(code);

  await test.step('B makes 1 click, then gives up', async () => {
    await B.actorClick(ACTORS.meg, { expectClicks: 1 });
    await B.giveUp();
  });
  await test.step('C finishes the long way (3 clicks)', async () => {
    await slowRoute(C);
  });
  await test.step("A (host) finishes in 1 click — the host's own finish ends the round", async () => {
    await A.actorClick(ACTORS.target, { expectClicks: 1, finishing: true });
  });

  const game = await waitForRoundRecorded(code);
  expect(game.winner, 'round winner').toBe(A.pid);

  // Running totals after round 1. [wins, rounds, gave up]; vs = [wins, losses]
  const expected = {
    A: { overall: [1, 1, 0], fewest: [1, 1, 0], vs: { B: [1, 0], C: [1, 0] } },
    B: { overall: [0, 1, 1], fewest: [0, 1, 1], vs: { A: [0, 1] } }, // a loss AND a give-up
    C: { overall: [0, 1, 0], fewest: [0, 1, 0], vs: { A: [0, 1] } },
  };
  await test.step('Career stats in Firebase', () => expectCareerTotals(botsByKey, expected));
  await test.step('Winners board', () =>
    expectWinnersBoard(A, { mode: 'fewest', winner: A, finishOrder: [A, C], didNotFinish: [B] }));
  await test.step('Profile cards', () => expectProfileCardsFor(botsByKey, expected));
});

test('Round 2 — Fastest to finish: C finishes first in 3 clicks and beats A\'s later 1-click finish; B gives up', async () => {
  const code = await startThreePlayerRound(bots, { mode: 'fastest' });
  codes.push(code);

  await test.step('B makes 1 click, then gives up', async () => {
    await B.actorClick(ACTORS.meg, { expectClicks: 1 });
    await B.giveUp();
  });
  await test.step('C finishes first, the long way (3 clicks)', async () => {
    await slowRoute(C);
  });
  await test.step('A (host) finishes second, in 1 click', async () => {
    await A.actorClick(ACTORS.target, { expectClicks: 1, finishing: true });
  });

  const game = await waitForRoundRecorded(code);
  expect(game.winner, 'round winner').toBe(C.pid);

  // Running totals after rounds 1–2.
  const expected = {
    A: { overall: [1, 2, 0], fewest: [1, 1, 0], fastest: [0, 1, 0], vs: { B: [1, 0], C: [1, 1] } },
    B: { overall: [0, 2, 2], fewest: [0, 1, 1], fastest: [0, 1, 1], vs: { A: [0, 1], C: [0, 1] } },
    C: { overall: [1, 2, 0], fewest: [0, 1, 0], fastest: [1, 1, 0], vs: { A: [1, 1], B: [1, 0] } },
  };
  await test.step('Career stats in Firebase', () => expectCareerTotals(botsByKey, expected));
  await test.step('Winners board', () =>
    expectWinnersBoard(A, { mode: 'fastest', winner: C, finishOrder: [C, A], didNotFinish: [B] }));
  await test.step('Profile cards', () => expectProfileCardsFor(botsByKey, expected));
});

test('Round 3 — Everyone gives up: no-contest — +1 gave up each, no wins or losses', async () => {
  const code = await startThreePlayerRound(bots, { mode: 'fewest' });
  codes.push(code);

  await test.step('B, C, then A (host) give up', async () => {
    await B.actorClick(ACTORS.meg, { expectClicks: 1 });
    await B.giveUp();
    await C.giveUp();
    await A.giveUp();
  });

  const game = await waitForRoundRecorded(code);
  expect(game.winner ?? null, 'round winner').toBeNull();
  expect(game.endedBy, 'how the round ended').toBe('gaveup');

  // Running totals after rounds 1–3: only the gave-up counts move.
  const expected = {
    A: { overall: [1, 2, 1], fewest: [1, 1, 1], fastest: [0, 1, 0], vs: { B: [1, 0], C: [1, 1] } },
    B: { overall: [0, 2, 3], fewest: [0, 1, 2], fastest: [0, 1, 1], vs: { A: [0, 1], C: [0, 1] } },
    C: { overall: [1, 2, 1], fewest: [0, 1, 1], fastest: [1, 1, 0], vs: { A: [1, 1], B: [1, 0] } },
  };
  await test.step('Career stats in Firebase', () => expectCareerTotals(botsByKey, expected));
  await test.step('Winners board', () =>
    expectWinnersBoard(A, { mode: 'fewest', winner: null, didNotFinish: [B, C, A] }));
  await test.step('Profile cards', () => expectProfileCardsFor(botsByKey, expected));
});
