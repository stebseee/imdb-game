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
// Utilities
function randId(len = 5) { return Math.random().toString(36).substr(2, len).toUpperCase(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ----------------------
// Firebase Anonymous Auth
// Signs in anonymously once per browser and caches the token in chrome.storage.
// All db helpers append ?auth=TOKEN so security rules can enforce auth != null.
let _fbIdToken = null;
let _fbTokenExpiry = 0;

async function getFirebaseToken() {
  // Return cached token if still valid (with 60 s buffer)
  if (_fbIdToken && Date.now() < _fbTokenExpiry - 60_000) return _fbIdToken;

  // Try refreshing with stored refresh token first
  const { firebaseRefreshToken } = await storageGet(['firebaseRefreshToken']);
  if (firebaseRefreshToken) {
    try {
      const res = await fetch(
        `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `grant_type=refresh_token&refresh_token=${firebaseRefreshToken}` }
      );
      const data = await res.json();
      if (data.id_token) {
        _fbIdToken = data.id_token;
        _fbTokenExpiry = Date.now() + parseInt(data.expires_in) * 1000;
        await storageSet({ firebaseRefreshToken: data.refresh_token });
        return _fbIdToken;
      }
    } catch (e) { console.warn('[Firebase Auth] Refresh failed', e); }
  }

  // No refresh token or refresh failed — sign in anonymously
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }) }
  );
  const data = await res.json();
  if (!data.idToken) throw new Error(`[Firebase Auth] Anonymous sign-in failed: ${JSON.stringify(data)}`);
  _fbIdToken = data.idToken;
  _fbTokenExpiry = Date.now() + parseInt(data.expiresIn) * 1000;
  await storageSet({ firebaseRefreshToken: data.refreshToken });
  return _fbIdToken;
}

// ----------------------
// REST helpers (paths are appended to GAMES_ROOT)
async function dbPut(path, value) {
  const token = await getFirebaseToken();
  return fetch(`${GAMES_ROOT}/${path}.json?auth=${token}`, { method: "PUT", body: JSON.stringify(value) }).then(r => r.json());
}
async function dbPatch(path, value) {
  const token = await getFirebaseToken();
  return fetch(`${GAMES_ROOT}/${path}.json?auth=${token}`, { method: "PATCH", body: JSON.stringify(value) }).then(r => r.json());
}
async function dbGet(path) {
  const token = await getFirebaseToken();
  return fetch(`${GAMES_ROOT}/${path}.json?auth=${token}`).then(r => r.json());
}
async function dbDelete(path) {
  const token = await getFirebaseToken();
  return fetch(`${GAMES_ROOT}/${path}.json?auth=${token}`, { method: "DELETE" }).then(r => r.json());
}

// Deletes all games older than 24 hours. Called silently on create/join so the DB
// self-cleans without needing Cloud Functions.
async function cleanupOldGames() {
  try {
    const CLEANUP_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
    const allGames = await dbGet('');
    if (!allGames || typeof allGames !== 'object') return;
    const cutoff = Date.now() - CLEANUP_AGE_MS;
    const staleIds = Object.entries(allGames)
      .filter(([, g]) => g && g.createdAt && g.createdAt < cutoff)
      .map(([id]) => id);
    await Promise.all(staleIds.map(id => dbDelete(id).catch(() => {})));
    if (staleIds.length) console.log(`[Cleanup] Deleted ${staleIds.length} old game(s):`, staleIds);
  } catch (e) {
    console.warn('[Cleanup] Could not clean old games', e);
  }
}

// ----------------------
// Storage helpers
async function storageGet(keys) { return new Promise(res => chrome.storage.local.get(keys, items => res(items))); }
async function storageSet(obj) { return new Promise(res => chrome.storage.local.set(obj, () => res())); }
async function storageRemove(keys) { return new Promise(res => chrome.storage.local.remove(keys, () => res())); }

// ----------------------
// Cross-origin fetch helper — routes through the background service worker to bypass CORS
function fetchViaBackground(url) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'FETCH_URL', url }, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && response.ok) {
        resolve(response.text);
      } else {
        reject(new Error(response?.error || 'Fetch failed'));
      }
    });
  });
}

// Parse Oracle of Bacon HTML response into a clean path array.
// The page renders a chain as a <table>: rows alternate actor / movie hops.
// Falls back to splitting the prose text on "was in" / "with".
// Parse Oracle of Bacon HTML response into a clean path array.
// Returns { path: [...] } on success, or { path: null, snippet } for diagnosis.
//
// The result chain uses Oracle of Bacon's own internal links:
//   actors → href contains "actorsearch"
//   movies → href contains "moviesearch"
// These only appear inside the actual result, never in genre filters or navigation.
function parseOraclePath(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // ── Strategy 1: internal result links (most reliable) ─────────────────
  const chainLinks = Array.from(doc.querySelectorAll(
    'a[href*="actorsearch"], a[href*="moviesearch"]'
  ));
  if (chainLinks.length >= 2) {
    const path = chainLinks
      .map(a => a.textContent.replace(/\s*\(\d{4}[^)]*\)/g, '').trim())
      .filter(name => name.length > 0);
    if (path.length >= 2) return { path };
  }

  // ── Strategy 2: find only the table that contains "was in" ─────────────
  // Genre filter tables never contain "was in", so this avoids hitting them.
  const tables = Array.from(doc.querySelectorAll('table'));
  for (const table of tables) {
    if (!table.textContent.includes('was in')) continue;
    const links = Array.from(table.querySelectorAll('td a'));
    if (links.length >= 2) {
      const path = links
        .map(a => a.textContent.replace(/\s*\(\d{4}[^)]*\)/g, '').trim())
        .filter(name => name.length > 0);
      if (path.length >= 2) return { path };
    }
  }

  // ── Fallback: return a raw snippet so the modal can show a diagnosis ────
  const snippet = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  return { path: null, snippet };
}

// ----------------------
// Dynamic actor list — fetched from IMDB's Most Popular People chart, cached for 7 days
async function fetchActorListFromIMDB() {
  const CACHE_KEY  = 'actorListCache';
  const CACHE_TTL  = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

  // Return cached list if it's still fresh
  try {
    const stored = await storageGet([CACHE_KEY]);
    const cache  = stored[CACHE_KEY];
    if (cache && cache.actors && cache.actors.length >= 20 && (Date.now() - cache.fetchedAt) < CACHE_TTL) {
      console.log(`[ActorList] Using cached list — ${cache.actors.length} actors, fetched ${Math.round((Date.now() - cache.fetchedAt) / 3_600_000)}h ago`);
      return cache.actors;
    }
  } catch (_) {}

  // Fetch fresh list from IMDB most popular people (server-rendered, parseable)
  try {
    console.log('[ActorList] Fetching fresh actor list from IMDB...');
    const res = await fetch('https://www.imdb.com/list/ls524618334/', {
      headers: { 'Accept': 'text/html,application/xhtml+xml' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const doc    = new DOMParser().parseFromString(html, 'text/html');
    const actors = [];
    const seen   = new Set();

    // IMDB search result links for name pages sit inside list items as ipc-title-link-wrapper anchors
    doc.querySelectorAll('a[href*="/name/nm"]').forEach(a => {
      const href  = a.getAttribute('href') || '';
      const match = href.match(/\/name\/(nm\d+)\//);
      if (!match) return;
      const nmId = match[1];
      if (seen.has(nmId)) return;

      // Name text lives in an <h3> child, or falls back to the anchor's own text
      const h3   = a.querySelector('h3');
      let   name = (h3 ? h3.textContent : a.textContent).trim();
      // Strip leading rank number "1. ", "42. " etc.
      name = name.replace(/^\d+\.\s*/, '').trim();
      if (!name || name.length < 2) return;

      seen.add(nmId);
      actors.push({ name, url: `https://www.imdb.com/name/${nmId}/` });
    });

    if (actors.length >= 20) {
      await storageSet({ [CACHE_KEY]: { actors, fetchedAt: Date.now() } });
      console.log(`[ActorList] Fetched and cached ${actors.length} actors from IMDB`);
      return actors;
    }

    console.warn(`[ActorList] Only parsed ${actors.length} actors — too few, falling back to static list`);
    return null;
  } catch (err) {
    console.warn('[ActorList] Fetch failed, using static fallback:', err.message);
    return null;
  }
}

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

// ----------------------
// UI overlay (reworked: includes name input + players list)
const uiBox = document.createElement("div");
uiBox.id = "uiOverlay"
document.body.appendChild(uiBox);

const header = document.createElement("div");
Object.assign(header.style, {
  fontWeight: "700",
  marginBottom: "8px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  cursor: "pointer",
  userSelect: "none",
});
const headerTitle = document.createElement("span");
headerTitle.textContent = "IMDB Competitive Click Race";
const collapseBtn = document.createElement("span");
collapseBtn.id = "collapseBtn";
Object.assign(collapseBtn.style, {
  fontSize: "16px", lineHeight: "1", marginLeft: "8px", flexShrink: "0",
});
header.appendChild(headerTitle);
header.appendChild(collapseBtn);
uiBox.appendChild(header);

// Panel content wrapper — everything except the header lives here
const panelContent = document.createElement("div");
panelContent.id = "panelContent";
uiBox.appendChild(panelContent);

// Collapse/expand logic
let _panelCollapsed = false;

function applyPanelCollapse(collapsed) {
  _panelCollapsed = collapsed;
  panelContent.style.display = collapsed ? "none" : "";
  collapseBtn.textContent = collapsed ? "▲" : "▼";
  // When collapsed override the fixed min-height so the box shrinks to just the header
  uiBox.style.minHeight = collapsed ? "0" : "";
  uiBox.style.maxHeight = collapsed ? "none" : "";
  storageSet({ panelCollapsed: collapsed });
}

header.addEventListener("click", () => applyPanelCollapse(!_panelCollapsed));

// Game info & target
const gameInfo = document.createElement("div");
gameInfo.style.marginBottom = "8px";
gameInfo.innerHTML = "Game: <em>Not in a game</em>";
panelContent.appendChild(gameInfo);

// Name row — click-to-edit: shows name + subtle hint in view mode, input + save in edit mode
const nameRow = document.createElement("div");
nameRow.style.marginTop = "8px";
panelContent.appendChild(nameRow);

// View mode: clickable name block
const nameDisplay = document.createElement("div");
Object.assign(nameDisplay.style, {
  cursor: "pointer",
  display: "inline-block",
});
nameRow.appendChild(nameDisplay);

// Inner name text (bigger)
const nameDisplayText = document.createElement("div");
Object.assign(nameDisplayText.style, {
  fontWeight: "700",
  fontSize: "15px",
  lineHeight: "1.2",
});
nameDisplay.appendChild(nameDisplayText);

// "Click to edit" hint beneath the name
const nameEditHint = document.createElement("div");
nameEditHint.textContent = "click to edit";
Object.assign(nameEditHint.style, {
  fontSize: "12px",
  opacity: "0.75",
  marginTop: "3px",
  fontStyle: "italic",
});
nameDisplay.appendChild(nameEditHint);

// Edit mode: text input
const nameInput = document.createElement("input");
nameInput.id = "nameInput";
nameInput.placeholder = "Display name (you)";
Object.assign(nameInput.style, {
  padding: "6px", width: "160px", marginBottom: "0", marginRight: "6px",
  display: "none", verticalAlign: "middle", fontSize: "13px",
  boxSizing: "border-box", border: "1px solid #ccc", borderRadius: "4px",
  lineHeight: "normal",
});
nameRow.appendChild(nameInput);

// Edit mode: Save button
const nameSaveBtn = document.createElement("button");
nameSaveBtn.textContent = "Save";
nameSaveBtn.id = "nameSaveBtn";
nameSaveBtn.className = "blue-button";
Object.assign(nameSaveBtn.style, { display: "none", verticalAlign: "middle", marginBottom: "0" });
nameRow.appendChild(nameSaveBtn);

// Kept for compatibility with any remaining references (hidden, never shown)
const nameEditBtn = document.createElement("button");
nameEditBtn.style.display = "none";
nameRow.appendChild(nameEditBtn);

// "Set name" button shown to first-time users who have no name yet
const setNameBtn = document.createElement("button");
setNameBtn.textContent = "Set name";
setNameBtn.className = "blue-button";
setNameBtn.style.display = "none";
nameRow.appendChild(setNameBtn);
setNameBtn.addEventListener("click", () => setNameEditMode(true));

// Helper: switch between view and edit mode
function setNameEditMode(editing) {
  const hasName = !!displayName;
  nameDisplay.style.display  = editing ? "none"         : (hasName ? "inline-block" : "none");
  setNameBtn.style.display   = editing ? "none"         : (hasName ? "none"         : "inline-block");
  nameInput.style.display    = editing ? "inline-block" : "none";
  nameSaveBtn.style.display  = editing ? "inline-block" : "none";
  if (editing) {
    nameInput.value = displayName || "";
    nameInput.focus();
  } else {
    nameDisplayText.textContent = displayName || "";
    // Show/hide the "click to edit" hint only when a name exists
    nameEditHint.style.display = hasName ? "" : "none";
  }
}

nameDisplay.addEventListener("click", () => setNameEditMode(true));

// Save on Enter key
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") nameSaveBtn.click();
});

// Global round timer (moved below nameRow and above players lobby list, left aligned)
const roundTimerDiv = document.createElement("div");
roundTimerDiv.id = "roundTimer";

// --- WINNER MESSAGE CONTAINER ---
const winnerBox = document.createElement("div");
winnerBox.id = "winnerbox";

// Container for the winner/leaderboard text
const winnerTextContainer = document.createElement("div");
winnerTextContainer.style.marginBottom = "15px";
winnerBox.appendChild(winnerTextContainer);

// Main winner text element (for 1st place)
const winnerText = document.createElement("div");
winnerText.id = "winnerText"
winnerTextContainer.appendChild(winnerText);

// Leaderboard list element (for 2nd, 3rd, etc. and Give Up players)
const leaderboardList = document.createElement("div");
leaderboardList.id = "leaderboardList";
winnerTextContainer.appendChild(leaderboardList);


// Optimal path inline section — auto-populated when a round finishes, lives inside winnerTextContainer
// so it appears between the leaderboard and Play Again, and survives leaderboard re-renders.
const optimalSection = document.createElement('div');
optimalSection.id = 'optimalSection';
Object.assign(optimalSection.style, {
  display: 'none',
  marginTop: '12px',
  padding: '10px 12px',
  background: 'rgba(0,0,0,0.25)',
  borderRadius: '6px',
  textAlign: 'left',
  fontSize: '13px',
});
winnerTextContainer.appendChild(optimalSection);

// Session standings — shown on the leaderboard after 2+ rounds have been played
const sessionStandingsDiv = document.createElement('div');
sessionStandingsDiv.id = 'sessionStandings';
Object.assign(sessionStandingsDiv.style, {
  display: 'none',
  marginTop: '12px',
  padding: '8px 10px',
  background: 'rgba(0,0,0,0.25)',
  borderRadius: '6px',
  fontSize: '12px',
  color: '#e0e0e0',
});
winnerBox.appendChild(sessionStandingsDiv);

// Play Again Button — larger and more prominent
const playAgainBtn = document.createElement("button");
playAgainBtn.textContent = "▶ Play Again";
playAgainBtn.className = "yellow-button";
Object.assign(playAgainBtn.style, {
  zIndex: "1000001",
  pointerEvents: "auto",
  fontSize: "16px",
  padding: "10px 24px",
  marginTop: "10px",
  fontWeight: "700",
});
winnerBox.appendChild(playAgainBtn);

// "Waiting for host" nudge — shown to guests after they click Play Again
const waitingForHostDiv = document.createElement('div');
waitingForHostDiv.style.cssText = 'display:none;font-size:12px;opacity:0.6;margin-top:6px;';
waitingForHostDiv.textContent = 'Waiting for host to start the next round…';
winnerBox.appendChild(waitingForHostDiv);

panelContent.appendChild(winnerBox); // Append winner box to the main UI box

