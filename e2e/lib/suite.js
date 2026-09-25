// suite.js — shared setup for a test file that uses three bots.
//
// Launches Bot A (host), Bot B and Bot C once for the whole file (so their career
// stats build up across the file's rounds), attaches screenshots when a round
// fails, prints a stats table after every round, and at the end closes the
// browsers and deletes the bots and every test game from Firebase.
//
// Rounds in a file run in order; if one fails, the rest are skipped (their
// expected totals depend on it).

const { Bot } = require('./bot');
const { dbDelete } = require('./firebase');
const { printStatsTable, cleanupTestData } = require('./game');

function useThreeBots(test) {
  test.describe.configure({ mode: 'serial' });

  const ctx = { A: null, B: null, C: null, bots: [], byKey: {}, codes: [] };

  test.beforeAll(async () => {
    test.setTimeout(2 * 60 * 1000);
    ctx.A = await Bot.launch('Bot A', 0); // host
    ctx.B = await Bot.launch('Bot B', 1);
    ctx.C = await Bot.launch('Bot C', 2);
    ctx.bots = [ctx.A, ctx.B, ctx.C];
    ctx.byKey = { A: ctx.A, B: ctx.B, C: ctx.C };

    // Each bot is the same saved player every run. Load IMDb once so the
    // extension signs in (reusing its saved sign-in), then reset the bot's stats
    // so this file's expected totals start from 0.
    for (const bot of ctx.bots) {
      await bot.leaveGameSession();
      await bot.storageSet({ displayName: bot.name });
      await bot.open('https://www.imdb.com/');
      bot.throwIfExtensionFailed();
      const { playerId } = await bot.storageGet(['playerId']);
      if (!playerId) throw new Error(`${bot.name} has no playerId after loading IMDb`);
      bot.pid = playerId;
      await dbDelete(`players/${playerId}`);
    }
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      for (const bot of ctx.bots) {
        const png = await bot.screenshot();
        if (png) await testInfo.attach(`${bot.name} at failure`, { body: png, contentType: 'image/png' });
      }
    }
    if (ctx.bots.length && ctx.bots.every(b => b.pid)) {
      await printStatsTable(ctx.byKey, `Stats after: ${testInfo.title}`);
    }
  });

  test.afterAll(async () => {
    for (const bot of ctx.bots) await bot.close();
    await cleanupTestData(ctx.bots, ctx.codes);
  });

  return ctx;
}

module.exports = { useThreeBots };
