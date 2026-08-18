// imdb.js — IMDB/Oracle DOM helpers: actor-page section removal, Oracle path parse, dynamic actor list.
// Split from content.js (v1.6 refactor) — code moved verbatim, no logic changes.

// ----------------------
// Hide distracting/misleading sections on actor pages
function removeActorPageSections() {
  let allRemoved = true;

  // 'Known for' — can show producer credits which confuse gameplay
  const knownFor = document.querySelector('[data-testid="nm_flmg_kwn_for"]');
  if (knownFor) {
    let node = knownFor;
    while (node && node.tagName !== 'SECTION') node = node.parentElement;
    (node || knownFor).remove();
  } else {
    allRemoved = false;
  }

  // 'Personal details' — contains clickable birth location links
  const personalDetails = document.querySelector('[data-testid="PersonalDetails"]');
  if (personalDetails) {
    personalDetails.remove();
  } else {
    allRemoved = false;
  }

  return allRemoved;
}
if (!removeActorPageSections()) {
  // IMDB renders some sections dynamically — observe until they appear
  const _sectionObserver = new MutationObserver(() => {
    if (removeActorPageSections()) _sectionObserver.disconnect();
  });
  _sectionObserver.observe(document.body, { childList: true, subtree: true });
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

