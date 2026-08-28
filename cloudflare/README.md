# Deploying the price proxy

`worker.js` is a CORS proxy for Yahoo Finance, to be deployed on your own
Cloudflare account. It replaces the free public proxies the site used until
August 2026, five of which failed inside three days.

Deploying needs your Cloudflare login, so it is a job only you can do. Six steps,
no command line, no install.

## Deploy

1. Sign in at **dash.cloudflare.com**.
2. In the left sidebar choose **Workers & Pages**, then **Create**.
3. Choose **Start with Hello World!** and **Deploy** it as-is. Name it something
   recognisable — `macro-compass-proxy` is what the rest of these notes assume.
   The name becomes part of the URL, so it is worth getting right now.
4. Once it deploys, choose **Edit code**.
5. Delete everything in the editor and paste the whole of `worker.js` in its
   place. **Deploy** again.
6. Copy the URL from the top of the page. It looks like
   `https://macro-compass-proxy.<your-subdomain>.workers.dev`.

Send me that URL and I will wire the site to it.

## Checking it works before you send it

Open this in a browser tab, replacing the host with yours:

```
https://macro-compass-proxy.<your-subdomain>.workers.dev/?url=https%3A%2F%2Fquery1.finance.yahoo.com%2Fv7%2Ffinance%2Fspark%3Fsymbols%3DSPY%26range%3D5d%26interval%3D1d
```

A wall of JSON beginning `{"spark":{"result":[{"symbol":"SPY"` means it is
working. Anything else — an error page, a Cloudflare message — means something
in the paste went wrong, and sending me what you see is more useful than
retrying blind.

Note that opening it directly in a tab is *not* the same test the site performs:
a browser sends no `Origin` header when you type a URL yourself, so this checks
the fetching half only. The site's own requests carry an origin, which the
worker checks against its allowlist. That part I will verify once it is wired in.

## What it will and will not do

It only fetches `query1`/`query2.finance.yahoo.com`, and it only returns CORS
headers to pages served from the dashboard's own origins. Both limits exist
because an unrestricted proxy is an open relay: anyone who found the URL could
push traffic through it, spend your quota, and make your account the apparent
source of whatever they fetched.

The free tier is 100,000 requests a day. A watchlist load is about fifty, so
roughly two thousand page loads a day before Cloudflare would charge anything.
Responses are held at the edge for sixty seconds, which costs nothing in
freshness — Yahoo's data is fifteen minutes delayed regardless — and cuts the
request count sharply when you reload or keep several tabs open.

## What this fixes

Live intraday prices come back, and with them the watchlist's intraday negation
check, which needs true session highs and lows and has been unavailable since
the public proxies went down.

The hourly snapshot in `docs/data/` stays exactly as it is. It is the floor
beneath this, not a thing this replaces: if the worker is ever unreachable the
pages fall back to it and say so, the same as they do today.

## If you would rather change the allowlists

Both are plain lists at the top of `worker.js` — `ALLOWED_HOSTS` for what it may
fetch, `ALLOWED_ORIGINS` for who may call it. Edit, paste, redeploy. A custom
domain in front of the worker would need its origin added here too.
