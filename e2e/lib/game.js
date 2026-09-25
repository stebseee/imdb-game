// game.js — shared setup + result checks for the 3-player scenarios.

const { expect } = require('@playwright/test');
const { dbGet, dbDelete, waitFor } = require('./firebase');

// Fixed pages so every run takes the same route. Any real IMDb actor/title pages
// work (the bots click through by URL), but these are genuinely connected.
const ACTORS = {
  start:  { name: 'Tom Hanks',      url: 'https://www.imdb.com/name/nm0000158/' },
  target: { name: 'Kevin Bacon',    url: 'https://www.imdb.com/name/nm0000102/' },
  meg:    { name: 'Meg Ryan',       url: 'https://www.imdb.com/name/nm0000212/' },
  morgan: { name: 'Morgan Freeman', url: 'https://www.imdb.com/name/nm0000151/' },
};
const TITLES = {
  apollo13:  { name: 'Apollo 13',             url: 'https://www.imdb.com/title/tt0112384/' },
  sleepless: { name: 'Sleepless in Seattle',  url: 'https://www.imdb.com/title/tt0108160/' },
  shawshank: { name: 'The Shawshank Redemption', url: 'https://www.imdb.com/title/tt0111161/' },
};
const MODE_LABEL = {
  fewest: 'Fewest clicks wins (standard)',
  fastest: 'Fastest to finish wins',
};

// Host creates a game in `mode`, the two guests join via the invite link, and
// the host starts the round. Resolves once all three are on the start actor's
// page with the round active. Returns the game code.
async function startThreePlayerRound([host, ...guests], { mode }) {
  const bots = [host, ...guests];

  // Configure each bot before its first IMDb page load (the extension reads these on load).
  for (const bot of bots) {
    await bot.storageSet({ displayName: bot.name, gameMode: mode, roundTimeLimitSec: 300 });
  }
  // Fix the actor pair so the route is the same every run (the debug "lock pair" setting).
  await host.storageSet({ lockedActorPair: { actorA: ACTORS.start, actorB: ACTORS.target } });

  await host.open('https://www.imdb.com/');
  await host.clickUi('create-game');
  const code = await waitFor(async () => (await host.storageGet(['gameId'])).gameId,
    { what: `${host.name} to create a game` });
  console.log(`  game code: ${code}`);

  for (const guest of guests) await guest.open(`https://www.imdb.com/?game=${code}`);
  await waitFor(async () => {
    const g = await dbGet(`games/${code}`);
    return g && Object.keys(g.players || {}).length === bots.length;
  }, { what: 'both guests to join the lobby' });

  for (const bot of bots) await bot.attach(code);

  await host.clickUi('start-round');
  const startPath = new URL(ACTORS.start.url).pathname; // e.g. /name/nm0000158/
  await Promise.all(bots.map(bot =>
    bot.page.waitForURL(u => u.pathname.startsWith(startPath), { timeout: 45_000 })));
  await Promise.all(bots.map(bot => bot.waitReady()));
  await waitFor(async () => (await dbGet(`games/${code}`))?.status === 'active',
    { what: 'the round to go active' });
  return code;
}

// Wait for the round to end AND for the host to record career stats for it.
async function waitForRoundRecorded(code) {
  return waitFor(async () => {
    const g = await dbGet(`games/${code}`);
    return g && g.status === 'finished' && g.endedAt && g.statsRecordedEndedAt === g.endedAt ? g : null;
  }, { timeout: 60_000, what: 'the round to finish and the host to record career stats' });
}

function statsView(node, mode) {
  const pick = (n) => ({
    wins: Number(n?.totalWins ?? 0),
    rounds: Number(n?.totalRounds ?? 0),
    giveUps: Number(n?.totalGiveUps ?? 0),
  });
  return { overall: pick(node), [mode]: pick(node?.byMode?.[mode]) };
}

