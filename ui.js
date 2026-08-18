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
chatSendBtn.addEventListener('click', (e) => sendChatMessage(e)); // wrapped: sendChatMessage lives in game.js (loads after ui.js); bare ref would ReferenceError at attach time
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
header.appendChild(headerTitle);
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
gameInfo.style.marginBottom = "8px";
gameInfo.innerHTML = "Game: <em>Not in a game</em>";
panelContent.appendChild(gameInfo);

// Name row — click-to-edit: shows name + subtle hint in view mode, input + save in edit mode
const nameRow = document.createElement("div");
nameRow.style.marginTop = "8px";
panelContent.appendChild(nameRow);

// View mode: clickable name block
const nameDisplay = document.createElement("div");
Object.assign(nameDisplay.style, {
  cursor: "pointer",
  display: "inline-block",
});
nameRow.appendChild(nameDisplay);

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
nameRow.appendChild(nameInput);

// Edit mode: Save button
const nameSaveBtn = document.createElement("button");
nameSaveBtn.textContent = "Save";
nameSaveBtn.id = "nameSaveBtn";
nameSaveBtn.className = "blue-button";
Object.assign(nameSaveBtn.style, { display: "none", verticalAlign: "middle", marginBottom: "0" });
nameRow.appendChild(nameSaveBtn);

// Kept for compatibility with any remaining references (hidden, never shown)
const nameEditBtn = document.createElement("button");
nameEditBtn.style.display = "none";
nameRow.appendChild(nameEditBtn);

// "Set name" button shown to first-time users who have no name yet
const setNameBtn = document.createElement("button");
setNameBtn.textContent = "Set name";
setNameBtn.className = "blue-button";
setNameBtn.style.display = "none";
nameRow.appendChild(setNameBtn);
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
}

nameDisplay.addEventListener("click", () => setNameEditMode(true));

// Save on Enter key
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") nameSaveBtn.click();
});

// Global round timer (moved below nameRow and above players lobby list, left aligned)
const roundTimerDiv = document.createElement("div");
roundTimerDiv.id = "roundTimer";

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
btnRow.appendChild(startBtn);

const joinBtn = document.createElement("button");
joinBtn.textContent = "Join Game";
joinBtn.className = "blue-button";
btnRow.appendChild(joinBtn);

// Action buttons (Leave/Give Up)
const actionRow = document.createElement("div");
actionRow.style.marginTop = "6px";
actionRow.style.display = "none";
panelContent.appendChild(actionRow);

// Give Up Button (New)
const giveUpBtn = document.createElement("button");
giveUpBtn.textContent = "Give Up";
giveUpBtn.id = "giveUpBtn"
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

function showCopyOnButton(text, color) {
  // Save original state
  const originalText = copybtn.textContent;
  const originalColor = copybtn.style.backgroundColor;

  // Apply feedback
  copybtn.textContent = text;
  copybtn.style.backgroundColor = color;

  // Reset after 2 seconds
  setTimeout(() => {
    copybtn.textContent = originalText;
    copybtn.style.backgroundColor = originalColor;
  }, 2000);
}

// START ROUND button (host-only) — left, then Copy Game Code middle
const startRoundBtn = document.createElement("button");
startRoundBtn.textContent = "Start Round";
startRoundBtn.className = "blue-button";
actionRow.appendChild(startRoundBtn);
actionRow.appendChild(copybtn);

// Host setting: per-round time limit (seconds; 0 disables)
const timeLimitRow = document.createElement("div");
Object.assign(timeLimitRow.style, {
  display: "none",
  width: "100%",
  // Slightly tighter spacing vs the buttons above, while keeping space before "Leave Game"
  marginTop: "-6px",
  marginBottom: "12px",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: "6px",
  padding: "6px 8px",
  borderRadius: "8px",
  background: "rgba(255,255,255,0.12)",
});
actionRow.appendChild(timeLimitRow);

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
});

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

const lobbyTitle = document.createElement("div");
lobbyTitle.style.fontWeight = "600";
lobbyTitle.style.marginBottom = "6px";
lobbyTitle.textContent = "Lobby — Waiting for players";
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

// Insert the round timer below the nameRow and above lobbyBox
nameRow.after(roundTimerDiv);

// join controls (enter game id)
const joinRow = document.createElement("div");
joinRow.style.display = "none";
joinRow.style.marginTop = "8px";
panelContent.appendChild(joinRow);

