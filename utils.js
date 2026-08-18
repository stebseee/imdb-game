// utils.js — small helpers: id/sleep, chrome.storage wrappers, cross-origin fetch.
// Split from content.js (v1.6 refactor) — code moved verbatim, no logic changes.

// ----------------------
// Utilities
function randId(len = 5) { return Math.random().toString(36).substr(2, len).toUpperCase(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

