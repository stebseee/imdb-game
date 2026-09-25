// ui.js — overlay + chat panel construction, modals (rules/debug/optimal), toasts, and UI render helpers.
// Split from content.js (v1.6 refactor) — code moved verbatim, no logic changes.

// ----------------------
// UI overlay (reworked: includes name input + players list)
const uiBox = document.createElement("div");
uiBox.id = "uiOverlay"
document.body.appendChild(uiBox);

// ----------------------
// Chat panel — sits above uiOverlay, shown only while in a game
const chatPanel = document.createElement('div');
chatPanel.id = 'chatPanel';
chatPanel.style.display = 'none';
document.body.appendChild(chatPanel);

// Header row
const chatHeader = document.createElement('div');
chatHeader.id = 'chatHeader';

const chatTitle = document.createElement('span');
chatTitle.id = 'chatTitle';
chatTitle.textContent = '💬 Chat';

const chatBadge = document.createElement('span');
chatBadge.id = 'chatBadge';
chatBadge.style.display = 'none';

const chatToggleBtn = document.createElement('button');
chatToggleBtn.id = 'chatToggleBtn';
chatToggleBtn.textContent = '+';
chatToggleBtn.title = 'Expand chat';

chatHeader.appendChild(chatTitle);
chatHeader.appendChild(chatBadge);
chatHeader.appendChild(chatToggleBtn);
chatPanel.appendChild(chatHeader);

// Body (feed + input) — starts hidden (minimised)
const chatBody = document.createElement('div');
chatBody.id = 'chatBody';
chatBody.style.display = 'none';

const chatFeed = document.createElement('div');
chatFeed.id = 'chatFeed';

const chatInputRow = document.createElement('div');
chatInputRow.id = 'chatInputRow';

const chatInput = document.createElement('input');
chatInput.id = 'chatInput';
chatInput.type = 'text';
chatInput.placeholder = 'Say something…';
chatInput.maxLength = 200;
chatInput.autocomplete = 'off';

const chatSendBtn = document.createElement('button');
chatSendBtn.id = 'chatSendBtn';
chatSendBtn.textContent = 'Send';
chatSendBtn.disabled = true;

// Emoji picker popup — sits above the input row, hidden by default
const chatEmojiPicker = document.createElement('div');
chatEmojiPicker.id = 'chatEmojiPicker';
chatEmojiPicker.style.display = 'none';
[
  '🎬', '🎥', '🎞️', '🍿', '📽️', '🎭',
  '⭐', '🏆', '🎯', '🔥', '💯', '👏',
  '😂', '🤣', '😱', '🤯', '😭', '💀',
  '❤️', '👍', '🙌', '👀', '😤', '🫡',
].forEach(emoji => {
  const btn = document.createElement('button');
  btn.className = 'chat-emoji-btn';
  btn.textContent = emoji;
  btn.title = `Send ${emoji}`;
  btn.addEventListener('click', () => {
    sendChatMessage(emoji);
    chatEmojiPicker.style.display = 'none';
  });
  chatEmojiPicker.appendChild(btn);
});

// Emoji toggle button sits between the input and Send
const chatEmojiToggle = document.createElement('button');
chatEmojiToggle.id = 'chatEmojiToggle';
chatEmojiToggle.textContent = '😊';
chatEmojiToggle.title = 'Emojis';
chatEmojiToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = chatEmojiPicker.style.display === 'grid';
  chatEmojiPicker.style.display = open ? 'none' : 'grid';
});

chatInputRow.appendChild(chatInput);
chatInputRow.appendChild(chatEmojiToggle);
chatInputRow.appendChild(chatSendBtn);

// Close picker when clicking anywhere outside the chat panel
document.addEventListener('click', (e) => {
  if (!chatPanel.contains(e.target)) chatEmojiPicker.style.display = 'none';
});

chatBody.appendChild(chatFeed);
chatBody.appendChild(chatEmojiPicker);
chatBody.appendChild(chatInputRow);
chatPanel.appendChild(chatBody);

// Toggle minimise/maximise — entire header bar is clickable
chatHeader.addEventListener('click', () => {
  _chatMinimised = !_chatMinimised;
  chatBody.style.display = _chatMinimised ? 'none' : 'flex';
  chatToggleBtn.textContent = _chatMinimised ? '+' : '−';
  chatToggleBtn.title = _chatMinimised ? 'Expand chat' : 'Minimise chat';
  storageSet({ chatMinimised: _chatMinimised });
  if (!_chatMinimised) {
    // Mark all currently visible messages as read by advancing the seen timestamp
    const chatObj = gameSnapshot?.chat || {};
    const maxTs = Object.values(chatObj).reduce((m, msg) => Math.max(m, msg.timestamp || 0), 0);
    if (maxTs > _chatLastSeenTime) {
      _chatLastSeenTime = maxTs;
      storageSet({ chatLastSeenTime: _chatLastSeenTime });
    }
    _chatUnread = 0;
    updateChatBadge();
    scrollChatToBottom();
  }
});

// Send on button click or Enter key
chatSendBtn.addEventListener('click', () => sendChatMessage()); // no arg: the click event must NOT be passed as the message (that stored the event object → "[object Object]"). Wrapped because sendChatMessage lives in game.js (loads after ui.js).
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChatMessage(); });
chatInput.addEventListener('input', () => { chatSendBtn.disabled = chatInput.value.trim() === ''; });

// Keep chat panel positioned above the main panel
function updateChatPosition() {
  const rect = uiBox.getBoundingClientRect();
  chatPanel.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
  chatPanel.style.right = '20px';
}
new ResizeObserver(updateChatPosition).observe(uiBox);
window.addEventListener('resize', updateChatPosition);
// ----------------------

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

// Header icon toolbar — single home for secondary views so features hang off
// icons instead of stacking buttons down the panel. Each icon stops propagation
// so clicking it doesn't also toggle the header's collapse.
const headerTools = document.createElement("span");
Object.assign(headerTools.style, { display: "flex", alignItems: "center", gap: "10px", marginLeft: "auto", flexShrink: "0" });

