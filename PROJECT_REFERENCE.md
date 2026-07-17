# IMDB Competitive Click Race Extension — Project Reference

**Last Updated:** March 19, 2026
**Project Status:** Active development — actor list complete
**Current Actor Count:** 200 actors
**Target:** 200 actors ✅ COMPLETE

---

## Quick Context

This is a Chrome Extension (Manifest V3) that creates a competitive "click race" game where players navigate from one IMDB actor to another in the fewest clicks possible. The extension tracks wins, leaderboards, and fastest routes.

---

## File Locations

All files are in: `/Users/robertstebbing/imdb-competitive-extension/`

- **`content.js`** — Main extension logic, game state, UI rendering
- **`actors.js`** — Static list of { name, url } actor objects (CRITICAL FILE)
- **`manifest.json`** — Extension config
- **`verify-actors.html`** — Browser-based tool to verify IMDB URLs (in /sessions/.../mnt/)

---

## Critical Technical Notes

### IMDB URL Format
```javascript
{
  name: "Actor Full Name",
  url: "https://www.imdb.com/name/nmXXXXXXXX/"
}
```
- **MUST use `nm` prefix followed by 7-8 digit numeric ID**
- Example: `nm0000104` (correct), `nm114` (wrong), `nm00000114` (wrong)
- IMDB blocks server-side fetches (Node.js, curl, wget) — verification must be done in-browser or via web search

### Actor List Source Default
Three locations in `content.js` default to `'static'` (not `'dynamic'`):
- Line ~979
- Line ~1061
- Line ~1369

Always verify this is set to `'static'` after any merge/update.

---

## Recent Changes (Session History)

### UI/UX Changes (Completed)
- ✅ Leaderboard visual hierarchy: winner has gold left-border, opacity gradient for lower ranks
- ✅ Winner path accordion: labeled "▶ What path did they take?", full width
- ✅ Session standings: compressed to single line
- ✅ Fastest route section: "Fastest route you could have taken?" with click count inline
- ✅ Name input field: fixed height to match "Enter Game ID" field
- ✅ Password gate: Shift+click on header opens debug panel (password: `sebastio`)
- ✅ Headshots: attempted, then **fully rolled back** (looked worse than native IMDB)

### Actor Updates (Completed)
- ✅ Removed: Cary Grant, Humphrey Bogart, Grace Kelly, Katharine Hepburn
- ✅ Added ~50 modern Oscar/Golden Globe nominees from last 5 years
- ✅ Verified all 147 current actors via web search (many nm ID corrections made)
  - Example: Antonio Banderas was `nm0000114` (wrong), corrected to `nm0000104`
  - Used two-pass verification strategy to catch all errors

### Critical Learning: Actor URL Verification
**DO NOT rely on memory for nm IDs.** Always verify via:
1. Web search agent: "Actor Name IMDB" — look for official IMDB profile
2. Check the URL in the search results
3. Extract the nm ID from the profile URL

Previous mistakes that were caught:
- Antonio Banderas: remembered as Steve Buscemi's nm ID
- Penélope Cruz: had wrong accent or digit transposition
- Paul Mescal: had wildly incorrect nm ID (10394100 → 8958770)

---

## Actors.js Current Format & Organization

Example structure (first ~10 of 147):
```javascript
const actors = [
  { name: "Leonardo DiCaprio", url: "https://www.imdb.com/name/nm0000138/" },
  { name: "Brad Pitt", url: "https://www.imdb.com/name/nm0000199/" },
  // ... 145 more actors
];

module.exports = actors;
```

Current 147 actors include:
- Classic Hollywood legends (DiCaprio, Pitt, Hanks, Streep, etc.)
- Recent Oscar winners & nominees (2021-2025)
- Rising generation (Paul Mescal, Barry Keoghan, Sebastian Stan, etc.)
- Franchise connectors (MCU, Star Wars actors)

---

## Pending Work: Add 53 Actors to Reach 200

