// Serves the static site and handles POST /api/subscribe — adds an email to
// the club list (Cloudflare KV). Until a KV namespace is bound as SIGNUPS in
// wrangler.toml, signups answer "list is not wired up yet" and everything
// else still works.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Owner's inbox. wrangler.toml's send_email destination_address stays a
// literal (routing config can't reference this), but everywhere the worker
// itself addresses mail, it reads from here.
const OWNER_EMAIL_ADDRESS = 'james.baker1628@gmail.com';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

// Best-effort per-IP throttle. KV is eventually consistent, so this bounds
// abuse rather than proving a hard limit; the honeypot does the heavy lifting.
const RL_MAX = 20;
const RL_WINDOW_S = 3600;
async function overRateLimit(request, env) {
  if (!env.SIGNUPS) return false;
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (!ip) return false;
  const key = 'rl:' + ip;
  const n = Number((await env.SIGNUPS.get(key)) || 0);
  if (n >= RL_MAX) return true;
  await env.SIGNUPS.put(key, String(n + 1), { expirationTtl: RL_WINDOW_S });
  return false;
}

async function subscribe(request, env) {
  let email = '';
  let note = '';
  let honeypot = '';
  let via = 'form';
  try {
    const type = request.headers.get('content-type') || '';
    if (type.includes('application/json')) {
      const body = await request.json();
      email = body.email || '';
      note = body.note || '';
      honeypot = body.company || '';
      if (body.via === 'console') via = 'console';
    } else {
      const form = await request.formData();
      email = form.get('email') || '';
      note = form.get('note') || '';
      honeypot = form.get('company') || '';
    }
  } catch {
    return json({ ok: false, error: 'bad request' }, 400);
  }

  // Bots fill the hidden "company" field; pretend it worked and drop it.
  if (honeypot) return json({ ok: true, already: false, message: 'application received. we answer slowly.' });

  email = String(email).trim().toLowerCase();
  // free text: a link, a line, whatever they like. one line, bounded.
  note = String(note).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 500);
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json({ ok: false, error: 'that email does not parse' }, 400);
  }

  if (!env.SIGNUPS) {
    return json({ ok: false, error: 'the list is not wired up yet' }, 500);
  }

  if (await overRateLimit(request, env)) {
    return json({ ok: false, error: 'slow down. try later.' }, 429);
  }

  // Not atomic (KV), so a double submit can reach the put twice; keeping the
  // stored first-seen timestamp is what makes that harmless.
  const prior = await env.SIGNUPS.get(email, 'json');
  if (prior) {
    // a returning applicant can still leave or update their line.
    if (note && note !== prior.note) {
      await env.SIGNUPS.put(email, JSON.stringify({ ...prior, note }));
      return json({ ok: true, already: true, message: 'you already applied. added your note.' });
    }
    return json({ ok: true, already: true, message: 'you already applied. patience.' });
  }

  await env.SIGNUPS.put(
    email,
    JSON.stringify({
      ts: new Date().toISOString(),
      country: request.cf?.country || '',
      via,
      ...(note ? { note } : {}),
    })
  );

  // tell the owner right away, best effort: a failed send must never fail a signup.
  // the daily digest still runs and stays the source of truth; this is just faster.
  if (env.OWNER_EMAIL) {
    try {
      const raw = [
        'From: the club <digest@newyorkcomputeclub.com>',
        `To: ${OWNER_EMAIL_ADDRESS}`,
        `Subject: new application: ${email}`,
        `Message-ID: <${crypto.randomUUID()}@newyorkcomputeclub.com>`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        `${email}  (via ${via}${request.cf?.country ? ', ' + request.cf.country : ''})`,
        ...(note ? ['', note] : []),
      ].join('\r\n');
      const { EmailMessage } = await import('cloudflare:email');
      await env.OWNER_EMAIL.send(
        new EmailMessage('digest@newyorkcomputeclub.com', OWNER_EMAIL_ADDRESS, raw)
      );
    } catch {}
  }

  const message = via === 'console'
    ? 'application received, and noted: you read the source.'
    : 'application received. we answer slowly.';
  return json({ ok: true, already: false, message });
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
    // kind defaults to "member" so this stays correct against v1 records that
    // predate the member/walk-in split.
    const walkins = alive.filter(n => n.kind === 'walk-in').length;
    return json({
      ok: true,
      nodes: alive.length,
      members: alive.length - walkins,
      walkins,
      watts: Math.round(alive.reduce((w, n) => w + (Number(n.wattage) || 0), 0) * 10) / 10,
    });
  } catch {
    return json({ ok: false }, 502);
  }
}

