# Deploying the price proxy

`src/index.js` is a CORS proxy for Yahoo Finance, to be deployed on your own
Cloudflare account. It replaces the free public proxies the site used until
August 2026, five of which failed inside three days.

Deploying needs your Cloudflare login, so it is a job only you can do. There are
two ways in; the second is more setup once and no work ever after.

## Path A — paste it in

Cloudflare's dashboard changes often and these steps go stale, so treat the
button names as a guide rather than gospel and say what you actually see if they
do not match.

1. **dash.cloudflare.com** → **Workers & Pages** → **Create**.
2. Name it `macro-compass-proxy`. The name becomes part of the URL.
3. **Deploy** it with whatever starter code it offers. You are not keeping that
   code; deploying it is just how the Worker gets created.
4. On the Worker's own page, find the code editor — depending on the version of
   the dashboard you have, it is **Edit code**, **Quick edit**, or an edit icon
   beside the source. Replace everything with the contents of `src/index.js`
   and deploy again.

## Path B — deploy from this repository

More setup the first time, then the Worker updates itself whenever
`src/index.js` changes here, and never needs pasting again.

1. **Workers & Pages** → **Create** → **Import a repository**.
2. Authorise Cloudflare for `joeedessa/macro-compass`.
3. Set **Root directory** to `cloudflare`. This matters: `wrangler.jsonc` and
   `src/` live there, not at the repo root.
4. Leave the build command empty — there is nothing to build — and deploy.

`wrangler.jsonc` already carries the name, entry point and a pinned
compatibility date, so nothing else needs configuring.

## Checking it works

Open this, replacing the host with yours:

```
https://macro-compass-proxy.joe-edessa.workers.dev/?url=https%3A%2F%2Fquery1.finance.yahoo.com%2Fv7%2Ffinance%2Fspark%3Fsymbols%3DSPY%26range%3D5d%26interval%3D1d
```

A wall of JSON starting `{"spark":{"result":[{"symbol":"SPY"` means it works.
Anything else — an error page, a Cloudflare message — means something went
wrong, and sending me what you see is more use than retrying blind.

This is not the same test the site performs. A browser sends no `Origin` header
when you type a URL yourself, so this exercises the fetching half only. The
site's requests carry an origin, which the Worker checks against its allowlist;
I will verify that half once it is wired in.

## What it will and will not do

It fetches only `query1`/`query2.finance.yahoo.com`, and returns CORS headers
only to the dashboard's own origins. Both limits exist because an unrestricted
proxy is an open relay: anyone finding the URL could push traffic through it,
spend your quota, and make your account the apparent source of whatever they
fetched.

The free tier is 100,000 requests a day. A watchlist load is about fifty, so
roughly two thousand page loads a day before Cloudflare charges anything.
Responses are held at the edge for sixty seconds, which costs nothing in
freshness — Yahoo is fifteen minutes delayed regardless — and cuts the request
count sharply across reloads and open tabs.

## What this fixes

Live intraday prices come back, and with them the watchlist's intraday negation
check, which needs true session highs and lows and has been unavailable since
the public proxies went down.

The committed snapshot in `docs/data/` stays as it is. It is the floor beneath
this, not something this replaces: if the Worker is ever unreachable the pages
fall back to it and say so, exactly as they do today.

## Changing the allowlists

Both are plain lists at the top of `src/index.js` — `ALLOWED_HOSTS` for what it
may fetch, `ALLOWED_ORIGINS` for who may call it. A custom domain in front of
the Worker would need its origin added there too.