// controls row (Create/Join)
const btnRow = document.createElement("div");
btnRow.style.marginTop = "16px";
btnRow.style.marginBottom = "8px";
panelContent.appendChild(btnRow);

const startBtn = document.createElement("button");
startBtn.textContent = "Create Game";
startBtn.className = "blue-button";
btnRow.appendChild(startBtn);

const joinBtn = document.createElement("button");
joinBtn.textContent = "Join Game";
joinBtn.className = "blue-button";
btnRow.appendChild(joinBtn);

// Action buttons (Leave/Give Up)
const actionRow = document.createElement("div");
actionRow.style.marginTop = "6px";
actionRow.style.display = "none";
panelContent.appendChild(actionRow);

// Give Up Button (New)
const giveUpBtn = document.createElement("button");
giveUpBtn.textContent = "Give Up";
giveUpBtn.id = "biveUpBtn"
giveUpBtn.className = "blue-button danger-button";
actionRow.appendChild(giveUpBtn);

// Copy Code Button (appended after Start Round — see below)
const copybtn = document.createElement("button");
copybtn.textContent = "Copy Game Code";
copybtn.id = 'copybtn';
copybtn.className = "blue-button"

// Copy Button code to copy code (non-blocking notice)
const copyNotice = document.createElement('div');
Object.assign(copyNotice.style, {
  marginTop: '3px',
  padding: '6px 6px',
  background: 'rgb(245, 197, 24)',
  color: '#000',
  borderRadius: '0px',
  fontSize: '12px',
  display: 'none',
  textAlign: 'left'
});
copyNotice.setAttribute('aria-live','polite');
actionRow.appendChild(copyNotice);

let copyNoticeTimeout = null;

copybtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(gameId || "");
    console.log("Game ID copied to clipboard:", gameId);

    // Change button text and color
    showCopyOnButton("Copied!", "green");
  } catch (err) {
    console.error("Failed to copy Game ID:", err);

    // Show error feedback on button
    showCopyOnButton("Failed!", "red");
  }
});

function showCopyOnButton(text, color) {
  // Save original state
  const originalText = copybtn.textContent;
  const originalColor = copybtn.style.backgroundColor;

  // Apply feedback
  copybtn.textContent = text;
  copybtn.style.backgroundColor = color;

  // Reset after 2 seconds
  setTimeout(() => {
    copybtn.textContent = originalText;
    copybtn.style.backgroundColor = originalColor;
  }, 2000);
}

// START ROUND button (host-only) — left, then Copy Game Code middle
const startRoundBtn = document.createElement("button");
startRoundBtn.textContent = "Start Round";
startRoundBtn.className = "blue-button";
actionRow.appendChild(startRoundBtn);
actionRow.appendChild(copybtn);

// Host setting: per-round time limit (seconds; 0 disables)
const timeLimitRow = document.createElement("div");
Object.assign(timeLimitRow.style, {
  display: "none",
  width: "100%",
  // Slightly tighter spacing vs the buttons above, while keeping space before "Leave Game"
  marginTop: "-6px",
  marginBottom: "12px",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: "6px",
  padding: "6px 8px",
  borderRadius: "8px",
  background: "rgba(255,255,255,0.12)",
});
actionRow.appendChild(timeLimitRow);

const timeLimitLabel = document.createElement("div");
timeLimitLabel.textContent = "Set round time limit";
Object.assign(timeLimitLabel.style, {
  fontSize: "13px",
  opacity: "1",
  flex: "1",
  whiteSpace: "pre-wrap",
  fontWeight: "800",
  color: "#000",
});
timeLimitRow.appendChild(timeLimitLabel);

const timeLimitHelper = document.createElement("div");
timeLimitHelper.textContent = "Players see a countdown during the round. If time runs out, the round ends.";
Object.assign(timeLimitHelper.style, {
  fontSize: "11px",
  opacity: "0.75",
  color: "#000",
  whiteSpace: "pre-wrap",
});
timeLimitRow.appendChild(timeLimitHelper);

const timeLimitSelect = document.createElement("select");
Object.assign(timeLimitSelect.style, {
  width: "100%",
  maxWidth: "220px",
  padding: "8px 10px",
  fontSize: "13px",
  borderRadius: "10px",
  border: "1px solid rgba(0,0,0,0.25)",
  outline: "none",
  background: "rgba(255,255,255,0.88)",
  color: "#000",
});

const timeLimitPresetsSec = [0, 300, 600, 900]; // 0 => no limit
const timeLimitPresetsLabel = {
  0: "No limit",
  300: "5 min",
  600: "10 min",
  900: "15 min",
};
timeLimitPresetsSec.forEach(sec => {
  const opt = document.createElement("option");
  opt.value = String(sec);
  opt.textContent = timeLimitPresetsLabel[sec];
  timeLimitSelect.appendChild(opt);
});
timeLimitSelect.value = String(hostRoundTimeLimitSec);
timeLimitRow.appendChild(timeLimitSelect);

timeLimitSelect.addEventListener("change", async () => {
  const sec = Number(timeLimitSelect.value);
  const allowed = [0, 300, 600, 900];
  hostRoundTimeLimitSec = allowed.includes(sec) ? sec : 300;
  timeLimitSelect.value = String(hostRoundTimeLimitSec);
  await storageSet({ roundTimeLimitSec: hostRoundTimeLimitSec });
});

startRoundBtn.addEventListener("click", async () => {
  if (!gameId) { alert("No active game"); return; }
  try {
    await startRound();
  } catch (err) {
    console.error("startRound failed", err);
    alert("Failed to start round.");
  }
});

const leaveBtn = document.createElement("button");
leaveBtn.textContent = "Leave Game";
leaveBtn.className = "blue-button danger-button";
actionRow.appendChild(leaveBtn);

// players list (lobby)
const lobbyBox = document.createElement("div");
lobbyBox.style.marginTop = "10px";
lobbyBox.style.padding = "8px";
lobbyBox.style.border = "1px solid rgba(0,0,0,0.08)";
lobbyBox.style.borderRadius = "6px";
lobbyBox.style.background = "rgba(0,0,0,0.02)";
lobbyBox.style.display = "none";
panelContent.appendChild(lobbyBox);

const lobbyTitle = document.createElement("div");
lobbyTitle.style.fontWeight = "600";
lobbyTitle.style.marginBottom = "6px";
lobbyTitle.textContent = "Lobby — Waiting for players";
lobbyBox.appendChild(lobbyTitle);

const playersList = document.createElement("div");
playersList.style.minHeight = "26px";
lobbyBox.appendChild(playersList);

// Session tally — compact win summary shown in lobby between rounds
const lobbyTallyDiv = document.createElement('div');
Object.assign(lobbyTallyDiv.style, {
  display: 'none', fontSize: '12px', marginTop: '8px',
  padding: '6px 8px', background: 'rgba(0,0,0,0.06)',
  borderRadius: '4px', color: '#333',
});
lobbyBox.appendChild(lobbyTallyDiv);

// Shown to guests in the lobby so they know what to do after clicking Play Again
const lobbyWaitingDiv = document.createElement('div');
Object.assign(lobbyWaitingDiv.style, {
  display: 'none', fontSize: '14px', fontWeight: '600',
  marginTop: '10px', color: '#000',
});
lobbyWaitingDiv.textContent = '⏳ Waiting for host to start the round…';
lobbyBox.appendChild(lobbyWaitingDiv);

// Insert the round timer below the nameRow and above lobbyBox
nameRow.after(roundTimerDiv);

// join controls (enter game id)
const joinRow = document.createElement("div");
joinRow.style.display = "none";
joinRow.style.marginTop = "8px";
panelContent.appendChild(joinRow);

const joinInput = document.createElement("input");
joinInput.placeholder = "Enter Game ID";
Object.assign(joinInput.style, { padding: "6px", width: "160px", marginRight: "6px" });
joinRow.appendChild(joinInput);

const joinSubmit = document.createElement("button");
joinSubmit.textContent = "Join";
joinSubmit.id = "joinSubmit";
joinSubmit.className = "blue-button";
joinRow.appendChild(joinSubmit);

// status text
const statusDiv = document.createElement("div");
statusDiv.style.whiteSpace = "pre-wrap";
statusDiv.style.marginTop = "8px";
statusDiv.style.fontSize = "15px";
statusDiv.style.fontWeight = "700";
panelContent.appendChild(statusDiv);

// hint
const hintDiv = document.createElement("div");
hintDiv.style.fontSize = "11px";
hintDiv.style.opacity = "100";
hintDiv.style.marginTop = "2px";
hintDiv.style.marginBottom = "12px";
hintDiv.innerHTML = "Create a game to generate an ID and enter the lobby. When 2 players are present the host can start the round.";
panelContent.appendChild(hintDiv);

// ----------------------
// RULES MODAL
// Add a Rules button at the bottom of the main modal which opens a secondary modal overlay
const rulesBtn = document.createElement("button");
rulesBtn.textContent = "Rules";
rulesBtn.className = "blue-button";
rulesBtn.style.marginTop = "12px";
panelContent.appendChild(rulesBtn);

// Create the overlay that will appear on top of everything
const rulesOverlay = document.createElement("div");
Object.assign(rulesOverlay.style, {
  position: "fixed",
  inset: "0",
  background: "rgba(0,0,0,0.5)",
  zIndex: 1000002,
  alignItems: "center",
  justifyContent: "center",
  padding: "10px",
  boxSizing: "border-box",
  display: "none" // ensure default is hidden and never shown automatically on load
});
rulesOverlay.setAttribute('aria-hidden', 'true');
rulesOverlay.setAttribute('role', 'dialog');
rulesOverlay.setAttribute('aria-modal', 'true');

// Inner rules box
const rulesBox = document.createElement("div");
Object.assign(rulesBox.style, {
  width: "420px",
  maxWidth: "100%",
  // match main modal golden styling
  background: "linear-gradient(295deg,rgba(110, 88, 10, 1) 0%, rgba(245, 197, 24, 1) 100%)",
  color: "#000", // black text like main UI
  borderRadius: "10px",
  padding: "16px",
  boxSizing: "border-box",
  boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
  textAlign: "left",
  fontSize: "14px",
  lineHeight: "1.4"
});
rulesOverlay.appendChild(rulesBox);

// Title
const rulesTitle = document.createElement("div");
rulesTitle.textContent = "Rules";
Object.assign(rulesTitle.style, {   fontFamily: "Arial, sans-serif", fontWeight: "700", fontSize: "16px", marginBottom: "8px", color: "#000" });
rulesBox.appendChild(rulesTitle);

// Rules content (ordered list)
const rulesContent = document.createElement("div");
rulesContent.innerHTML = `
<ol style="font-family: Arial, sans-serif; padding-left: 18px; margin: 0 0 10px 0; list-style-type: decimal;">
<li>Click through actors, movies and TV shows to reach the destination actor generated</li>
<li>Only the clicks on actors will be counted in the click counter</li>
<li>The player with the least actor clicks wins! If players are tied in click count then the player that reached the destination actor the fastest wins</li>
</ol>
`;
rulesBox.appendChild(rulesContent);

// Close button area
const rulesCloseRow = document.createElement("div");
Object.assign(rulesCloseRow.style, { textAlign: "right", fontFamily: "Arial, sans-serif", marginTop: "10px" });
const rulesCloseBtn = document.createElement("button");
rulesCloseBtn.textContent = "Close";
rulesCloseBtn.className = "blue-button";
rulesCloseRow.appendChild(rulesCloseBtn);
rulesBox.appendChild(rulesCloseRow);

// Append to body so it overlays the entire page (including the uiBox)
document.body.appendChild(rulesOverlay);

// Open / close handlers
function openRulesModal() {
  rulesOverlay.style.display = "flex";
  rulesOverlay.setAttribute('aria-hidden', 'false');
  // trap focus to close button for accessibility
  rulesCloseBtn.focus();
  // prevent background scrolling while modal is open
  document.body.style.overflow = "hidden";
}
function closeRulesModal() {
  rulesOverlay.style.display = "none";
  rulesOverlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = "";
  // return focus to the rules button
  rulesBtn.focus();
}

rulesBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  openRulesModal();
});

rulesCloseBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  closeRulesModal();
});

// close when clicking outside the rules box
rulesOverlay.addEventListener("click", (e) => {
  if (e.target === rulesOverlay) {
    closeRulesModal();
  }
});

// close on Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && rulesOverlay.style.display === "flex") {
    closeRulesModal();
  }
});

// ----------------------
// DEBUG PANEL — Shift+click the header to open
// Lets you toggle between the dynamic IMDB list and the static actors.js fallback.

const debugOverlay = document.createElement('div');
Object.assign(debugOverlay.style, {
  position: 'fixed', inset: '0',
  background: 'rgba(0,0,0,0.6)',
  zIndex: '1000003',
  display: 'none',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '10px',
  boxSizing: 'border-box',
});
document.body.appendChild(debugOverlay);

const debugBox = document.createElement('div');
Object.assign(debugBox.style, {
  width: '380px', maxWidth: '100%',
  background: '#1a1a2e',
  color: '#e0e0e0',
  borderRadius: '10px',
  padding: '16px',
  boxSizing: 'border-box',
  boxShadow: '0 6px 24px rgba(0,0,0,0.6)',
  fontSize: '13px',
  lineHeight: '1.5',
  fontFamily: 'monospace',
});
debugOverlay.appendChild(debugBox);

const debugTitle = document.createElement('div');
debugTitle.textContent = '⚙ Actor List Debug';
Object.assign(debugTitle.style, { fontWeight: '700', fontSize: '15px', marginBottom: '12px', color: '#f5c518' });
debugBox.appendChild(debugTitle);

const debugSourceLine = document.createElement('div');
debugSourceLine.style.marginBottom = '8px';
debugBox.appendChild(debugSourceLine);

const debugCacheLine = document.createElement('div');
debugCacheLine.style.marginBottom = '12px';
debugCacheLine.style.opacity = '0.7';
debugCacheLine.style.fontSize = '12px';
debugBox.appendChild(debugCacheLine);

const debugToggleBtn = document.createElement('button');
debugToggleBtn.className = 'blue-button';
debugToggleBtn.style.marginRight = '8px';
debugBox.appendChild(debugToggleBtn);

const debugClearCacheBtn = document.createElement('button');
debugClearCacheBtn.textContent = 'Clear Cache & Re-fetch';
debugClearCacheBtn.className = 'blue-button';
debugBox.appendChild(debugClearCacheBtn);

// ── Fixed Actor Pair ──────────────────────────────────────────
const debugDivider1 = document.createElement('hr');
Object.assign(debugDivider1.style, { border: 'none', borderTop: '1px solid rgba(255,255,255,0.12)', margin: '12px 0' });
debugBox.appendChild(debugDivider1);

const debugPairTitle = document.createElement('div');
debugPairTitle.textContent = 'Fixed Actor Pair';
Object.assign(debugPairTitle.style, { fontWeight: '700', marginBottom: '6px', color: '#f5c518' });
debugBox.appendChild(debugPairTitle);

const debugPairStatus = document.createElement('div');
Object.assign(debugPairStatus.style, { fontSize: '12px', marginBottom: '8px', opacity: '0.75' });
debugBox.appendChild(debugPairStatus);

