# NEW YORK COMPUTE CLUB

Pooled GPUs. Five boroughs. Hardware you can bike to.

One dark page (`public/index.html`), zero dependencies.
Rub it — compute is heat, heat is light.

## Layout

- `public/index.html` — the whole site. No build step, no frameworks.
- `functions/api/subscribe.js` — Cloudflare Pages Function; takes an email, drops it in KV.
- `wrangler.toml` — Pages config + KV binding.

## Deploy (Cloudflare Pages)

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** →
   pick this repo. Build command: *(none)*. Build output directory: `public`.
2. Create the list:
   ```sh
   npx wrangler kv namespace create SIGNUPS
   ```
   Paste the printed `id` into `wrangler.toml`. (Dashboard route: **Storage & Databases → KV**,
   then bind it to the Pages project under **Settings → Bindings** with the name `SIGNUPS`.)
3. Push. Cloudflare builds nothing and serves everything.

### Read the list

```sh
npx wrangler kv key list --namespace-id <your-namespace-id> --remote
```

Each key is an email; each value has a signup timestamp and country.

### Local dev

```sh
npx wrangler pages dev public
```
