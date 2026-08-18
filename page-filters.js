// page-filters.js — standalone page-enhancement IIFEs that run during active rounds.
// Split from content.js (v1.6 refactor) — code moved verbatim, no logic changes.

// ----------------------
// ----------------------
// Page enhancement: enforce actor-only filmography filter on /name/ pages
// ----------------------
(function enforceActorFilter() {
  if (!window.location.pathname.startsWith('/name/')) return;

  // Talk shows / chat shows / morning shows — always hidden globally
  const TALK_SHOW_PATTERNS = [
    /\btonight show\b/i,
    /\blate show\b/i,
    /\blate late show\b/i,
    /\blate night with\b/i,
    /\bjimmy kimmel\b/i,
    /\bjimmy fallon\b/i,
    /\bfallon\b.*\btonight\b/i,
    /\bconan\b/i,
    /\bellen degeneres\b/i,
    /\bthe ellen show\b/i,
    /\bgraham norton\b/i,
    /\bjonathan ross\b/i,
    /\bsaturday night live\b/i,
    /\bsnl\b/i,
    /\bthe view\b/i,
    /\bgood morning america\b/i,
    /\btoday show\b/i,
    /\bthe today show\b/i,
    /\bdaily show\b/i,
    /\bcolbert report\b/i,
    /\blate show with stephen colbert\b/i,
    /\bdavid letterman\b/i,
    /\bjay leno\b/i,
    /\bthe tonight show starring\b/i,
    /\bseth meyers\b/i,
    /\blast week tonight\b/i,
    /\bwatch what happens live\b/i,
    /\breal time with bill maher\b/i,
    /\bjames corden\b/i,
    /\blate late show with james corden\b/i,
    /\bcraig ferguson\b/i,
    /\bchelsea lately\b/i,
    /\blive with kelly\b/i,
    /\boprah winfrey show\b/i,
    /\bthe oprah\b/i,
    /\bwendy williams\b/i,
    /\baccess hollywood\b/i,
    /\bentertainment tonight\b/i,
    /\bthe rosie o'donnell\b/i,
    /\btrevor noah\b/i,
    /\bdaily show with trevor noah\b/i,
    /\btalk show\b/i,
    /\bchat show\b/i,
    /\bmorning show\b/i,
    /\bbreakfast show\b/i,
    /\bbreakfast tv\b/i,
    /\bthis morning\b/i,
    /\bloose women\b/i,
    /\bgood morning britain\b/i,
    /\bdaybreak\b/i,
    /\blorraine\b/i,
    /\bthe one show\b/i,
    /\bthe late late\b/i,
    /\bthe late show\b/i,
    /\bthe early show\b/i,
    /\bcbs this morning\b/i,
    /\bnbc nightly news\b/i,
    /\babc news\b/i,
    /\bgma\b/i,
    /\bextra \(tv\b/i,
    /\bextra tv\b/i,
    /\bthe talk\b/i,
    /\bthe chew\b/i,
    /\bmaury\b/i,
    /\bjerry springer\b/i,
    /\bdoctor oz\b/i,
    /\bdr\. oz\b/i,
    /\bthe dr\. oz show\b/i,
    /\bkelly and ryan\b/i,
    /\blive with regis\b/i,
    /\bregis and kelly\b/i,
  ];

  function isTalkShow(title) {
    return TALK_SHOW_PATTERNS.some(p => p.test(title));
  }

  function hideEl(el) {
    if (el.style.display === 'none') return; // already hidden
    el.style.display = 'none';
    el.setAttribute('data-race-hidden', '1');
  }

  function restoreFiltered() {
    document.querySelectorAll('[data-race-hidden]').forEach(el => {
      el.style.display = '';
      el.removeAttribute('data-race-hidden');
    });
  }

  function applyFilter() {
    // Only enforce restrictions while a round is actively in progress
    if (!roundIsActive) {
      restoreFiltered();
      return;
    }

    const selected   = Array.from(document.querySelectorAll('.filmography-selected-chip-filter'));
    const unselected = Array.from(document.querySelectorAll('.filmography-unselected-chip-filter'));
    if (selected.length === 0 && unselected.length === 0) return; // not rendered yet

    const getLabel = chip => chip.querySelector('.ipc-chip__text')?.childNodes[0]?.nodeValue?.trim() ?? '';

    // Deselect + hide any active non-Actor chip (click first so React updates the filmography list)
    selected.forEach(chip => {
      if (getLabel(chip) !== 'Actor') {
        chip.click();
        hideEl(chip);
      }
    });

    // Hide unselected non-Actor chips; activate Actor if it somehow isn't already
    unselected.forEach(chip => {
      const label = getLabel(chip);
      if (label === 'Actor') {
        chip.click(); // activate it
      } else {
        hideEl(chip);
      }
    });

    // Hide non-Actor section headings and their accordion containers
    document.querySelectorAll('[class*="filmo-section-"]').forEach(titleEl => {
      const label = titleEl.querySelector('.ipc-title__text')?.textContent?.trim() ?? '';
      if (label !== 'Actor' && label !== 'Actress') {
        hideEl(titleEl);
        const container = titleEl.nextElementSibling;
        if (container) hideEl(container);
      }
    });

    // Hide the entire "Recently Viewed" section — it can contain destination actors
    // that players could click directly to cheat. Also hide the outer page-background
    // section so the black bar doesn't remain visible.
    document.querySelectorAll('.recently-viewed, section.recently-viewed-items').forEach(el => {
      hideEl(el);
      const bg = el.closest('section.ipc-page-background');
      if (bg) hideEl(bg);
    });

    // Hide individual talk show credit rows (actor filmography accordion)
    document.querySelectorAll('li.ipc-metadata-list-summary-item').forEach(li => {
      const titleEl = li.querySelector('.ipc-metadata-list-summary-item__t');
      if (!titleEl) return;
      if (isTalkShow(titleEl.textContent.trim())) {
        hideEl(li);
      }
    });

    // Hide ANY link to a talk show title anywhere on the page
    // (recently viewed, recommendations, trivia, known-for, etc.)
    document.querySelectorAll('a[href*="/title/tt"]').forEach(anchor => {
      const text = anchor.textContent.trim();
      if (!text || !isTalkShow(text)) return;
      // Hide the closest li ancestor (covers cards, trivia items, list rows),
      // or fall back to hiding the anchor's direct parent element.
      const container = anchor.closest('li') || anchor.parentElement;
      if (container && container.style.display !== 'none') {
        hideEl(container);
      }
    });
  }

  // Run once when chips are already in the DOM, and observe for lazy-loaded content
  const observer = new MutationObserver(() => applyFilter());
  observer.observe(document.body, { childList: true, subtree: true });
  applyFilter();
})();

// ----------------------
// Page enhancement: hide site search during active rounds (applies on all IMDB pages)
// ----------------------
(function enforceSearchHide() {
  const ATTR = 'data-race-search-hidden';

  function hideSearch() {
    const form = document.querySelector('#nav-search-form');
    if (!form) return;
    if (roundIsActive) {
      if (!form.hasAttribute(ATTR)) {
        form.style.visibility = 'hidden';
        form.style.pointerEvents = 'none';
        form.setAttribute(ATTR, '1');
      }
    } else {
      if (form.hasAttribute(ATTR)) {
        form.style.visibility = '';
        form.style.pointerEvents = '';
        form.removeAttribute(ATTR);
      }
    }
  }

  const observer = new MutationObserver(() => hideSearch());
  observer.observe(document.body, { childList: true, subtree: true });
  hideSearch();
})();

// ----------------------
// Hide "Recently Viewed" section on ALL page types during active rounds
// (actor pages are also covered here; the actor-page IIFE handles it too as a fallback)
(function enforceRecentlyViewedHide() {
  const ATTR = 'data-race-rvi-hidden';

  function apply() {
    if (roundIsActive) {
      document.querySelectorAll('.recently-viewed, section.recently-viewed-items').forEach(el => {
        if (!el.hasAttribute(ATTR)) {
          el.style.display = 'none';
          el.setAttribute(ATTR, '1');
        }
        // Also hide the outer black page-background section so no empty bar remains
        const bg = el.closest('section.ipc-page-background');
        if (bg && !bg.hasAttribute(ATTR)) {
          bg.style.display = 'none';
          bg.setAttribute(ATTR, '1');
        }
      });
    } else {
      document.querySelectorAll(`[${ATTR}]`).forEach(el => {
        el.style.display = '';
        el.removeAttribute(ATTR);
      });
    }
  }

  const observer = new MutationObserver(() => apply());
  observer.observe(document.body, { childList: true, subtree: true });
  apply();
})();

// ----------------------
// Disarm the IMDB header logo link during active rounds only
(function enforceLogoDisarm() {
  const ATTR = 'data-race-logo-disarmed';
  function apply() {
    const logo = document.getElementById('home_img_holder');
    if (!logo) return;
    if (roundIsActive) {
      if (!logo.hasAttribute(ATTR)) {
        logo.setAttribute(ATTR, logo.getAttribute('href') || '');
        logo.removeAttribute('href');
        logo.style.cursor = 'default';
      }
    } else {
      if (logo.hasAttribute(ATTR)) {
        const orig = logo.getAttribute(ATTR);
        if (orig) logo.setAttribute('href', orig);
        logo.removeAttribute(ATTR);
        logo.style.cursor = '';
      }
    }
  }
  const observer = new MutationObserver(() => apply());
  observer.observe(document.body, { childList: true, subtree: true });
  apply();
})();

// ----------------------
// Hide sidebar sections (user lists, polls, editorial) during active rounds only
(function enforceSidebarHide() {
  const SELECTORS = ['[data-testid="SidebarList-user"]', '[data-testid="SidebarList-polls"]', '[data-testid="SidebarList-editorial"]'];
  const ATTR = 'data-race-sidebar-hidden';
  function apply() {
    SELECTORS.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        if (roundIsActive) {
          if (!el.hasAttribute(ATTR)) {
            el.style.display = 'none';
            el.setAttribute(ATTR, '1');
          }
        } else {
          if (el.hasAttribute(ATTR)) {
            el.style.display = '';
            el.removeAttribute(ATTR);
          }
        }
      });
    });
  }
  const observer = new MutationObserver(() => apply());
  observer.observe(document.body, { childList: true, subtree: true });
  apply();
})();

