// firebase.js — anonymous auth token + REST DB helpers (dbPut/Patch/Get/Delete) + cleanup.
// Split from content.js (v1.6 refactor) — code moved verbatim, no logic changes.

// ----------------------
// Firebase Anonymous Auth
// Signs in anonymously once per browser and caches the token in chrome.storage.
// All db helpers append ?auth=TOKEN so security rules can enforce auth != null.
let _fbIdToken = null;
let _fbTokenExpiry = 0;
let _fbTokenInFlight = null; // shared promise so N concurrent callers make ONE auth request

// Public entry point: returns a valid token, coalescing concurrent callers.
// The content script reloads on every navigation, so many call sites (SSE,
// session validation, stats, heartbeat) all ask for a token at once on load —
// without this coalescing each fired its own sign-in/refresh, hammering Google's
// auth endpoints and tripping rate limits (TOO_MANY_ATTEMPTS_TRY_LATER).
async function getFirebaseToken() {
  // Return cached token if still valid (with 60 s buffer)
  if (_fbIdToken && Date.now() < _fbTokenExpiry - 60_000) return _fbIdToken;
  // A fetch is already underway this page load — reuse it instead of starting another.
  if (_fbTokenInFlight) return _fbTokenInFlight;
  _fbTokenInFlight = _acquireFirebaseToken().finally(() => { _fbTokenInFlight = null; });
  return _fbTokenInFlight;
}

async function _acquireFirebaseToken() {
  // Re-check the cache in case a prior in-flight request just populated it.
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