const selectStyle = { width: '100%', marginBottom: '6px', padding: '4px', background: '#2a2a4a', color: '#e0e0e0', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', fontSize: '12px', boxSizing: 'border-box' };

const debugPairLabelA = document.createElement('div');
debugPairLabelA.textContent = 'Actor A (start):';
debugPairLabelA.style.fontSize = '11px';
debugPairLabelA.style.opacity = '0.65';
debugBox.appendChild(debugPairLabelA);

const debugActorASelect = document.createElement('select');
Object.assign(debugActorASelect.style, selectStyle);
debugBox.appendChild(debugActorASelect);

const debugPairLabelB = document.createElement('div');
debugPairLabelB.textContent = 'Actor B (destination):';
debugPairLabelB.style.fontSize = '11px';
debugPairLabelB.style.opacity = '0.65';
debugBox.appendChild(debugPairLabelB);

const debugActorBSelect = document.createElement('select');
Object.assign(debugActorBSelect.style, selectStyle);
debugBox.appendChild(debugActorBSelect);

const debugPairBtnRow = document.createElement('div');
debugPairBtnRow.style.marginTop = '4px';
debugBox.appendChild(debugPairBtnRow);

const debugLockPairBtn = document.createElement('button');
debugLockPairBtn.textContent = 'Lock This Pair';
debugLockPairBtn.className = 'blue-button';
debugLockPairBtn.style.marginRight = '6px';
debugPairBtnRow.appendChild(debugLockPairBtn);

const debugClearPairBtn = document.createElement('button');
debugClearPairBtn.textContent = 'Clear Lock';
debugClearPairBtn.className = 'blue-button';
debugPairBtnRow.appendChild(debugClearPairBtn);

// ── Loaded Actors Preview ─────────────────────────────────────
const debugDivider2 = document.createElement('hr');
Object.assign(debugDivider2.style, { border: 'none', borderTop: '1px solid rgba(255,255,255,0.12)', margin: '12px 0' });
debugBox.appendChild(debugDivider2);

const debugPreviewTitle = document.createElement('div');
debugPreviewTitle.textContent = 'Loaded Actors';
Object.assign(debugPreviewTitle.style, { fontWeight: '700', marginBottom: '6px', color: '#f5c518' });
debugBox.appendChild(debugPreviewTitle);

const debugPreviewCountLine = document.createElement('div');
Object.assign(debugPreviewCountLine.style, { fontSize: '12px', marginBottom: '6px', opacity: '0.75' });
debugBox.appendChild(debugPreviewCountLine);

const debugPreviewToggleBtn = document.createElement('button');
debugPreviewToggleBtn.textContent = 'Show Actor List';
debugPreviewToggleBtn.className = 'blue-button';
debugBox.appendChild(debugPreviewToggleBtn);

const debugActorsList = document.createElement('div');
Object.assign(debugActorsList.style, {
  display: 'none', maxHeight: '180px', overflowY: 'auto',
  marginTop: '8px', fontSize: '12px', lineHeight: '1.8',
  background: 'rgba(0,0,0,0.3)', borderRadius: '4px', padding: '6px 8px',
});
debugBox.appendChild(debugActorsList);

debugPreviewToggleBtn.addEventListener('click', () => {
  const isVisible = debugActorsList.style.display !== 'none';
  debugActorsList.style.display = isVisible ? 'none' : 'block';
  debugPreviewToggleBtn.textContent = isVisible ? 'Show Actor List' : 'Hide Actor List';
});

// ── Testing Tools ─────────────────────────────────────────────
const debugDivider3 = document.createElement('hr');
Object.assign(debugDivider3.style, { border: 'none', borderTop: '1px solid rgba(255,255,255,0.12)', margin: '12px 0' });
debugBox.appendChild(debugDivider3);

const debugTestTitle = document.createElement('div');
debugTestTitle.textContent = 'Testing Tools';
Object.assign(debugTestTitle.style, { fontWeight: '700', marginBottom: '8px', color: '#f5c518' });
debugBox.appendChild(debugTestTitle);

// Jump to Destination button
const debugJumpBtn = document.createElement('button');
debugJumpBtn.textContent = 'Jump to Destination';
debugJumpBtn.className = 'blue-button';
debugJumpBtn.style.marginBottom = '10px';
debugBox.appendChild(debugJumpBtn);
debugJumpBtn.addEventListener('click', () => {
  const dest = actorPair?.[1];
  if (dest?.url) {
    window.location.href = dest.url;
  } else {
    alert('No active round destination set.');
  }
});

// Mini actor search
const debugSearchLabel = document.createElement('div');
debugSearchLabel.textContent = 'Jump to actor:';
Object.assign(debugSearchLabel.style, { fontSize: '11px', opacity: '0.65', marginBottom: '4px' });
debugBox.appendChild(debugSearchLabel);

const debugSearchInput = document.createElement('input');
debugSearchInput.placeholder = 'Type actor name…';
Object.assign(debugSearchInput.style, {
  padding: '5px', width: '100%', marginBottom: '4px',
  background: '#2a2a4a', color: '#e0e0e0',
  border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px',
  fontSize: '12px', boxSizing: 'border-box',
});
debugBox.appendChild(debugSearchInput);

const debugSearchResults = document.createElement('div');
Object.assign(debugSearchResults.style, {
  maxHeight: '130px', overflowY: 'auto',
  background: 'rgba(0,0,0,0.3)', borderRadius: '4px',
  fontSize: '12px', display: 'none',
});
debugBox.appendChild(debugSearchResults);

debugSearchInput.addEventListener('input', () => {
  const q = debugSearchInput.value.trim().toLowerCase();
  debugSearchResults.innerHTML = '';
  if (!q) { debugSearchResults.style.display = 'none'; return; }
  const matches = actorList.filter(a => a.name.toLowerCase().includes(q)).slice(0, 8);
  if (matches.length === 0) { debugSearchResults.style.display = 'none'; return; }
  matches.forEach(actor => {
    const row = document.createElement('div');
    Object.assign(row.style, {
      padding: '5px 8px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.07)',
    });
    row.textContent = actor.name;
    row.addEventListener('mouseenter', () => row.style.background = 'rgba(255,255,255,0.1)');
    row.addEventListener('mouseleave', () => row.style.background = '');
    row.addEventListener('click', () => { window.location.href = actor.url; });
    debugSearchResults.appendChild(row);
  });
  debugSearchResults.style.display = 'block';
});

// ── Close ────────────────────────────────────────────────────
const debugCloseBtn = document.createElement('button');
debugCloseBtn.textContent = 'Close';
debugCloseBtn.className = 'yellow-button';
Object.assign(debugCloseBtn.style, { display: 'block', marginTop: '12px' });
debugBox.appendChild(debugCloseBtn);

async function refreshDebugPanel() {
  const prefs = await storageGet(['actorListSource', 'actorListCache', 'lockedActorPair']);
  const source = prefs.actorListSource || 'static';
  const cache  = prefs.actorListCache;
  const locked = prefs.lockedActorPair;

  // ── Source section ──
  debugSourceLine.innerHTML =
    `<strong>Active source:</strong> ${source === 'static'
      ? 'Static <code>actors.js</code>'
      : 'Dynamic IMDB list'}`;

  debugToggleBtn.textContent = source === 'static'
    ? 'Switch to Dynamic IMDB'
    : 'Switch to Static actors.js';

  if (source === 'dynamic') {
    if (cache && cache.fetchedAt) {
      const age  = Math.round((Date.now() - cache.fetchedAt) / 3_600_000);
      const next = Math.max(0, Math.round((7 * 24) - age));
      debugCacheLine.textContent =
        `Cache: ${cache.actors?.length ?? 0} actors · fetched ${age}h ago · refreshes in ~${next}h`;
    } else {
      debugCacheLine.textContent = 'Cache: empty — will fetch on next reload';
    }
    debugClearCacheBtn.style.display = 'inline-block';
  } else {
    debugCacheLine.textContent = `Static list: ${STATIC_ACTOR_LIST.length} actors in actors.js`;
    debugClearCacheBtn.style.display = 'none';
  }

  // ── Fixed pair section ──
  // Populate selects from current actorList
  const currentAVal = debugActorASelect.value;
  const currentBVal = debugActorBSelect.value;
  debugActorASelect.innerHTML = '';
  debugActorBSelect.innerHTML = '';
  actorList.forEach((actor, i) => {
    const optA = document.createElement('option');
    optA.value = i;
    optA.textContent = actor.name;
    debugActorASelect.appendChild(optA);

    const optB = document.createElement('option');
    optB.value = i;
    optB.textContent = actor.name;
    debugActorBSelect.appendChild(optB);
  });
  // Restore previous selection if still valid
  if (currentAVal && debugActorASelect.options[currentAVal]) debugActorASelect.value = currentAVal;
  if (currentBVal && debugActorBSelect.options[currentBVal]) debugActorBSelect.value = currentBVal;
  // Default B to second actor so A ≠ B
  if (debugActorBSelect.value === debugActorASelect.value && actorList.length > 1) {
    debugActorBSelect.value = '1';
  }

  if (locked) {
    debugPairStatus.innerHTML = `Locked: <strong>${locked.actorA.name}</strong> → <strong>${locked.actorB.name}</strong>`;
    debugPairStatus.style.color = '#4ade80';
    debugClearPairBtn.style.display = 'inline-block';
  } else {
    debugPairStatus.textContent = 'No pair locked — rounds use random selection';
    debugPairStatus.style.color = '';
    debugClearPairBtn.style.display = 'none';
  }

  // ── Actor preview count ──
  debugPreviewCountLine.textContent = `${actorList.length} actors currently loaded`;
  // Rebuild preview list
  debugActorsList.innerHTML = actorList
    .map((a, i) => `<div style="opacity:0.85">${i + 1}. ${a.name}</div>`)
    .join('');
}

function openDebugPanel() {
  refreshDebugPanel();
  debugOverlay.style.display = 'flex';
}
function closeDebugPanel() {
  debugOverlay.style.display = 'none';
}

debugToggleBtn.addEventListener('click', async () => {
  const prefs  = await storageGet(['actorListSource']);
  const current = prefs.actorListSource || 'static';
  const next    = current === 'static' ? 'dynamic' : 'static';
  await storageSet({ actorListSource: next });
  await refreshDebugPanel();
  // Apply immediately without a full reload
  if (next === 'static') {
    actorList = STATIC_ACTOR_LIST;
  } else {
    const fetched = await fetchActorListFromIMDB();
    if (fetched && fetched.length >= 20) actorList = fetched;
    else actorList = STATIC_ACTOR_LIST;
  }
  debugSourceLine.insertAdjacentHTML('beforeend',
    ` <span style="color:#4ade80">✓ applied (${actorList.length} actors loaded)</span>`);
});

debugClearCacheBtn.addEventListener('click', async () => {
  await storageRemove(['actorListCache']);
  debugCacheLine.textContent = 'Cache cleared — fetching fresh list…';
  const fetched = await fetchActorListFromIMDB();
  if (fetched && fetched.length >= 20) {
    actorList = fetched;
    debugCacheLine.textContent = `Fresh list loaded — ${actorList.length} actors`;
  } else {
    debugCacheLine.textContent = 'Fetch failed — static fallback in use';
  }
  refreshDebugPanel();
});

debugLockPairBtn.addEventListener('click', async () => {
  const idxA = parseInt(debugActorASelect.value, 10);
  const idxB = parseInt(debugActorBSelect.value, 10);
  if (idxA === idxB) {
    debugPairStatus.textContent = '⚠ Actor A and B must be different';
    debugPairStatus.style.color = '#f87171';
    return;
  }
  const pair = { actorA: actorList[idxA], actorB: actorList[idxB] };
  await storageSet({ lockedActorPair: pair });
  await refreshDebugPanel();
});

debugClearPairBtn.addEventListener('click', async () => {
  await storageRemove(['lockedActorPair']);
  await refreshDebugPanel();
});

debugCloseBtn.addEventListener('click', closeDebugPanel);
debugOverlay.addEventListener('click', e => { if (e.target === debugOverlay) closeDebugPanel(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && debugOverlay.style.display === 'flex') closeDebugPanel();
});

// Password prompt for debug panel
function promptDebugPassword(onSuccess) {
  const pwOverlay = document.createElement('div');
  Object.assign(pwOverlay.style, {
    position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
    background: 'rgba(0,0,0,0.6)', zIndex: '2147483646',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  });
  const pwBox = document.createElement('div');
  Object.assign(pwBox.style, {
    background: '#1a1a2e', border: '1px solid #3E49AD', borderRadius: '10px',
    padding: '20px 24px', minWidth: '240px', color: '#fff',
    fontFamily: 'Arial, sans-serif', boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
    display: 'flex', flexDirection: 'column', gap: '10px',
  });
  const pwTitle = document.createElement('div');
  pwTitle.textContent = '🔒 Debug Access';
  Object.assign(pwTitle.style, { fontWeight: '700', fontSize: '15px', color: '#f5c518' });
  const pwInput = document.createElement('input');
  pwInput.type = 'password';
  pwInput.placeholder = 'Enter password…';
  Object.assign(pwInput.style, {
    padding: '7px 10px', borderRadius: '5px', border: '1px solid #3E49AD',
    background: '#0d0d1a', color: '#fff', fontSize: '14px', outline: 'none',
  });
  const pwError = document.createElement('div');
  Object.assign(pwError.style, { color: '#f87171', fontSize: '12px', display: 'none' });
  pwError.textContent = 'Incorrect password.';
  const pwBtnRow = document.createElement('div');
  Object.assign(pwBtnRow.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end' });
  const pwCancelBtn = document.createElement('button');
  pwCancelBtn.textContent = 'Cancel';
  pwCancelBtn.className = 'yellow-button';
  Object.assign(pwCancelBtn.style, { margin: '0' });
  const pwOkBtn = document.createElement('button');
  pwOkBtn.textContent = 'Unlock';
  pwOkBtn.className = 'blue-button';
  Object.assign(pwOkBtn.style, { margin: '0' });
  pwBtnRow.appendChild(pwCancelBtn);
  pwBtnRow.appendChild(pwOkBtn);
  pwBox.appendChild(pwTitle);
  pwBox.appendChild(pwInput);
  pwBox.appendChild(pwError);
  pwBox.appendChild(pwBtnRow);
  pwOverlay.appendChild(pwBox);
  document.documentElement.appendChild(pwOverlay);
  setTimeout(() => pwInput.focus(), 50);
  const dismiss = () => pwOverlay.remove();
  pwCancelBtn.addEventListener('click', dismiss);
  pwOverlay.addEventListener('click', e => { if (e.target === pwOverlay) dismiss(); });
  const attempt = () => {
    if (pwInput.value === 'sebastio') { dismiss(); onSuccess(); }
    else { pwError.style.display = 'block'; pwInput.value = ''; pwInput.focus(); }
  };
  pwOkBtn.addEventListener('click', attempt);
  pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); if (e.key === 'Escape') dismiss(); });
}

// Shift+click the header to open debug panel (password protected)
header.addEventListener('click', (e) => {
  if (e.shiftKey) {
    e.stopPropagation();
    if (_panelCollapsed) applyPanelCollapse(false);
    promptDebugPassword(() => openDebugPanel());
  }
});

// ----------------------
// OPTIMAL PATH MODAL — fetches and displays the Oracle of Bacon shortest path
const optimalOverlay = document.createElement('div');
Object.assign(optimalOverlay.style, {
  position: 'fixed', inset: '0',
  background: 'rgba(0,0,0,0.6)',
  zIndex: '1000004',
  display: 'none',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '10px',
  boxSizing: 'border-box',
});
document.body.appendChild(optimalOverlay);

const optimalBox = document.createElement('div');
Object.assign(optimalBox.style, {
  width: '380px', maxWidth: '100%',
  background: '#1a1a2e',
  color: '#e0e0e0',
  borderRadius: '10px',
  padding: '16px',
  boxSizing: 'border-box',
  boxShadow: '0 6px 24px rgba(0,0,0,0.6)',
  fontSize: '13px',
  lineHeight: '1.6',
  fontFamily: 'Arial, sans-serif',
});
optimalOverlay.appendChild(optimalBox);

const optimalTitle = document.createElement('div');
Object.assign(optimalTitle.style, { fontWeight: '700', fontSize: '15px', marginBottom: '4px', color: '#f5c518' });
optimalTitle.textContent = 'Fastest Route';
optimalBox.appendChild(optimalTitle);

const optimalSubtitle = document.createElement('div');
Object.assign(optimalSubtitle.style, { fontSize: '15px', opacity: '1', marginBottom: '14px' });
optimalSubtitle.textContent = 'Shortest possible route';
optimalBox.appendChild(optimalSubtitle);