// The richer feed for the /grid dashboard: proxies the coordinator's own
// aggregate. Returns 502 until the coordinator ships /v1/stats, so the page
// degrades to the lighter /api/grid.
async function gridStats() {
  try {
    const res = await fetch('https://grid.newyorkcomputeclub.com/v1/stats', {
      cf: { cacheTtl: 20, cacheEverything: true },
    });
    if (!res.ok) throw new Error(String(res.status));
    return new Response(await res.text(), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  } catch {
    return json({ ok: false }, 502);
  }
}

// Daily digest of new applications, mailed to the club address's owner.
// State lives in the same KV under a key no email can collide with (the
// subscribe validator requires an @). Runs on cron; GET /api/digest with the
// right x-digest-key header triggers it by hand.
const DIGEST_STATE_KEY = '__digest__';

async function runDigest(env) {
  const seen = new Set(((await env.SIGNUPS.get(DIGEST_STATE_KEY, 'json')) || {}).seen || []);
  const emails = [];
  let cursor;
  do {
    const page = await env.SIGNUPS.list({ cursor });
    for (const k of page.keys) if (k.name.includes('@')) emails.push(k.name);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  const fresh = emails.filter(e => !seen.has(e));
  let sent = false;
  if (fresh.length && env.OWNER_EMAIL) {
    const lines = [];
    for (const e of fresh) {
      const rec = (await env.SIGNUPS.get(e, 'json')) || {};
      lines.push(`${e}  (${rec.ts || 'unknown time'}${rec.country ? ', ' + rec.country : ''})`);
      if (rec.note) lines.push(`    ${rec.note}`);
    }
    const subject = `${fresh.length} new application${fresh.length === 1 ? '' : 's'}`;
    const raw = [
      'From: the club <digest@newyorkcomputeclub.com>',
      `To: ${OWNER_EMAIL_ADDRESS}`,
      `Subject: ${subject}`,
      `Message-ID: <${crypto.randomUUID()}@newyorkcomputeclub.com>`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      'new since the last digest:',
      '',
      ...lines,
      '',
      `list total: ${emails.length}`,
      'read it all: npx wrangler kv key list --binding SIGNUPS --remote',
    ].join('\r\n');
    const { EmailMessage } = await import('cloudflare:email');
    await env.OWNER_EMAIL.send(
      new EmailMessage('digest@newyorkcomputeclub.com', OWNER_EMAIL_ADDRESS, raw)
    );
    sent = true;
  }

  await env.SIGNUPS.put(DIGEST_STATE_KEY, JSON.stringify({ seen: emails }));
  return { total: emails.length, fresh: fresh.length, sent };
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
    if (url.pathname === '/api/stats' && request.method === 'GET') {
      return gridStats();
    }
    if (url.pathname === '/api/digest' && request.method === 'GET') {
      if (!env.DIGEST_KEY || request.headers.get('x-digest-key') !== env.DIGEST_KEY) {
        return json({ ok: false, error: 'no' }, 403);
      }
      return json({ ok: true, ...(await runDigest(env)) });
    }

    const res = await env.ASSETS.fetch(request);
    // Serve the club's own 404 for missing pages, not the platform default.
    if (res.status === 404 && (request.headers.get('accept') || '').includes('text/html')) {
      const page = await env.ASSETS.fetch(new URL('/404.html', url));
      if (page.ok) return new Response(page.body, { status: 404, headers: page.headers });
    }
    return res;
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runDigest(env));
  },
};
