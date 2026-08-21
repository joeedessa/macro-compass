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