// Inline monochrome SVG icons that inherit the header's black text colour
// (currentColor) — no emoji, no white background boxes.
const ICON_STATS = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><rect x="3" y="12" width="4.5" height="8" rx="1"/><rect x="9.75" y="7" width="4.5" height="13" rx="1"/><rect x="16.5" y="3" width="4.5" height="17" rx="1"/></svg>`;
const ICON_RULES = `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><text x="12" y="16.5" text-anchor="middle" font-size="13" font-weight="700" fill="currentColor" font-family="Arial, sans-serif">?</text></svg>`;
const ICON_SETTINGS = `<svg width="16" height="16" viewBox="-1 -1 26 26" overflow="visible" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

function makeToolIcon(svgMarkup, label, onClick) {
  const el = document.createElement("span");
  el.innerHTML = svgMarkup;
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute("aria-label", label);
  el.title = label;
  Object.assign(el.style, { display: "inline-flex", alignItems: "center", color: "#000", lineHeight: "1", cursor: "pointer", userSelect: "none" });
  el.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onClick(); } });
  return el;
}

const profileToolBtn  = makeToolIcon(ICON_STATS, "Your profile & stats", () => openProfileModal());
profileToolBtn.dataset.testid = "open-profile"; // data-testid hooks are for the e2e tests (e2e/)
const settingsToolBtn = makeToolIcon(ICON_SETTINGS, "Settings", () => openSettingsModal());
const rulesToolBtn     = makeToolIcon(ICON_RULES, "Rules", () => openRulesModal());
headerTools.appendChild(profileToolBtn);
headerTools.appendChild(settingsToolBtn);
headerTools.appendChild(rulesToolBtn);

header.appendChild(headerTitle);
header.appendChild(headerTools);
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
gameInfo.dataset.testid = "game-info";
gameInfo.style.marginBottom = "8px";
gameInfo.innerHTML = "Game: <em>Not in a game</em>";
panelContent.appendChild(gameInfo);

// Panel name area — kept as `nameRow` so the existing show/hide-by-state and
// round-timer positioning logic keeps working. It now holds a compact chip that
// opens the Profile modal (where name editing lives), instead of inline editing.
const nameRow = document.createElement("div");
nameRow.style.marginTop = "8px";
panelContent.appendChild(nameRow);

const nameChip = document.createElement("div");
nameChip.dataset.testid = "name-chip";
Object.assign(nameChip.style, {
  cursor: "pointer", fontWeight: "700", fontSize: "15px",
  display: "inline-block", textDecoration: "underline", textDecorationStyle: "dotted",
});
nameChip.setAttribute("role", "button");
nameChip.setAttribute("tabindex", "0");
nameChip.title = "View your profile & stats";
function syncNameChip() { nameChip.textContent = displayName || "Set your name"; }
nameChip.addEventListener("click", () => openProfileModal());
nameChip.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProfileModal(); } });
nameRow.appendChild(nameChip);

// Name editing UI — the same element objects as before (so game.js handlers and
// setNameEditMode keep working), but grouped in a container that gets appended
// into the Profile modal when it's built, instead of onto the panel.
const nameEditContainer = document.createElement("div");

// View mode: clickable name block
const nameDisplay = document.createElement("div");
Object.assign(nameDisplay.style, {
  cursor: "pointer",
  display: "inline-block",
});
nameEditContainer.appendChild(nameDisplay);

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

// Career + head-to-head stats no longer live on the panel — they open in the
// Profile modal (see the PROFILE / STATS MODAL section below), reached from the
// 📊 icon in the header toolbar. renderCareerStats() populates that modal.

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
nameEditContainer.appendChild(nameInput);

// Edit mode: Save button
const nameSaveBtn = document.createElement("button");
nameSaveBtn.textContent = "Save";
nameSaveBtn.id = "nameSaveBtn";
nameSaveBtn.className = "blue-button";
Object.assign(nameSaveBtn.style, { display: "none", verticalAlign: "middle", marginBottom: "0" });
nameEditContainer.appendChild(nameSaveBtn);

// Kept for compatibility with any remaining references (hidden, never shown)
const nameEditBtn = document.createElement("button");
nameEditBtn.style.display = "none";
nameEditContainer.appendChild(nameEditBtn);

// "Set name" button shown to first-time users who have no name yet
const setNameBtn = document.createElement("button");
setNameBtn.textContent = "Set name";
setNameBtn.className = "blue-button";
setNameBtn.style.display = "none";
nameEditContainer.appendChild(setNameBtn);
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
  syncNameChip(); // keep the panel chip in step with the current name
}

nameDisplay.addEventListener("click", () => setNameEditMode(true));

// Save on Enter key
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") nameSaveBtn.click();
});

// Global round timer (moved below nameRow and above players lobby list, left aligned)
const roundTimerDiv = document.createElement("div");
roundTimerDiv.id = "roundTimer";

// Round-info line (game mode, plus the time limit while in the lobby). Shown to
// EVERYONE — host and guests — so the mode and limit are clear before a round
// starts and during it. Populated/toggled by refreshStatusUI. During an active
// round it shows just the mode; the live countdown stays in roundTimerDiv.
const roundInfoDiv = document.createElement("div");
roundInfoDiv.id = "roundInfo";
Object.assign(roundInfoDiv.style, {
  display: "none", fontSize: "13px", marginTop: "10px", marginBottom: "10px",
}, MODE_INFO_CARD_STYLE());

// Mode + time-limit labels reused across the lobby chip, the in-round line, and
// the winners board so the wording stays consistent. The mode names match the
// Settings "Game mode" dropdown exactly. (Kept self-contained so it's safe to
// call during early init, before gameModeOpts is defined.)
function gameModeLabelShort(mode) {
  return mode === 'fastest' ? 'Fastest to finish wins' : 'Fewest clicks wins (standard)';
}
function timeLimitLabelFromMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return 'No time limit';
  return timeLimitPresetsLabel[Math.round(n / 1000)] || `${Math.round(n / 60000)} min`;
}