// ----------------------
// Hide director/writer rows on title pages during active rounds, and disarm
// any remaining crew links. Stars row is kept visible (actors are fair game).
// Also disarms the "See full cast and crew" icon link.
(function enforceCrewLinkDisarm() {
  const ATTR      = 'data-race-crew-href';
  const ATTR_ROW  = 'data-race-crew-row-hidden';

  function apply() {
    if (roundIsActive) {
      // Hide director/writer rows entirely, disarm any links inside them too
      document.querySelectorAll('[data-testid="title-pc-principal-credit"]').forEach(item => {
        const label = item.querySelector('.ipc-metadata-list-item__label')?.textContent?.trim().toLowerCase() || '';
        if (label === 'director' || label === 'directors' || label === 'writer' || label === 'writers' || label === 'creator' || label === 'creators') {
          if (!item.hasAttribute(ATTR_ROW)) {
            item.style.display = 'none';
            item.setAttribute(ATTR_ROW, '1');
          }
          item.querySelectorAll('a[href]').forEach(a => {
            if (!a.hasAttribute(ATTR)) {
              a.setAttribute(ATTR, a.getAttribute('href'));
              a.removeAttribute('href');
              a.style.cursor = 'default';
              a.style.pointerEvents = 'none';
            }
          });
        }
      });
      // Disarm the "See full cast and crew" arrow icon link
      document.querySelectorAll('a.ipc-metadata-list-item__icon-link[href*="fullcredits"]').forEach(a => {
        if (!a.hasAttribute(ATTR)) {
          a.setAttribute(ATTR, a.getAttribute('href'));
          a.removeAttribute('href');
          a.style.cursor = 'default';
          a.style.pointerEvents = 'none';
        }
      });
    } else {
      // Restore hidden rows
      document.querySelectorAll(`[${ATTR_ROW}]`).forEach(item => {
        item.style.display = '';
        item.removeAttribute(ATTR_ROW);
      });
      // Restore all disarmed crew links
      document.querySelectorAll(`[${ATTR}]`).forEach(a => {
        a.setAttribute('href', a.getAttribute(ATTR));
        a.removeAttribute(ATTR);
        a.style.cursor = '';
        a.style.pointerEvents = '';
      });
    }
  }

  const observer = new MutationObserver(() => apply());
  observer.observe(document.body, { childList: true, subtree: true });
  apply();
})();

