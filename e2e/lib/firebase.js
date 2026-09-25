// firebase.js — tiny Firebase Realtime Database REST client for the e2e tests.
//
// The test reads Firebase directly (the source of truth) to confirm each bot's
// clicks/give-ups landed and to check the recorded career stats. It signs in
// anonymously exactly like the extension does. The API key and DB URL are read
// from the extension's own config.js so they never go out of sync.

const fs = require('fs');
const path = require('path');

const configSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'config.js'), 'utf8');
const API_KEY = (configSrc.match(/FIREBASE_API_KEY\s*=\s*"([^"]+)"/) || [])[1];
const DB_URL = (configSrc.match(/FIREBASE_DB_URL\s*=\s*"([^"]+)"/) || [])[1];
if (!API_KEY || !DB_URL) throw new Error('Could not read FIREBASE_API_KEY / FIREBASE_DB_URL from config.js');

let _token = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry - 60_000) return _token;
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const data = await res.json();
  if (!data.idToken) throw new Error(`Firebase anonymous sign-in failed: ${JSON.stringify(data)}`);
  _token = data.idToken;
  _tokenExpiry = Date.now() + Number(data.expiresIn) * 1000;
  return _token;
}

async function dbGet(dbPath) {
  const token = await getToken();
  const res = await fetch(`${DB_URL}/${dbPath}.json?auth=${token}`);
  if (!res.ok) throw new Error(`GET ${dbPath} failed: HTTP ${res.status}`);
  return res.json();
}

async function dbDelete(dbPath) {
  const token = await getToken();
  const res = await fetch(`${DB_URL}/${dbPath}.json?auth=${token}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${dbPath} failed: HTTP ${res.status}`);
}

// Poll `fn` until it returns a truthy value (which is returned), or throw after
// `timeout` ms with a message saying what we were waiting for.
async function waitFor(fn, { timeout = 30_000, interval = 500, what = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) { lastErr = e; }
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`Timed out after ${timeout / 1000}s waiting for: ${what}${lastErr ? ` (last error: ${lastErr.message})` : ''}`);
}

module.exports = { dbGet, dbDelete, waitFor };
