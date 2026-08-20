// game.js — game operations, host transfer/kick, snapshot logic, chat, SSE streaming, click tracking, UI wiring.
// Split from content.js (v1.6 refactor) — code moved verbatim, no logic changes.

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

  // Shared round payload. SSE fires after player records are already clean.
  const roundPayload = {
    actorA: newActorPair[0],
    actorB: newActorPair[1],
    winner: null,
    winnerClicks: null,
    optimalPath: null,
    roundTimeLimitMs: roundTimeLimitMsToWrite,
    endedAt: null,
    endedBy: null,
    participants
  };

  // Solo (host alone) starts immediately. Multiplayer gets a pre-round countdown so
  // players who haven't readied up yet get a heads-up before the round begins. During
  // 'starting' we leave startedAt null so no one redirects until the countdown flips
  // the game to 'active' (handled by the countdown ticker in processSnapshot).
  if (participantIds.length > 1) {
    await dbPatch(`${gameId}`, {
      ...roundPayload,
      status: "starting",
      startAt: Date.now() + ROUND_COUNTDOWN_MS,
      startedAt: null
    });
    console.log("Round countdown started for participants:", participantIds);
  } else {
    await dbPatch(`${gameId}`, {
      ...roundPayload,
      status: "active",
      startAt: null,
      startedAt: Date.now()
    });
    console.log("Started new round (solo) with participants:", participantIds);
  }
}
// ----------------------
// Browser-tab title override — saves the page's real title on first override and
// restores it on clear. Used for both the pre-round countdown and the lobby prompt,
// so they never fight over document.title.
function setTabTitle(text) {
  if (_origDocTitle === null) _origDocTitle = document.title;
  if (document.title !== text) document.title = text;
}
function clearTabTitle() {
  if (_origDocTitle !== null) { document.title = _origDocTitle; _origDocTitle = null; }
}

// Lobby "players ready" nudge: while the game already qualifies to start (2+ ready) but
// the host hasn't started yet, prompt not-yet-ready guests (via the tab title) to jump
// back and Ready Up. Ready players and the host aren't nudged.
function updateLobbyTabPrompt(snapshot) {
  const players = snapshot.players || {};
  const readyCount = Object.keys(players).filter(pid => players[pid] && players[pid].ready).length;
  const meReady = !!(players[playerId] && players[playerId].ready);
  const wantPrompt = snapshot.status === 'lobby' && readyCount >= 2 && !meReady && role !== 'host';
  if (wantPrompt) setTabTitle('✅ Players ready — Ready Up to join!');
  else clearTabTitle();
}

// ----------------------
// Pre-round countdown UI (multiplayer). Shown on ALL clients while status === 'starting':
// an on-page banner, a ticking browser-tab title (visible when the tab is backgrounded),
// AND the modal's round-timer slot (so it lands where the round timer will appear — a
// seamless hand-off). The host flips the game to 'active' when the countdown hits zero;
// a guest fallback covers the case where the host vanished mid-countdown.
function ensureCountdownBanner() {
  if (_countdownBanner && document.body && document.body.contains(_countdownBanner)) return _countdownBanner;
  const el = document.createElement('div');
  el.id = 'imdb-race-countdown';
  Object.assign(el.style, {
    position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)',
    zIndex: '2147483647', background: '#111', color: '#f5c518',
    fontSize: '18px', fontWeight: '800', padding: '10px 18px', borderRadius: '10px',
    boxShadow: '0 4px 18px rgba(0,0,0,0.45)', fontFamily: 'system-ui, sans-serif',
    pointerEvents: 'none', textAlign: 'center', whiteSpace: 'nowrap',
  });
  if (document.body) document.body.appendChild(el);
  _countdownBanner = el;
  return el;
}