// ----------------------
// Full credits page — hide non-cast sections during active rounds only
(function enforceFullCreditsFilter() {
  const ATTR = 'data-race-crew-hidden';
  function apply() {
    if (!window.location.pathname.includes('/fullcredits')) return;
    document.querySelectorAll('.ipc-page-section').forEach(section => {
      const heading = section.querySelector('h3 span');
      if (!heading) return;
      const isCast = heading.textContent.trim().toLowerCase().includes('cast');
      if (roundIsActive && !isCast) {
        if (!section.hasAttribute(ATTR)) {
          section.style.display = 'none';
          section.setAttribute(ATTR, '1');
        }
      } else if (!roundIsActive && section.hasAttribute(ATTR)) {
        section.style.display = '';
        section.removeAttribute(ATTR);
      }
    });
  }
  const observer = new MutationObserver(() => apply());
  observer.observe(document.body, { childList: true, subtree: true });
  apply();
})();

// ----------------------
// Page enhancement: always expand Previous / Upcoming acting-role accordions on actor pages
// ----------------------
(function expandActorAccordions() {
  if (!window.location.pathname.startsWith('/name/')) return;

  function expandAll() {
    document.querySelectorAll('[data-testid="nm-flmg-all-accordion-expander"]').forEach(btn => {
      if (btn.textContent.trim() === 'Expand below') btn.click();
    });
  }

  const observer = new MutationObserver(() => expandAll());
  observer.observe(document.body, { childList: true, subtree: true });
  expandAll();
})();

// initialRefresh() was removed — init() at the top of this file handles all rehydration.
// Having two concurrent async IIFEs caused races and double startPolling() calls.