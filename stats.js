// stats.js — persistent, cross-session career stats for each player.
//
// Stored under /players/{id}, a SIBLING of /games — deliberately outside the
// /games tree so cleanupOldGames() (which only walks /games) never deletes it.
//
// Data model:
//   /players/{id} = {
//     name,            // latest display name, for readouts only
//     totalWins,       // lifetime rounds won
//     totalRounds,     // lifetime rounds played  (losses = totalRounds - totalWins)
//     lastSeen,        // ms epoch
//     schemaVersion,   // bump when the shape changes
//     vs: { {opponentId}: { wins, losses, lastName } }   // head-to-head (later phase)
//   }
//   win% = totalWins / totalRounds
//
// Identity: keyed on getStatsId() — TODAY the browser-local playerId, so history
// persists per browser. This single seam lets a future real login swap in a
// stable uid (and migrate the anonymous node) without touching any caller.
//
// Trust note: because id is not the Firebase auth uid, security rules can't
// restrict a client to writing only its own node — any authed client can write
// any /players node. Acceptable for a friends game; tighten once login exists.

const STATS_SCHEMA_VERSION = 1;
const PLAYERS_ROOT = `${FIREBASE_DB_URL}/players`;
const _fbIncrement = { ".sv": { "increment": 1 } }; // server-side atomic +1

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

// Record one concluded round into lifetime stats. Called by the single client
// that concludes the round (see game.js processSnapshot), so it writes every
// participant's node in one fan-out PATCH using atomic server increments —
// concurrent writers can't lose an update.
//   participantPids: everyone who played this round
//   winnerPid:       the round winner, or null on a no-winner timeout
//   nameOf:          { pid: displayName } to keep each /players/{id}/name fresh
async function recordRoundStats({ participantPids, winnerPid, nameOf }) {
  try {
    if (!participantPids || participantPids.length === 0) return;
    const now = Date.now();
    const update = {};
    for (const pid of participantPids) {
      update[`${pid}/totalRounds`]   = _fbIncrement;
      update[`${pid}/name`]          = (nameOf && nameOf[pid]) || `Player-${pid}`;
      update[`${pid}/lastSeen`]      = now;
      update[`${pid}/schemaVersion`] = STATS_SCHEMA_VERSION;
    }
    if (winnerPid) update[`${winnerPid}/totalWins`] = _fbIncrement;
    await playersPatch('', update);
  } catch (e) {
    console.warn('[Stats] Could not record round into career stats', e);
  }
}
