/**
 * PARC reviews — Cloudflare Worker.
 *
 * GitHub Pages serves files and cannot store anything, so submissions go here
 * and are kept in Cloudflare KV.
 *
 * REVIEWS PUBLISH IMMEDIATELY, and are deleted after the fact if needed.
 * An earlier version held everything for approval. That is safer but only works
 * if somebody actually reads the queue — an unread queue means a candidate is
 * told "a volunteer will read this" and then nothing happens, which is worse
 * than not asking. Three things carry the load instead:
 *
 *   1. Cloudflare Turnstile, which stops automated submissions.
 *   2. A per-address daily cap, so one person cannot flood the page.
 *   3. A hard refusal of anything containing a phone number or email address,
 *      returned to the writer so they can fix it, rather than published.
 *
 * What none of that stops is a real person writing something abusive, or a
 * minor putting personal details in prose. That is now visible until somebody
 * notices and deletes it. tools/moderate-reviews.mjs lists and deletes.
 *
 * ROUTES
 *   GET  /            published reviews (public)
 *   POST /            submit a review   (public, Turnstile + rate limited)
 *   GET  /list        every stored review with ids  -- requires ADMIN_KEY
 *   POST /moderate    delete one                    -- requires ADMIN_KEY
 *
 * SETUP (see DEPLOY.md)
 *   1. Workers & Pages -> KV -> Create namespace, call it PARC_REVIEWS
 *   2. Bind it to this Worker as the variable REVIEWS
 *   3. Add a secret named ADMIN_KEY       (Settings -> Variables -> Encrypt)
 *   4. Add a secret named TURNSTILE_SECRET from the Turnstile widget
 */

const ALLOWED_DOMAINS = ['parcradio.net', 'parcradio.org', 'radiotests.org', 'github.io'];
const ALLOWED_EXACT = [
  'http://127.0.0.1:8088', 'http://localhost:8088',
  'http://127.0.0.1:8090', 'http://localhost:8090',
];
const DEFAULT_ORIGIN = 'https://radiotests.org';

const MAX_NAME = 60;
const MAX_TEXT = 1200;
const MAX_PER_IP_PER_DAY = 3;

function originAllowed(origin) {
  if (!origin) return false;
  if (ALLOWED_EXACT.includes(origin)) return true;
  let host;
  try { host = new URL(origin).hostname.toLowerCase(); } catch { return false; }
  return ALLOWED_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': originAllowed(origin) ? origin : DEFAULT_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
  });

/** Strip anything that could become markup, and collapse whitespace. */
function clean(s, max) {
  return String(s == null ? '' : s)
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/* Refused outright now rather than flagged, because there is no longer a human
   between the form and the page. A submission carrying a phone number or an
   email is nearly always somebody trying to reach the team, and publishing it
   would put their contact details on a public page — the writer may well be a
   minor. The refusal says which one it found so it can be removed and resent.
   Call signs are deliberately NOT blocked: on a ham radio site people sign with
   them, and the form only advises against it. */
const PHONE_RE = /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/;

/** Verify a Turnstile token. Skipped when no secret is configured. */
async function humanChecked(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return { ok: true };
  if (!token) return { ok: false, error: 'Please complete the "I am human" check and try again.' };

  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip && ip !== 'unknown') form.append('remoteip', ip);

  let data = null;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'POST', body: form });
    data = await res.json();
  } catch {
    /* Cloudflare's own verifier being unreachable is not the writer's fault, and
       failing closed here would silently break the form. Turnstile has already
       run in their browser; let it through. */
    return { ok: true };
  }

  if (!data || data.success !== true) {
    return { ok: false, error: 'The human check did not pass. Please try again.' };
  }
  return { ok: true };
}

