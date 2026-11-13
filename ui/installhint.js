// The one-time Home Screen tip for iOS Safari. Safari deletes a site's script-writable storage (here the pilot
// sessions and the journal) after 7 days of Safari use without a visit; Home Screen web apps are exempt
// (https://webkit.org/tracking-prevention/). The tip sits in the page flow above the views: it never takes focus
// or covers a control, and stays away once dismissed. No imports, so the detection is unit-testable.
export const HIDE = 'eve-install-hint:v1';
// Browsers on iOS that put their own name in Safari's user agent; Add to Home Screen lives in Safari's Share sheet.
const NOT_SAFARI = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|YaBrowser|FBAN|FBAV|Instagram|Line\//;

// iOS Safari in a tab: only WebKit on iOS defines navigator.standalone (false in a tab, true from the Home Screen),
// so desktop browsers and Chromium with an iPhone user agent never see the tip. iPadOS asks for desktop sites
// and reports a Mac, which has no touch points.
export function wantsHint({userAgent = '', standalone, maxTouchPoints = 0} = {}, displayStandalone = false) {
  if (standalone !== false || displayStandalone) return false;
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  return ios && /Version\/[\d.]+.*Safari\//.test(userAgent) && !NOT_SAFARI.test(userAgent);
}

function dismissed() { try { return localStorage.getItem(HIDE) === '1'; } catch { return false; } }

export function wire() {
  const hint = document.querySelector('#install-hint');
  if (!hint || dismissed() || !wantsHint(navigator, matchMedia('(display-mode: standalone)').matches)) return;
  hint.hidden = false;
  document.querySelector('#install-hint-close').addEventListener('click', () => {
    hint.hidden = true;
    // Don't drop keyboard focus on the page: land on the current screen's title, as moving between views does.
    const title = document.querySelector('.view:not([hidden]) .screen-title, #viewbar:not([hidden]) .screen-title');
    if (title) { title.tabIndex = -1; title.focus({preventScroll:true}); }
    try { localStorage.setItem(HIDE, '1'); } catch { /* Hidden for this visit. */ }
  });
}
