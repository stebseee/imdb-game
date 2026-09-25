// game.js — shared setup + result checks for the 3-player rounds.

const { expect } = require('@playwright/test');
const { dbGet, dbPatch, dbDelete, waitFor } = require('./firebase');

// Fixed pages so every run takes the same route (served as stand-ins, see imdb-stub.js).
const ACTORS = {
  start:  { name: 'Tom Hanks',      url: 'https://www.imdb.com/name/nm0000158/' },
  target: { name: 'Kevin Bacon',    url: 'https://www.imdb.com/name/nm0000102/' },
  meg:    { name: 'Meg Ryan',       url: 'https://www.imdb.com/name/nm0000212/' },
  morgan: { name: 'Morgan Freeman', url: 'https://www.imdb.com/name/nm0000151/' },
};
const TITLES = {
  apollo13:  { name: 'Apollo 13',                url: 'https://www.imdb.com/title/tt0112384/' },
  sleepless: { name: 'Sleepless in Seattle',     url: 'https://www.imdb.com/title/tt0108160/' },
  shawshank: { name: 'The Shawshank Redemption', url: 'https://www.imdb.com/title/tt0111161/' },
};
const MODE_LABEL = {
  fewest: 'Fewest clicks wins (standard)',
  fastest: 'Fastest to finish wins',
};

// Host creates a game in `mode` and the guests join via the invite link. Resolves
// once everyone is in the lobby. Bots keep their player identity and career stats
// across games. Returns the game code.
async function createGame(host, guests, { mode }) {
  const bots = [host, ...guests];
  for (const bot of bots) {
    bot.dialogs = [];
    await bot.leaveGameSession(); // drop any previous game (no-op the first time)
    await bot.storageSet({ displayName: bot.name, gameMode: mode, roundTimeLimitSec: 300 });
  }
  // Fix the actor pair so the route is the same every run (the debug "lock pair" setting).
  await host.storageSet({ lockedActorPair: { actorA: ACTORS.start, actorB: ACTORS.target } });

  await host.open('https://www.imdb.com/');
  await host.clickUi('create-game');
  const code = await waitFor(async () => {
    host.throwIfExtensionFailed();
    return (await host.storageGet(['gameId'])).gameId;
  }, { what: `${host.name} to create a game` });
  console.log(`  game code: ${code}`);
  await host.attach(code);

  for (const guest of guests) await guest.open(`https://www.imdb.com/?game=${code}`);
  await waitFor(async () => {
    for (const bot of bots) bot.throwIfExtensionFailed();
    const g = await dbGet(`games/${code}`);
    return g && Object.keys(g.players || {}).length === bots.length;
  }, { what: `${guests.length ? 'the guests' : 'the host'} to be in the lobby` });
  for (const guest of guests) await guest.attach(code);
  return code;
}

// Host starts a round; `players` are the bots expected to play it. Resolves once
// they're all on the start actor's page with the round active. Returns the round's
// roundKey (its stable ID).
async function startRound(host, players) {
  const code = host.code;
  const before = await dbGet(`games/${code}`);
  await host.clickUi('start-round');
  const g = await waitFor(async () => {
    const x = await dbGet(`games/${code}`);
    return x && x.status === 'active' && x.roundKey && x.roundKey !== before?.roundKey ? x : null;
  }, { what: 'the round to start' });
  const startPath = new URL(ACTORS.start.url).pathname; // e.g. /name/nm0000158/
  await Promise.all(players.map(bot =>
    bot.page.waitForURL(u => u.pathname.startsWith(startPath), { timeout: 45_000 })));
  await Promise.all(players.map(bot => bot.waitReady()));
  return g.roundKey;
}

// First round of a fresh 3-player game (used by three-players.spec.js).
async function startThreePlayerRound([host, ...guests], { mode }) {
  const code = await createGame(host, guests, { mode });
  await startRound(host, [host, ...guests]);
  return code;
}

// Everyone presses Play Again, then goes to IMDb's home page to wait in the lobby.
// (Moving off the actor pages means the next round's redirect is a real page change.)
async function playAgain(bots) {
  for (const bot of bots) await bot.playAgain();
  for (const bot of bots) await bot.open('https://www.imdb.com/');
}

