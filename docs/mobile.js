/* Two things the navigation strip needs that CSS cannot do on its own.
 *
 * First, bring the current page into view. The strip scrolls sideways on a
 * phone and the pages are in a fixed order, so opening Watchlist — thirteenth
 * of fourteen — would otherwise land you looking at Overview with no clue the
 * chip you are standing on exists.
 *
 * Second, fade only the edges that have something past them. A permanent fade
 * on both sides implies more content in a direction where there is none, and
 * at the ends of the strip that is a lie the reader has to test by swiping.
 */
(function () {
  "use strict";
  const nav = document.querySelector("nav.pages");
  if (!nav) return;

  function edges() {
    const slack = nav.scrollWidth - nav.clientWidth;
    if (slack <= 2) { nav.classList.remove("scrollable", "atend", "mid"); return; }
    nav.classList.add("scrollable");
    const atStart = nav.scrollLeft <= 2;
    const atEnd = nav.scrollLeft >= slack - 2;
    nav.classList.toggle("atend", atEnd && !atStart);
    nav.classList.toggle("mid", !atStart && !atEnd);
  }

  const here = nav.querySelector("a.here");
  if (here) {
    /* Centre it rather than align it: a chip flush against the left edge reads
       as the first item, which is exactly the wrong impression when there are
       six pages behind it. inline:"center" leaves a hint of both neighbours. */
    const centre = () => {
      const want = here.offsetLeft - (nav.clientWidth - here.offsetWidth) / 2;
      nav.scrollLeft = Math.max(0, want);
      edges();
    };
    /* Layout is not final until fonts land, and a chip that moves after the
       scroll has been set ends up off-centre. */
    centre();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(centre);
    addEventListener("load", centre, { once: true });
  }

  edges();
  nav.addEventListener("scroll", edges, { passive: true });
  addEventListener("resize", edges, { passive: true });
  addEventListener("orientationchange", () => setTimeout(edges, 250), { passive: true });
})();

/* Stay current when the page is reopened rather than reloaded.
 *
 * Added to the Home Screen, the site runs as a standalone app: no address bar,
 * no pull-to-refresh, and iOS keeps its pages alive for days. A redesign of the
 * Watchlist went unseen on a phone for a week because the app kept showing the
 * copy it already had. A Safari tab restored from the back-forward cache does
 * the same, more briefly.
 *
 * So on returning to the page, fetch it again past every cache and compare the
 * code: if any inline script or stylesheet in the deployed page is not present
 * verbatim in this one, a newer version is live — reload. Comparing what the
 * fresh copy contains (rather than hashing this document) ignores anything the
 * page injected into itself after loading. At most one reload per page every
 * ten minutes, so a CDN edge serving a different copy cannot loop it.
 */
(function () {
  "use strict";
  const texts = doc => [...doc.querySelectorAll("script:not([src]), style")]
    .map(n => n.textContent.trim()).filter(Boolean);
  let last = 0;
  async function check() {
    if (Date.now() - last < 120000) return;          // not more than every two minutes
    last = Date.now();
    try {
      const r = await fetch(location.pathname + location.search, { cache: "no-store" });
      if (!r.ok) return;
      const fresh = new DOMParser().parseFromString(await r.text(), "text/html");
      const mine = new Set(texts(document));
      if (texts(fresh).every(t => mine.has(t))) return;  // up to date
      const key = "mc-reloaded:" + location.pathname;
      let prev = 0;
      try { prev = +sessionStorage.getItem(key) || 0; } catch { /* private mode */ }
      if (Date.now() - prev < 600000) return;
      try { sessionStorage.setItem(key, String(Date.now())); } catch { /* private mode */ }
      location.reload();
    } catch { /* offline: keep what we have */ }
  }
  addEventListener("pageshow", e => { if (e.persisted) { last = 0; check(); } });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
  setTimeout(check, 4000);
})();
