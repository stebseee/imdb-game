// ledger.js — the expected career stats, worked out from the agreed rules.
//
// Each round the test states only the facts: who played, who won, and who
// clicked Give Up. The ledger turns those into the running totals every bot
// should have, which the test then compares with Firebase.
//
// The rules (as agreed):
//   - A round only counts toward wins/losses if somebody finished and won.
//     Nobody finishing (everyone gave up, or time ran out) = no-contest.
//   - In a counted round, everyone who played gets +1 round; the winner +1 win.
//     Losses = rounds - wins. Head-to-head: winner +1 win vs each other player,
//     each other player +1 loss vs the winner.
//   - Every Give Up click is +1 gave up, whatever the outcome (so it can be a
//     loss AND a give-up). Running out of time is NOT a give-up.
//   - Rounds with fewer than 2 players (solo practice) don't count at all.
//   - Everything is tracked overall and per game mode (fewest / fastest).

class Ledger {
  constructor(keys) {
    this.keys = keys;
    this.t = {};
    for (const k of keys) {
      this.t[k] = { overall: [0, 0, 0], fewest: [0, 0, 0], fastest: [0, 0, 0], vs: {} };
      for (const o of keys) if (o !== k) this.t[k].vs[o] = [0, 0];
    }
  }

  // players: keys of everyone in the round, e.g. ['A', 'B', 'C']
  // winner:  key of the winner, or null if nobody finished
  // gaveUp:  keys of players who clicked Give Up
  round({ mode, players, winner = null, gaveUp = [] }) {
    if (players.length < 2) return; // solo practice: nothing counts
    const bump = (k, i) => { this.t[k].overall[i]++; this.t[k][mode][i]++; };
    for (const k of gaveUp) bump(k, 2);
    if (!winner) return; // no-contest
    for (const k of players) bump(k, 1);
    bump(winner, 0);
    for (const k of players) {
      if (k === winner) continue;
      this.t[winner].vs[k][0]++;
      this.t[k].vs[winner][1]++;
    }
  }

  // The expected totals, in the shape expectCareerTotals() takes.
  expected() {
    return JSON.parse(JSON.stringify(this.t));
  }
}

module.exports = { Ledger };