const optimalContent = document.createElement('div');
optimalBox.appendChild(optimalContent);

const optimalFallbackLink = document.createElement('a');
optimalFallbackLink.target = '_blank';
optimalFallbackLink.rel = 'noopener noreferrer';
optimalFallbackLink.textContent = 'View on Oracle of Bacon ↗';
Object.assign(optimalFallbackLink.style, {
  display: 'none', fontSize: '11px', color: '#93c5fd',
  textDecoration: 'underline', marginTop: '10px',
});
optimalBox.appendChild(optimalFallbackLink);

const optimalCloseBtn = document.createElement('button');
optimalCloseBtn.textContent = 'Close';
optimalCloseBtn.className = 'yellow-button';
Object.assign(optimalCloseBtn.style, { display: 'block', marginTop: '14px' });
optimalBox.appendChild(optimalCloseBtn);

optimalCloseBtn.addEventListener('click', () => { optimalOverlay.style.display = 'none'; });
optimalOverlay.addEventListener('click', e => { if (e.target === optimalOverlay) optimalOverlay.style.display = 'none'; });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && optimalOverlay.style.display === 'flex') optimalOverlay.style.display = 'none'; });

async function showOptimalPath(actorAName, actorBName) {
  const oracleUrl = `https://oracleofbacon.org/movielinks.php?a=${encodeURIComponent(actorAName)}&b=${encodeURIComponent(actorBName)}`;

  // Set fallback link regardless of parse outcome
  optimalFallbackLink.href = oracleUrl;
  optimalFallbackLink.style.display = 'none';
  optimalContent.innerHTML = '<span style="opacity:0.6">Fetching optimal path…</span>';
  optimalOverlay.style.display = 'flex';

  try {
    const html = await fetchViaBackground(oracleUrl);
    const { path, snippet } = parseOraclePath(html);

    if (path && path.length >= 2) {
      // Render color-coded path: even indices = actors (white), odd = titles (blue), last = gold
      // Only actor clicks count — actors are at even indices (0=start, 2, 4…),
      // so actor clicks = number of even-index entries minus the start = floor(length / 2)
      const actorClicks = Math.floor(path.length / 2);
      const hopLabel = `${actorClicks} actor click${actorClicks !== 1 ? 's' : ''}`;
      optimalContent.innerHTML = `
        <div style="font-size:14px;font-weight:600;opacity:0.8;margin-bottom:10px;">${hopLabel} minimum</div>
        <div style="font-size:14px;line-height:2;word-break:break-word;
                    background:rgba(0,0,0,0.25);border-radius:4px;padding:10px 12px;">
          ${path.map((name, i) => {
            if (i === 0 || i === path.length - 1) return `<strong style="color:#f5c518">${name}</strong>`;
            const color = i % 2 === 1 ? '#93c5fd' : '#ffffff';
            return `<span style="color:${color}">${name}</span>`;
          }).join(' <span style="opacity:0.35">→</span> ')}
        </div>`;
      optimalFallbackLink.style.display = 'inline-block';
    } else {
      // Parsing failed — show the raw page snippet so we can diagnose the structure
      const safeSnippet = (snippet || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      optimalContent.innerHTML = `
        <div style="opacity:0.75;font-size:12px;margin-bottom:8px;">
          Couldn't parse the result automatically. Raw page text below —
          please share this with the developer to fix the parser:
        </div>
        <div style="font-size:10px;line-height:1.5;word-break:break-all;
                    background:rgba(0,0,0,0.3);border-radius:4px;padding:6px 8px;
                    max-height:140px;overflow-y:auto;opacity:0.7;">${safeSnippet}</div>`;
      optimalFallbackLink.style.display = 'inline-block';
    }
  } catch (err) {
    optimalContent.innerHTML = `<div style="color:#f87171;font-size:12px;">
      Failed to fetch: ${err.message}
    </div>`;
    optimalFallbackLink.style.display = 'inline-block';
  }
}

// ----------------------
// Inline optimal path — renders the Oracle of Bacon result directly inside the winner box.
// Cached per-round by optimalPathRoundKey so the fetch only fires once.
function renderOptimalSection() {
  if (!optimalPathResult) {
    optimalSection.style.display = 'none';
    return;
  }
  optimalSection.style.display = 'block';

  if (optimalPathResult === 'loading') {
    optimalSection.innerHTML = '<div style="opacity:0.6;font-size:12px;">Fetching optimal path via Oracle of Bacon…</div>';
    return;
  }

  const { path, actorClicks, error } = optimalPathResult;

  if (path && path.length >= 2) {
    const hopLabel = `${actorClicks} actor click${actorClicks !== 1 ? 's' : ''} minimum`;
    const pathHtml = path.map((name, i) => {
      if (i === 0 || i === path.length - 1) return `<strong style="color:#f5c518">${name}</strong>`;
      const color = i % 2 === 1 ? '#93c5fd' : '#ffffff';
      return `<span style="color:${color}">${name}</span>`;
    }).join(' <span style="opacity:0.4">→</span> ');

    optimalSection.innerHTML = `
      <div style="font-weight:700;font-size:13px;color:#f5c518;margin-bottom:6px;">Fastest Route</div>
      <div style="font-weight:800;font-size:20px;color:#fff;line-height:1.1;margin-bottom:6px;">${hopLabel}</div>
      <div style="font-size:13px;line-height:2;word-break:break-word;background:rgba(0,0,0,0.2);border-radius:4px;padding:8px 10px;">${pathHtml}</div>`;
  } else {
    // No path found or parse failed — hide the section entirely
    optimalSection.style.display = 'none';
  }
}

async function fetchAndShowInlineOptimalPath(actorAName, actorBName, roundKey) {
  // Already have a result for this round — just re-render (handles poll re-renders)
  if (optimalPathRoundKey === roundKey && optimalPathResult !== null) {
    renderOptimalSection();
    return;
  }

  // New round: start a fresh fetch
  optimalPathRoundKey = roundKey;
  optimalPathResult = 'loading';
  renderOptimalSection();

  const oracleUrl = `https://oracleofbacon.org/movielinks.php?a=${encodeURIComponent(actorAName)}&b=${encodeURIComponent(actorBName)}`;

  try {
    const html = await fetchViaBackground(oracleUrl);
    const { path, snippet } = parseOraclePath(html);

    if (path && path.length >= 2) {
      // Oracle of Bacon returns the chain from b→a; reverse so it reads start→destination
      const orderedPath = [...path].reverse();
      const actorClicks = Math.floor(orderedPath.length / 2);
      optimalPathResult = { path: orderedPath, actorClicks, oracleUrl };
    } else {
      optimalPathResult = { error: snippet || 'Could not parse result', oracleUrl };
    }
  } catch (err) {
    optimalPathResult = { error: err.message, oracleUrl };
  }

  renderOptimalSection();
}

// ----------------------
// Initialization
(async function init() {
  try {
    // Load actor list — respects the debug toggle (actorListSource: 'dynamic' | 'static')
    const sourcePrefs = await storageGet(['actorListSource']);
    const actorListSource = sourcePrefs.actorListSource || 'static';
    if (actorListSource === 'static') {
      actorList = STATIC_ACTOR_LIST;
      console.log(`[ActorList] Using static actors.js list — ${actorList.length} actors (manually selected)`);
    } else {
      const dynamicList = await fetchActorListFromIMDB();
      if (dynamicList && dynamicList.length >= 20) {
        actorList = dynamicList;
        console.log(`[ActorList] Dynamic IMDB list active — ${actorList.length} actors`);
      } else {
        console.log(`[ActorList] Dynamic fetch failed, using static fallback — ${actorList.length} actors`);
      }
    }

    const stored = await storageGet(['playerId', 'gameId', 'actorPair', 'clicks', 'displayName', 'role', 'hasRedirected', 'finished', 'roundStartedAt', 'lastReadyAt', 'clickPath', 'panelCollapsed', 'roundTimeLimitSec']);
    // Restore collapsed state before anything else renders
    if (stored.panelCollapsed) applyPanelCollapse(true);
    else applyPanelCollapse(false);
    if (stored.playerId) playerId = stored.playerId;
    else {
      playerId = randId(6);
      await storageSet({ playerId });
    }

    displayName = stored.displayName || null;
    // Start in edit mode if no name saved yet, otherwise view mode
    setNameEditMode(!displayName);
    if (!displayName) displayName = `Player-${playerId}`;

    if (stored.role) role = stored.role;
    if (stored.hasRedirected) hasRedirected = stored.hasRedirected;
    if (stored.finished) finished = stored.finished;
    if (stored.roundStartedAt) roundStartedAt = stored.roundStartedAt;
    if (stored.lastReadyAt) lastReadyAt = stored.lastReadyAt;
    if (stored.clickPath) clickPath = stored.clickPath;
    if (stored.roundTimeLimitSec !== undefined) {
      let sec = Number(stored.roundTimeLimitSec);
      if (!Number.isFinite(sec)) sec = 0;
      sec = Math.max(0, Math.floor(sec));

      const allowed = [0, 300, 600, 900];
      if (allowed.includes(sec)) {
        hostRoundTimeLimitSec = sec;
      } else {
        // Snap unknown values to the nearest preset seconds
        let best = 600;
        let bestDist = Infinity;
        for (const a of allowed) {
          const d = Math.abs(sec - a);
          if (d < bestDist) { bestDist = d; best = a; }
        }
        hostRoundTimeLimitSec = best;
      }

      if (timeLimitSelect) timeLimitSelect.value = String(hostRoundTimeLimitSec);
    }

    // Title page tracking: if the player navigated to a movie/TV show page mid-round,
    // record its name in the click path. document.title is server-rendered and reliable.
    if (window.location.pathname.startsWith('/title/')) {
      if (stored.gameId && !stored.finished) {
        // Strip " - IMDb" suffix to get a clean title, e.g. "Gladiator (2000)"
        const rawTitle = document.title.replace(/\s*[-–]\s*IMDb\s*$/i, '').trim();
        if (rawTitle && clickPath[clickPath.length - 1] !== rawTitle) {
          clickPath.push(rawTitle);
          await storageSet({ clickPath });
        }
      }
    }

    if (stored.gameId) {
      // Validate the stored session before rejoining — clear it if the game is stale or over
      let sessionValid = false;
      let snap = null; // hoisted so it's accessible outside the try block
      try {
        snap = await dbGet(stored.gameId);
        const now = Date.now();
        const STALE_ROUND_MS = 30 * 60 * 1000;       // 30 minutes per round
        const STALE_GAME_MS  = 24 * 60 * 60 * 1000;  // 24 hours for the whole game
        const stale =
          !snap ||
          snap.status === 'expired' ||
          (snap.players?.[stored.playerId]?.gaveUp === true) ||
          (snap.status === 'active' && snap.startedAt && (now - snap.startedAt) > STALE_ROUND_MS) ||
          (snap.createdAt && (now - snap.createdAt) > STALE_GAME_MS);
        if (stale) {
          await storageRemove(['gameId', 'actorPair', 'clicks', 'role', 'hasRedirected', 'finished', 'lastReadyAt', 'roundStartedAt', 'clickPath']);
        } else {
          sessionValid = true;
        }
      } catch (err) {
        sessionValid = true; // can't validate — rejoin as before
      }
      if (sessionValid) {
        gameId = stored.gameId;
        actorPair = stored.actorPair || null;
        clicks = stored.clicks || 0;
        startPolling();

        // Page-load win check: handles navigation via debug tools (or direct URL entry)
        // where no click event fires. If we're already on actor B's page and the round
        // is active, record the finish exactly as the click handler would.
        if (!finished && actorPair && snap?.status === 'active' && window.location.pathname.startsWith('/name/')) {
          const targetUrl = actorPair[1]?.url?.replace(/\/$/, '');
          const currentUrl = window.location.href.split('?')[0].replace(/\/$/, '');
          if (targetUrl && currentUrl.startsWith(targetUrl)) {
            const finishedAt = Date.now();
            // Add actor B to clickPath if not already the last entry
            const actorBName = actorPair[1].name;
            if (clickPath[clickPath.length - 1] !== actorBName) {
              clickPath.push(actorBName);
            }
            await dbPatch(`${gameId}/players/${playerId}`, { clicks, finishedAt, name: displayName, gaveUp: false, clickPath });
            finished = true;
            await storageSet({ clicks, finished, clickPath });
          }
        }
      }
    }
    refreshStatusUI();
    updateGameControls();
    console.log("IMDB Click Race initialized", { playerId, displayName, hasRedirected, finished, roundStartedAt, lastReadyAt, gameId });
  } catch (err) {
    console.error("Init error", err);
  }
})();

// ----------------------
// Finish toast — briefly shown when another player completes the round
function showFinishToast(playerName, clicks) {
  const toast = document.createElement('div');
  toast.textContent = `${playerName} just finished — ${clicks} click${clicks === 1 ? '' : 's'}!`;
  // Use cssText to ensure IMDB CSS cannot interfere
  toast.style.cssText = [
    'position: fixed',
    'top: 50%',
    'left: 50%',
    'transform: translate(-50%, -50%)',
    'background: #222',
    'color: #fff',
    'padding: 16px 28px',
    'border-radius: 8px',
    'font-size: 18px',
    'font-family: Arial, sans-serif',
    'font-weight: 700',
    'z-index: 2147483647',
    'box-shadow: 0 6px 24px rgba(0,0,0,0.6)',
    'pointer-events: none',
    'white-space: nowrap',
    'text-align: center',
    'display: block'
  ].join(' !important; ') + ' !important';
  // Append to <html> not <body> to avoid IMDB stacking context issues
  document.documentElement.appendChild(toast);
  // Remove after 3.5s
  setTimeout(() => toast.remove(), 3500);
}

// ----------------------
// UI helpers
function formatDuration(ms) {
  if (typeof ms !== 'number' || isNaN(ms)) return "";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Escape user-supplied strings before inserting into innerHTML to prevent XSS.
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function refreshStatusUI(snapshotGame) {
  // Update active-round flag — filters only apply when a round is genuinely running
  roundIsActive = !!(gameId && snapshotGame && snapshotGame.status === 'active');

  if (snapshotGame) {
    // In lobby, the next round's actors haven't been picked yet — always show TBD
    const isLobbyState = snapshotGame.status === 'lobby';
    const actorADisplay = (!isLobbyState && snapshotGame.actorA) ? snapshotGame.actorA.name : 'TBD';
    const actorBDisplay = (!isLobbyState && snapshotGame.actorB) ? snapshotGame.actorB.name : 'TBD';
    gameInfo.innerHTML = `Game: <strong>${gameId}</strong><div style="margin-top:10px;font-size:19px;font-weight:800;color:#000;line-height:1.35;">${actorADisplay} <span style="opacity:0.45;font-size:16px;font-weight:400;">→</span> ${actorBDisplay}</div>`;
    if (!isLobbyState) {
      actorPair = snapshotGame.actorA && snapshotGame.actorB ? [snapshotGame.actorA, snapshotGame.actorB] : actorPair;
      storageSet({ actorPair }).catch(() => {});
    }
  } else {
    if (gameId && actorPair) {
      gameInfo.innerHTML = `Game: <strong>${gameId}</strong><div style="margin-top:10px;font-size:19px;font-weight:800;color:#000;line-height:1.35;">${actorPair[0].name} <span style="opacity:0.45;font-size:16px;font-weight:400;">→</span> ${actorPair[1].name}</div>`;
    } else {
      gameInfo.innerHTML = "Game: <em>Not in a game</em>";
    }
  }

  // ROUND TIMER: drive with a local 1s interval so it ticks smoothly independent of SSE events
  if (snapshotGame && snapshotGame.startedAt && snapshotGame.status === 'active') {
    roundStartedAt = snapshotGame.startedAt;
    const tl = Number(snapshotGame.roundTimeLimitMs);
    roundTimeLimitMs = Number.isFinite(tl) && tl > 0 ? tl : null;
    storageSet({ roundStartedAt }).catch(() => {});
    roundTimerDiv.style.display = 'block';
    // Start the smooth tick if not already running
    if (!_timerInterval) {
      _timerInterval = setInterval(() => {
        if (roundStartedAt) {
          if (roundTimeLimitMs) {
            const remainingMs = Math.max(0, roundTimeLimitMs - (Date.now() - roundStartedAt));
            roundTimerDiv.textContent = `Time left: ${formatDuration(remainingMs)}`;
          } else {
            roundTimerDiv.textContent = `Time: ${formatDuration(Date.now() - roundStartedAt)}`;
          }
        }
      }, 1000);
    }
    // Stamp immediately so there's no 1s delay on first display
    if (roundTimeLimitMs) {
      const remainingMs = Math.max(0, roundTimeLimitMs - (Date.now() - roundStartedAt));
      roundTimerDiv.textContent = `Time left: ${formatDuration(remainingMs)}`;
    } else {
      roundTimerDiv.textContent = `Time: ${formatDuration(Date.now() - roundStartedAt)}`;
    }
  } else {
    // Stop the tick whenever the round isn't active
    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }

    if (snapshotGame && snapshotGame.status === 'finished' && roundStartedAt) {
      // Show the frozen final time on the leaderboard
      roundTimerDiv.style.display = 'block';
      const tl = Number(snapshotGame.roundTimeLimitMs);
      const timeLimit = Number.isFinite(tl) && tl > 0 ? tl : null;
      const endTs = Number(snapshotGame.endedAt) || Date.now();
      if (timeLimit) {
        const remainingMs = Math.max(0, timeLimit - (endTs - roundStartedAt));
        roundTimerDiv.textContent = `Time left: ${formatDuration(remainingMs)}`;
      } else {
        // Use endTs (the actual round-end timestamp) so the timer freezes correctly
        roundTimerDiv.textContent = `Time: ${formatDuration(endTs - roundStartedAt)}`;
      }
    } else {
      roundTimerDiv.style.display = 'none';
      if (snapshotGame && snapshotGame.status === 'lobby') {
        roundStartedAt = null;
        roundTimeLimitMs = null;
        storageSet({ roundStartedAt: null }).catch(() => {});
        lastReadyAt = null;
        storageSet({ lastReadyAt: null }).catch(() => {});
      }
    }
  }

  // If the game is in lobby mode, reset redirect flag so participants will redirect on the next start
  if (snapshotGame && snapshotGame.status === 'lobby') {
    hasRedirected = false;
    storageSet({ hasRedirected }).catch(() => {});
  }

  // --- WINNER LOGIC FOR UI (replacement block) ---
  if (snapshotGame && snapshotGame.status === 'finished') {
    const players = snapshotGame.players || {};

    // 1. Build players array
    const allPlayers = Object.keys(players).map(pid => ({ pid, ...players[pid] }));

    // finished players: sort by clicks then finishedAt (earliest first)
    const finishedPlayers = allPlayers
      .filter(p => p.finishedAt && !p.gaveUp)
      .sort((a, b) => {
        const ac = Number(a.clicks ?? Infinity);
        const bc = Number(b.clicks ?? Infinity);
        if (ac !== bc) return ac - bc;
        const af = Number(a.finishedAt ?? Infinity);
        const bf = Number(b.finishedAt ?? Infinity);
        return af - bf;
      });

    // gave up players: sort by gaveUpAt ascending (first to give up at the top)
    const gaveUpPlayers = allPlayers
      .filter(p => p.gaveUp)
      .sort((a, b) => {
        const aa = Number(a.gaveUpAt ?? Infinity);
        const ba = Number(b.gaveUpAt ?? Infinity);
        return aa - ba;
      });

    leaderboardList.innerHTML = '';

    if (finishedPlayers.length > 0) {
      // Prefer server-declared winner if present and valid, otherwise fall back to sorted list
      const serverWinnerPid = snapshotGame.winner;
      let winner;
      if (serverWinnerPid && players[serverWinnerPid] && players[serverWinnerPid].finishedAt) {
        winner = { pid: serverWinnerPid, ...players[serverWinnerPid] };
      } else {
        winner = finishedPlayers[0];
      }

      const winnerName = escapeHtml(winner.name || winner.pid);
      const baseStart = snapshotGame.startedAt || roundStartedAt;
      const winnerTime = (winner.finishedAt && baseStart) ? formatDuration(winner.finishedAt - baseStart) : "";
      winnerText.innerHTML = `${winnerName} WINS! ${winnerTime ? `${winnerTime}` : ''}`;

      // render finished leaderboard (already sorted)
      finishedPlayers.forEach((player, index) => {
        const rank = index + 1;
        const isWinner = rank === 1;
        const isSelf = player.pid === playerId;
        const playerName = player.name || player.pid;
        const clicks = player.clicks;
        const base = snapshotGame.startedAt || roundStartedAt;
        const playerTime = (player.finishedAt && base) ? formatDuration(player.finishedAt - base) : '';
        const suffix = rank === 1 ? 'st' : (rank === 2 ? 'nd' : (rank === 3 ? 'rd' : 'th'));

        const listItem = document.createElement('div');
        Object.assign(listItem.style, {
          display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
          padding: isWinner ? '6px 6px' : '4px 6px',
          borderLeft: isWinner ? '3px solid #f5c518' : '3px solid transparent',
          borderRadius: '3px',
          opacity: isWinner ? '1' : (rank === 2 ? '0.85' : '0.7'),
          fontSize: isWinner ? '15px' : '13px',
          marginBottom: '3px',
        });

        const rankSpan = document.createElement('span');
        rankSpan.textContent = `${rank}${suffix}`;
        Object.assign(rankSpan.style, {
          minWidth: '26px', fontWeight: '700',
          color: isWinner ? '#f5c518' : 'inherit', flexShrink: '0',
        });

        const nameSpan = document.createElement('span');
        nameSpan.textContent = playerName; // textContent — safe against XSS
        Object.assign(nameSpan.style, {
          fontWeight: isSelf || isWinner ? '700' : '400',
          color: isSelf ? '#f5c518' : '#fff', flex: '1',
        });

        const statsSpan = document.createElement('span');
        statsSpan.style.flexShrink = '0';
        statsSpan.style.textAlign = 'right';
        const timeHtml = playerTime ? ` <span style="opacity:0.5;font-size:11px;">· ${playerTime}</span>` : '';
        statsSpan.innerHTML = `<strong>${clicks}</strong> clicks${timeHtml}`;

        listItem.appendChild(rankSpan);
        listItem.appendChild(nameSpan);
        listItem.appendChild(statsSpan);
        leaderboardList.appendChild(listItem);

        // Path accordion — collapsed by default, expand on demand
        if (player.clickPath && player.clickPath.length > 0) {
          const pathToggle = document.createElement('button');
          const toggleOpenLabel = isWinner ? '▼ What path did they take?' : '▼ Show path';
          const toggleClosedLabel = isWinner ? '▶ What path did they take?' : '▶ Show path';
          Object.assign(pathToggle.style, {
            cursor: 'pointer', fontSize: '11px', fontFamily: 'inherit',
            marginTop: '2px', marginBottom: '4px',
            marginLeft: '0',
            width: '100%',
            padding: isWinner ? '5px 10px' : '2px 8px',
            background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '4px', color: '#e0e0e0', userSelect: 'none',
            textAlign: 'left',
          });

          const pathContent = document.createElement('div');
          Object.assign(pathContent.style, {
            fontSize: '12px', lineHeight: '1.8', marginBottom: '6px',
            wordBreak: 'break-word', background: 'rgba(0,0,0,0.2)',
            borderRadius: '4px', padding: '6px 8px', marginTop: '2px',
          });
          const pathNames = player.clickPath;
          pathContent.innerHTML = pathNames.map((name, i) => {
            if (i === 0 || i === pathNames.length - 1) return `<strong style="color:#f5c518">${name}</strong>`;
            const color = i % 2 === 1 ? '#93c5fd' : '#ffffff';
            return `<span style="color:${color}">${name}</span>`;
          }).join(' <span style="opacity:0.4">→</span> ');

          const isCurrentlyOpen = openPaths.has(player.pid);
          pathContent.style.display = isCurrentlyOpen ? 'block' : 'none';
          pathToggle.textContent = isCurrentlyOpen ? toggleOpenLabel : toggleClosedLabel;

          pathToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = pathContent.style.display !== 'none';
            if (isOpen) {
              pathContent.style.display = 'none';
              pathToggle.textContent = toggleClosedLabel;
              openPaths.delete(player.pid);
            } else {
              pathContent.style.display = 'block';
              pathToggle.textContent = toggleOpenLabel;
              openPaths.add(player.pid);
            }
          });

          leaderboardList.appendChild(pathToggle);
          leaderboardList.appendChild(pathContent);
        }
      });
    } else {
      // No finishers: show Game Ended and indicate no finishers
      winnerText.innerHTML = `Game Ended`;
      leaderboardList.innerHTML = 'No finishers recorded.';
    }

    // Append gave-up players at bottom in order who gave up first -> last
    if (gaveUpPlayers.length > 0) {
      const divider = document.createElement('div');
      divider.style.borderTop = '1px dashed rgba(245, 197, 24, 0.4)';
      divider.style.margin = '8px 0';
      leaderboardList.appendChild(divider);

      const gaveUpHeader = document.createElement('div');
      gaveUpHeader.textContent = 'Did not finish';
      Object.assign(gaveUpHeader.style, {
        fontSize: '11px', fontWeight: '700', textTransform: 'uppercase',
        letterSpacing: '0.05em', opacity: '0.5', marginTop: '4px', marginBottom: '2px',
      });
      leaderboardList.appendChild(gaveUpHeader);

      gaveUpPlayers.forEach(player => {
        const playerName = player.name || player.pid;
        const listItem = document.createElement('div');
        listItem.innerHTML = `${playerName}`;
        listItem.style.textAlign = 'left';
        listItem.style.opacity = '0.55';
        listItem.style.fontSize = '12px';

        if (player.pid === playerId) {
          listItem.style.fontWeight = 'bold';
          listItem.style.color = '#fff';
          listItem.style.opacity = '1';
        }

        leaderboardList.appendChild(listItem);
      });
    }

    // Render optimal path from Firebase snapshot — same result for all players
    const op = snapshotGame.optimalPath;
    if (!op) {
      optimalSection.style.display = 'none';
    } else if (op.loading) {
      optimalSection.style.display = 'block';
      optimalSection.innerHTML = '<div style="opacity:0.6;font-size:12px;">Fetching fastest route…</div>';
    } else if (op.notFound) {
      optimalSection.style.display = 'none';
    } else if (op.path && op.path.length >= 2) {
      const hopLabel = `${op.actorClicks} click${op.actorClicks !== 1 ? 's' : ''}`;
      const pathHtml = op.path.map((name, i) => {
        if (i === 0 || i === op.path.length - 1) return `<strong style="color:#f5c518">${name}</strong>`;
        const color = i % 2 === 1 ? '#93c5fd' : '#ffffff';
        return `<span style="color:${color}">${name}</span>`;
      }).join(' <span style="opacity:0.4">→</span> ');
      optimalSection.style.display = 'block';
      optimalSection.innerHTML = `
        <div style="font-weight:700;font-size:15px;color:#f5c518;margin-bottom:6px;">Fastest route you could have taken? <span style="color:#fff;font-weight:800;font-size:16px;">· ${hopLabel}</span></div>
        <div style="font-size:13px;line-height:2;word-break:break-word;background:rgba(0,0,0,0.2);border-radius:4px;padding:8px 10px;">${pathHtml}</div>`;
    } else {
      optimalSection.style.display = 'none';
    }

    // Session standings — stacked rows, one per player, sorted by wins desc
    const wins = snapshotGame.wins || {};
    const totalWins = Object.values(wins).reduce((sum, w) => sum + Number(w), 0);
    if (totalWins > 0) {
      const allPids = Object.keys(snapshotGame.players || {});
      const rows = allPids
        .map(pid => ({ pid, name: snapshotGame.players[pid]?.name || pid, wins: Number(wins[pid] ?? 0) }))
        .sort((a, b) => b.wins - a.wins)
        .map(r => {
          const isSelf = r.pid === playerId;
          const nameColor = isSelf ? '#f5c518' : 'rgba(255,255,255,0.85)';
          const nameWeight = isSelf ? '700' : '400';
          const winsStr = r.wins === 1 ? '1 win' : `${r.wins} wins`;
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;">
            <span style="color:${nameColor};font-weight:${nameWeight};font-size:13px;">${escapeHtml(r.name)}</span>
            <span style="color:#f5c518;font-weight:700;font-size:13px;margin-left:12px;">${winsStr}</span>
          </div>`;
        })
        .join('');
      sessionStandingsDiv.innerHTML = `
        <div style="font-size:13px;text-transform:uppercase;letter-spacing:0.06em;font-weight:800;color:#fff;margin-bottom:8px;">Session Scoreboard</div>
        ${rows}`;
      sessionStandingsDiv.style.display = 'block';
    } else {
      sessionStandingsDiv.style.display = 'none';
    }

    // Ensure panel is expanded so the leaderboard is visible
    if (_panelCollapsed) applyPanelCollapse(false);
    winnerBox.style.display = "flex"; // Show the overlay
    // Hide standard lobby/controls
    lobbyBox.style.display = "none";
    btnRow.style.display = "none";
    nameRow.style.display = "none";
    actionRow.style.display = "none";
  } else {
    // Hide winner box if no winner or game is not finished
    optimalSection.style.display = 'none';
    winnerBox.style.display = "none";
    if (gameId) {
        // Only show controls/lobby if a game is active
        lobbyBox.style.display = "block";
        btnRow.style.display = "block";

        // Name row: only visible in lobby (before round starts), hidden during active round
        const isLobby = !snapshotGame || snapshotGame.status === 'lobby';
        nameRow.style.display = isLobby ? "flex" : "none";

        // Update lobby panel heading based on round state
        lobbyTitle.textContent = (snapshotGame && snapshotGame.status === 'active')
          ? "Leaderboard"
          : "Lobby — Waiting for players";

        // Session tally in lobby — show if at least 1 round has been played
        const lobbyWins = snapshotGame?.wins || {};
        const lobbyTotalWins = Object.values(lobbyWins).reduce((sum, w) => sum + Number(w), 0);
        if (lobbyTotalWins > 0) {
          const lobbyPlayers = snapshotGame?.players || {};
          const lobbyRows = Object.keys(lobbyPlayers)
            .map(pid => ({
              pid,
              name: lobbyPlayers[pid]?.name || pid,
              wins: Number(lobbyWins[pid] ?? 0),
            }))
            .sort((a, b) => b.wins - a.wins)
            .map(r => {
              const isSelf = r.pid === playerId;
              const winsStr = r.wins === 1 ? '1 win' : `${r.wins} wins`;
              return `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;">
                <span style="font-weight:${isSelf ? '700' : '400'};color:${isSelf ? '#000' : '#333'};">${escapeHtml(r.name)}</span>
                <span style="font-weight:700;color:#000;margin-left:12px;">${winsStr}</span>
              </div>`;
            })
            .join('');
          lobbyTallyDiv.innerHTML = `<div style="font-size:13px;text-transform:uppercase;letter-spacing:0.06em;font-weight:800;color:#000;margin-bottom:6px;">Session Scoreboard</div>${lobbyRows}`;
          lobbyTallyDiv.style.display = 'block';
        } else {
          lobbyTallyDiv.style.display = 'none';
        }

        // Only show Give Up if the game is started and current player hasn't finished/given up
        const isStarted = snapshotGame && snapshotGame.startedAt;
        const currentPlayer = snapshotGame?.players?.[playerId];
        const canGiveUp = isStarted && currentPlayer && !currentPlayer.finishedAt && !currentPlayer.gaveUp;

        actionRow.style.display = "block";
        giveUpBtn.style.display = canGiveUp ? "inline-block" : "none";

    } else {
        actionRow.style.display = "none";
    }
  }

  // Show host Start Round button if in lobby
  if (snapshotGame && snapshotGame.status === 'lobby' && role === 'host') {
    startRoundBtn.style.display = 'inline-block';
    timeLimitRow.style.display = 'flex';
  } else {
    startRoundBtn.style.display = 'none';
    timeLimitRow.style.display = 'none';
  }

  // Show "waiting for host" nudge to guests in the lobby
  if (snapshotGame && snapshotGame.status === 'lobby' && role === 'guest') {
    lobbyWaitingDiv.style.display = 'block';
  } else {
    lobbyWaitingDiv.style.display = 'none';
  }

  statusDiv.textContent = `Clicks: ${clicks}`;
}

function renderPlayersList(playersObj, gameStatus, isHost = false) {
  playersList.innerHTML = "";
  if (!playersObj || Object.keys(playersObj).length === 0) {
    playersList.textContent = "No players yet.";
    return;
  }

  const allPlayers = Object.keys(playersObj).map(pid => ({ pid, ...playersObj[pid] }));

  // 1. Sort Finished players by clicks then finishedAt
  const finishedPlayers = allPlayers
    .filter(p => p.finishedAt && !p.gaveUp)
    .sort((a, b) => {
       const ac = Number(a.clicks ?? Infinity);
       const bc = Number(b.clicks ?? Infinity);
       if (ac !== bc) return ac - bc;
       const af = Number(a.finishedAt ?? Infinity);
       const bf = Number(b.finishedAt ?? Infinity);
       return af - bf;
    });

  // 2. Collect Active players (not finished, not gave up, and heartbeat is recent)
  // In lobby state heartbeats aren't written, so skip the staleness check there.
  const displayNow = Date.now();
  const activePlayers = allPlayers
    .filter(p => {
      if (p.finishedAt || p.gaveUp) return false;
      if (gameStatus === 'lobby') return true; // lobby: show all non-gave-up players regardless of heartbeat
      const ls = Number(p.lastSeen) || 0;
      if (ls === 0) return true; // no heartbeat yet — assume active
      return (displayNow - ls) < 10000;
    });

  // 3. Collect Gave Up players (order by gaveUpAt)
  const gaveUpPlayers = allPlayers
    .filter(p => p.gaveUp)
    .sort((a, b) => {
      const aa = Number(a.gaveUpAt ?? Infinity);
      const ba = Number(b.gaveUpAt ?? Infinity);
      return aa - ba;
    });

  // Combine in order: Finished, Active, Gave Up
  const sortedPlayers = [...finishedPlayers, ...activePlayers, ...gaveUpPlayers];

  for (const p of sortedPlayers) {
    const row = document.createElement("div");
    row.style.padding = "4px 0";
    row.style.fontSize = "13px";
    const label = p.pid === playerId ? `${escapeHtml(p.name || p.pid)} (You)` : escapeHtml(p.name || p.pid);

    let statusLabel = "";
    if (p.finishedAt) {
      const base = roundStartedAt;
      const dur = (base && p.finishedAt) ? formatDuration(p.finishedAt - base) : '';
      statusLabel = ` — ${p.clicks} clicks — finished${dur ? ` — ${dur}` : ''} ✅`;
    } else if (p.gaveUp) {
      // include gaveUpAt if present
      const gaveUpAt = p.gaveUpAt ? ` (${new Date(Number(p.gaveUpAt)).toLocaleTimeString()})` : '';
      statusLabel = ` — GAVE UP${gaveUpAt} 🏳️`;
      row.style.opacity = '0.6';
    } else if (p.ready) {
      statusLabel = " — READY ⏱️";
      row.style.fontWeight = '600';
    } else if (typeof p.clicks !== 'undefined') {
      statusLabel = ` — ${p.clicks} clicks`;
    }

    // Host kick button — shown in lobby and during active rounds, for non-self players
    if ((gameStatus === 'lobby' || gameStatus === 'active') && isHost && p.pid !== playerId) {
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'space-between';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = label + statusLabel;
      const kickBtn = document.createElement('button');
      kickBtn.textContent = 'Kick';
      kickBtn.title = `Kick ${p.name || p.pid}`;
      Object.assign(kickBtn.style, {
        marginLeft: '8px', background: '#c0392b', border: 'none',
        color: '#fff', cursor: 'pointer', fontSize: '11px',
        fontWeight: 'bold', padding: '2px 7px', borderRadius: '3px',
        flexShrink: '0', lineHeight: '1.4'
      });
      kickBtn.addEventListener('click', () => kickPlayer(p.pid));
      row.appendChild(nameSpan);
      row.appendChild(kickBtn);
    } else {
      row.innerHTML = label + statusLabel;
    }
    playersList.appendChild(row);
  }
}

function updateGameControls() {
  const inGame = !!gameId;
  startBtn.style.display = inGame ? "none" : "inline-block";
  joinBtn.style.display = inGame ? "none" : "inline-block";
  if (inGame) joinRow.style.display = "none"; // hide when in-game; preserve user-toggled state otherwise
  actionRow.style.display = inGame ? "block" : "none";
  lobbyBox.style.display = inGame ? "block" : "none";
  hintDiv.style.display = inGame ? "none" : "block";

  if (!inGame) {
     winnerBox.style.display = "none";
     btnRow.style.display = "block";
     nameRow.style.display = "flex";
     lobbyBox.style.display = "none";
  }
}

// ----------------------
// Game operations

// Host action: start a new round using players who are ready or all players that are joined (non-gaveUp)
// REPLACE the existing startRound() with this function
async function startRound() {
  if (!gameId) throw new Error("No gameId");
  // Fetch latest snapshot to avoid races
  const snapshot = await dbGet(`${gameId}`);
  if (!snapshot) throw new Error("Game not found");

  const players = snapshot.players || {};

  // explicit ready flags
  const explicitReady = Object.keys(players).filter(pid => players[pid] && players[pid].ready);

  // all non-gaveUp players (joined)
  const allNonGaveUp = Object.keys(players).filter(pid => players[pid] && !players[pid].gaveUp);

  // Decide readyPids for selection rules:
  // - If 2+ explicit ready -> use explicitReady
  // - Else -> fall back to allNonGaveUp
  let readyPids = explicitReady.length >= 2 ? explicitReady : allNonGaveUp;

  // If still <2, allow host solo if they're the only joined player
  const hostSoloAllowed = (readyPids.length === 1 && readyPids[0] === playerId && role === 'host');

  // Build participants map:
  // 1) Include optimistic participants map (written by guests when they Play Again)
  // 2) Include non-gaveUp players from snapshot.players
  // 3) Include readyPids
  // 4) Always include the host (playerId) so the host can't accidentally exclude themself
  const participants = {};
  const existingParticipants = snapshot.participants || {};
  Object.keys(existingParticipants).forEach(pid => {
    if (existingParticipants[pid]) participants[pid] = true;
  });

  Object.keys(players).forEach(pid => {
    if (players[pid] && !players[pid].gaveUp) participants[pid] = true;
  });

  readyPids.forEach(pid => { participants[pid] = true; });

  // Ensure host is included so host can't be left out due to a previous gaveUp flag
  if (playerId) participants[playerId] = true;

  const participantIds = Object.keys(participants);

  // Now decide if we have enough participants (use participants size, not readyPids length)
  if (participantIds.length < 2 && !hostSoloAllowed) {
    alert("Need at least 2 participants to start a round (or host can start solo if alone).");
    return;
  }

  // Choose actor pair — use debug-locked pair if set, otherwise random
  const debugPairPrefs = await storageGet(['lockedActorPair']);
  let newActorPair;
  if (debugPairPrefs.lockedActorPair) {
    const lp = debugPairPrefs.lockedActorPair;
    newActorPair = [lp.actorA, lp.actorB];
    console.log(`[Debug] Using locked actor pair: ${lp.actorA.name} → ${lp.actorB.name}`);
  } else {
    const shuffled = [...actorList].sort(() => Math.random() - 0.5);
    newActorPair = [shuffled[0], shuffled[1]];
  }

  // Host-configured time limit for this round (null/0 => disabled)
  const roundTimeLimitMsToWrite = hostRoundTimeLimitSec > 0 ? hostRoundTimeLimitSec * 1000 : null;
  roundTimeLimitMs = roundTimeLimitMsToWrite;

  // Clear player records FIRST so that when status flips to 'active' the SSE
  // fires with clean data — prevents the conclude logic from seeing stale
  // finishedAt values from the previous round and immediately ending the new round.
  const resets = participantIds.map(pid => {
    const name = (players[pid] && players[pid].name) ? players[pid].name : undefined;
    const payload = { clicks: 0, finishedAt: null, gaveUp: false, ready: false, gaveUpAt: null, clickPath: null };
    if (name) payload.name = name;
    return dbPatch(`${gameId}/players/${pid}`, payload);
  });
  await Promise.all(resets);

  // NOW set the game to active — SSE fires after player records are already clean
  await dbPatch(`${gameId}`, {
    actorA: newActorPair[0],
    actorB: newActorPair[1],
    startedAt: Date.now(),
    status: "active",
    winner: null,
    winnerClicks: null,
    optimalPath: null,
    roundTimeLimitMs: roundTimeLimitMsToWrite,
    endedAt: null,
    endedBy: null,
    participants
  });

  console.log("Started new round with participants:", participantIds);
}
async function createGameAndStart() {
  cleanupOldGames(); // fire-and-forget; don't await so it doesn't delay game creation
  const id = randId(5);
  gameId = id;

  actorPair = null;
  clicks = 0;
  finished = false;

  const now = Date.now();
  const gameObj = {
    actorA: null,
    actorB: null,
    hostId: playerId,
    players: { [playerId]: { clicks: 0, name: displayName, gaveUp: false, ready: true, gaveUpAt: null } }, // host ready by default so they can start solo
    status: "lobby",
    winner: null,
    winnerClicks: null,
    createdAt: now
  };

  try {
    // create lobby (not started)
    await dbPut(`${gameId}`, gameObj);
    await storageSet({ gameId, actorPair, clicks, finished });
    role = 'host';
    await storageSet({ role });
    refreshStatusUI(gameObj);
    updateGameControls();
    startPolling();

    // NOTE: do not redirect here — host will click Start Round when ready
  } catch (err) {
    console.error("createGameAndStart failed", err);
    alert("Failed to create game. Check DB URL / rules.");
  }
}

const MAX_PLAYERS = 6;

async function joinGameWithId(inputId) {
  cleanupOldGames(); // fire-and-forget; runs in background while join proceeds
  const id = (inputId || "").trim().toUpperCase();
  if (!id) { alert("Enter a Game ID."); return; }

  try {
    const game = await dbGet(`${id}`);
    if (!game) { alert("Game not found: " + id); return; }

    // Enforce player cap — count existing non-gave-up players, excluding self (rejoin allowed)
    const existingPlayers = game.players ? Object.keys(game.players) : [];
    const activePlayers   = existingPlayers.filter(pid => pid !== playerId && !game.players[pid]?.gaveUp);
    if (activePlayers.length >= MAX_PLAYERS) {
      alert(`This game is full (max ${MAX_PLAYERS} players).`);
      return;
    }

    gameId = id;
    actorPair = [game.actorA, game.actorB];
    clicks = 0;
    finished = false;

    // add self to players (don't auto-ready)
    await dbPatch(`${gameId}/players/${playerId}`, { clicks: 0, name: displayName, gaveUp: false, ready: false, gaveUpAt: null });
    await storageSet({ gameId, actorPair, clicks, finished });
    role = 'guest';
    await storageSet({ role });

    refreshStatusUI(game);
    updateGameControls();
    startPolling();

    // If game already started (startedAt present) the poll will redirect this client automatically (if participant)
  } catch (err) {
    console.error("joinGameWithId failed", err);
    alert("Failed to join game. Check DB URL and code.");
  }
}

async function giveUpGame() {
    if (!gameId || !confirm("Are you sure you want to give up? You will be excluded from winning.")) return;
    
    // mark local finished flag so clicks are blocked, but keep polling running so player will see the final winner screen
    finished = true;
    await storageSet({ finished });

    try {
        // 1. Set the gaveUp flag and record when the player gave up
        const gaveUpAt = Date.now();
        await dbPatch(`${gameId}/players/${playerId}`, { gaveUp: true, finishedAt: null, name: displayName, gaveUpAt });

        // 2. Fetch the updated game state
        const snapshot = await dbGet(`${gameId}`);
        const players = snapshot?.players || {};
        const playerIds = Object.keys(players);
        
        // 3. Check for automatic game end 
        // Only consider players who DID NOT give up when checking finishers
        const finishedPlayers = playerIds.filter(pid => 
            players[pid] && players[pid].finishedAt && !players[pid].gaveUp
        );
        const giveUpNow = Date.now();
        const activePlayers = playerIds.filter(pid => {
            if (!players[pid] || players[pid].finishedAt || players[pid].gaveUp) return false;
            const lastSeen = Number(players[pid].lastSeen) || 0;
            const sinceStart = snapshot?.startedAt ? (giveUpNow - snapshot.startedAt) : 0;
            if (lastSeen === 0 && sinceStart < 10000) return true;
            return (giveUpNow - lastSeen) < 10000;
        });
        const gaveUpPlayers = playerIds.filter(pid =>
            players[pid] && players[pid].gaveUp
        );

        // a) If all remaining (non-gave-up) players have finished, declare winner using tie-breaking logic
        if (finishedPlayers.length >= 1 && activePlayers.length === 0) {
            let winnerPid = null;
            let minClicks = Infinity;
            for (const pid of finishedPlayers) {
                const c = Number(players[pid]?.clicks ?? Infinity);
                if (c < minClicks) minClicks = c;
            }
            let earliestFinishedAt = Infinity;
            for (const pid of finishedPlayers) {
                const c = Number(players[pid]?.clicks ?? Infinity);
                const ft = Number(players[pid]?.finishedAt ?? Infinity);
                if (c === minClicks && ft < earliestFinishedAt) {
                    earliestFinishedAt = ft;
                    winnerPid = pid;
                }
            }
            if (!winnerPid) winnerPid = finishedPlayers[0]; // defensive fallback

            // Set winner and status
            await dbPatch(`${gameId}`, {
                winner: winnerPid,
                winnerClicks: minClicks,
                status: "finished"
            });
            console.log(`Game ended: ${winnerPid} won with ${minClicks} clicks.`);

            // Update UI with the final state
            refreshStatusUI(await dbGet(`${gameId}`));
            return;
        }

        // b) If there are NO finishers and NO active players, everyone gave up -> end the game so clients show gave-up board
        if (finishedPlayers.length === 0 && activePlayers.length === 0 && gaveUpPlayers.length > 0) {
            await dbPatch(`${gameId}`, {
              winner: null,
              winnerClicks: null,
              status: "finished"
            });
            console.log(`All players gave up; ending game and showing gave-up board.`);
            refreshStatusUI(await dbGet(`${gameId}`));
            return;
        }

        // else: just update the UI with the 'gave up' status
        refreshStatusUI(snapshot); 

    } catch (err) {
        console.error("Failed to give up game", err);
        alert("Failed to give up.");
    }
}

async function leaveGame(shouldRestart = false) {
  if (!gameId) { 
      // If we're forcing a restart, and not in a game, just execute the restart logic.
      if (shouldRestart) {
          stopPolling();
          gameId = null;
          actorPair = null;
          clicks = 0;
          role = null;
          hasRedirected = false;
          finished = false;
          await storageSet({ finished });
          refreshStatusUI();
          updateGameControls();
      } else {
        alert("Not in a game."); 
      }
      return;
  }
  
  const leavingGameId = gameId; // capture before clearing local state

  try {
    // Remove player entry (set to null)
    await dbPatch(`${leavingGameId}/players/${playerId}`, null);
  } catch (err) {
    console.warn("Failed to remove player from DB", err);
  }

  // After leaving, check if the game needs to be resolved or expired
  try {
    const remainingGame = await dbGet(`${leavingGameId}`);
    if (remainingGame && remainingGame.status !== 'expired' && remainingGame.status !== 'finished') {
      const remainingPlayers = remainingGame.players || {};
      const remainingIds = Object.keys(remainingPlayers);

      if (remainingIds.length === 0) {
        // Last player left — expire the game so nobody can accidentally rejoin it
        await dbPatch(`${leavingGameId}`, { status: 'expired' });
      } else if (remainingGame.hostId === playerId) {
        // Leaving player was the host — promote someone else
        await transferHost(leavingGameId, remainingPlayers);
      }
      if (remainingIds.length > 0 && remainingGame.status === 'active' && !remainingGame.winner) {
        const remainingFinished = remainingIds.filter(pid => remainingPlayers[pid]?.finishedAt && !remainingPlayers[pid]?.gaveUp);
        const remainingActive = remainingIds.filter(pid => !remainingPlayers[pid]?.finishedAt && !remainingPlayers[pid]?.gaveUp);

        if (remainingFinished.length >= 1 && remainingActive.length === 0) {
          // All remaining players have finished — declare winner
          let winnerPid = null, minClicks = Infinity, earliestFinishedAt = Infinity;
          for (const pid of remainingFinished) {
            const c = Number(remainingPlayers[pid]?.clicks ?? Infinity);
            if (c < minClicks) minClicks = c;
          }
          for (const pid of remainingFinished) {
            const c = Number(remainingPlayers[pid]?.clicks ?? Infinity);
            const ft = Number(remainingPlayers[pid]?.finishedAt ?? Infinity);
            if (c === minClicks && ft < earliestFinishedAt) {
              earliestFinishedAt = ft;
              winnerPid = pid;
            }
          }
          if (!winnerPid) winnerPid = remainingFinished[0];
          await dbPatch(`${leavingGameId}`, { winner: winnerPid, winnerClicks: minClicks, status: 'finished' });
        }
        // If there are still active players remaining, polling on their end will handle conclusion
      }
    }
  } catch (err) {
    console.warn("Failed to resolve game state after leaving", err);
  }

  // Clear local state and storage
  stopPolling();
  await storageRemove(['gameId', 'actorPair', 'clicks', 'role', 'hasRedirected', 'finished', 'lastReadyAt', 'clickPath']);
  gameId = null;
  actorPair = null;
  clicks = 0;
  role = null;
  hasRedirected = false;
  finished = false;
  lastReadyAt = null;
  clickPath = [];
  openPaths.clear();
  optimalPathRoundKey = null;
  optimalPathResult = null;

  // Re-run UI update
  refreshStatusUI();
  updateGameControls();
}

// ----------------------
// Host transfer
// ----------------------
// Picks the first eligible remaining player and writes them as the new hostId.
// Should only be called by one client (the leaving host, or the first non-host to detect disconnect).
async function transferHost(forGameId, remainingPlayers) {
  const candidates = Object.keys(remainingPlayers).filter(pid => !remainingPlayers[pid]?.gaveUp);
  if (candidates.length === 0) return;
  const newHostId = candidates[0];
  await dbPatch(`${forGameId}`, { hostId: newHostId });
  console.log(`[Host] Transferred host to ${newHostId}`);
}

// ----------------------
// Host kick
// ----------------------
async function kickPlayer(targetPid) {
  if (!gameId || role !== 'host') return;
  if (targetPid === playerId) return; // host can't kick themselves
  try {
    await dbPatch(`${gameId}/players/${targetPid}`, null);
  } catch (e) {
    console.warn('[Kick] Failed to remove player', e);
  }
}

// ----------------------
// Polling / lobby coordination / redirect-on-start
// ----------------------
// Core game logic — runs whenever the game snapshot changes (replaces pollOnce)
async function processSnapshot(snapshot) {
  if (!snapshot) {
    gameInfo.innerHTML = `Game: <em>Not found</em>`;
    return;
  }

  // Keep local role in sync with Firebase hostId (handles host transfer without page reload)
  if (snapshot.hostId && gameId) {
    const newRole = snapshot.hostId === playerId ? 'host' : 'guest';
    if (newRole !== role) {
      role = newRole;
      await storageSet({ role });
    }
  }

  refreshStatusUI(snapshot);
  renderPlayersList(snapshot.players || {}, snapshot.status, snapshot.hostId === playerId);

  const players = snapshot.players || {};
  const playerIds = Object.keys(players);
  const currentPlayer = players[playerId];

  // Detect being kicked: we have a gameId but our player record is gone.
  // Works in both lobby and active rounds — host can now kick mid-round.
  if (gameId && role !== 'host' && (snapshot.status === 'lobby' || snapshot.status === 'active') && !currentPlayer) {
    stopPolling();
    const kickedGameId = gameId;
    gameId = null; actorPair = null; clicks = 0; role = null;
    hasRedirected = false; finished = false; clickPath = [];
    await storageRemove(['gameId', 'actorPair', 'clicks', 'role', 'hasRedirected', 'finished', 'clickPath', 'roundStartedAt', 'lastReadyAt']);
    refreshStatusUI();
    updateGameControls();
    alert(`You were removed from game ${kickedGameId} by the host.`);
    return;
  }

  // Detect host disconnect in lobby — first non-host client to notice promotes a new host
  if (
    snapshot.status === 'lobby' &&
    snapshot.hostId &&
    snapshot.hostId !== playerId &&
    !_hostTransferring
  ) {
    const hostRec = players[snapshot.hostId];
    const hostLastSeen = Number(hostRec?.lastSeen) || 0;
    // Hosts write lastSeen every 3s during active rounds but not in lobby.
    // Use absence of the player record itself as the signal instead.
    if (!hostRec) {
      _hostTransferring = true;
      try {
        const remaining = Object.fromEntries(
          Object.entries(players).filter(([pid]) => pid !== snapshot.hostId)
        );
        await transferHost(gameId, remaining);
      } catch (e) {
        console.warn('[Host transfer] Failed', e);
      } finally {
        _hostTransferring = false;
      }
    }
  }

  // If the current player has given up, mark locally finished but keep stream open for the end screen
  if (currentPlayer && currentPlayer.gaveUp && !finished) {
    finished = true;
    await storageSet({ finished });
  }

  // Redirect to actorA when a round starts and we haven't redirected yet
  if (snapshot.startedAt && !hasRedirected) {
    if (snapshot.actorA && snapshot.actorB) {
      actorPair = [snapshot.actorA, snapshot.actorB];
      await storageSet({ actorPair });
    }

    const serverPlayerRec = snapshot.players?.[playerId] ?? null;
    const playerReadyFlag    = !!(serverPlayerRec?.ready);
    const playerGaveUpFlag   = !!(serverPlayerRec?.gaveUp);
    const explicitlyIncluded = !!(snapshot.participants?.[playerId]);
    const recentReadyRace    = lastReadyAt && snapshot.startedAt && Math.abs(snapshot.startedAt - lastReadyAt) < 5000;
    const amParticipant      = explicitlyIncluded || playerReadyFlag || (serverPlayerRec && !playerGaveUpFlag) || recentReadyRace;

    if (amParticipant) {
      finished = false;
      hasRedirected = false;
      clicks = 0;
      clickPath = actorPair?.[0] ? [actorPair[0].name] : [];
      await storageSet({ finished, hasRedirected, clicks, clickPath });
      await sleep(150);
      if (actorPair?.[0]?.url) {
        hasRedirected = true;
        await storageSet({ hasRedirected });
        window.location.href = actorPair[0].url;
        return;
      }
    }
  }

  // Toast notifications for newly finished players (not yourself)
  if (snapshot.status === 'active' || snapshot.status === 'finished') {
    for (const pid of playerIds) {
      if (pid === playerId) continue; // skip self
      if (players[pid]?.finishedAt && !players[pid]?.gaveUp && !_toastedFinishers.has(pid)) {
        _toastedFinishers.add(pid);
        const name = players[pid].name || pid;
        const c = Number(players[pid].clicks ?? 0);
        showFinishToast(name, c);
      }
    }
  } else if (snapshot.status === 'lobby') {
    _toastedFinishers.clear(); // reset between rounds
  }

  // Winner determination — any client can trigger this; _concluding prevents races
  const finishedPlayers = playerIds.filter(pid => players[pid]?.finishedAt && !players[pid]?.gaveUp);
  const DISCONNECT_MS = 10000;
  const nowTs = Date.now();
  const activePlayers = playerIds.filter(pid => {
    if (!players[pid] || players[pid].finishedAt || players[pid].gaveUp) return false;
    const lastSeen = Number(players[pid].lastSeen) || 0;
    const sinceStart = snapshot.startedAt ? (nowTs - snapshot.startedAt) : 0;
    if (lastSeen === 0 && sinceStart < DISCONNECT_MS) return true;
    return (nowTs - lastSeen) < DISCONNECT_MS;
  });

  const completionConclude = finishedPlayers.length >= 1 && activePlayers.length === 0;
  const timeLimitMs = Number(snapshot.roundTimeLimitMs ?? 0);
  const timeoutReached = timeLimitMs > 0 && snapshot.startedAt && (nowTs - snapshot.startedAt) >= timeLimitMs;
  const shouldEndRound =
    (completionConclude || timeoutReached) &&
    snapshot.status === 'active' &&
    !snapshot.endedAt &&
    !_concluding;

  if (shouldEndRound) {
    _concluding = true;
    try {
      const endedByTimeout = timeoutReached;
      const endedAt = Date.now();

      let winnerPid = null;
      let minClicks = null;
      if (finishedPlayers.length > 0) {
        minClicks = Infinity;
        for (const pid of finishedPlayers) {
          const c = Number(players[pid]?.clicks ?? Infinity);
          if (c < minClicks) minClicks = c;
        }

        let earliestFinishedAt = Infinity;
        for (const pid of finishedPlayers) {
          const c  = Number(players[pid]?.clicks ?? Infinity);
          const fa = Number(players[pid]?.finishedAt ?? Infinity);
          if (c === minClicks && fa < earliestFinishedAt) {
            earliestFinishedAt = fa;
            winnerPid = pid;
          }
        }
        if (!winnerPid) {
          winnerPid = finishedPlayers[0];
          minClicks = Number(players[winnerPid]?.clicks ?? Infinity);
        }
      }

      // If the round ended due to timeout, treat all non-finishers as "gave up"
      // so they stop clicking and show up under the "Did not finish" leaderboard section.
      if (endedByTimeout) {
        const pidsToGiveUp = playerIds.filter(
          pid => !players[pid]?.finishedAt && !players[pid]?.gaveUp
        );
        await Promise.all(
          pidsToGiveUp.map(pid => dbPatch(`${gameId}/players/${pid}`, { gaveUp: true, gaveUpAt: endedAt }))
        );
      }

      // Build round result for history
      const roundNum = Object.keys(snapshot.roundHistory || {}).length + 1;
      const roundPlayerSummary = {};
      for (const pid of playerIds) {
        const isGaveUpForResult = !!players[pid]?.gaveUp || (endedByTimeout && !players[pid]?.finishedAt);
        roundPlayerSummary[pid] = {
          name: players[pid]?.name || pid,
          clicks: players[pid]?.clicks ?? null,
          finishedAt: players[pid]?.finishedAt ?? null,
          gaveUp: isGaveUpForResult,
        };
      }
      const roundResult = {
        roundNum,
        winnerPid,
        winnerName: winnerPid ? (players[winnerPid]?.name || winnerPid) : null,
        winnerClicks: winnerPid ? minClicks : null,
        players: roundPlayerSummary,
        concludedAt: endedAt,
      };

      // Increment winner's win count
      let winsUpdate = null;
      if (winnerPid) {
        const currentWins = Number(snapshot.wins?.[winnerPid] ?? 0);
        winsUpdate = { [winnerPid]: currentWins + 1 };
      }

      // Write round history as a dedicated nested path to avoid multi-path SSE issues
      await dbPatch(`${gameId}/roundHistory`, { [roundNum]: roundResult });
      // Write game state — mark optimalPath as loading so clients show a spinner
      await dbPatch(`${gameId}`, {
        winner: winnerPid,
        winnerClicks: minClicks,
        status: 'finished',
        startedAt: null,
        endedAt,
        endedBy: endedByTimeout ? 'timeout' : 'completed',
        wins: winsUpdate ? Object.assign({}, snapshot.wins || {}, winsUpdate) : (snapshot.wins || {}),
        optimalPath: { loading: true },
      });
      if (winnerPid) {
        console.log(`Winner: ${winnerPid} in ${minClicks} clicks (Round ${roundNum})`);
      } else {
        console.log(`Round ended by timeout with no finishers (Round ${roundNum})`);
      }

      // Fetch the optimal path once (this client only) and write to Firebase
      // so all clients show the same result
      const actorAName = snapshot.actorA?.name;
      const actorBName = snapshot.actorB?.name;
      if (actorAName && actorBName) {
        try {
          const oracleUrl = `https://oracleofbacon.org/movielinks.php?a=${encodeURIComponent(actorAName)}&b=${encodeURIComponent(actorBName)}`;
          const html = await fetchViaBackground(oracleUrl);
          const { path } = parseOraclePath(html);
          if (path && path.length >= 2) {
            const orderedPath = [...path].reverse();
            const actorClicks = Math.floor(orderedPath.length / 2);
            await dbPatch(`${gameId}`, { optimalPath: { path: orderedPath, actorClicks } });
          } else {
            await dbPatch(`${gameId}`, { optimalPath: { notFound: true } });
          }
        } catch (e) {
          await dbPatch(`${gameId}`, { optimalPath: { notFound: true } });
        }
      } else {
        await dbPatch(`${gameId}`, { optimalPath: { notFound: true } });
      }
    } finally {
      _concluding = false;
    }
  }
}

