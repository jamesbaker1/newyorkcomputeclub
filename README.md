# NEW YORK COMPUTE CLUB

Pooled GPUs. Five boroughs. Hardware you can bike to.

One dark page. Manhattan rendered live as a compute-load histogram —
one instanced box per lot, height = load, Central Park and Broadway
carved out of the grid. Heat roams the island on its own; your cursor
overrides it. Joining the list makes the city surge.

Live at [newyorkcomputeclub.com](https://newyorkcomputeclub.com).

## Layout

- `public/index.html` — the whole site. No build step, no frameworks.
- `public/vendor/` — self-hosted three.js (pinned 0.170.0, MIT).
- `public/fonts/` — self-hosted Anton (SIL OFL).
- `src/worker.js` — Cloudflare Worker; serves `public/` and handles
  `POST /api/subscribe` into KV (honeypot, dedupe, timestamp + country).
- `wrangler.toml` — Worker config: static assets, KV binding, custom domains.

## Deploy

```sh
npx wrangler deploy
```

That's the whole pipeline. Custom domains (`newyorkcomputeclub.com`, `www`)
are declared in `wrangler.toml` and provisioned on deploy.

### Read the list

```sh
npx wrangler kv key list --binding SIGNUPS --remote
```

Each key is an email; each value has a signup timestamp and country.

### Local dev

```sh
npx wrangler dev
```
