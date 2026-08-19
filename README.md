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
- `src/site/city.js` — the scene source. Bundled (with three.js 0.170.0,
  tree-shaken) to `public/js/city.min.js`, which is committed, so deploys
  need no build.
- `public/fonts/` — self-hosted Anton (SIL OFL).
- `src/worker.js` — Cloudflare Worker; serves `public/` and handles
  `POST /api/subscribe` into KV (honeypot, dedupe with first-seen
  timestamp kept, machine-readable `already` flag).
- `wrangler.toml` — Worker config: static assets, KV binding, custom domains.

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

```sh
npx wrangler kv key list --binding SIGNUPS --remote
```

Each key is an email; each value has a signup timestamp and country.

## Related

- [nycc-engine](https://github.com/jamesbaker1/nycc-engine) — the inference engine every node runs.
- [nycc-grid](https://github.com/jamesbaker1/nycc-grid) — the mesh: sealed jobs, signed node traffic, an untrusted coordinator.