// ----------------------
// Firebase SSE streaming — replaces setInterval polling

// Merge a Firebase SSE event into a local snapshot object
// Apply a Firebase SSE event into a local snapshot.
// put   at /      → full replacement (initial state or node deletion)
// patch at /      → shallow merge into root (e.g. writing winner/status without touching players)
// put   at /foo   → replace the value at that path
// patch at /foo   → merge into the object at that path
function applyStreamEvent(eventType, obj, path, data) {
  const isRoot = !path || path === '/';

  if (isRoot) {
    if (eventType === 'put')   return data;                              // full replacement
    if (eventType === 'patch') return Object.assign({}, obj || {}, data); // shallow merge
  }

  const result = obj ? JSON.parse(JSON.stringify(obj)) : {};
  const parts = path.replace(/^\//, '').split('/');
  let cur = result;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (data === null) {
    delete cur[last];
  } else if (eventType === 'patch' && typeof data === 'object' && cur[last] && typeof cur[last] === 'object') {
    Object.assign(cur[last], data);
  } else {
    cur[last] = data;
  }
  return result;
}

async function handleStreamEvent(eventType, path, data) {
  gameSnapshot = applyStreamEvent(eventType, gameSnapshot, path, data);
  if (gameSnapshot) await processSnapshot(gameSnapshot);
}

async function startStreaming() {
  if (_sseAbortController) return; // already open
  if (!gameId) return;

  if (_sseReconnectTimer) { clearTimeout(_sseReconnectTimer); _sseReconnectTimer = null; }

  _sseAbortController = new AbortController();

  // Heartbeat: write lastSeen every 3 s during active rounds so disconnect detection works.
  // Also re-evaluates processSnapshot so stale-lastSeen of other players is caught even
  // when nothing else changes in the DB.
  _sseHeartbeat = setInterval(async () => {
    if (!gameId || !gameSnapshot) return;
    if (gameSnapshot.status === 'active') {
      const cp = gameSnapshot.players?.[playerId];
      if (cp && !cp.finishedAt && !cp.gaveUp) {
        dbPatch(`${gameId}/players/${playerId}`, { lastSeen: Date.now() }).catch(() => {});
      }
      // Re-run logic so we catch when a previously-active player's lastSeen goes stale
      await processSnapshot(gameSnapshot);
    }
  }, 3000);

  try {
    const token = await getFirebaseToken();
    const url = `${GAMES_ROOT}/${gameId}.json?auth=${token}`;
    const response = await fetch(url, {
      signal: _sseAbortController.signal,
      headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
    });

    if (!response.ok) {
      console.warn('[SSE] Bad response', response.status);
      scheduleReconnect(); return;
    }

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let pendingEventType = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) { scheduleReconnect(); break; }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep partial last line

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          pendingEventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const raw = line.slice(6).trim();
          if (pendingEventType === 'auth_revoked') {
            _fbIdToken = null; _fbTokenExpiry = 0;
            stopStreaming(); startStreaming(); return;
          }
          if (pendingEventType === 'cancel') {
            gameSnapshot = null;
            gameInfo.innerHTML = `Game: <em>Not found</em>`; return;
          }
          if ((pendingEventType === 'put' || pendingEventType === 'patch') && raw !== 'null') {
            try {
              const { path, data } = JSON.parse(raw);
              await handleStreamEvent(pendingEventType, path, data);
            } catch (e) { console.warn('[SSE] Parse error', e); }
          }
          pendingEventType = null;
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') { console.warn('[SSE] Error', err); scheduleReconnect(); }
  }
}

