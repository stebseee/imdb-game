// background.js — Manifest V3 service worker
// Handles cross-origin fetches on behalf of content scripts.
// Background service workers are not subject to CORS, so they can fetch
// oracleofbacon.org (which sends no CORS headers) without being blocked.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_URL') {
    fetch(message.url, {
      headers: { 'Accept': 'text/html,application/xhtml+xml' }
    })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then(text => sendResponse({ ok: true, text }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // keep message channel open for async response
  }
});
