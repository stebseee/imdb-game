# IMDB Click Race — Session Handoff

Use this file to brief Claude at the start of a new session.

---

## What this project is

A Chrome extension called **"IMDB Click Race: Six Degrees of Kevin Bacon"** — a multiplayer game where players race to connect two actors through their IMDB filmographies using the fewest clicks. Up to 6 players join a lobby, a random actor pair is chosen, and everyone races simultaneously on their own IMDB browser.

**Live on Chrome Web Store** (published, currently v1.3 live, v1.4 built and ready to submit).

---

## Extension file structure

All files live in the user's selected folder (referred to as "the extension folder"):

| File | Purpose |
|---|---|
| `manifest.json` | Extension config, currently v1.4 |
| `content.js` | Main game logic — runs on every IMDB page |
| `content.css` | Styles for the game UI overlay |
| `actors.js` | Static list of actor name/URL pairs used for random pair selection |
| `background.js` | Service worker — proxies Oracle of Bacon fetches (no CORS headers) |
| `popup.html` | Shown when user clicks the extension icon in toolbar |
| `privacy.html` | Privacy policy, hosted on GitHub Pages |
| `icon16.png` / `icon48.png` / `icon128.png` | Extension icons (generated from clapperboard source image) |
| `Store releases/` | Folder containing zipped builds for Chrome Web Store submissions |

---

## Tech stack

- **Firebase Realtime Database** — game state, player records, lobby management
- **Firebase Anonymous Auth** — players sign in anonymously; tokens cached in `chrome.storage`
- **Oracle of Bacon API** — used to compute the optimal path between two actors (shown at end of round)
- **Manifest V3** Chrome extension

### Key constants in `content.js`
```js
const FIREBASE_DB_URL = "https://imdb-game-343f1-default-rtdb.firebaseio.com";
const FIREBASE_API_KEY = "AIzaSyBLyKiLclFPaOz7kwGbMUMrw88hvEGIIak";
```

The Firebase API key is intentionally public (Firebase web app design), but security relies on Firebase Security Rules (`auth != null`).

---

## Current manifest (`manifest.json`)

```json
{
  "manifest_version": 3,
  "name": "IMDB Click Race: Six Degrees of Kevin Bacon",
  "version": "1.4",
  "description": "Multiplayer IMDB actor-click race — join a lobby with up to 6 players and race to connect two actors through their filmographies.",
  "permissions": ["storage"],
  "host_permissions": [
    "https://www.imdb.com/*",
    "https://imdb-game-343f1-default-rtdb.firebaseio.com/",
    "https://oracleofbacon.org/*"
  ],
  "icons": {"16": "icon16.png", "48": "icon48.png", "128": "icon128.png"},
  "action": {
    "default_icon": {"16": "icon16.png", "48": "icon48.png", "128": "icon128.png"},
    "default_popup": "popup.html"
  },
  "background": {"service_worker": "background.js"},
  "content_scripts": [{
    "matches": ["https://www.imdb.com/*"],
    "js": ["actors.js", "content.js"],
    "css": ["content.css"],
    "run_at": "document_idle"
  }]
}
```

---

## Chrome Web Store details

- **Store URL**: Live on Chrome Web Store (search "IMDB Click Race")
- **Privacy policy**: `https://robapp1.github.io/imdb-game/imdb-competitive-extension/privacy.html`
- **GitHub repo**: `https://github.com/robapp1/imdb-game/tree/main/imdb-competitive-extension`
- **Last approved version**: 1.2 (had `scripting` permission removed after rejection)
- **v1.3 submitted and live**
- **v1.4 built, not yet submitted**

---

## Changes made in v1.3

### 1. Hide "Known for" section on actor pages
The "Known for" section on IMDB actor pages can show producer/writer credits, confusing players into thinking a movie link is valid when it's not. Removed via JS targeting `data-testid="nm_flmg_kwn_for"`.

**Note**: An earlier attempt used CSS (`section:has(#name_known_for) { display: none }`) which accidentally blanked the entire page. That was reverted. The JS approach is correct.

### 2. Hide "Personal details" section on actor pages
The "Personal details" section contains clickable links (e.g. birth location → search results) that players could use to navigate outside the intended actor→movie→actor path, gaining an unfair advantage. Removed via JS targeting `data-testid="PersonalDetails"]`.

Both sections are handled together in `content.js` at the very top:
```js
function removeActorPageSections() {
  // removes [data-testid="nm_flmg_kwn_for"] and [data-testid="PersonalDetails"]
  // uses MutationObserver to catch dynamically rendered sections
}
```

### 3. Back button penalty click
If a player uses the browser back button during an active round, they receive +1 penalty click. Detected on page load via:
```js
performance.getEntriesByType('navigation')[0]?.type === 'back_forward'
```
A dark red toast notification appears centre-screen: **"⚠️ Back button used — +1 penalty click!"** — matching the style of the existing finish toast. Only fires during an active game when the player hasn't already finished.

---

## Changes made in v1.4

### 1. actors.js — Succession cast added
5 main Succession cast members added (Kieran Culkin and Jeremy Strong were already present). Actor count now 205.
- Brian Cox — `nm0004051`
- Sarah Snook — `nm3512758`
- Matthew Macfadyen — `nm0532193`
- Nicholas Braun — `nm1002609`
- J. Smith-Cameron — `nm0810397`

