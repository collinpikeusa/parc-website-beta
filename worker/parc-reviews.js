/**
 * PARC reviews — Cloudflare Worker.
 *
 * GitHub Pages serves files and cannot store anything, so submissions go here
 * and are kept in Cloudflare KV.
 *
 * NOTHING IS PUBLISHED UNTIL IT IS APPROVED.
 * A public review box on an exam site is an obvious spam target, and a candidate
 * who has just failed can post instantly and anonymously. Minors also sit these
 * exams, so a submission can easily contain personal details that should not end
 * up on a public page. Submissions land as "pending" and only appear once an
 * approval call moves them.
 *
 * ROUTES
 *   GET  /            approved reviews (public)
 *   POST /            submit a review  (public, rate limited)
 *   GET  /pending     awaiting moderation      -- requires ADMIN_KEY
 *   POST /moderate    approve or delete one    -- requires ADMIN_KEY
 *
 * SETUP (see DEPLOY.md)
 *   1. Workers & Pages -> KV -> Create namespace, call it PARC_REVIEWS
 *   2. Bind it to this Worker as the variable REVIEWS
 *   3. Add a secret named ADMIN_KEY (Settings -> Variables -> Encrypt)
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

/* A submission carrying a phone number or an email is almost always someone
   trying to reach the team rather than leave a review, and publishing it would
   expose their contact details. Flagged for the moderator, never auto-approved
   (nothing is), and worth seeing in the queue. */
const CONTACT_RE = /(\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b)|([\w.+-]+@[\w-]+\.[\w.]+)/;

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

    /* ---- public: approved reviews ---------------------------------------- */
    if (request.method === 'GET' && path === '/') {
      const items = await listByPrefix(env.REVIEWS, 'approved:');
      const shown = items.map((r) => ({ n: r.name, r: r.rating, t: r.text, at: r.at }));
      const avg = shown.length
        ? Math.round((shown.reduce((a, b) => a + b.r, 0) / shown.length) * 10) / 10
        : null;
      return json({ count: shown.length, average: avg, reviews: shown }, 200,
        { ...H, 'cache-control': 'public, max-age=60' });
    }

    /* ---- public: submit --------------------------------------------------- */
    if (request.method === 'POST' && path === '/') {
      if (!originAllowed(origin)) return json({ error: 'origin not allowed' }, 403, H);

      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400, H); }

      // Honeypot: a real person never fills a field they cannot see.
      if (clean(body.website, 50)) return json({ ok: true }, 200, H);

      const rating = Number(body.rating);
      const text = clean(body.text, MAX_TEXT);
      const name = clean(body.name, MAX_NAME) || 'Anonymous';

      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return json({ error: 'Please choose a rating from 1 to 5 stars.' }, 400, H);
      }
      if (text.length < 4) {
        return json({ error: 'Please add a few words about your experience.' }, 400, H);
      }

      // Coarse per-IP daily cap. Not airtight — it is a speed bump for casual
      // flooding, and moderation is what actually protects the page.
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const day = new Date().toISOString().slice(0, 10);
      const rlKey = `rl:${day}:${ip}`;
      const used = Number(await env.REVIEWS.get(rlKey)) || 0;
      if (used >= MAX_PER_IP_PER_DAY) {
        return json({ error: 'You have already submitted a review today. Thank you!' }, 429, H);
      }
      await env.REVIEWS.put(rlKey, String(used + 1), { expirationTtl: 60 * 60 * 26 });

      const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      const record = {
        id, name, rating, text,
        at: new Date().toISOString(),
        flags: CONTACT_RE.test(text) ? ['contains contact details'] : [],
      };
      await env.REVIEWS.put(`pending:${id}`, JSON.stringify(record));

      return json({ ok: true, message: 'Thank you. Your review will appear once a volunteer has read it.' }, 200, H);
    }

    /* ---- moderation ------------------------------------------------------- */
    const key = url.searchParams.get('key') || request.headers.get('X-Admin-Key') || '';
    const authed = env.ADMIN_KEY && key && key === env.ADMIN_KEY;

    if (path === '/pending') {
      if (!authed) return json({ error: 'unauthorised' }, 401, H);
      const items = await listByPrefix(env.REVIEWS, 'pending:');
      return json({ count: items.length, pending: items }, 200, H);
    }

    if (request.method === 'POST' && path === '/moderate') {
      if (!authed) return json({ error: 'unauthorised' }, 401, H);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400, H); }
      const id = clean(body.id, 60);
      const action = clean(body.action, 20);
      if (!id) return json({ error: 'id required' }, 400, H);

      const rec = await env.REVIEWS.get(`pending:${id}`, 'json');
      if (!rec) return json({ error: 'not found' }, 404, H);

      if (action === 'approve') {
        await env.REVIEWS.put(`approved:${id}`, JSON.stringify(rec));
        await env.REVIEWS.delete(`pending:${id}`);
        return json({ ok: true, action: 'approved', id }, 200, H);
      }
      if (action === 'delete') {
        await env.REVIEWS.delete(`pending:${id}`);
        return json({ ok: true, action: 'deleted', id }, 200, H);
      }
      if (action === 'unpublish') {
        await env.REVIEWS.delete(`approved:${id}`);
        return json({ ok: true, action: 'unpublished', id }, 200, H);
      }
      return json({ error: 'action must be approve, delete or unpublish' }, 400, H);
    }

    return json({ error: 'not found' }, 404, H);
  },
};
