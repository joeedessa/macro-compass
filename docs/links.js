/* Where a ticker links to, defined once.
 *
 * This was eleven copies of the same one-liner, one per page, plus a twelfth
 * spelt differently in portfolio.html and a thirteenth called YC on the AI page.
 * Asked to send every ticker to a chart instead of a summary, I changed the
 * eleven that shared a name and missed the two that did not — the AI page went
 * on pointing at /chart/SYM, a URL that resolves for US tickers and not
 * reliably for Samsung, TSMC or SK Hynix, which is most of that page.
 *
 * It only surfaced because the miss was asked about. So the URL lives here now
 * and the pages hold a reference to it: changing where a ticker goes is one
 * edit, and a page that forgets to use this has no URL of its own to be wrong
 * with.
 *
 * On the URL itself: /quote/SYM/chart is the form that works for every symbol
 * on this site, US and otherwise. The bare /chart/SYM route is US-reliable
 * only. Neither can be checked with curl — Yahoo answers 404 to non-browser
 * clients for both, on every non-US symbol — so this has to be verified by
 * loading it. It was, on 7936.T.
 *
 * Nothing here is ever fetched. These are hrefs the reader's browser opens; all
 * of this site's data comes from query1.finance.yahoo.com, a different host
 * with a different policy, which is why the bot-blocking above is a nuisance
 * for testing and not a problem for the dashboard.
 */
(function () {
  "use strict";
  window.YCHART = s => "https://finance.yahoo.com/quote/" + encodeURIComponent(s) + "/chart";
  window.YNEWS = s => "https://finance.yahoo.com/quote/" + encodeURIComponent(s) + "/news";
})();
