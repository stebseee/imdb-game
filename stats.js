// stats.js — persistent, cross-session career stats for each player.
//
// Stored under /players/{id}, a SIBLING of /games — deliberately outside the
// /games tree so cleanupOldGames() (which only walks /games) never deletes it.
//
// Data model:
//   /players/{id} = {
//     name,            // latest display name, for readouts only
//     totalWins,       // lifetime rounds won   (OVERALL, all game modes)
//     totalRounds,     // lifetime rounds played (OVERALL) — losses = totalRounds - totalWins
//     lastSeen,        // ms epoch
//     schemaVersion,   // bump when the shape changes
//     vs: { {opponentId}: { wins, losses, lastName } },  // head-to-head (OVERALL)
//     totalGiveUps,    // rounds where the player clicked Give Up (OVERALL). Counted
//                      // separately from losses: a give-up the opponent then wins
//                      // is a loss AND a give-up; a no-contest give-up is only a give-up.
//     byMode: {        // per-mode breakdown, added in Phase 7 (fills from now on)
//       fewest:  { totalWins, totalRounds, totalGiveUps, vs: { {opponentId}: { wins, losses, lastName } } },
//       fastest: { totalWins, totalRounds, totalGiveUps, vs: { {opponentId}: { wins, losses, lastName } } },
//     }
//   }
//   win% = totalWins / totalRounds
//
// Stats start fresh at the 2.0 release (the old /players data was cleared), so
// every player begins at 0 W/L. A round only counts toward W/L if somebody
// finished and won; each counted round increments BOTH the overall totals and
// its matching byMode bucket in the same atomic fan-out. A mode with no games yet has no byMode.<mode> node — the UI
// reads that as "no games in this mode yet".
//
// Identity: keyed on getStatsId() — TODAY the browser-local playerId, so history
// persists per browser. This single seam lets a future real login swap in a
// stable uid (and migrate the anonymous node) without touching any caller.
//
// Trust note: because id is not the Firebase auth uid, security rules can't
// restrict a client to writing only its own node — any authed client can write
// any /players node. Acceptable for a friends game; tighten once login exists.

const STATS_SCHEMA_VERSION = 2; // v2: per-mode byMode buckets (2.0 release, fresh start)
const PLAYERS_ROOT = `${FIREBASE_DB_URL}/players`;
const _fbIncrement = { ".sv": { "increment": 1 } }; // server-side atomic +1

// The game modes we keep a per-mode stats bucket for. A round whose mode isn't
// one of these still counts toward the OVERALL totals; it just gets no byMode
// bucket (so an unknown/legacy mode never creates a stray node).
const STATS_GAME_MODES = ['fewest', 'fastest'];

// The identity career stats are keyed on. Swap here when real login lands.
function getStatsId() { return playerId; }

// REST helpers rooted at /players. (The shared dbGet/dbPatch in firebase.js are
// rooted at /games, so we need our own here.) Both append ?auth=TOKEN like the
// game helpers so security rules can enforce auth != null.
async function playersGet(path) {
  const token = await getFirebaseToken();
  return fetch(`${PLAYERS_ROOT}/${path}.json?auth=${token}`).then(r => r.json());
}
async function playersPatch(path, value) {
  const token = await getFirebaseToken();
  return fetch(`${PLAYERS_ROOT}/${path}.json?auth=${token}`, {
    method: "PATCH", body: JSON.stringify(value),
  }).then(r => r.json());
}

// Load the current player's career stats, or null if they have none yet.
async function loadMyStats() {
  try {
    const id = getStatsId();
    if (!id) return null;
    return await playersGet(id);
  } catch (e) {
    console.warn('[Stats] Could not load career stats', e);
    return null;
  }
}

// Ensure the player's node exists and keep name/lastSeen fresh, even before any
// wins. Called on load and on name save so the display name never goes stale.
async function touchMyStats() {
  try {
    const id = getStatsId();
    if (!id) return;
    await playersPatch(id, {
      name: displayName || `Player-${id}`,
      lastSeen: Date.now(),
      schemaVersion: STATS_SCHEMA_VERSION,
    });
  } catch (e) {
    console.warn('[Stats] Could not touch career stats', e);
  }
}

// Minimum real players for a round to count toward career stats. Solo practice
// rounds (you against nobody) must NOT inflate wins or rounds-played, so we only
// record rounds that were an actual contest against other players.
const MIN_PLAYERS_FOR_STATS = 2;

