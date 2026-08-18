// config.js — Firebase constants, active actor list, and all game-session local state.
// Split from content.js (v1.6 refactor) — code moved verbatim, no logic changes.

// content.js
// IMDB Competitive Click Race - rebuilt; host now redirects to actorA immediately on create

const FIREBASE_DB_URL = "https://imdb-game-343f1-default-rtdb.firebaseio.com"; // Corrected URL
const GAMES_ROOT = `${FIREBASE_DB_URL}/games`;
const FIREBASE_API_KEY = "AIzaSyBLyKiLclFPaOz7kwGbMUMrw88hvEGIIak"; // Firebase Web API Key
//THIS IS THE FED BRANCH
// STATIC_ACTOR_LIST is defined in actors.js, which is loaded before this file.
// Edit actors.js to update the fallback list.

// Active actor list — uses actors.js by default; can be switched to dynamic IMDB fetch via debug panel
let actorList = STATIC_ACTOR_LIST;

// ----------------------
// Local state
let playerId = null;
let gameId = null;
let actorPair = null; // [actorA, actorB]
let clicks = 0;
let _sseAbortController = null; // SSE stream controller
let _sseHeartbeat = null;       // interval that writes lastSeen during active rounds
let _sseReconnectTimer = null;  // reconnect delay timer
let gameSnapshot = null;        // latest known game state from the stream
let _concluding = false;        // prevents concurrent winner-write races
let _timerInterval = null;      // local 1s tick to keep the round timer smooth
let _hostTransferring = false;  // prevents multiple clients racing to transfer host
let _toastedFinishers = new Set(); // pids we've already shown a finish toast for
let displayName = null;
let role = null; // 'host' | 'guest' | null
let hasRedirected = false; // Now persistent via storage
let finished = false; // local session flag to block further clicks after finishing
let roundStartedAt = null; // preserved across finished state (stored locally) so winners board can compute durations
let lastReadyAt = null; // timestamp when user clicked Play Again (local helper to handle races)
let clickPath = []; // ordered list of actor names visited this round, written to Firebase on finish
const openPaths = new Set(); // tracks which player pids have their path accordion expanded (survives leaderboard re-renders)
let optimalPathRoundKey = null; // `${gameId}_${startedAt}` — prevents re-fetching same round
let optimalPathResult = null;   // null | 'loading' | { path, actorClicks, oracleUrl } | { error, oracleUrl }
let roundIsActive = false;      // true only while a game round is status='active'; gates page filters
let hostRoundTimeLimitSec = 300; // host-configured per-round limit (seconds; presets only)
let roundTimeLimitMs = null;   // round-configured for the currently active round
let _chatMinimised = true;     // chat panel collapse state (starts minimised)
let _chatUnread = 0;           // unread count — messages from others not yet seen
let _chatLastKeys = '';        // serialised key list — avoids redundant re-renders
let _chatLastSeenTime = 0;     // timestamp of newest message seen while chat was open (persisted)
let _leavingGame = false;      // true while leaveGame() is running — suppresses the "kicked" alert

