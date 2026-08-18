// main.js — bootstrap/init IIFE. MUST load last; wires up UI + game state on page load.
// Split from content.js (v1.6 refactor) — code moved verbatim, no logic changes.

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

    const stored = await storageGet(['playerId', 'gameId', 'actorPair', 'clicks', 'displayName', 'role', 'hasRedirected', 'finished', 'roundStartedAt', 'lastReadyAt', 'clickPath', 'panelCollapsed', 'roundTimeLimitSec', 'chatMinimised', 'chatLastSeenTime', 'toastedFinishers']);
    // Restore collapsed state before anything else renders
    if (stored.panelCollapsed) applyPanelCollapse(true);
    else applyPanelCollapse(false);
    // Restore chat panel state (defaults to minimised if never set)
    _chatMinimised = stored.chatMinimised !== false;
    chatBody.style.display = _chatMinimised ? 'none' : 'flex';
    chatToggleBtn.textContent = _chatMinimised ? '+' : '−';
    chatToggleBtn.title = _chatMinimised ? 'Expand chat' : 'Minimise chat';
    // Restore last-seen timestamp so unread count survives page navigation
    _chatLastSeenTime = stored.chatLastSeenTime || 0;
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
    if (Array.isArray(stored.toastedFinishers)) _toastedFinishers = new Set(stored.toastedFinishers);
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
    // Excludes sub-pages (/fullcredits, /reviews, etc.) — only the main title page is logged.
    // /list/ URLs are naturally excluded as they don't start with /title/.
    if (window.location.pathname.startsWith('/title/') && window.location.pathname.split('/').filter(Boolean).length === 2) {
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

        // Back-button penalty: if this page was reached via browser back/forward,
        // charge 1 extra click and notify the player
        const _navType = performance.getEntriesByType('navigation')[0]?.type;
        if (_navType === 'back_forward' && snap?.status === 'active' && !finished) {
          clicks = clicks + 1;
          // Log the page we've landed back on so the path reflects the back-and-forth.
          // For /title/ pages the title-page tracker above has already added it (dedup handles
          // any double). For /name/ pages this is the only chance to record the actor.
          const backPageName = document.title.replace(/\s*[-–]\s*IMDb\s*$/i, '').trim();
          if (backPageName && clickPath[clickPath.length - 1] !== backPageName) {
            clickPath.push(backPageName);
          }
          await storageSet({ clicks, clickPath });
          await dbPatch(`${gameId}/players/${playerId}`, { clicks, name: displayName, gaveUp: false });
          showPenaltyToast();
        }

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

