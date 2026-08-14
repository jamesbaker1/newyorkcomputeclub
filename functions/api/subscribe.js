// POST /api/subscribe — adds an email to the club list (Cloudflare KV).
// Requires a KV namespace bound as SIGNUPS in the Pages project settings.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestPost({ request, env }) {
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
  if (honeypot) return json({ ok: true, message: 'you are on the list' });

  email = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json({ ok: false, error: 'that email does not parse' }, 400);
  }

  if (!env.SIGNUPS) {
    return json({ ok: false, error: 'list is not wired up yet' }, 500);
  }

  if (await env.SIGNUPS.get(email)) {
    return json({ ok: true, message: 'already on the list' });
  }

  await env.SIGNUPS.put(
    email,
    JSON.stringify({
      ts: new Date().toISOString(),
      country: request.cf?.country || '',
    })
  );

  return json({ ok: true, message: 'you are on the list' });
}
