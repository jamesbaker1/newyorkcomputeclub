// Serves the static site and handles POST /api/subscribe — adds an email to
// the club list (Cloudflare KV). Until a KV namespace is bound as SIGNUPS in
// wrangler.toml, signups answer "list is not wired up yet" and everything
// else still works.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function subscribe(request, env) {
  let email = '';
  let honeypot = '';
  try {
    const type = request.headers.get('content-type') || '';
    if (type.includes('application/json')) {
      const body = await request.json();
      email = body.email || '';
      honeypot = body.company || '';
    } else {
      const form = await request.formData();
      email = form.get('email') || '';
      honeypot = form.get('company') || '';
    }
  } catch {
    return json({ ok: false, error: 'bad request' }, 400);
  }

  // Bots fill the hidden "company" field; pretend it worked and drop it.
  if (honeypot) return json({ ok: true, already: false, message: 'application received. we answer slowly.' });

  email = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json({ ok: false, error: 'that email does not parse' }, 400);
  }

  if (!env.SIGNUPS) {
    return json({ ok: false, error: 'the list is not wired up yet' }, 500);
  }

  // Not atomic (KV), so a double submit can reach the put twice; keeping the
  // stored first-seen timestamp is what makes that harmless.
  const prior = await env.SIGNUPS.get(email, 'json');
  if (prior) {
    return json({ ok: true, already: true, message: 'you already applied. patience.' });
  }

  await env.SIGNUPS.put(
    email,
    JSON.stringify({
      ts: new Date().toISOString(),
      country: request.cf?.country || '',
    })
  );

  return json({ ok: true, already: false, message: 'application received. we answer slowly.' });
}

// The about page's pilot light reads this instead of pretending. The grid
// coordinator is public read-only, but proxying keeps the page same-origin
// and lets the edge cache absorb the traffic.
async function gridStatus() {
  try {
    const res = await fetch('https://grid.newyorkcomputeclub.com/v1/nodes', {
      cf: { cacheTtl: 30, cacheEverything: true },
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const alive = (data.nodes || []).filter(n => n.alive);
    return json({
      ok: true,
      nodes: alive.length,
      watts: alive.reduce((w, n) => w + (Number(n.wattage) || 0), 0),
    });
  } catch {
    return json({ ok: false }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/subscribe' && request.method === 'POST') {
      return subscribe(request, env);
    }
    if (url.pathname === '/api/grid' && request.method === 'GET') {
      return gridStatus();
    }
    return env.ASSETS.fetch(request);
  },
};
