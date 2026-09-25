// three-players.spec.js — automated 3-player rounds of IMDB Click Race.
//
// Each test launches three Chrome windows (Bot A = host, Bot B, Bot C), each with
// the extension loaded and a brand-new player profile, plays one scripted round,
// then checks:
//   - Firebase: who won, and every bot's career stats (overall + per mode)
//   - The winners board (mode label, finish order, "Did not finish")
//   - Each bot's 📊 profile cards (wins / losses / gave up / win rate)
// Test players and the test game are deleted afterwards (set KEEP_TEST_DATA=1 to keep them).

const { test, expect } = require('@playwright/test');
const { Bot } = require('../lib/bot');
const {
  ACTORS, TITLES,
  startThreePlayerRound, waitForRoundRecorded,
  expectCareerStats, expectProfileCards, expectWinnersBoard, cleanupTestData,
} = require('../lib/game');

let bots = [];
let code = null;

test.beforeEach(async () => {
  bots = [];
  code = null;
  // Launch one at a time so each window is ready before the next opens.
  bots.push(await Bot.launch('Bot A', 0));
  bots.push(await Bot.launch('Bot B', 1));
  bots.push(await Bot.launch('Bot C', 2));
});

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    for (const bot of bots) {
      const png = await bot.screenshot();
      if (png) await testInfo.attach(`${bot.name} at failure`, { body: png, contentType: 'image/png' });
    }
  }
  for (const bot of bots) await bot.close();
  await cleanupTestData(bots, code);
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

test('Fewest clicks: host wins in 1 click, B gives up after 1 click, C finishes in 3 clicks and loses', async () => {
  const [A, B, C] = bots;
  code = await startThreePlayerRound(bots, { mode: 'fewest' });

  await test.step('B makes 1 click, then gives up', async () => {
    await B.actorClick(ACTORS.meg, { expectClicks: 1 });
    await B.giveUp();
  });
  await test.step('C finishes the long way (3 clicks)', async () => {
    await slowRoute(C);
  });
  await test.step('A (host) finishes in 1 click — the host\'s own finish ends the round', async () => {
    await A.actorClick(ACTORS.target, { expectClicks: 1, finishing: true });
  });

  const game = await waitForRoundRecorded(code);
  expect(game.winner, 'round winner').toBe(A.pid);

  await test.step('Career stats in Firebase', async () => {
    await expectCareerStats(A, 'fewest', { wins: 1, rounds: 1, giveUps: 0 });
    await expectCareerStats(B, 'fewest', { wins: 0, rounds: 1, giveUps: 1 }); // a loss AND a give-up
    await expectCareerStats(C, 'fewest', { wins: 0, rounds: 1, giveUps: 0 });
  });
  await test.step('Winners board', async () => {
    await expectWinnersBoard(A, { mode: 'fewest', winner: A, finishOrder: [A, C], didNotFinish: [B] });
  });
  await test.step('Profile cards', async () => {
    await expectProfileCards(A, { wins: 1, losses: 0, giveUps: 0, rounds: 1 });
    await expectProfileCards(B, { wins: 0, losses: 1, giveUps: 1, rounds: 1 });
    await expectProfileCards(C, { wins: 0, losses: 1, giveUps: 0, rounds: 1 });
  });
});

test('Fastest to finish: C finishes first in 3 clicks and beats the host\'s later 1-click finish', async () => {
  const [A, B, C] = bots;
  code = await startThreePlayerRound(bots, { mode: 'fastest' });

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

  await test.step('Career stats in Firebase', async () => {
    await expectCareerStats(A, 'fastest', { wins: 0, rounds: 1, giveUps: 0 });
    await expectCareerStats(B, 'fastest', { wins: 0, rounds: 1, giveUps: 1 });
    await expectCareerStats(C, 'fastest', { wins: 1, rounds: 1, giveUps: 0 });
  });
  await test.step('Winners board', async () => {
    await expectWinnersBoard(A, { mode: 'fastest', winner: C, finishOrder: [C, A], didNotFinish: [B] });
  });
  await test.step('Profile cards', async () => {
    await expectProfileCards(A, { wins: 0, losses: 1, giveUps: 0, rounds: 1 });
    await expectProfileCards(C, { wins: 1, losses: 0, giveUps: 0, rounds: 1 });
  });
});

test('Everyone gives up: no-contest round — give-ups only, no wins or losses', async () => {
  const [A, B, C] = bots;
  code = await startThreePlayerRound(bots, { mode: 'fewest' });

  await test.step('B, C, then A (host) give up', async () => {
    await B.actorClick(ACTORS.meg, { expectClicks: 1 });
    await B.giveUp();
    await C.giveUp();
    await A.giveUp();
  });

  const game = await waitForRoundRecorded(code);
  expect(game.winner ?? null, 'round winner').toBeNull();
  expect(game.endedBy, 'how the round ended').toBe('gaveup');

  await test.step('Career stats in Firebase', async () => {
    for (const bot of bots) await expectCareerStats(bot, 'fewest', { wins: 0, rounds: 0, giveUps: 1 });
  });
  await test.step('Winners board', async () => {
    await expectWinnersBoard(A, { mode: 'fewest', winner: null, didNotFinish: [B, C, A] });
  });
  await test.step('Profile cards', async () => {
    for (const bot of bots) await expectProfileCards(bot, { wins: 0, losses: 0, giveUps: 1, rounds: 0 });
  });
});