// Shared "info card" look for the lobby mode/limit blocks — a subtle indigo tint
// with a rounded border, so the block reads as distinct from the surrounding text.
function MODE_INFO_CARD_STYLE() {
  return {
    background: "rgba(62,73,173,0.08)",
    border: "1px solid rgba(62,73,173,0.20)",
    borderRadius: "8px",
    padding: "8px 11px",
  };
}
// Renders "Label — value" rows: muted label, bold brand-coloured value, with
// vertical padding between rows so the block breathes instead of reading as one
// clump of small bold text. `pairs` is an array of [label, value].
function modeLimitLinesHtml(pairs) {
  return pairs.map(([label, value], i) =>
    `<div style="padding:${i === 0 ? '0' : '5px'} 0 ${i === pairs.length - 1 ? '0' : '5px'};">` +
      `<span style="color:#5a4a00;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;">${label}</span>` +
      `<div style="color:#000;font-weight:800;font-size:14px;line-height:1.25;">${value}</div>` +
    `</div>`
  ).join('');
}

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
startBtn.dataset.testid = "create-game";
btnRow.appendChild(startBtn);

const joinBtn = document.createElement("button");
joinBtn.textContent = "Join Game";
joinBtn.className = "blue-button";
btnRow.appendChild(joinBtn);

// Action buttons (Leave/Give Up) — inline layout. The round-limit chip sits on
// its own line at the top (see timerChip) so it never overlaps a button or jumps
// when the Copy button momentarily resizes.
const actionRow = document.createElement("div");
actionRow.style.marginTop = "6px";
actionRow.style.display = "none";
panelContent.appendChild(actionRow);

// Give Up Button (New)
const giveUpBtn = document.createElement("button");
giveUpBtn.textContent = "Give Up";
giveUpBtn.id = "giveUpBtn"
giveUpBtn.dataset.testid = "give-up";
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

const COPY_BTN_LABEL = "Copy Game Code"; // resting label to revert to
let _copyResetTimer = null;
function showCopyOnButton(text, color) {
  // Clear any pending revert so overlapping clicks can't capture the green
  // "Copied!" state as the baseline (that was leaving it stuck green).
  if (_copyResetTimer) { clearTimeout(_copyResetTimer); _copyResetTimer = null; }

  copybtn.textContent = text;
  copybtn.style.backgroundColor = color;

  // Always revert to the KNOWN resting state (label + CSS .blue-button colour),
  // never to whatever the button happened to show when this was called.
  _copyResetTimer = setTimeout(() => {
    copybtn.textContent = COPY_BTN_LABEL;
    copybtn.style.backgroundColor = "";
    _copyResetTimer = null;
  }, 2000);
}

// START ROUND button (host-only) — left, then Copy Game Code middle
const startRoundBtn = document.createElement("button");
startRoundBtn.textContent = "Start Round";
startRoundBtn.className = "blue-button";
startRoundBtn.dataset.testid = "start-round";
actionRow.appendChild(startRoundBtn);

// Copy Game Code + invite-link chain icon as one segmented control:
// [ Copy Game Code | link ]. The chain button copies a share link that
// auto-joins whoever opens it (if they have the extension).
const ICON_LINK = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;

const copyGroup = document.createElement("div");
Object.assign(copyGroup.style, { display: "inline-flex", alignItems: "stretch", verticalAlign: "middle", margin: "2px", marginBottom: "20px" });

// Left segment: the existing Copy Game Code button, squared on its right edge.
// Fixed width so the text swapping to "Copied!"/"Link copied!" can't shrink it
// (which used to reflow the neighbouring buttons).
Object.assign(copybtn.style, {
  margin: "0", marginBottom: "0", borderRadius: "6px 0 0 6px",
  width: "175px", boxSizing: "border-box", textAlign: "center", whiteSpace: "nowrap",
});
copyGroup.appendChild(copybtn);

// Right segment: the invite-link chain icon (thin divider between the two).
const copyLinkBtn = document.createElement("button");
copyLinkBtn.className = "blue-button";
copyLinkBtn.id = "copyLinkBtn";
copyLinkBtn.innerHTML = ICON_LINK;
copyLinkBtn.title = "Copy invite link";
copyLinkBtn.setAttribute("aria-label", "Copy invite link");
Object.assign(copyLinkBtn.style, {
  margin: "0", marginBottom: "0", borderRadius: "0 6px 6px 0",
  borderLeft: "1px solid rgba(255,255,255,0.35)", padding: "6px 9px",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
});
copyLinkBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(`https://www.imdb.com/?game=${encodeURIComponent(gameId || '')}`);
    showCopyOnButton("Link copied!", "green"); // feedback on the adjacent Copy button
  } catch (err) {
    showCopyOnButton("Failed!", "red");
  }
});
copyGroup.appendChild(copyLinkBtn);

actionRow.appendChild(copyGroup);

// Host setting: per-round time limit (seconds; 0 disables).
// Lives in the Settings modal (⚙) now — appended there when the modal is built.
const timeLimitRow = document.createElement("div");
Object.assign(timeLimitRow.style, {
  display: "flex",
  width: "100%",
  marginTop: "0",
  marginBottom: "4px",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: "6px",
  padding: "6px 8px",
  borderRadius: "8px",
  background: "rgba(255,255,255,0.12)",
  boxSizing: "border-box",
});

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
  syncTimerChip();
  // If the host changes it while sitting in a lobby, push it to the game node so
  // guests' round-info line updates before the round starts.
  if (gameId && role === 'host') {
    const ms = hostRoundTimeLimitSec > 0 ? hostRoundTimeLimitSec * 1000 : null;
    dbPatch(gameId, { roundTimeLimitMs: ms }).catch(() => {});
  }
});