function stopStreaming() {
  if (_sseAbortController) { _sseAbortController.abort(); _sseAbortController = null; }
  if (_sseHeartbeat)        { clearInterval(_sseHeartbeat); _sseHeartbeat = null; }
  if (_timerInterval)       { clearInterval(_timerInterval); _timerInterval = null; }
  gameSnapshot = null;
}

function scheduleReconnect() {
  stopStreaming();
  if (!gameId) return;
  if (_sseReconnectTimer) clearTimeout(_sseReconnectTimer);
  _sseReconnectTimer = setTimeout(() => { if (gameId) startStreaming(); }, 3000);
}

// Keep startPolling / stopPolling as aliases so all existing call sites work unchanged
function startPolling() { startStreaming(); }
function stopPolling()  { stopStreaming(); }

// ----------------------
// CLICK TRACKING (only actor page clicks) - preserved logic
document.addEventListener("click", async (event) => {
  if (!gameId || !playerId) return;

  const a = event.target.closest("a");
  if (!a) return;

  let href = a.getAttribute("href");
  if (!href) return;

  if (href.startsWith("/")) href = "https://www.imdb.com" + href;
  if (!href.startsWith("http")) return;

  // Only actor pages count (allow extra query params)
  if (!/^https:\/\/www\.imdb\.com\/name\/nm\d+\/?/.test(href)) return;

  // If we've already marked finished in this session, ignore further clicks
  if (finished) return;

  if (!actorPair) {
    try {
      const snapshot = await dbGet(`${gameId}`);
      if (snapshot && snapshot.actorA && snapshot.actorB)
        actorPair = [snapshot.actorA, snapshot.actorB];
    } catch (err) {
      console.warn("Failed to fetch actorPair during click", err);
    }
  }

  // Double-check server-side that this player hasn't finished or given up (prevents post-finish increments)
  try {
    const playerRec = await dbGet(`${gameId}/players/${playerId}`);
    if (playerRec && (playerRec.finishedAt || playerRec.gaveUp)) {
      finished = !!playerRec.finishedAt || !!playerRec.gaveUp;
      await storageSet({ finished });
      return;
    }

    // Determine new clicks based on latest known value (server preferred if available)
    const serverClicks = Number(playerRec?.clicks) || 0;
    const currentLocalClicks = Number(clicks) || 0;
    const base = Math.max(serverClicks, currentLocalClicks);
    const newClicks = base + 1;
    clicks = newClicks; // update local counter

    // Append this actor to the click path (clean up whitespace from anchor text)
    const clickedActorName = a.textContent.trim().replace(/\s+/g, ' ');
    if (clickedActorName) {
      clickPath.push(clickedActorName);
      await storageSet({ clicks, clickPath });
    } else {
      await storageSet({ clicks });
    }

    const targetUrl = actorPair?.[1]?.url;
    if (targetUrl && href.startsWith(targetUrl)) {
      // finishing click: write clicks + finishedAt + full path atomically
      const finishedAt = Date.now();
      await dbPatch(`${gameId}/players/${playerId}`, { clicks: newClicks, finishedAt, name: displayName, gaveUp: false, clickPath });
      finished = true;
      await storageSet({ clicks, finished, clickPath });
      // The poll function will now detect the winner and display the message to all players.
    } else {
      // non-finishing click: just update clicks
      await dbPatch(`${gameId}/players/${playerId}`, { clicks: newClicks, name: displayName, gaveUp: false });
    }
  } catch (err) {
    console.error("Failed to persist click", err);
  }
});