// Test-only shortcut: shorten the running round's time limit (the smallest
// setting is 5 minutes). The extension reads the limit from the game, so the
// round then ends by timeout as normal once this many seconds have passed since
// it started.
async function shortenTimeLimit(code, seconds) {
  await dbPatch(`games/${code}`, { roundTimeLimitMs: seconds * 1000 });
}

// Play a route to the target actor with `clicks` actor clicks, visiting a (free)
// movie page before each click, like a real player.
const ROUTES = {
  1: [ACTORS.target],
  2: [ACTORS.meg, ACTORS.target],
  3: [ACTORS.meg, ACTORS.morgan, ACTORS.target],
};
const ROUTE_TITLES = [TITLES.apollo13, TITLES.sleepless, TITLES.shawshank];
async function finishIn(bot, clicks) {
  const route = ROUTES[clicks];
  for (let i = 0; i < route.length; i++) {
    await bot.visit(ROUTE_TITLES[i]);
    await bot.actorClick(route[i], { expectClicks: i + 1, finishing: i === route.length - 1 });
  }
}

// Wait for the round to end AND for the host to record career stats for it.
// Pass the roundKey from startRound() to be sure it's that round.
async function waitForRoundRecorded(code, roundKey) {
  return waitFor(async () => {
    const g = await dbGet(`games/${code}`);
    if (!g || g.status !== 'finished' || !g.roundKey) return null;
    if (roundKey && g.roundKey !== roundKey) return null;
    return g.statsRecordedRound === g.roundKey ? g : null;
  }, { timeout: 90_000, what: 'the round to finish and the host to record career stats' });
}

// Check the in-game round score: the game's win tally, the number of rounds in
// its history, and the Session Scoreboard shown on `viewer`'s winners board.
//   wins: { A: 2, B: 1, C: 0 } — by bot key; bots not listed must have 0
async function expectSessionScore(viewer, botsByKey, { wins, rounds }) {
  const code = viewer.code;
  const g = await dbGet(`games/${code}`);
  const tally = {};
  for (const [k, bot] of Object.entries(botsByKey)) tally[k] = Number(g?.wins?.[bot.pid] ?? 0);
  const want = {};
  for (const k of Object.keys(botsByKey)) want[k] = wins[k] || 0;
  expect(tally, 'round wins this session (in Firebase)').toEqual(want);
  expect(Object.keys(g?.roundHistory || {}).length, 'rounds in the session history').toBe(rounds);

  const board = viewer.page.locator('#sessionStandings');
  await expect(board, 'Session Scoreboard').toContainText('Session Scoreboard', { timeout: 30_000 });
  const text = (await board.textContent()) || '';
  for (const [k, bot] of Object.entries(botsByKey)) {
    if (!(k in wins)) continue;
    const m = text.match(new RegExp(`${bot.name}\\s*(\\d+) wins?`));
    expect(m, `${bot.name} should be on the Session Scoreboard`).not.toBeNull();
    expect(Number(m[1]), `${bot.name}'s wins on the Session Scoreboard`).toBe(wins[k]);
  }
}

// ---------------------------------------------------------------------------
// Career stats checks
//
// Expected totals are written per bot as [wins, rounds, gaveUp] overall and per
// mode, plus head-to-head as [wins, losses] against each other bot, e.g.
//   A: { overall: [1, 2, 0], fewest: [1, 1, 0], fastest: [0, 1, 0], vs: { B: [1, 0], C: [1, 1] } }
// Anything left out counts as zero. Losses = rounds - wins.

function totals(n) {
  return [Number(n?.totalWins ?? 0), Number(n?.totalRounds ?? 0), Number(n?.totalGiveUps ?? 0)];
}

function shapeOf(selfKey, botsByKey, source) {
  const vs = {};
  for (const key of Object.keys(botsByKey)) {
    if (key !== selfKey) vs[key] = source.vs(key);
  }
  return { overall: source.overall, fewest: source.fewest, fastest: source.fastest, vs };
}

function expectedShape(selfKey, botsByKey, exp) {
  return shapeOf(selfKey, botsByKey, {
    overall: exp.overall || [0, 0, 0],
    fewest: exp.fewest || [0, 0, 0],
    fastest: exp.fastest || [0, 0, 0],
    vs: (k) => (exp.vs && exp.vs[k]) || [0, 0],
  });
}

