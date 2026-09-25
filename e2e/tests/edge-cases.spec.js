// edge-cases.spec.js — the less common ways a round can go.
//
// Covers: time running out with one finisher (the others lose, but it's not a
// give-up), time running out with nobody finished (no-contest, nothing counts),
// a player leaving between rounds (they must not be pulled into the next round
// or charged a loss), a player leaving mid-round, and a solo practice round
// (never counts). Career stats are checked after every round.

const { test, expect } = require('@playwright/test');
const { useThreeBots } = require('../lib/suite');
const { Ledger } = require('../lib/ledger');
const { dbGet } = require('../lib/firebase');
const {
  ACTORS, createGame, startRound, playAgain, finishIn, shortenTimeLimit, waitForRoundRecorded,
  expectSessionScore, expectCareerTotals, expectProfileCardsFor, expectWinnersBoard,
} = require('../lib/game');

const ctx = useThreeBots(test);
const ledger = new Ledger(['A', 'B', 'C']);
let code = null;

test('Time runs out, one finisher — A finishes; B and C lose on time but are NOT counted as giving up', async () => {
  const { A, B, C } = ctx;
  code = await createGame(A, [B, C], { mode: 'fewest' });
  ctx.codes.push(code);
  const roundKey = await startRound(A, [A, B, C]);
  await shortenTimeLimit(code, 25); // test-only: the round times out 25s after it started

  await finishIn(A, 1); // B and C never finish

  const game = await waitForRoundRecorded(code, roundKey);
  expect(game.endedBy, 'how the round ended').toBe('timeout');
  expect(game.winner, 'winner').toBe(A.pid);
  ledger.round({ mode: 'fewest', players: ['A', 'B', 'C'], winner: 'A' }); // no gave-ups

  await expectWinnersBoard(A, { mode: 'fewest', winner: A, finishOrder: [A], didNotFinish: [B, C] });
  await expectCareerTotals(ctx.byKey, ledger.expected());
});

test('Time runs out, nobody finished — no-contest: no wins, losses or give-ups for anyone', async () => {
  const { A, B, C } = ctx;
  await playAgain([A, B, C]);
  const roundKey = await startRound(A, [A, B, C]);
  await shortenTimeLimit(code, 15);

  const game = await waitForRoundRecorded(code, roundKey);
  expect(game.endedBy, 'how the round ended').toBe('timeout');
  expect(game.winner ?? null, 'winner').toBeNull();
  ledger.round({ mode: 'fewest', players: ['A', 'B', 'C'], winner: null }); // changes nothing

  await expectWinnersBoard(A, { mode: 'fewest', winner: null, didNotFinish: [A, B, C] });
  await expectCareerTotals(ctx.byKey, ledger.expected());
});

test('A player leaves between rounds — C leaves; the next round is just A and B, and C gets nothing from it', async () => {
  const { A, B, C } = ctx;
  await C.leaveGame(); // from the winners board
  await playAgain([A, B]);
  const roundKey = await startRound(A, [A, B]);

  const atStart = await dbGet(`games/${code}`);
  expect(Object.keys(atStart.players || {}).sort(), 'players in the round (C must not come back)')
    .toEqual([A.pid, B.pid].sort());

  await finishIn(B, 1);
  await finishIn(A, 2);

  const game = await waitForRoundRecorded(code, roundKey);
  expect(game.winner, 'winner').toBe(B.pid);
  expect(Object.keys(game.players || {}).sort(), 'players at the end of the round').toEqual([A.pid, B.pid].sort());
  ledger.round({ mode: 'fewest', players: ['A', 'B'], winner: 'B' });

  await expectWinnersBoard(A, { mode: 'fewest', winner: B, finishOrder: [B, A] });
  // Round score for this game: A won round 1; round 2 had no winner; B won this one.
  await expectSessionScore(A, { A, B }, { wins: { A: 1, B: 1 }, rounds: 3 });
  await expectCareerTotals(ctx.byKey, ledger.expected());
});

test('A player leaves mid-round — B clicks once then leaves; A wins over C, and B gets nothing from the round', async () => {
  const { A, B, C } = ctx;
  code = await createGame(A, [B, C], { mode: 'fewest' }); // a fresh game with all three
  ctx.codes.push(code);
  const roundKey = await startRound(A, [A, B, C]);

  await B.actorClick(ACTORS.meg, { expectClicks: 1 });
  await B.leaveGame();
  await finishIn(A, 1);
  await finishIn(C, 2);

  const game = await waitForRoundRecorded(code, roundKey);
  expect(game.winner, 'winner').toBe(A.pid);
  ledger.round({ mode: 'fewest', players: ['A', 'C'], winner: 'A' });

  await expectWinnersBoard(A, { mode: 'fewest', winner: A, finishOrder: [A, C] });
  const boardText = (await A.page.locator('#leaderboardList').textContent()) || '';
  expect(boardText, 'B left, so B should not be on the winners board').not.toContain(B.name);
  await expectCareerTotals(ctx.byKey, ledger.expected());
});

test('Solo practice round — A plays alone; nothing counts toward career stats', async () => {
  const { A } = ctx;
  code = await createGame(A, [], { mode: 'fewest' });
  ctx.codes.push(code);
  const roundKey = await startRound(A, [A]);

  await finishIn(A, 1);

  await waitForRoundRecorded(code, roundKey);
  ledger.round({ mode: 'fewest', players: ['A'], winner: 'A' }); // solo: changes nothing
  await expectCareerTotals(ctx.byKey, ledger.expected());
  await expectProfileCardsFor(ctx.byKey, ledger.expected());
});