// Panel round-timer chip — shows the current limit (default 5 min) and opens the
// Settings modal (little cog), so the host sees and sets the round timer without
// hunting through a menu. Shown to the host in the lobby (see updateGameControls).
const timerChip = document.createElement("div");
Object.assign(timerChip.style, {
  display: "none", alignItems: "flex-start", justifyContent: "space-between",
  gap: "8px", cursor: "pointer", marginTop: "2px", marginBottom: "10px",
}, MODE_INFO_CARD_STYLE());
timerChip.setAttribute("role", "button");
timerChip.setAttribute("tabindex", "0");
timerChip.title = "Round settings — click to change";
const timerChipText = document.createElement("span");
timerChipText.style.flex = "1";
timerChip.appendChild(timerChipText);
const timerChipCog = document.createElement("span");
timerChipCog.innerHTML = ICON_SETTINGS;
Object.assign(timerChipCog.style, { display: "inline-flex", alignItems: "center", color: "#000", flexShrink: "0", marginTop: "1px" });
timerChip.appendChild(timerChipCog);
function syncTimerChip() {
  const label = timeLimitPresetsLabel[hostRoundTimeLimitSec] || `${Math.round(hostRoundTimeLimitSec / 60)} min`;
  const modeLabel = gameModeLabelShort(gameMode);
  timerChipText.innerHTML = modeLimitLinesHtml([
    ["Game mode", modeLabel],
    ["Round limit", label],
  ]);
}
syncTimerChip();
timerChip.addEventListener("click", () => openSettingsModal());
timerChip.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSettingsModal(); } });
timerChip.style.marginTop = "0";
timerChip.style.marginBottom = "8px"; // space between the chip's own line and the inline buttons below
// Put the round-limit chip on its own line at the top of the action row (a
// block-level flex row, so the inline buttons below can't reflow it).
actionRow.insertBefore(timerChip, actionRow.firstChild);

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

// Finisher "you're done" card — shown at the top of the leaderboard box when the
// local player has finished but the round is still running (others still racing).
// The live leaderboard renders below it, so they can watch the others' clicks.
const finishedCard = document.createElement("div");
Object.assign(finishedCard.style, {
  display: "none", marginBottom: "10px", padding: "10px 12px", borderRadius: "8px",
  background: "#1a7a4a", color: "#fff", fontFamily: "Arial, sans-serif",
});
const finishedCardTitle = document.createElement("div");
finishedCardTitle.textContent = "✅ You finished!";
Object.assign(finishedCardTitle.style, { fontWeight: "800", fontSize: "16px", marginBottom: "3px" });
finishedCard.appendChild(finishedCardTitle);
const finishedCardStats = document.createElement("div");
Object.assign(finishedCardStats.style, { fontSize: "13px", opacity: "0.95" });
finishedCard.appendChild(finishedCardStats);
const finishedCardNote = document.createElement("div");
finishedCardNote.textContent = "Sit tight — watch the others race below.";
Object.assign(finishedCardNote.style, { fontSize: "12px", opacity: "0.85", marginTop: "5px" });
finishedCard.appendChild(finishedCardNote);
lobbyBox.appendChild(finishedCard); // first child of lobbyBox (above the leaderboard title)

const lobbyTitle = document.createElement("div");
lobbyTitle.style.fontWeight = "600";
lobbyTitle.style.marginBottom = "6px";
lobbyTitle.textContent = "Lobby";
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

// Insert the round timer below the nameRow and above lobbyBox, with the
// round-info line (mode / limit) sitting just above the timer.
nameRow.after(roundTimerDiv);
roundTimerDiv.before(roundInfoDiv);

// join controls (enter game id)
const joinRow = document.createElement("div");
joinRow.style.display = "none";
// Flex row with centered items so the field and button line up vertically. (The
// culprit was .blue-button's margin-bottom:20px pushing the button up; we zero
// the button's margin here and let `gap` handle spacing.)
Object.assign(joinRow.style, { marginTop: "8px", alignItems: "center", gap: "6px" });
panelContent.appendChild(joinRow);

const joinInput = document.createElement("input");
joinInput.placeholder = "Enter Game ID";
Object.assign(joinInput.style, {
  padding: "6px 8px", width: "160px", margin: "0",
  boxSizing: "border-box",
  border: "1px solid rgba(0,0,0,0.25)", borderRadius: "6px", fontSize: "14px",
});
joinRow.appendChild(joinInput);

const joinSubmit = document.createElement("button");
joinSubmit.textContent = "Join";
joinSubmit.id = "joinSubmit";
joinSubmit.className = "blue-button";
joinSubmit.style.margin = "0"; // drop .blue-button's asymmetric margin so it centers with the field
joinRow.appendChild(joinSubmit);

// Enter in the game-code field joins, same as clicking Join.
joinInput.addEventListener("keydown", (e) => { if (e.key === "Enter") joinSubmit.click(); });

// status text
const statusDiv = document.createElement("div");
statusDiv.style.whiteSpace = "pre-wrap";
statusDiv.style.marginTop = "8px";
statusDiv.style.fontSize = "15px";
statusDiv.style.fontWeight = "700";
panelContent.appendChild(statusDiv);

// Breadcrumb — shows the player's click path during an active round
const breadcrumbBox = document.createElement('div');
breadcrumbBox.id = 'race-breadcrumb';
Object.assign(breadcrumbBox.style, {
  display: 'none',
  marginTop: '8px',
  marginBottom: '2px',
  fontSize: '11px',
  lineHeight: '1.7',
  wordBreak: 'break-word',
  background: 'rgba(0,0,0,0.05)',
  borderRadius: '5px',
  padding: '7px 9px',
});
panelContent.appendChild(breadcrumbBox);

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
// Rules now open from the ❔ icon in the header toolbar. This button is kept
// (not appended to the panel) only so existing focus()/handler references stay valid.
const rulesBtn = document.createElement("button");
rulesBtn.textContent = "Rules";
rulesBtn.className = "blue-button";
rulesBtn.style.marginTop = "12px";

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
// MODAL FRAMEWORK
// A small reusable modal (backdrop + golden box + title + close), mirroring the
// Rules modal styling. Returns handles plus open()/close() with ESC and
// backdrop-click support. New secondary views (Profile, later Settings) use this
// so they stay consistent without copy-pasting the overlay boilerplate.
function createModal(titleText, widthPx = 360) {
  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed", inset: "0", background: "rgba(0,0,0,0.5)",
    zIndex: 1000002, alignItems: "center", justifyContent: "center",
    padding: "10px", boxSizing: "border-box", display: "none",
  });
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const box = document.createElement("div");
  Object.assign(box.style, {
    width: widthPx + "px", maxWidth: "100%",
    background: "linear-gradient(295deg,rgba(110, 88, 10, 1) 0%, rgba(245, 197, 24, 1) 100%)",
    color: "#000", borderRadius: "10px", padding: "16px", boxSizing: "border-box",
    boxShadow: "0 6px 24px rgba(0,0,0,0.4)", textAlign: "left",
    fontFamily: "Arial, sans-serif", fontSize: "14px", lineHeight: "1.4",
    maxHeight: "82vh", overflowY: "auto",
  });
  overlay.appendChild(box);

  const titleRow = document.createElement("div");
  Object.assign(titleRow.style, { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" });
  const titleEl = document.createElement("div");
  titleEl.textContent = titleText;
  Object.assign(titleEl.style, { fontWeight: "700", fontSize: "16px", color: "#000" });
  const closeX = document.createElement("span");
  closeX.textContent = "✕";
  closeX.setAttribute("role", "button");
  closeX.setAttribute("aria-label", "Close");
  closeX.title = "Close";
  Object.assign(closeX.style, { cursor: "pointer", fontSize: "16px", lineHeight: "1", padding: "2px 4px", userSelect: "none" });
  titleRow.appendChild(titleEl);
  titleRow.appendChild(closeX);
  box.appendChild(titleRow);

  const body = document.createElement("div");
  box.appendChild(body);

  document.body.appendChild(overlay);

  function open() {
    overlay.style.display = "flex";
    overlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    closeX.focus();
  }
  function close() {
    overlay.style.display = "none";
    overlay.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }
  closeX.addEventListener("click", (e) => { e.stopPropagation(); close(); });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && overlay.style.display === "flex") close(); });

  return { overlay, box, body, titleEl, open, close };
}

