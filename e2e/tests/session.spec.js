// session.spec.js — one game session, five rounds in a row (Play Again between rounds).
//
// Covers: everyone finishing with different click counts, a tie on clicks (the
// earlier finisher wins), switching game mode in the lobby, a give-up in an
// otherwise normal round, and a no-contest round mid-session. After every round
// it checks the winner, the winners board, the in-game round score (Session
// Scoreboard + the game's win tally) and every bot's career stats.

const { test, expect } = require('@playwright/test');
const { useThreeBots } = require('../lib/suite');
const { Ledger } = require('../lib/ledger');
const {
  createGame, startRound, playAgain, finishIn, waitForRoundRecorded,
  expectSessionScore, expectCareerTotals, expectProfileCardsFor, expectWinnersBoard,
} = require('../lib/game');

const ctx = useThreeBots(test);
const ledger = new Ledger(['A', 'B', 'C']);
let code = null;

test('Round 1 (fewest) — everyone finishes: C in 3 clicks, then B in 2, then A in 1 → A wins on fewest clicks', async () => {
  const { A, B, C } = ctx;
  code = await createGame(A, [B, C], { mode: 'fewest' });
  ctx.codes.push(code);
  const roundKey = await startRound(A, [A, B, C]);

  await finishIn(C, 3);
  await finishIn(B, 2);
  await finishIn(A, 1); // last to finish, but fewest clicks

  const game = await waitForRoundRecorded(code, roundKey);
  expect(game.winner, 'winner').toBe(A.pid);
  ledger.round({ mode: 'fewest', players: ['A', 'B', 'C'], winner: 'A' });

  await expectWinnersBoard(A, { mode: 'fewest', winner: A, finishOrder: [A, B, C] });
  await expectSessionScore(A, ctx.byKey, { wins: { A: 1, B: 0, C: 0 }, rounds: 1 });
  await expectCareerTotals(ctx.byKey, ledger.expected());
});

test('Round 2 (fewest) — tie on clicks: B and C both 1 click, B finishes first → B wins; A 2 clicks', async () => {
  const { A, B, C } = ctx;
  await playAgain([A, B, C]);
  const roundKey = await startRound(A, [A, B, C]);

  await finishIn(B, 1);
  await finishIn(C, 1); // same clicks as B, but later
  await finishIn(A, 2);

  const game = await waitForRoundRecorded(code, roundKey);
  expect(game.winner, 'winner (tie on clicks → earlier finish)').toBe(B.pid);
  ledger.round({ mode: 'fewest', players: ['A', 'B', 'C'], winner: 'B' });

  await expectWinnersBoard(A, { mode: 'fewest', winner: B, finishOrder: [B, C, A] });
  await expectSessionScore(A, ctx.byKey, { wins: { A: 1, B: 1, C: 0 }, rounds: 2 });
  await expectCareerTotals(ctx.byKey, ledger.expected());
});

test('Round 3 (host switches to fastest) — C finishes first in 3 clicks, A second in 1, B third in 2 → C wins', async () => {
  const { A, B, C } = ctx;
  await playAgain([A, B, C]);
  await A.setGameMode('fastest');
  const roundKey = await startRound(A, [A, B, C]);

  await finishIn(C, 3);
  await finishIn(A, 1);
  await finishIn(B, 2);

  const game = await waitForRoundRecorded(code, roundKey);
  expect(game.gameMode, 'round mode').toBe('fastest');
  expect(game.winner, 'winner (first to finish)').toBe(C.pid);
  ledger.round({ mode: 'fastest', players: ['A', 'B', 'C'], winner: 'C' });

  await expectWinnersBoard(A, { mode: 'fastest', winner: C, finishOrder: [C, A, B] });
  await expectSessionScore(A, ctx.byKey, { wins: { A: 1, B: 1, C: 1 }, rounds: 3 });
  await expectCareerTotals(ctx.byKey, ledger.expected());
});

test('Round 4 (host switches back to fewest) — C gives up; A and B both 2 clicks, A first → A wins', async () => {
  const { A, B, C } = ctx;
  await playAgain([A, B, C]);
  await A.setGameMode('fewest');
  const roundKey = await startRound(A, [A, B, C]);

  await C.giveUp();
  await finishIn(A, 2);
  await finishIn(B, 2);

  const game = await waitForRoundRecorded(code, roundKey);
  expect(game.gameMode, 'round mode').toBe('fewest');
  expect(game.winner, 'winner (tie on clicks → earlier finish)').toBe(A.pid);
  ledger.round({ mode: 'fewest', players: ['A', 'B', 'C'], winner: 'A', gaveUp: ['C'] });

  await expectWinnersBoard(A, { mode: 'fewest', winner: A, finishOrder: [A, B], didNotFinish: [C] });
  await expectSessionScore(A, ctx.byKey, { wins: { A: 2, B: 1, C: 1 }, rounds: 4 });
  await expectCareerTotals(ctx.byKey, ledger.expected());
});

test('Round 5 (fewest) — everyone gives up: no-contest, the round score stays the same', async () => {
  const { A, B, C } = ctx;
  await playAgain([A, B, C]);
  const roundKey = await startRound(A, [A, B, C]);

  await B.giveUp();
  await C.giveUp();
  await A.giveUp();

  const game = await waitForRoundRecorded(code, roundKey);
  expect(game.winner ?? null, 'winner').toBeNull();
  ledger.round({ mode: 'fewest', players: ['A', 'B', 'C'], winner: null, gaveUp: ['A', 'B', 'C'] });

  await expectWinnersBoard(A, { mode: 'fewest', winner: null, didNotFinish: [B, C, A] });
  await expectSessionScore(A, ctx.byKey, { wins: { A: 2, B: 1, C: 1 }, rounds: 5 });
  await expectCareerTotals(ctx.byKey, ledger.expected());
  await expectProfileCardsFor(ctx.byKey, ledger.expected());
});