async function listByPrefix(kv, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor, limit: 100 });
    for (const k of page.keys) {
      const v = await kv.get(k.name, 'json');
      if (v) out.push(v);
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const H = cors(origin);
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: H });
    if (!env || !env.REVIEWS) {
      return json({ error: 'KV namespace REVIEWS is not bound to this Worker' }, 500, H);
    }

    /* ---- public: published reviews --------------------------------------- */
    if (request.method === 'GET' && path === '/') {
      const items = await listByPrefix(env.REVIEWS, 'approved:');
      const shown = items.map((r) => ({ id: r.id, n: r.name, r: r.rating, t: r.text, at: r.at }));
      const avg = shown.length
        ? Math.round((shown.reduce((a, b) => a + b.r, 0) / shown.length) * 10) / 10
        : null;
      return json({ count: shown.length, average: avg, reviews: shown }, 200,
        { ...H, 'cache-control': 'public, max-age=30' });
    }

    /* ---- public: submit --------------------------------------------------- */
    if (request.method === 'POST' && path === '/') {
      if (!originAllowed(origin)) return json({ error: 'origin not allowed' }, 403, H);

      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400, H); }

      // Honeypot: a real person never fills a field they cannot see.
      if (clean(body.website, 50)) return json({ ok: true }, 200, H);

      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

      const human = await humanChecked(env, clean(body.turnstile, 4096), ip);
      if (!human.ok) return json({ error: human.error }, 400, H);

      const rating = Number(body.rating);
      const text = clean(body.text, MAX_TEXT);
      const name = clean(body.name, MAX_NAME) || 'Anonymous';

      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return json({ error: 'Please choose a rating from 1 to 5 stars.' }, 400, H);
      }
      if (text.length < 4) {
        return json({ error: 'Please add a few words about your experience.' }, 400, H);
      }
      if (EMAIL_RE.test(text) || EMAIL_RE.test(name)) {
        return json({ error: 'Please remove the email address — this page is public. '
          + 'To reach us, use the address in the footer instead.' }, 400, H);
      }
      if (PHONE_RE.test(text) || PHONE_RE.test(name)) {
        return json({ error: 'Please remove the phone number — this page is public.' }, 400, H);
      }

      // Coarse per-address daily cap, so one person cannot flood the page.
      const day = new Date().toISOString().slice(0, 10);
      const rlKey = `rl:${day}:${ip}`;
      const used = Number(await env.REVIEWS.get(rlKey)) || 0;
      if (used >= MAX_PER_IP_PER_DAY) {
        return json({ error: 'You have already submitted a review today. Thank you!' }, 429, H);
      }
      await env.REVIEWS.put(rlKey, String(used + 1), { expirationTtl: 60 * 60 * 26 });

      const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      const record = { id, name, rating, text, at: new Date().toISOString() };
      await env.REVIEWS.put(`approved:${id}`, JSON.stringify(record));

      return json({ ok: true, message: 'Thank you — your review is on the page.', review: record }, 200, H);
    }

    /* ---- moderation ------------------------------------------------------- */
    const key = url.searchParams.get('key') || request.headers.get('X-Admin-Key') || '';
    const authed = env.ADMIN_KEY && key && key === env.ADMIN_KEY;

    /* Includes anything left in `pending:` by the older hold-for-approval
       version, so those can still be found and cleared. */
    if (path === '/list' || path === '/pending') {
      if (!authed) return json({ error: 'unauthorised' }, 401, H);
      const live = await listByPrefix(env.REVIEWS, 'approved:');
      const held = await listByPrefix(env.REVIEWS, 'pending:');
      return json({
        count: live.length,
        reviews: live,
        leftoverPending: held,
      }, 200, H);
    }

    if (request.method === 'POST' && path === '/moderate') {
      if (!authed) return json({ error: 'unauthorised' }, 401, H);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400, H); }
      const id = clean(body.id, 60);
      const action = clean(body.action, 20) || 'delete';
      if (!id) return json({ error: 'id required' }, 400, H);
      if (action !== 'delete') return json({ error: 'action must be delete' }, 400, H);

      const inLive = await env.REVIEWS.get(`approved:${id}`);
      const inHeld = await env.REVIEWS.get(`pending:${id}`);
      if (!inLive && !inHeld) return json({ error: 'not found' }, 404, H);

      if (inLive) await env.REVIEWS.delete(`approved:${id}`);
      if (inHeld) await env.REVIEWS.delete(`pending:${id}`);
      return json({ ok: true, action: 'deleted', id }, 200, H);
    }

    return json({ error: 'not found' }, 404, H);
  },
};