// ----------------------
// PROFILE / STATS MODAL
// Career win/loss + head-to-head, keyed on this browser's player (see stats.js).
const _profileModal = createModal("Your profile", 340);

// Identity row: initials avatar + name
const _profileIdentity = document.createElement("div");
Object.assign(_profileIdentity.style, { display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" });
const _profileAvatar = document.createElement("div");
Object.assign(_profileAvatar.style, {
  width: "44px", height: "44px", borderRadius: "50%", background: "#3E49AD", color: "#F5C518",
  display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "700", fontSize: "15px", flexShrink: "0",
});
_profileIdentity.appendChild(_profileAvatar);
// Name editing lives here now (relocated from the panel). setNameEditMode toggles
// its view/edit state; the panel shows a read-only chip that opens this modal.
_profileIdentity.appendChild(nameEditContainer);
_profileModal.body.appendChild(_profileIdentity);

// Mode filter dropdown: which figures the cards + head-to-head below show —
// the overall totals ("All modes"), or one byMode bucket. Uses the same mode
// names as the Settings "Game mode" selector so the wording stays consistent.
// Changing it only re-renders the last-loaded stats object — never re-fetches.
const STATS_VIEW_MODES = [
  { key: "all",     label: "All modes" },
  { key: "fewest",  label: "Fewest clicks wins (standard)" },
  { key: "fastest", label: "Fastest to finish wins" },
];
let _statsViewMode = "all";
let _lastLoadedStats = null;
const _statsModeRow = document.createElement("div");
Object.assign(_statsModeRow.style, { marginBottom: "14px" });
const _statsModeSelect = document.createElement("select");
Object.assign(_statsModeSelect.style, {
  width: "100%", padding: "8px 10px", fontSize: "13px", borderRadius: "10px",
  border: "1px solid rgba(0,0,0,0.25)", outline: "none",
  background: "rgba(255,255,255,0.88)", color: "#000",
});
STATS_VIEW_MODES.forEach(({ key, label }) => {
  const opt = document.createElement("option");
  opt.value = key; opt.textContent = label;
  _statsModeSelect.appendChild(opt);
});
_statsModeSelect.value = _statsViewMode;
_statsModeSelect.addEventListener("change", () => {
  _statsViewMode = _statsModeSelect.value;
  renderCareerStats(_lastLoadedStats);
});
_statsModeRow.appendChild(_statsModeSelect);
_profileModal.body.appendChild(_statsModeRow);

// Metric cards: wins / losses / win rate
function _makeStatCard(label, accent, testKey) {
  const card = document.createElement("div");
  Object.assign(card.style, {
    flex: "1", background: accent ? "#3E49AD" : "rgba(255,255,255,0.55)", borderRadius: "8px",
    padding: "10px 4px", textAlign: "center", minWidth: "0",
  });
  const lab = document.createElement("div");
  lab.textContent = label;
  Object.assign(lab.style, { fontSize: "11px", color: accent ? "#cdd2f2" : "#5a4a00" });
  const val = document.createElement("div");
  val.textContent = "0";
  Object.assign(val.style, { fontSize: "22px", fontWeight: "700", color: accent ? "#F5C518" : "#000" });
  // Optional small line under the value (used by win rate for the round count).
  const sub = document.createElement("div");
  Object.assign(sub.style, { fontSize: "10px", marginTop: "1px", color: accent ? "#cdd2f2" : "#5a4a00" });
  if (testKey) { val.dataset.testid = `stat-${testKey}`; sub.dataset.testid = `stat-${testKey}-sub`; }
  card.appendChild(lab);
  card.appendChild(val);
  card.appendChild(sub);
  return { card, val, sub };
}
const _cardsRow = document.createElement("div");
Object.assign(_cardsRow.style, { display: "flex", gap: "6px", marginBottom: "16px" });
const _winsCard = _makeStatCard("wins", false, "wins");
const _lossesCard = _makeStatCard("losses", false, "losses");
// Give-ups are their own counter, not a subset of losses: a give-up the opponent
// then wins counts in both; a give-up in a round nobody finished is only this.
const _giveUpsCard = _makeStatCard("gave up", false, "giveups");
const _rateCard = _makeStatCard("win rate", true, "winrate");
_cardsRow.appendChild(_winsCard.card);
_cardsRow.appendChild(_lossesCard.card);
_cardsRow.appendChild(_giveUpsCard.card);
_cardsRow.appendChild(_rateCard.card);
_profileModal.body.appendChild(_cardsRow);

// Head-to-head
const _h2hHeading = document.createElement("div");
_h2hHeading.textContent = "Head-to-head";
Object.assign(_h2hHeading.style, { fontSize: "12px", color: "#5a4a00", marginBottom: "6px", fontWeight: "700" });
_profileModal.body.appendChild(_h2hHeading);
const _h2hList = document.createElement("div");
Object.assign(_h2hList.style, { border: "0.5px solid rgba(0,0,0,0.25)", borderRadius: "8px", overflow: "hidden", background: "rgba(255,255,255,0.4)" });
_profileModal.body.appendChild(_h2hList);

const _profileFootnote = document.createElement("div");
_profileFootnote.textContent = "Stats are saved to this browser. Sign in later to carry them across devices.";
Object.assign(_profileFootnote.style, { fontSize: "11px", color: "#5a4a00", marginTop: "10px", lineHeight: "1.5" });
_profileModal.body.appendChild(_profileFootnote);

function _initials(name) {
  const n = (name || "").trim();
  if (!n) return "🎬";
  const parts = n.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return n.slice(0, 2).toUpperCase();
}

// Populate the profile modal from a /players/{id} stats object (or null).
// Renders the OVERALL totals when the mode toggle is on "all", or the selected
// byMode bucket ('fewest'|'fastest') otherwise. Caches the stats object so the
// toggle can re-render without a re-fetch.
function renderCareerStats(stats) {
  _lastLoadedStats = stats || null;

  // Pick the bucket the toggle asks for. For a per-mode view the figures live
  // under byMode.<mode>; a missing bucket just reads as an all-zero source.
  const source = _statsViewMode === "all"
    ? stats
    : (stats && stats.byMode && typeof stats.byMode === "object" ? stats.byMode[_statsViewMode] : null);

  const wins   = Number(source?.totalWins   ?? 0);
  const rounds = Number(source?.totalRounds ?? 0);
  const giveUps = Number(source?.totalGiveUps ?? 0);
  const losses = Math.max(0, rounds - wins);
  const pct = rounds ? Math.round((wins / rounds) * 100) : 0;
  _winsCard.val.textContent = String(wins);
  _lossesCard.val.textContent = String(losses);
  _giveUpsCard.val.textContent = String(giveUps);
  _rateCard.val.textContent = rounds ? pct + "%" : "—";
  // Show the sample size so a 100% after one round reads as what it is.
  _rateCard.sub.textContent = rounds ? `${rounds} round${rounds === 1 ? "" : "s"}` : "";

  // Head-to-head rows, sorted by most games played
  _h2hList.innerHTML = "";
  const vs = (source && source.vs && typeof source.vs === "object") ? source.vs : {};
  const rows = Object.keys(vs).map((oppId) => {
    const r = vs[oppId] || {};
    return { name: r.lastName || `Player-${oppId}`, wins: Number(r.wins || 0), losses: Number(r.losses || 0) };
  }).filter(r => (r.wins + r.losses) > 0)
    .sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses));

  if (rows.length === 0) {
    const empty = document.createElement("div");
    // A per-mode view with no rounds gets its own copy — this mode just hasn't
    // been played yet, which is different from having no record at all.
    // (A player can have give-ups but no counted rounds, if every round they
    // played ended with nobody finishing, so check both.)
    const playedAny = rounds > 0 || giveUps > 0;
    if (playedAny) {
      empty.textContent = "No head-to-head record yet.";
    } else if (_statsViewMode !== "all") {
      empty.textContent = "No games in this mode yet.";
    } else {
      empty.textContent = "No games yet — play a round to start your record.";
    }
    Object.assign(empty.style, { padding: "10px 12px", fontSize: "13px", color: "#5a4a00" });
    _h2hList.appendChild(empty);
    return;
  }
  rows.forEach((r, i) => {
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex", justifyContent: "space-between", padding: "9px 12px",
      borderBottom: i < rows.length - 1 ? "0.5px solid rgba(0,0,0,0.15)" : "none",
    });
    const nameSpan = document.createElement("span");
    nameSpan.textContent = `vs ${r.name}`;
    Object.assign(nameSpan.style, { fontSize: "13px", color: "#000" });
    const scoreSpan = document.createElement("span");
    scoreSpan.textContent = `${r.wins}–${r.losses}`;
    const good = r.wins >= r.losses;
    Object.assign(scoreSpan.style, { fontSize: "13px", fontWeight: "700", color: good ? "#0f6e2f" : "#a32d2d" });
    row.appendChild(nameSpan);
    row.appendChild(scoreSpan);
    _h2hList.appendChild(row);
  });
}

