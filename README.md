# NEW YORK COMPUTE CLUB

Pooled GPUs. Five boroughs. Hardware you can bike to.

One dark page (`public/index.html`), zero dependencies.
Rub it — compute is heat, heat is light.

## Layout

- `public/index.html` — the whole site. No build step, no frameworks.
- `public/fonts/` — self-hosted Anton (SIL OFL).
- `src/worker.js` — Cloudflare Worker; serves `public/` and handles `POST /api/subscribe` into KV.
- `wrangler.toml` — Worker config: static assets + KV binding.

## Deploy (Cloudflare Workers)

The repo deploys with plain `npx wrangler deploy` — which is exactly what
Cloudflare's git integration (Workers Builds) runs. Connect the repo and it
ships as-is; signups answer "list is not wired up yet" until KV exists.

To turn the list on:

1. ```sh
   npx wrangler kv namespace create SIGNUPS
   ```
2. Paste the printed `id` into `wrangler.toml` and uncomment the
   `[[kv_namespaces]]` block.
3. Push (or `npx wrangler deploy`).

### Read the list

```sh
npx wrangler kv key list --namespace-id <your-namespace-id> --remote
```

Each key is an email; each value has a signup timestamp and country.

### Local dev

```sh
npx wrangler dev
```