### Requirements
- Oscar or Golden Globe nominees, last 5 years (2021-2025)
- Well-known films from recent years
- Similar fame/recognition level to existing list (e.g., Paul Mescal, Barry Keoghan, Timothée Chalamet)
- **MUST verify all nm IDs before adding** (use web search, not memory)

### Verification Process
1. Create list of 53 candidate actors
2. Use web search agent to find each actor's IMDB profile
3. Extract nm ID from profile URL
4. Document the actor + verified nm ID
5. Add to actors.js in chronological order (or by category)

### Candidate Categories to Fill
- 2025 Oscar nominees (films of 2024) — e.g., Demi Moore, Mikey Madison, Cynthia Erivo
- 2024 Oscar nominees (films of 2023) — e.g., Kirsten Dunst, Ariana DeBose, Troy Kotsur
- 2023 Oscar nominees (films of 2022) — e.g., Jessie Buckley, Judi Dench
- Rising generation — e.g., Jonathan Majors, John David Washington, Steven Yeun
- International/diverse talent — e.g., Youn Yuh-jung, Riz Ahmed, Awkwafina
- Franchise leads — e.g., Tom Holland, Daisy Ridley, Henry Cavill

---

## Password Gate (Debug Panel)

Location: `content.js`, before Shift+click handler
- Triggering: Shift+click on page header opens custom password overlay
- Password: `sebastio` (plain text in code — visible to extension inspection, but adequate for casual protection)
- Custom UI: Not `window.prompt()` — custom DOM overlay

---

## Testing & Verification Tools

### verify-actors.html
Location: `/sessions/youthful-optimistic-goldberg/mnt/imdb-competitive-extension/verify-actors.html`

- Browser-based tool listing all current actors with clickable IMDB links
- Flags actors with nm numbers > 5,000,000 (newer actors, usually correct)
- **Use this to spot-check URLs after adding new actors**

### Debug Panel
- Shift+click extension header (password: `sebastio`)
- Jump to destination: test individual actor URLs
- View game state, leaderboard, etc.

---

## Known Issues & Decisions

### Headshots (ROLLED BACK)
- Feature: Fetching actor headshots from IMDB og:image meta tag
- Status: Fully removed from codebase
- Reason: Visual feedback indicated it looked worse than native IMDB experience
- Learning: Sometimes simplicity wins

### IMDB Server-Side Blocking
- Node.js fetches to IMDB fail with network errors
- Solution: Use browser (HTML page with links) or web search for verification
- Don't attempt curl, wget, or server-side node scripts for IMDB data

---

## Next Session Checklist

- [ ] Verify 53 new actors via web search
- [ ] Add verified actors to actors.js (keep current 147 intact)
- [ ] Update actors.js file date/count in header comment
- [ ] Run verify-actors.html to spot-check new additions
- [ ] Test extension in Chrome (load unpacked) with new actor list
- [ ] Document which new actors were added in actors.js comments

---

## Code Snippets for Reference

### Adding an Actor (Format)
```javascript
{ name: "Actor Full Name", url: "https://www.imdb.com/name/nmXXXXXXXX/" },
```

### Actor List Source Default (Check These Lines)
```javascript
// Line ~979
let selectedSource = localStorage.getItem('actorListSource') || 'static';

// Line ~1061
actorListSource: 'static',

// Line ~1369
const source = localStorage.getItem('actorListSource') || 'static';
```

### Debug Password Overlay (Snippet)
```javascript
function promptDebugPassword(onSuccess) {
  // Creates custom DOM overlay with password input
  // Checks: if (value === 'sebastio') { onSuccess(); }
}
```

---

## Contact/Notes

- **Password:** `sebastio` (for debug panel)
- **Extension Type:** Manifest V3 Chrome Extension
- **Database:** Firebase Realtime Database (for game state, leaderboards)
- **Current Actor Count:** 200 ✅
- **Target:** 200 (complete)

---

**Goal:** Keep this document updated across sessions to avoid context window bloat and provide instant onboarding for continuation sessions.
