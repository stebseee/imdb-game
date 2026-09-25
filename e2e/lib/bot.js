// bot.js — one automated player: its own Chrome window with the extension loaded.
//
// Each bot gets a brand-new browser profile, so it is a brand-new player (new
// playerId, 0 career stats) every run — no need to wipe Firebase between runs.
//
// How a bot "clicks" an actor: it adds a link to the page and clicks it. The
// extension's real click handler counts it exactly like a human click. We stop the
// browser following the link straight away, wait until Firebase confirms the click
// was recorded, then navigate. That makes every run deterministic and independent
// of IMDb's page layout (which changes often).

const { chromium, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { dbGet, waitFor } = require('./firebase');
const { installImdbStub } = require('./imdb-stub');

const EXT_PATH = path.resolve(__dirname, '..', '..'); // the repo root is the unpacked extension
const HEADLESS = !!process.env.HEADLESS;
const WIN_W = 560;
const WIN_H = 860;

class Bot {
  constructor({ name, context, page, extPage, userDataDir }) {
    this.name = name;
    this.context = context;
    this.page = page;         // the bot's IMDb tab
    this.extPage = extPage;   // an extension page, used to read/write chrome.storage
    this.userDataDir = userDataDir;
    this.pid = null;          // playerId, filled in by attach()
    this.code = null;         // game code, filled in by attach()
    this._cookieBannerHandled = false;
  }

  // Launch a fresh Chrome with the extension. `slot` tiles the windows side by side.
  static async launch(name, slot = 0) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imdb-race-bot-'));
    const opts = {
      headless: HEADLESS,
      viewport: null, // use the real window size
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
        `--window-position=${slot * (WIN_W + 10)},0`,
        `--window-size=${WIN_W},${WIN_H}`,
      ],
    };
    // Extensions need Playwright's own Chromium (branded Chrome ignores --load-extension).
    if (process.env.CHROMIUM_PATH) opts.executablePath = process.env.CHROMIUM_PATH;
    else opts.channel = 'chromium';

    const context = await chromium.launchPersistentContext(userDataDir, opts);
    await installImdbStub(context); // stand-in imdb.com pages (IMDb blocks automated browsers)
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20_000 });
    const extId = new URL(sw.url()).host;

    const page = context.pages()[0] || await context.newPage();
    const extPage = await context.newPage();
    await extPage.goto(`chrome-extension://${extId}/popup.html`);
    await page.bringToFront();

    // Auto-accept the extension's confirm()/alert() popups (e.g. "Are you sure you
    // want to give up?"), and log them so a failing run shows what appeared.
    page.on('dialog', async (d) => {
      console.log(`  [${name}] dialog: ${d.message()}`);
      await d.accept().catch(() => {});
    });
    if (process.env.DEBUG_CONSOLE) {
      page.on('console', (m) => console.log(`  [${name}] console.${m.type()}: ${m.text()}`));
    }
    return new Bot({ name, context, page, extPage, userDataDir });
  }

  // --- chrome.storage (what the extension persists per browser) ---
  async storageGet(keys) {
    return this.extPage.evaluate((k) => chrome.storage.local.get(k), keys);
  }
  async storageSet(obj) {
    await this.extPage.evaluate((o) => chrome.storage.local.set(o), obj);
    if (obj.displayName) this._displayName = obj.displayName;
  }

  // Remember this bot's game code + playerId for the Firebase checks.
  async attach(code) {
    const { playerId } = await this.storageGet(['playerId']);
    if (!playerId) throw new Error(`${this.name} has no playerId yet`);
    this.pid = playerId;
    this.code = code;
  }

  // --- navigation ---
  // Open an IMDb URL and wait for the extension panel to appear.
  async open(url) {
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await this.page.waitForSelector('#uiOverlay', { state: 'attached', timeout: 30_000 });
    await this._dismissCookieBanner();
    await this.waitLoaded();
    await this.waitReady();
  }

  // The panel appears before the extension has finished starting up. The name
  // chip switches from "Set your name" to our name once it has (the playerId is
  // set just before), so wait for that before pressing any buttons.
  async waitLoaded() {
    if (!this._displayName) return;
    await expect(this.page.getByTestId('name-chip'), `${this.name}'s extension to finish loading`)
      .toHaveText(this._displayName, { timeout: 30_000 });
  }

  // The panel appears before the extension has restored the game from storage,
  // and clicks made before that are ignored. Once the panel shows our game code,
  // the extension is ready to count clicks.
  async waitReady() {
    if (!this.code) return;
    await expect(this.page.getByTestId('game-info'), `${this.name}'s panel to load game ${this.code}`)
      .toContainText(this.code, { timeout: 30_000 });
  }

  // Visit a movie/show page. Title pages are free — they don't count as a click.
  async visit(title) {
    await this.open(title.url);
  }

  // Click through to an actor page. Actor clicks are what the game counts.
  //   expectClicks: this bot's click total after this click (1, 2, 3…)
  //   finishing:    true when this actor is the round's destination
  async actorClick(actor, { expectClicks, finishing = false }) {
    await this.page.evaluate(({ url, name }) => {
      const a = document.createElement('a');
      a.href = url;
      a.textContent = name;
      // Don't follow the link yet — the test navigates once Firebase has the click.
      a.addEventListener('click', (e) => e.preventDefault());
      document.body.appendChild(a);
      a.click(); // the extension's document-level click handler records this
      a.remove();
    }, actor);

    await waitFor(async () => {
      const rec = await dbGet(`games/${this.code}/players/${this.pid}`);
      return rec && Number(rec.clicks) === expectClicks && (!finishing || !!rec.finishedAt);
    }, { what: `${this.name}'s click #${expectClicks} (${actor.name}) to reach Firebase` });

    if (finishing) {
      // The extension saves "finished" locally just after the Firebase write.
      // Wait for it, or the next page load would record the finish a second time.
      await waitFor(async () => (await this.storageGet(['finished'])).finished === true,
        { what: `${this.name}'s finish to be saved locally` });
    }
    await this.open(actor.url);
  }

  // Press the Give Up button (its "are you sure?" popup is auto-accepted).
  async giveUp() {
    await this.clickUi('give-up');
    await waitFor(async () => {
      const rec = await dbGet(`games/${this.code}/players/${this.pid}`);
      return rec && rec.gaveUp && rec.gaveUpVoluntarily;
    }, { what: `${this.name}'s give-up to reach Firebase` });
  }

  // Click an extension control by its data-testid. dispatchEvent fires the click
  // directly on the element, so IMDb overlays/banners can't intercept it.
  async clickUi(testId) {
    await this.page.getByTestId(testId).dispatchEvent('click');
  }

  async screenshot() {
    return this.page.screenshot({ fullPage: false }).catch(() => null);
  }

  async close() {
    await this.context.close().catch(() => {});
    fs.rmSync(this.userDataDir, { recursive: true, force: true });
  }

  // IMDb shows a cookie-consent banner in some regions (e.g. UK/EU). Accept it
  // once so it doesn't cover the page; ignore it if it isn't there.
  async _dismissCookieBanner() {
    if (!process.env.REAL_IMDB) return; // stand-in pages have no banner
    if (this._cookieBannerHandled) return;
    this._cookieBannerHandled = true;
    const btn = this.page.locator('[data-testid="accept-button"]');
    await btn.click({ timeout: 2_500 }).catch(() => {});
  }
}

module.exports = { Bot };