const joinInput = document.createElement("input");
joinInput.placeholder = "Enter Game ID";
Object.assign(joinInput.style, { padding: "6px", width: "160px", marginRight: "6px" });
joinRow.appendChild(joinInput);

const joinSubmit = document.createElement("button");
joinSubmit.textContent = "Join";
joinSubmit.id = "joinSubmit";
joinSubmit.className = "blue-button";
joinRow.appendChild(joinSubmit);

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
const rulesBtn = document.createElement("button");
rulesBtn.textContent = "Rules";
rulesBtn.className = "blue-button";
rulesBtn.style.marginTop = "12px";
panelContent.appendChild(rulesBtn);

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
      _timerInterval = setInterval(() => {
        if (roundStartedAt) {
          if (roundTimeLimitMs) {
            const remainingMs = Math.max(0, roundTimeLimitMs - (Date.now() - roundStartedAt));
            roundTimerDiv.textContent = `Time left: ${formatDuration(remainingMs)}`;
          } else {
            roundTimerDiv.textContent = `Time: ${formatDuration(Date.now() - roundStartedAt)}`;
          }
        }
      }, 1000);
    }
    // Stamp immediately so there's no 1s delay on first display
    if (roundTimeLimitMs) {
      const remainingMs = Math.max(0, roundTimeLimitMs - (Date.now() - roundStartedAt));
      roundTimerDiv.textContent = `Time left: ${formatDuration(remainingMs)}`;
    } else {
      roundTimerDiv.textContent = `Time: ${formatDuration(Date.now() - roundStartedAt)}`;
    }
  } else {
    // Stop the tick whenever the round isn't active
    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }

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

    // gave up players: sort by gaveUpAt ascending (first to give up at the top)
    const gaveUpPlayers = allPlayers
      .filter(p => p.gaveUp)
      .sort((a, b) => {
        const aa = Number(a.gaveUpAt ?? Infinity);
        const ba = Number(b.gaveUpAt ?? Infinity);
        return aa - ba;
      });

    leaderboardList.innerHTML = '';

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
      leaderboardList.innerHTML = 'No finishers recorded.';
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
          : "Lobby — Waiting for players";

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

  // Show host Start Round button if in lobby
  if (snapshotGame && snapshotGame.status === 'lobby' && role === 'host') {
    startRoundBtn.style.display = 'inline-block';
    timeLimitRow.style.display = 'flex';
  } else {
    startRoundBtn.style.display = 'none';
    timeLimitRow.style.display = 'none';
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
      // include gaveUpAt if present
      const gaveUpAt = p.gaveUpAt ? ` (${new Date(Number(p.gaveUpAt)).toLocaleTimeString()})` : '';
      statusLabel = ` — GAVE UP${gaveUpAt} 🏳️`;
      row.style.opacity = '0.6';
    } else if (p.ready) {
      statusLabel = " — READY ⏱️";
      row.style.fontWeight = '600';
    } else if (typeof p.clicks !== 'undefined') {
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
      // Add ready button for players in lobby
      if (gameStatus === 'lobby' && p.pid !== playerId) {
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'space-between';
        const nameSpan = document.createElement('span');
        nameSpan.textContent = label + statusLabel;
        
        // Add ready button for non-host players in lobby
        const readyBtn = document.createElement('button');
        readyBtn.textContent = p.ready ? 'READY' : 'Ready Up';
        readyBtn.title = `Mark as ready`;
        Object.assign(readyBtn.style, {
          marginLeft: '8px', 
          background: p.ready ? '#27ae60' : '#3498db', 
          border: 'none',
          color: '#fff', 
          cursor: 'pointer', 
          fontSize: '11px',
          fontWeight: 'bold', 
          padding: '2px 7px', 
          borderRadius: '3px',
          flexShrink: '0', 
          lineHeight: '1.4'
        });
        
        // Add click handler for ready button
        readyBtn.addEventListener('click', () => {
          // Update ready status in Firebase
          dbPatch(`${gameId}/players/${p.pid}`, { ready: !p.ready }).catch(err => {
            console.error("Failed to update ready status:", err);
          });
        });
        
        row.appendChild(nameSpan);
        row.appendChild(readyBtn);
      } else {
        row.innerHTML = label + statusLabel;
      }
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