function actualShape(selfKey, botsByKey, node) {
  return shapeOf(selfKey, botsByKey, {
    overall: totals(node),
    fewest: totals(node?.byMode?.fewest),
    fastest: totals(node?.byMode?.fastest),
    vs: (k) => {
      const r = node?.vs?.[botsByKey[k].pid];
      return [Number(r?.wins ?? 0), Number(r?.losses ?? 0)];
    },
  });
}

// Check every bot's career stats in Firebase against the expected running totals.
async function expectCareerTotals(botsByKey, expectedByKey) {
  let lastActual = {};
  const matches = async () => {
    let allMatch = true;
    for (const [key, bot] of Object.entries(botsByKey)) {
      const actual = actualShape(key, botsByKey, await dbGet(`players/${bot.pid}`));
      lastActual[key] = actual;
      if (JSON.stringify(actual) !== JSON.stringify(expectedShape(key, botsByKey, expectedByKey[key] || {}))) allMatch = false;
    }
    return allMatch;
  };
  try {
    await waitFor(matches, { timeout: Number(process.env.STATS_WAIT_MS || 20_000), what: 'career stats to match' });
  } catch (e) {
    const lines = ['Career stats in Firebase do not match (format: [wins, rounds, gave up]; vs = [wins, losses]):'];
    for (const [key, bot] of Object.entries(botsByKey)) {
      const exp = expectedShape(key, botsByKey, expectedByKey[key] || {});
      const act = lastActual[key];
      const ok = JSON.stringify(exp) === JSON.stringify(act);
      lines.push(`  ${bot.name} ${ok ? '✓' : '✗'}`);
      if (!ok) {
        lines.push(`    expected: ${JSON.stringify(exp)}`);
        lines.push(`    actual:   ${JSON.stringify(act)}`);
      }
    }
    throw new Error(lines.join('\n'));
  }
}

// Print the bots' current stats as a table (so each run shows them building up).
async function printStatsTable(botsByKey, heading) {
  const pad = (s, n) => String(s).padEnd(n);
  const fmt = ([w, r, g]) => `${w}/${r}/${g}`;
  console.log(`\n  ${heading}`);
  console.log(`  ${pad('', 7)}${pad('wins', 6)}${pad('losses', 8)}${pad('gave up', 9)}${pad('rounds', 8)}│ fewest W/R/G │ fastest W/R/G`);
  for (const [key, bot] of Object.entries(botsByKey)) {
    const a = actualShape(key, botsByKey, await dbGet(`players/${bot.pid}`).catch(() => null));
    const [w, r, g] = a.overall;
    console.log(`  ${pad(bot.name, 7)}${pad(w, 6)}${pad(r - w, 8)}${pad(g, 9)}${pad(r, 8)}│ ${pad(fmt(a.fewest), 13)}│ ${fmt(a.fastest)}`);
  }
  console.log('');
}

// Open each bot's 📊 profile and check the cards (All modes view) match its
// expected overall totals.
async function expectProfileCardsFor(botsByKey, expectedByKey) {
  for (const [key, bot] of Object.entries(botsByKey)) {
    const [wins, rounds, giveUps] = (expectedByKey[key] && expectedByKey[key].overall) || [0, 0, 0];
    await expectProfileCards(bot, { wins, losses: rounds - wins, giveUps, rounds });
  }
}

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

// Delete the bots' player records and every test game, unless KEEP_TEST_DATA is set.
async function cleanupTestData(bots, codes) {
  const players = bots.filter(b => b.pid).map(b => b.pid);
  if (process.env.KEEP_TEST_DATA) {
    console.log(`  KEEP_TEST_DATA set — leaving games ${codes.join(', ')} and players ${players.join(', ')} in Firebase`);
    return;
  }
  for (const p of [...players.map(pid => `players/${pid}`), ...codes.map(c => `games/${c}`)]) {
    await dbDelete(p).catch(e => console.warn(`  cleanup: ${e.message}`));
  }
  console.log(`  Cleaned up: ${players.length} bot players and ${codes.length} test games deleted from Firebase.`);
}

module.exports = {
  ACTORS, TITLES, MODE_LABEL,
  createGame, startRound, startThreePlayerRound, playAgain, shortenTimeLimit, finishIn,
  waitForRoundRecorded, expectSessionScore,
  expectCareerTotals, printStatsTable, expectProfileCardsFor, expectWinnersBoard, cleanupTestData,
};