function openProfileModal() {
  // Refresh identity + stats each open so they're current. setNameEditMode(false)
  // shows the name in view mode (or the "Set name" prompt for first-timers) and
  // syncs the panel chip.
  _profileAvatar.textContent = _initials(displayName);
  setNameEditMode(false);
  _statsViewMode = "all";          // always open on the overall view
  _statsModeSelect.value = "all";  // reset the dropdown to match
  _profileModal.open();
  loadMyStats().then(renderCareerStats).catch(() => {});
}
function closeProfileModal() { _profileModal.close(); }

// ----------------------
// SETTINGS MODAL (⚙)
// Home for the host round-time presets (the timeLimitRow control, relocated from
// the panel) and password-gated developer tools.
const _settingsModal = createModal("Settings", 340);
_settingsModal.body.appendChild(timeLimitRow);

const _settingsTimeNote = document.createElement("div");
_settingsTimeNote.textContent = "Applies to rounds you host.";
Object.assign(_settingsTimeNote.style, { fontSize: "11px", color: "#5a4a00", marginTop: "4px" });
_settingsModal.body.appendChild(_settingsTimeNote);

// Game mode (win rule) selector — host-set, fixed per round like the time limit.
const gameModeRow = document.createElement("div");
Object.assign(gameModeRow.style, {
  display: "flex", width: "100%", marginTop: "16px", marginBottom: "4px",
  flexDirection: "column", alignItems: "flex-start", gap: "6px",
  padding: "6px 8px", borderRadius: "8px", background: "rgba(255,255,255,0.12)", boxSizing: "border-box",
});
const gameModeLabel = document.createElement("div");
gameModeLabel.textContent = "Game mode";
Object.assign(gameModeLabel.style, { fontSize: "13px", fontWeight: "800", color: "#000" });
gameModeRow.appendChild(gameModeLabel);
const gameModeHelper = document.createElement("div");
gameModeHelper.textContent = "How the round winner is decided.";
Object.assign(gameModeHelper.style, { fontSize: "11px", opacity: "0.75", color: "#000" });
gameModeRow.appendChild(gameModeHelper);
const gameModeSelect = document.createElement("select");
Object.assign(gameModeSelect.style, {
  width: "100%", maxWidth: "220px", padding: "8px 10px", fontSize: "13px",
  borderRadius: "10px", border: "1px solid rgba(0,0,0,0.25)", outline: "none",
  background: "rgba(255,255,255,0.88)", color: "#000",
});
const gameModeOpts = { fewest: "Fewest clicks wins (standard)", fastest: "Fastest to finish wins" };
Object.keys(gameModeOpts).forEach(m => {
  const opt = document.createElement("option");
  opt.value = m; opt.textContent = gameModeOpts[m];
  gameModeSelect.appendChild(opt);
});
gameModeSelect.value = (gameMode === 'fastest') ? 'fastest' : 'fewest';
gameModeRow.appendChild(gameModeSelect);
gameModeSelect.addEventListener("change", async () => {
  gameMode = (gameModeSelect.value === 'fastest') ? 'fastest' : 'fewest';
  gameModeSelect.value = gameMode;
  await storageSet({ gameMode });
  syncTimerChip(); // host's lobby chip shows the mode too
  // Push the mode to the lobby node so guests' round-info line reflects it now.
  if (gameId && role === 'host') {
    dbPatch(gameId, { gameMode }).catch(() => {});
  }
});
_settingsModal.body.appendChild(gameModeRow);