function startRoundCountdown(startAt) {
  if (_countdownTicker && _countdownStartAt === startAt) return; // already running for this round
  stopRoundCountdown(); // clear any prior ticker/banner
  _countdownStartAt = startAt;
  _countdownFlipped = false;

  const flipToActive = () => {
    if (_countdownFlipped || !gameId) return;
    _countdownFlipped = true;
    dbPatch(`${gameId}`, { status: 'active', startAt: null, startedAt: Date.now() }).catch(() => {});
  };

  const setModalTimer = (text) => {
    if (typeof roundTimerDiv !== 'undefined' && roundTimerDiv) {
      roundTimerDiv.style.display = 'block';
      roundTimerDiv.style.color = '#e74c3c'; // red for urgency during the countdown
      roundTimerDiv.style.fontWeight = '800';
      roundTimerDiv.textContent = text;
    }
  };

  const tick = () => {
    const remainingMs = startAt - Date.now();
    const secs = Math.max(0, Math.ceil(remainingMs / 1000));
    const banner = ensureCountdownBanner();
    if (remainingMs > 0) {
      banner.textContent = `⏱️ Round starting in ${secs}s — Ready Up!`;
      setTabTitle(`(${secs}) ⏱️ Round starting… Ready Up!`);
      setModalTimer(`Round starting in ${secs}…`);
    } else {
      banner.textContent = 'Go!';
      setTabTitle('Round starting…');
      setModalTimer('Go!');
      // Host flips at zero; a guest only steps in if the host clearly didn't (3s grace).
      if (role === 'host') flipToActive();
      else if (remainingMs < -3000) flipToActive();
    }
  };

  tick();
  _countdownTicker = setInterval(tick, 200);
}