// Check a bot's career stats in Firebase (overall AND the round's mode bucket).
//   expected: { wins, rounds, giveUps }
async function expectCareerStats(bot, mode, expected) {
  const norm = { wins: expected.wins, rounds: expected.rounds, giveUps: expected.giveUps };
  const want = { overall: norm, [mode]: norm };
  let got = null;
  try {
    await waitFor(async () => {
      got = statsView(await dbGet(`players/${bot.pid}`), mode);
      return JSON.stringify(got) === JSON.stringify(want);
    }, { timeout: 20_000, what: `${bot.name}'s career stats` });
  } catch (e) {
    throw new Error(`${bot.name} career stats in Firebase\n  expected: ${JSON.stringify(want)}\n  actual:   ${JSON.stringify(got)}`);
  }
}

// Open the bot's 📊 profile and check the cards it shows (All modes view).
//   expected: { wins, losses, giveUps, rounds }
async function expectProfileCards(bot, { wins, losses, giveUps, rounds }) {
  await bot.clickUi('open-profile');
  const p = bot.page;
  const pct = rounds ? `${Math.round((wins / rounds) * 100)}%` : '—';
  const roundsLabel = rounds ? `${rounds} round${rounds === 1 ? '' : 's'}` : '';
  await expect(p.getByTestId('stat-wins'), `${bot.name} profile: wins`).toHaveText(String(wins));
  await expect(p.getByTestId('stat-losses'), `${bot.name} profile: losses`).toHaveText(String(losses));
  await expect(p.getByTestId('stat-giveups'), `${bot.name} profile: gave up`).toHaveText(String(giveUps));
  await expect(p.getByTestId('stat-winrate'), `${bot.name} profile: win rate`).toHaveText(pct);
  await expect(p.getByTestId('stat-winrate-sub'), `${bot.name} profile: round count`).toHaveText(roundsLabel);
}

// Check the winners board on a bot's page: mode label, winner line, finish order,
// and who is listed under "Did not finish".
async function expectWinnersBoard(bot, { mode, winner, finishOrder = [], didNotFinish = [] }) {
  const board = bot.page.locator('#leaderboardList');
  await expect(board, 'winners board mode label').toContainText(`Game mode: ${MODE_LABEL[mode]}`, { timeout: 30_000 });
  if (winner) {
    await expect(bot.page.locator('#winnerText'), 'winner line').toContainText(`${winner.name} WINS`);
  }
  const text = (await board.textContent()) || '';
  let prev = -1;
  for (const b of finishOrder) {
    const i = text.indexOf(b.name);
    expect(i, `${b.name} should be on the board`).toBeGreaterThan(-1);
    expect(i, `${b.name} should be listed after the previous finisher`).toBeGreaterThan(prev);
    prev = i;
  }
  if (didNotFinish.length) {
    const dnfAt = text.indexOf('Did not finish');
    expect(dnfAt, '"Did not finish" section').toBeGreaterThan(-1);
    for (const b of didNotFinish) {
      expect(text.indexOf(b.name, dnfAt), `${b.name} should be under "Did not finish"`).toBeGreaterThan(dnfAt);
    }
  }
}

// Delete the bots' player records and the test game, unless KEEP_TEST_DATA is set.
async function cleanupTestData(bots, code) {
  if (process.env.KEEP_TEST_DATA) {
    console.log(`  KEEP_TEST_DATA set — leaving game ${code} and players ${bots.map(b => b.pid).join(', ')} in Firebase`);
    return;
  }
  const paths = bots.filter(b => b.pid).map(b => `players/${b.pid}`);
  if (code) paths.push(`games/${code}`);
  for (const p of paths) await dbDelete(p).catch(e => console.warn(`  cleanup: ${e.message}`));
}

module.exports = {
  ACTORS, TITLES, MODE_LABEL,
  startThreePlayerRound, waitForRoundRecorded,
  expectCareerStats, expectProfileCards, expectWinnersBoard, cleanupTestData,
};