const _settingsModeNote = document.createElement("div");
_settingsModeNote.textContent = "Applies to rounds you host.";
Object.assign(_settingsModeNote.style, { fontSize: "11px", color: "#5a4a00", marginTop: "4px" });
_settingsModal.body.appendChild(_settingsModeNote);

// (Debug panel stays a hidden secret — Shift+click the header. No visible entry.)

function openSettingsModal() { _settingsModal.open(); }
function closeSettingsModal() { _settingsModal.close(); }

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

// Penalty toast — shown when the player uses the browser back button during a game
function showPenaltyToast() {
  const toast = document.createElement('div');
  toast.textContent = '⚠️ Back button used — +1 penalty click!';
  toast.style.cssText = [
    'position: fixed',
    'top: 50%',
    'left: 50%',
    'transform: translate(-50%, -50%)',
    'background: #7f1d1d',
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
  document.documentElement.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// Give-up banner — same black banner as finishes, shown to other players when
// someone gives up.
function showGiveUpToast(playerName) {
  const toast = document.createElement('div');
  toast.textContent = `${playerName} has given up! 🏳️`;
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
  document.documentElement.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// Briefly flash the browser tab title (then revert), so a player who tabbed away
// notices key events (a player finished, the round ended). The original title is
// captured once and restored after ~5s. main.js only reads document.title on page
// LOAD (for click-path capture), so a temporary change here can't pollute it.
let _origTabTitle = null;
let _tabTitleTimer = null;
function flashTabTitle(text) {
  try {
    if (_countdownTitleActive) return; // the final-30s countdown owns the tab title
    if (_origTabTitle === null) _origTabTitle = document.title;
    document.title = text;
    if (_tabTitleTimer) clearTimeout(_tabTitleTimer);
    _tabTitleTimer = setTimeout(() => {
      if (_origTabTitle !== null) { document.title = _origTabTitle; _origTabTitle = null; }
      _tabTitleTimer = null;
    }, 5000);
  } catch (e) { /* document.title always writable; guard just in case */ }
}

// Live final-30s countdown in the browser tab, so a player who tabbed away sees
// the clock ticking down. Takes over the tab title while active (see the guard in
// flashTabTitle) and restores the page's own title when it ends.
let _countdownTitleActive = false;
function setCountdownTitle(remainingMs) {
  try {
    if (_origTabTitle === null) _origTabTitle = document.title; // capture the page's title once
    if (_tabTitleTimer) { clearTimeout(_tabTitleTimer); _tabTitleTimer = null; } // cancel any flash revert
    document.title = `⏳ ${formatDuration(remainingMs)} left!`;
    _countdownTitleActive = true;
  } catch (e) { /* guard */ }
}
function clearCountdownTitle() {
  if (!_countdownTitleActive) return;
  try {
    if (_origTabTitle !== null) { document.title = _origTabTitle; _origTabTitle = null; }
  } catch (e) { /* guard */ }
  _countdownTitleActive = false;
}

// Paints the in-panel round timer each tick: counts up (no limit) or down (limit).
// In the final 30s the number turns red and a live countdown runs in the tab title.
const ROUND_TIMER_URGENT_MS = 30000;
function paintRoundTimer() {
  if (!roundStartedAt) return;
  if (roundTimeLimitMs) {
    const remainingMs = Math.max(0, roundTimeLimitMs - (Date.now() - roundStartedAt));
    roundTimerDiv.textContent = `Time left: ${formatDuration(remainingMs)}`;
    const urgent = remainingMs <= ROUND_TIMER_URGENT_MS;
    roundTimerDiv.style.color = urgent ? '#c0392b' : '';
    roundTimerDiv.style.fontWeight = urgent ? '800' : '';
    if (urgent && remainingMs > 0) setCountdownTitle(remainingMs);
    else clearCountdownTitle(); // >30s left, or time's up → restore the tab title
  } else {
    roundTimerDiv.textContent = `Time: ${formatDuration(Date.now() - roundStartedAt)}`;
    roundTimerDiv.style.color = '';
    roundTimerDiv.style.fontWeight = '';
    clearCountdownTitle();
  }
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

function renderBreadcrumb() {
  if (!roundIsActive || !clickPath || clickPath.length === 0) {
    breadcrumbBox.style.display = 'none';
    return;
  }
  breadcrumbBox.style.display = 'block';
  const label = '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;opacity:0.45;margin-bottom:4px;">Your path so far</div>';
  const items = clickPath.map((name, i) => {
    // Even indices are actors, odd indices are movies/shows
    return i % 2 === 0
      ? `<strong>${escapeHtml(name)}</strong>`
      : `<span style="opacity:0.6;">${escapeHtml(name)}</span>`;
  }).join(' <span style="opacity:0.3;">→</span> ');
  breadcrumbBox.innerHTML = label + items;
}

function refreshStatusUI(snapshotGame) {
  // Update active-round flag — filters only apply when a round is genuinely running
  roundIsActive = !!(gameId && snapshotGame && snapshotGame.status === 'active');
  renderBreadcrumb();

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
      _timerInterval = setInterval(paintRoundTimer, 1000);
    }
    // Stamp immediately so there's no 1s delay on first display
    paintRoundTimer();
  } else {
    // Stop the tick whenever the round isn't active
    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
    clearCountdownTitle();          // drop any live tab countdown
    roundTimerDiv.style.color = ''; // clear the red urgency colour
    roundTimerDiv.style.fontWeight = '';

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

  // ROUND-INFO LINE (game mode + limit). Visible to everyone so the mode/limit
  // are clear before and during a round. In the lobby the host uses the
  // interactive timerChip instead (it shows the same thing + a cog), so we only
  // show this line to guests there. During an active round we show just the mode
  // (the live countdown is roundTimerDiv). On the winners board the mode appears
  // above the leaderboard, so this line hides.
  if (snapshotGame && (snapshotGame.status === 'lobby' || snapshotGame.status === 'active')) {
    const mode = gameModeLabelShort(snapshotGame.gameMode || 'fewest');
    if (snapshotGame.status === 'active') {
      roundInfoDiv.innerHTML = modeLimitLinesHtml([["Game mode", mode]]);
      roundInfoDiv.style.display = 'block';
    } else if (role !== 'host') {
      // Guest in the lobby: mode + the host's chosen time limit, as an info card.
      const limit = timeLimitLabelFromMs(snapshotGame.roundTimeLimitMs);
      roundInfoDiv.innerHTML = modeLimitLinesHtml([
        ["Game mode", mode],
        ["Round limit", limit],
      ]);
      roundInfoDiv.style.display = 'block';
    } else {
      roundInfoDiv.style.display = 'none'; // host lobby → timerChip covers it
    }
  } else {
    roundInfoDiv.style.display = 'none';
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
    // Leaderboard order follows the win rule: 'fastest' → by finish time; else
    // (fewest) → by clicks, tie-broken by finish time. This also feeds the
    // fallback winner (finishedPlayers[0]) when no server winner is set.
    const isFastest = snapshotGame.gameMode === 'fastest';
    const finishedPlayers = allPlayers
      .filter(p => p.finishedAt && !p.gaveUp)
      .sort((a, b) => {
        const af = Number(a.finishedAt ?? Infinity);
        const bf = Number(b.finishedAt ?? Infinity);
        if (isFastest) return af - bf;
        const ac = Number(a.clicks ?? Infinity);
        const bc = Number(b.clicks ?? Infinity);
        if (ac !== bc) return ac - bc;
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

    // Mode label above the leaderboard, so the results make sense at a glance
    // (e.g. why a higher click-count won under "Fastest to finish").
    const modeHeader = document.createElement('div');
    modeHeader.textContent = `Game mode: ${gameModeLabelShort(snapshotGame.gameMode || 'fewest')}`;
    Object.assign(modeHeader.style, {
      fontSize: '12px', fontWeight: '700', color: '#f5c518',
      marginBottom: '8px', opacity: '0.9',
    });
    leaderboardList.appendChild(modeHeader);

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
      // Append rather than overwrite, so the "Game mode:" header above stays.
      const noFinishers = document.createElement('div');
      noFinishers.textContent = 'No finishers recorded.';
      leaderboardList.appendChild(noFinishers);
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
          : "Lobby";

        // Finisher "you're done" card — shown when you've finished the current
        // (still-running) round. Keeps you on the live leaderboard rather than
        // jumping to the winners board, so you can watch the others race.
        const meRec = snapshotGame?.players?.[playerId];
        const iFinished = snapshotGame && snapshotGame.status === 'active' && meRec?.finishedAt && !meRec?.gaveUp;
        if (iFinished) {
          const base = snapshotGame.startedAt || roundStartedAt;
          const dur = (base && meRec.finishedAt) ? formatDuration(meRec.finishedAt - base) : '';
          const c = Number(meRec.clicks ?? 0);
          finishedCardStats.textContent = `${c} click${c === 1 ? '' : 's'}${dur ? ` · ${dur}` : ''}`;
          finishedCard.style.display = 'block';
        } else {
          finishedCard.style.display = 'none';
        }

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

  // Show host Start Round button + the round-timer chip if in lobby. The chip is
  // a full-width block row (its own line) so it never gets pulled into the button
  // flow — e.g. it won't jump when the Copy button momentarily shrinks to "Copied".
  if (snapshotGame && snapshotGame.status === 'lobby' && role === 'host') {
    startRoundBtn.style.display = 'inline-block';
    timerChip.style.display = 'flex';
    syncTimerChip();
  } else {
    startRoundBtn.style.display = 'none';
    timerChip.style.display = 'none';
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
      statusLabel = ` — GAVE UP 🏳️`;
      row.style.opacity = '0.6';
    } else if (gameStatus !== 'lobby' && typeof p.clicks !== 'undefined') {
      // Live click count during an active round. In the lobby (no round yet)
      // clicks are meaningless, so rows show just the name. The READY label is
      // gone with ready-up mode.
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

  // Show chat panel only while in a game; reset state on leave
  chatPanel.style.display = inGame ? 'flex' : 'none';
  if (inGame) updateChatPosition();
  if (!inGame) { _chatUnread = 0; _chatLastKeys = ''; _chatLastSeenTime = 0; chatFeed.innerHTML = ''; updateChatBadge(); storageSet({ chatLastSeenTime: 0 }); }

  if (!inGame) {
     winnerBox.style.display = "none";
     btnRow.style.display = "block";
     nameRow.style.display = "flex";
     lobbyBox.style.display = "none";
  }
}