// Tears down the countdown ticker + on-page banner. Tab title is managed separately
// (clearTabTitle / updateLobbyTabPrompt) so it survives a 'starting' -> 'active' hand-off.
function stopRoundCountdown() {
  if (_countdownTicker) { clearInterval(_countdownTicker); _countdownTicker = null; }
  _countdownStartAt = null;
  if (_countdownBanner) { try { _countdownBanner.remove(); } catch (e) {} _countdownBanner = null; }
  // Reset the round-timer slot's countdown styling so the actual round timer renders normally.
  if (typeof roundTimerDiv !== 'undefined' && roundTimerDiv) {
    roundTimerDiv.style.color = '';
    roundTimerDiv.style.fontWeight = '';
  }
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
  _leavingGame = true;
  stopRoundCountdown(); // tear down any pre-round countdown banner/ticker
  clearTabTitle();      // restore the browser-tab title (countdown or lobby prompt)
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
      _leavingGame = false;
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
  _leavingGame = false;
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
// ----------------------
// Chat helpers

function updateChatBadge() {
  if (_chatUnread > 0 && _chatMinimised) {
    chatBadge.textContent = _chatUnread;
    chatBadge.style.display = 'inline-block';
  } else {
    chatBadge.style.display = 'none';
  }
}

function scrollChatToBottom() {
  chatFeed.scrollTop = chatFeed.scrollHeight;
}

function renderChat(chatObj) {
  if (!chatObj) return;
  const entries = Object.entries(chatObj).sort((a, b) => a[1].timestamp - b[1].timestamp);
  const keys = entries.map(([k]) => k).join(',');
  if (keys === _chatLastKeys) return; // nothing new
  _chatLastKeys = keys;

  const myName = displayName || `Player-${playerId}`;
  const wasAtBottom = chatFeed.scrollHeight - chatFeed.scrollTop <= chatFeed.clientHeight + 20;

  chatFeed.innerHTML = entries.map(([, msg]) => {
    const isSelf = msg.playerName === myName;
    const safeMsg = escapeHtml(msg.message || '');
    const safeName = escapeHtml(msg.playerName || 'Player');
    return `<div class="chat-msg ${isSelf ? 'chat-msg--self' : 'chat-msg--other'}">
      <span class="chat-msg-name">${isSelf ? 'You' : safeName}</span>
      <span class="chat-msg-text">${safeMsg}</span>
    </div>`;
  }).join('');

  if (!_chatMinimised) {
    // Chat is open — advance the seen timestamp to the newest message
    const maxTs = entries.reduce((m, [, msg]) => Math.max(m, msg.timestamp || 0), 0);
    if (maxTs > _chatLastSeenTime) {
      _chatLastSeenTime = maxTs;
      storageSet({ chatLastSeenTime: _chatLastSeenTime });
    }
    _chatUnread = 0;
  } else {
    // Chat is minimised — count messages from others received after the last seen timestamp
    _chatUnread = entries.filter(([, msg]) =>
      (msg.timestamp || 0) > _chatLastSeenTime && msg.playerName !== myName
    ).length;
  }
  updateChatBadge();

  if (wasAtBottom || entries.length <= 1) scrollChatToBottom();
}

async function sendChatMessage(directText) {
  const text = directText || chatInput.value.trim();
  if (!text || !gameId) return;
  if (!directText) { chatInput.value = ''; chatSendBtn.disabled = true; }
  const name = displayName || `Player-${playerId}`;
  try {
    await dbPatch(`${gameId}/chat/${randId(10)}`, {
      playerName: name,
      message: text,
      timestamp: Date.now()
    });
  } catch (e) {
    console.warn('[Chat] Send failed', e);
  }
}
// ----------------------

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
  renderChat(snapshot.chat || null);

  // Pre-round countdown while status === 'starting'; otherwise tear it down and let the
  // lobby "players ready" tab prompt decide whether the tab title should nudge guests.
  if (snapshot.status === 'starting' && snapshot.startAt) {
    startRoundCountdown(Number(snapshot.startAt));
  } else {
    stopRoundCountdown();
    updateLobbyTabPrompt(snapshot);
  }

  const players = snapshot.players || {};
  const playerIds = Object.keys(players);
  const currentPlayer = players[playerId];

  // Host is always "ready" while in the lobby so the start-gate (needs 2 ready, or host solo)
  // never locks the host out — including from round 2 onward, when startRound resets ready flags.
  // Guarded on !ready so this doesn't loop (patch -> snapshot -> already ready -> no patch).
  if (gameId && role === 'host' && snapshot.status === 'lobby' && currentPlayer && !currentPlayer.ready) {
    dbPatch(`${gameId}/players/${playerId}`, { ready: true }).catch(() => {});
  }

  // Back in the lobby, clear this player's own stale give-up flag from the previous round so a
  // give-up behaves exactly like a normal completion: they become a clean, un-ready lobby member
  // (must Ready Up again) instead of lingering as "GAVE UP" — which also stops the host being
  // wrongly counted as "solo" (gaveUp players are excluded from the active roster) and starting
  // without them. Guarded on gaveUp so this doesn't loop.
  if (gameId && snapshot.status === 'lobby' && currentPlayer && currentPlayer.gaveUp && !_leavingGame) {
    dbPatch(`${gameId}/players/${playerId}`, { gaveUp: false, gaveUpAt: null, clicks: 0 }).catch(() => {});
  }

  // Detect being kicked: we have a gameId but our player record is gone.
  // Works in both lobby and active rounds — host can now kick mid-round.
  // _leavingGame guard prevents this firing when the player left voluntarily (including as host).
  if (gameId && role !== 'host' && !_leavingGame && (snapshot.status === 'lobby' || snapshot.status === 'active') && !currentPlayer) {
    stopPolling();
    stopRoundCountdown(); clearTabTitle(); // clean up any countdown/lobby-prompt tab title
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
        storageSet({ toastedFinishers: [..._toastedFinishers] }); // persist across page navigations
        const name = players[pid].name || pid;
        const c = Number(players[pid].clicks ?? 0);
        showFinishToast(name, c);
      }
    }
  } else if (snapshot.status === 'lobby') {
    _toastedFinishers.clear();
    storageSet({ toastedFinishers: [] }); // reset between rounds
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

      // Mark any player who didn't finish (and didn't voluntarily give up) so they appear
      // in the "Did not finish" leaderboard section — applies on timeout AND when someone
      // else wins while they're still playing.
      const pidsToGiveUp = playerIds.filter(
        pid => !players[pid]?.finishedAt && !players[pid]?.gaveUp
      );
      if (pidsToGiveUp.length > 0) {
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
  if (role === 'host') {
    const otherPlayers = gameSnapshot ? Object.keys(gameSnapshot.players || {}).filter(pid => pid !== playerId) : [];
    const msg = otherPlayers.length > 0
      ? "You are the host. Leaving will pass the host role to another player. Are you sure you want to leave?"
      : "You are the only player. Leaving will end the game. Are you sure?";
    const confirmed = confirm(msg);
    if (!confirmed) return;
  }
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