// ----------------------
// UI wiring
startBtn.addEventListener("click", async () => {
  displayName = (nameInput.value || "").trim() || displayName || `Player-${playerId}`;
  await storageSet({ displayName });
  createGameAndStart();
  updateGameControls();
});

joinBtn.addEventListener("click", () => {
  joinRow.style.display = joinRow.style.display === "none" ? "block" : "none";
});

joinSubmit.addEventListener("click", async () => {
  displayName = (nameInput.value || "").trim() || displayName || `Player-${playerId}`;
  await storageSet({ displayName });
  joinGameWithId(joinInput.value);
  updateGameControls();
});

leaveBtn.addEventListener("click", () => {
  leaveGame();
  updateGameControls();
});

// New: Give Up Button Listener
giveUpBtn.addEventListener("click", giveUpGame);


nameSaveBtn.addEventListener("click", async () => {
  displayName = (nameInput.value || "").trim() || displayName || `Player-${playerId}`;
  await storageSet({ displayName });
  setNameEditMode(false); // flip back to view mode
  if (gameId) {
    try {
      // Also update the name on the server, ensuring gaveUp status is preserved or defaulted
      await dbPatch(`${gameId}/players/${playerId}`, {
          name: displayName,
          gaveUp: (await dbGet(`${gameId}/players/${playerId}/gaveUp`)) || false
      });
    } catch (err) {
      console.warn("Failed to update name on server", err);
    }
  }
  refreshStatusUI();
});