### 2. Title page click path — sub-pages excluded
The page-load click path tracker previously logged any `/title/` URL, including `/fullcredits`, `/reviews`, `/trivia` etc. Fixed to only log the exact movie/show page (exactly 2 path segments). Any sub-page is now silently ignored.

### 3. Sidebar sections hidden during active rounds
User lists, polls, and editorial lists in the IMDB sidebar are hidden during an active round to prevent shortcut navigation. Implemented as `enforceSidebarHide()` IIFE. Restores when round ends.
- `[data-testid="SidebarList-user"]`
- `[data-testid="SidebarList-polls"]`
- `[data-testid="SidebarList-editorial"]`

### 4. Full credits page — non-cast sections hidden during active rounds
On `/fullcredits` pages, all sections except Cast are hidden during active rounds (Directors, Writers, Producers, etc.). Sections share the same class so are identified by their `<h3>` heading text. Implemented as `enforceFullCreditsFilter()` IIFE. Restores when round ends.

### 5. IMDB logo link disarmed during active rounds
The IMDB header logo (`#home_img_holder`) navigates to the homepage, where players could find actors to click. During active rounds the `href` is removed and cursor changed to default. Implemented as `enforceLogoDisarm()` IIFE. Original href saved in a `data-*` attribute and restored when round ends.

### 6. Director / Writer / Creator links disarmed on title pages during active rounds
On movie and TV show pages, the principal credits block shows Director, Writer, and Creator names as clickable links. During active rounds these links have their `href` removed and `pointer-events` disabled so they show as plain text. Stars/actor links are untouched. Also disarms the "See full cast and crew" arrow icon link. Implemented as `enforceCrewLinkDisarm()` IIFE. Restores when round ends.

---

## How the game works (for context)

1. One player creates a game and shares a lobby code
2. Everyone joins and sets a display name
3. Host clicks Start — a random actor pair (A → B) is selected from `actors.js`
4. All players are redirected to Actor A's IMDB page simultaneously
5. Players click through filmographies (actor → movie → actor → movie…) trying to reach Actor B
6. Only clicks on **actor names** count — movie clicks are free
7. Fewest actor clicks wins; ties broken by time
8. At end of round, the optimal path (via Oracle of Bacon) is shown
9. Players can play again with a new pair

---

## Round-gating pattern (important for future changes)

All IMDB page restrictions use `roundIsActive` (declared at ~line 323 in `content.js`) to gate behaviour. The pattern is always an IIFE placed at the **bottom** of the file (after `roundIsActive` is declared), following this structure:

```js
(function enforceXxx() {
  const ATTR = 'data-race-xxx';
  function apply() {
    if (roundIsActive) {
      // find element, store original state in ATTR, apply restriction
    } else {
      // find elements with ATTR, restore original state, remove ATTR
    }
  }
  const observer = new MutationObserver(() => apply());
  observer.observe(document.body, { childList: true, subtree: true });
  apply();
})();
```

**Critical**: never place these IIFEs before line 323 — `roundIsActive` uses `let` and is not hoisted, so early placement causes a ReferenceError that crashes the entire script and hides the game modal.

Existing enforce functions (all near bottom of `content.js`):
- `enforceSearchHide()` — hides the site search bar
- `enforceLogoDisarm()` — disarms header logo link
- `enforceSidebarHide()` — hides sidebar list sections
- `enforceCrewLinkDisarm()` — disarms director/writer/creator links on title pages
- `enforceFullCreditsFilter()` — hides non-cast sections on fullcredits pages

---

## Pending / recommended improvements

### HIGH PRIORITY
- **Tighten Firebase Security Rules** — current rules only check `auth != null`, meaning any anonymous user who extracts the API key could write to any game record. Better rules:
  ```json
  {
    "rules": {
      "games": {
        "$gameId": {
          "players": {
            "$playerId": {
              ".write": "auth != null && auth.uid == $playerId",
              ".read": "auth != null"
            }
          },
          ".read": "auth != null",
          ".write": "auth != null"
        }
      }
    }
  }
  ```
  Update this in the Firebase console under Realtime Database → Rules.

### OTHER IDEAS (discussed but not built)
- **In-game chat** — discussed in detail. Would add a `chat/` node under each game ID in Firebase. Messages store playerName, message text, timestamp. Chat spans the whole session across rounds and deletes with the game after 24hrs. UI would be a collapsible floating panel. Firebase cost would be minimal.
- Leaderboard / persistent stats across sessions
- Better actor list management (currently hardcoded in `actors.js`)

---

## Key things Claude should know

- The `scripting` permission was removed from the manifest after a Chrome Web Store rejection — **do not add it back**
- The SSE network error that appears in console (`TypeError: network error`) is **expected** — it fires when the content script context is destroyed on page navigation, and `scheduleReconnect()` handles it automatically. Not a bug.
- `content.css` does not contain section-hiding rules — all hiding is done in JS only
- When reading `content.js` note it is a large file (~3000+ lines) — use `offset` and `limit` parameters when reading, or `Grep` to find specific sections
- The Glob tool has trouble finding files in the mounted folder — use `Read` with the full path directly, or `Bash` with `ls`
- IMDB cannot be fetched directly (network blocked in Cowork) — use WebSearch with `allowed_domains: ["imdb.com"]` to look up actor nm IDs. Never trust Claude's training data alone for nm IDs — always verify via search.
