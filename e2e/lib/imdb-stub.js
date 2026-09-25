// imdb-stub.js — serve simple stand-in pages for www.imdb.com inside the test browsers.
//
// Why: real IMDb shows a bot-verification page to automated browsers, which covers
// the whole page and blocks the test. Nothing these tests check comes from IMDb's
// own content — the game logic lives in the extension and Firebase — so each bot
// intercepts imdb.com requests and gets a minimal page instead. The address is
// still https://www.imdb.com/..., so the extension loads exactly as normal, and
// document.title is set like IMDb's ("Tom Hanks - IMDb"), which the extension uses
// to record the click path.
//
// Only imdb.com is stubbed. Firebase and everything else is real.
// Set REAL_IMDB=1 to use the real site instead (expect the verification page).

const { ACTORS, TITLES } = require('./game');

// Path → display name, from the pages the scenarios visit.
const NAMES = {};
for (const x of [...Object.values(ACTORS), ...Object.values(TITLES)]) {
  NAMES[new URL(x.url).pathname] = x.name;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function pageFor(pathname) {
  const clean = pathname.endsWith('/') ? pathname : `${pathname}/`;
  const name = NAMES[clean];
  const isActor = clean.startsWith('/name/');
  const isTitle = clean.startsWith('/title/');
  const heading = name || (isActor ? `Actor ${clean.split('/')[2]}` : isTitle ? `Title ${clean.split('/')[2]}` : 'IMDb');
  const docTitle = (isActor || isTitle) ? `${heading} - IMDb` : 'IMDb: Ratings, Reviews, and Where to Watch the Best Movies & TV Shows';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(docTitle)}</title>
<style>body{font-family:Arial,sans-serif;background:#1f1f1f;color:#eee;margin:0;padding:24px}
.tag{display:inline-block;background:#f5c518;color:#000;font-weight:700;padding:2px 8px;border-radius:4px}
p{color:#aaa}</style></head>
<body><span class="tag">IMDb (test stand-in)</span>
<h1>${escapeHtml(heading)}</h1>
<p>Stand-in page served by the e2e tests. Real IMDb isn't loaded.</p></body></html>`;
}

async function installImdbStub(context) {
  if (process.env.REAL_IMDB) return;
  await context.route(/^https:\/\/www\.imdb\.com\//, async (route) => {
    const req = route.request();
    if (req.resourceType() !== 'document') {
      return route.fulfill({ status: 204, body: '' }); // stand-in pages load nothing else
    }
    return route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: pageFor(new URL(req.url()).pathname),
    });
  });
}

module.exports = { installImdbStub };