// Play Again Button Listener (mark ready + return to lobby)
// Moved into named handler so it can be invoked by the button itself and by a fallback click detector
// --- REPLACE handlePlayAgainClick with this version ---
async function handlePlayAgainClick() {
  if (!gameId) return;
  try {
    // Reset local counters so the UI doesn't show previous round values
    clicks = 0;
    finished = false;
    hasRedirected = false;
    lastReadyAt = Date.now();
    openPaths.clear(); // clear accordion open state so previous round paths don't start expanded
    optimalPathRoundKey = null; // force re-fetch for the new round
    optimalPathResult = null;
    await storageSet({ clicks, finished, hasRedirected, lastReadyAt });

    // Mark this player ready for the next round (don't leave the game)
    await dbPatch(`${gameId}/players/${playerId}`, { ready: true, gaveUp: false, finishedAt: null, clicks: 0, name: displayName, gaveUpAt: null });

    // Also write an optimistic participants entry so the host's startRound can pick this guest up
    await dbPatch(`${gameId}/participants/${playerId}`, true);

    // Move the game into lobby mode so host can start the next round; clear previous winner/startedAt (do NOT clear participants)
    await dbPatch(`${gameId}`, { status: 'lobby', winner: null, winnerClicks: null, startedAt: null });

    // The stream will receive the patch event and call processSnapshot automatically.
    // Give it a moment then refresh controls from local snapshot.
    await sleep(200);
    if (gameSnapshot) { refreshStatusUI(gameSnapshot); renderPlayersList(gameSnapshot.players || {}, gameSnapshot.status, gameSnapshot.hostId === playerId); }
    updateGameControls();
  } catch (err) {
    console.error("Failed to ready for next round", err);
    alert("Failed to mark ready.");
  }
}

// attach handler to the button
playAgainBtn.addEventListener('click', handlePlayAgainClick);

// fallback: winnerBox click handler detects clicks that land within the visible button rect
// and calls the same handler. This helps if something overlays the button and prevents
// the button's own click event from firing in some browsers / devices.
winnerBox.addEventListener('click', (e) => {
  try {
    const rect = playAgainBtn.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      // call handler but don't await (click handler already handles async)
      handlePlayAgainClick();
      // prevent duplicate handling by preventing default propagation
      e.preventDefault();
      e.stopPropagation();
    }
  } catch (err) {
    // ignore; non-critical
  }
});

// ----------------------
// ----------------------
// Page enhancement: enforce actor-only filmography filter on /name/ pages
// ----------------------
(function enforceActorFilter() {
  if (!window.location.pathname.startsWith('/name/')) return;

  // Talk shows / chat shows / morning shows — always hidden globally
  const TALK_SHOW_PATTERNS = [
    /\btonight show\b/i,
    /\blate show\b/i,
    /\blate late show\b/i,
    /\blate night with\b/i,
    /\bjimmy kimmel\b/i,
    /\bjimmy fallon\b/i,
    /\bfallon\b.*\btonight\b/i,
    /\bconan\b/i,
    /\bellen degeneres\b/i,
    /\bthe ellen show\b/i,
    /\bgraham norton\b/i,
    /\bjonathan ross\b/i,
    /\bsaturday night live\b/i,
    /\bsnl\b/i,
    /\bthe view\b/i,
    /\bgood morning america\b/i,
    /\btoday show\b/i,
    /\bthe today show\b/i,
    /\bdaily show\b/i,
    /\bcolbert report\b/i,
    /\blate show with stephen colbert\b/i,
    /\bdavid letterman\b/i,
    /\bjay leno\b/i,
    /\bthe tonight show starring\b/i,
    /\bseth meyers\b/i,
    /\blast week tonight\b/i,
    /\bwatch what happens live\b/i,
    /\breal time with bill maher\b/i,
    /\bjames corden\b/i,
    /\blate late show with james corden\b/i,
    /\bcraig ferguson\b/i,
    /\bchelsea lately\b/i,
    /\blive with kelly\b/i,
    /\boprah winfrey show\b/i,
    /\bthe oprah\b/i,
    /\bwendy williams\b/i,
    /\baccess hollywood\b/i,
    /\bentertainment tonight\b/i,
    /\bthe rosie o'donnell\b/i,
    /\btrevor noah\b/i,
    /\bdaily show with trevor noah\b/i,
    /\btalk show\b/i,
    /\bchat show\b/i,
    /\bmorning show\b/i,
    /\bbreakfast show\b/i,
    /\bbreakfast tv\b/i,
    /\bthis morning\b/i,
    /\bloose women\b/i,
    /\bgood morning britain\b/i,
    /\bdaybreak\b/i,
    /\blorraine\b/i,
    /\bthe one show\b/i,
    /\bthe late late\b/i,
    /\bthe late show\b/i,
    /\bthe early show\b/i,
    /\bcbs this morning\b/i,
    /\bnbc nightly news\b/i,
    /\babc news\b/i,
    /\bgma\b/i,
    /\bextra \(tv\b/i,
    /\bextra tv\b/i,
    /\bthe talk\b/i,
    /\bthe chew\b/i,
    /\bmaury\b/i,
    /\bjerry springer\b/i,
    /\bdoctor oz\b/i,
    /\bdr\. oz\b/i,
    /\bthe dr\. oz show\b/i,
    /\bkelly and ryan\b/i,
    /\blive with regis\b/i,
    /\bregis and kelly\b/i,
  ];

  function isTalkShow(title) {
    return TALK_SHOW_PATTERNS.some(p => p.test(title));
  }

  function hideEl(el) {
    if (el.style.display === 'none') return; // already hidden
    el.style.display = 'none';
    el.setAttribute('data-race-hidden', '1');
  }

  function restoreFiltered() {
    document.querySelectorAll('[data-race-hidden]').forEach(el => {
      el.style.display = '';
      el.removeAttribute('data-race-hidden');
    });
  }

  function applyFilter() {
    // Only enforce restrictions while a round is actively in progress
    if (!roundIsActive) {
      restoreFiltered();
      return;
    }

    const selected   = Array.from(document.querySelectorAll('.filmography-selected-chip-filter'));
    const unselected = Array.from(document.querySelectorAll('.filmography-unselected-chip-filter'));
    if (selected.length === 0 && unselected.length === 0) return; // not rendered yet

    const getLabel = chip => chip.querySelector('.ipc-chip__text')?.childNodes[0]?.nodeValue?.trim() ?? '';

    // Deselect + hide any active non-Actor chip (click first so React updates the filmography list)
    selected.forEach(chip => {
      if (getLabel(chip) !== 'Actor') {
        chip.click();
        hideEl(chip);
      }
    });

    // Hide unselected non-Actor chips; activate Actor if it somehow isn't already
    unselected.forEach(chip => {
      const label = getLabel(chip);
      if (label === 'Actor') {
        chip.click(); // activate it
      } else {
        hideEl(chip);
      }
    });

    // Hide non-Actor section headings and their accordion containers
    document.querySelectorAll('[class*="filmo-section-"]').forEach(titleEl => {
      const label = titleEl.querySelector('h3.ipc-title__text')?.textContent?.trim() ?? '';
      if (label !== 'Actor' && label !== 'Actress') {
        hideEl(titleEl);
        const container = titleEl.nextElementSibling;
        if (container) hideEl(container);
      }
    });

    // Hide the entire "Recently Viewed" section — it can contain destination actors
    // that players could click directly to cheat
    document.querySelectorAll('.recently-viewed, section.recently-viewed-items').forEach(el => {
      hideEl(el);
    });

    // Hide individual talk show credit rows (actor filmography accordion)
    document.querySelectorAll('li.ipc-metadata-list-summary-item').forEach(li => {
      const titleEl = li.querySelector('.ipc-metadata-list-summary-item__t');
      if (!titleEl) return;
      if (isTalkShow(titleEl.textContent.trim())) {
        hideEl(li);
      }
    });

    // Hide ANY link to a talk show title anywhere on the page
    // (recently viewed, recommendations, trivia, known-for, etc.)
    document.querySelectorAll('a[href*="/title/tt"]').forEach(anchor => {
      const text = anchor.textContent.trim();
      if (!text || !isTalkShow(text)) return;
      // Hide the closest li ancestor (covers cards, trivia items, list rows),
      // or fall back to hiding the anchor's direct parent element.
      const container = anchor.closest('li') || anchor.parentElement;
      if (container && container.style.display !== 'none') {
        hideEl(container);
      }
    });
  }

  // Run once when chips are already in the DOM, and observe for lazy-loaded content
  const observer = new MutationObserver(() => applyFilter());
  observer.observe(document.body, { childList: true, subtree: true });
  applyFilter();
})();

// ----------------------
// Page enhancement: hide site search during active rounds (applies on all IMDB pages)
// ----------------------
(function enforceSearchHide() {
  const ATTR = 'data-race-search-hidden';

  function hideSearch() {
    const form = document.querySelector('#nav-search-form');
    if (!form) return;
    if (roundIsActive) {
      if (!form.hasAttribute(ATTR)) {
        form.style.visibility = 'hidden';
        form.style.pointerEvents = 'none';
        form.setAttribute(ATTR, '1');
      }
    } else {
      if (form.hasAttribute(ATTR)) {
        form.style.visibility = '';
        form.style.pointerEvents = '';
        form.removeAttribute(ATTR);
      }
    }
  }

  const observer = new MutationObserver(() => hideSearch());
  observer.observe(document.body, { childList: true, subtree: true });
  hideSearch();
})();

// ----------------------
// Page enhancement: always expand Previous / Upcoming acting-role accordions on actor pages
// ----------------------
(function expandActorAccordions() {
  if (!window.location.pathname.startsWith('/name/')) return;

  function expandAll() {
    document.querySelectorAll('[data-testid="nm-flmg-all-accordion-expander"]').forEach(btn => {
      if (btn.textContent.trim() === 'Expand below') btn.click();
    });
  }

  const observer = new MutationObserver(() => expandAll());
  observer.observe(document.body, { childList: true, subtree: true });
  expandAll();
})();

// initialRefresh() was removed — init() at the top of this file handles all rehydration.
// Having two concurrent async IIFEs caused races and double startPolling() calls.