// Record one concluded round into lifetime stats. Called once per round by the
// host (see game.js processSnapshot), writing every affected player's node in
// one fan-out PATCH using atomic server increments, so concurrent writers can't
// lose an update.
//   participantPids: everyone who played this round
//   winnerPid:       the round winner, or null if nobody finished
//   nameOf:          { pid: displayName } to keep each /players/{id}/name fresh
//   gameMode:        this round's mode ('fewest' | 'fastest'); increments the
//                    matching byMode bucket alongside the overall totals. An
//                    unknown mode still counts toward overall, but gets no bucket.
//   quitPids:        players who clicked Give Up this round
// Rules:
//   - A round only counts toward wins/losses if somebody finished and won.
//     Nobody finishing (everyone gave up, or time ran out) is a no-contest:
//     no round, win or loss for anyone.
//   - Every Give Up click counts toward totalGiveUps, whatever the outcome. So a
//     give-up where the opponent then wins is BOTH a loss and a give-up, and a
//     give-up in a no-contest round is a give-up only.
// No-op for solo rounds (fewer than MIN_PLAYERS_FOR_STATS players).
async function recordRoundStats({ participantPids, winnerPid, nameOf, gameMode, quitPids }) {
  try {
    if (!participantPids || participantPids.length < MIN_PLAYERS_FOR_STATS) return;
    const now = Date.now();
    // Only fan out to a per-mode bucket for modes we track; anything else falls
    // through as overall-only. `modePrefix` turns "fewest" into "byMode/fewest/",
    // or "" when there's no bucket to touch.
    const mode = STATS_GAME_MODES.includes(gameMode) ? gameMode : null;
    const modePrefix = mode ? `byMode/${mode}/` : "";
    const nameFor = (pid) => (nameOf && nameOf[pid]) || `Player-${pid}`;
    const quitters = (quitPids || []).filter(pid => participantPids.includes(pid));
    const update = {};
    const touch = (pid) => {
      update[`${pid}/name`]          = nameFor(pid);
      update[`${pid}/lastSeen`]      = now;
      update[`${pid}/schemaVersion`] = STATS_SCHEMA_VERSION;
    };

    // Give-ups: always counted, whether or not the round has a winner.
    for (const pid of quitters) {
      touch(pid);
      update[`${pid}/totalGiveUps`] = _fbIncrement;
      if (mode) update[`${pid}/${modePrefix}totalGiveUps`] = _fbIncrement;
    }

    // Wins/losses: only when somebody actually finished and won.
    if (winnerPid) {
      for (const pid of participantPids) {
        touch(pid);
        update[`${pid}/totalRounds`] = _fbIncrement;
        if (mode) update[`${pid}/${modePrefix}totalRounds`] = _fbIncrement;
      }
      update[`${winnerPid}/totalWins`] = _fbIncrement;
      if (mode) update[`${winnerPid}/${modePrefix}totalWins`] = _fbIncrement;
      const winnerName = nameFor(winnerPid);
      // Head-to-head: the winner beat each other participant this round, so
      // winner +1 win vs each opponent, and each opponent +1 loss vs winner.
      // Keyed on opponent id; lastName is stored only for display. Mirror the
      // same head-to-head into the byMode bucket when the mode is tracked.
      for (const pid of participantPids) {
        if (pid === winnerPid) continue;
        const oppName = nameFor(pid);
        update[`${winnerPid}/vs/${pid}/wins`]     = _fbIncrement;
        update[`${winnerPid}/vs/${pid}/lastName`] = oppName;
        update[`${pid}/vs/${winnerPid}/losses`]   = _fbIncrement;
        update[`${pid}/vs/${winnerPid}/lastName`] = winnerName;
        if (mode) {
          update[`${winnerPid}/${modePrefix}vs/${pid}/wins`]     = _fbIncrement;
          update[`${winnerPid}/${modePrefix}vs/${pid}/lastName`] = oppName;
          update[`${pid}/${modePrefix}vs/${winnerPid}/losses`]   = _fbIncrement;
          update[`${pid}/${modePrefix}vs/${winnerPid}/lastName`] = winnerName;
        }
      }
    }

    if (Object.keys(update).length === 0) return; // no-contest with no give-ups: nothing to write
    await playersPatch('', update);
  } catch (e) {
    console.warn('[Stats] Could not record round into career stats', e);
  }
}
