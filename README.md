# NEW YORK COMPUTE CLUB

Pooled GPUs. Five boroughs. Hardware you can bike to.

Live at [newyorkcomputeclub.com](https://newyorkcomputeclub.com).

One dark page: the five boroughs rendered as a load histogram. One
instanced box per lot, Manhattan at fine grain with Central Park and
Broadway carved out, the outer boroughs as dim sprawl, real bridges as
thin arcs. Above the rooftops, the cluster: nodes at the real carrier
hotels (60 Hudson St, 111 8th Ave, the Teleport), jobs routing between
them, arrivals warming the streets below. Heat roams the city on its own;
your cursor overrides it. Joining the list makes every wire fire.

`/about` takes applications into the same list.

## Layout

- `public/index.html` — the landing page.
- `public/about.html` — the application.
- `public/grid.html` — the grid dashboard, reading `/api/grid` and
  `/api/stats`.
- `src/site/city.js` — the scene source. Bundled (with three.js 0.170.0,
  tree-shaken) to `public/js/city.min.js`, which is committed, so deploys
  need no build.
- `public/fonts/` — self-hosted Anton (SIL OFL).
- `src/worker.js` — Cloudflare Worker; serves `public/` and the API below.
- `wrangler.toml` — Worker config: static assets, KV binding, `send_email`
  binding, cron trigger, custom domains.

## API

- `POST /api/subscribe` — adds an email to the list (KV). Honeypot,
  per-IP rate limit, dedupe with first-seen timestamp kept,
  machine-readable `already` flag.
- `GET /api/grid` — node count and total wattage, proxied from the grid
  coordinator.
- `GET /api/stats` — the coordinator's richer stats feed, proxied the
  same way. 502s until the coordinator ships `/v1/stats`.
- `GET /api/digest` — runs the digest by hand. Needs an `x-digest-key`
  header matching the `DIGEST_KEY` secret.

A cron trigger runs that same digest at 13:00 UTC (`wrangler.toml`
`[triggers]`), mailing new applications to the owner through the
`send_email` binding (`OWNER_EMAIL`). A signup also gets an instant,
best-effort notification to the same address; the digest stays the
source of truth if that send fails.

## Deploy

```sh
npx wrangler deploy
```

Custom domains (`newyorkcomputeclub.com`, `www`) are declared in
`wrangler.toml` and provisioned on deploy.

Editing the scene needs a rebuild first:

```sh
npm install
npm run build
```

## Read the list

The namespace holds more than emails now: `rl:<ip>` rate-limit keys and
the `__digest__` state key sit alongside signups. Filter to emails the
same way the digest does, on `@`:

```sh
npx wrangler kv key list --binding SIGNUPS --remote | jq '[.[] | select(.name | contains("@"))]'
```

Each key is an email; each value has a signup timestamp and country.

## Related

- [nycc-engine](https://github.com/jamesbaker1/nycc-engine) — the inference engine every node runs.
- [nycc-grid](https://github.com/jamesbaker1/nycc-grid) — the mesh: sealed jobs, signed node traffic, an untrusted coordinator.
