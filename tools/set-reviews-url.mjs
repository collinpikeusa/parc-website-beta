#!/usr/bin/env node
/**
 * Points the reviews page at a deployed reviews Worker, then proves it works.
 *
 *   node tools/set-reviews-url.mjs https://parc-reviews.<you>.workers.dev
 *   node tools/set-reviews-url.mjs --clear
 *
 * Sets data-reviews-endpoint on <div id="reviews">. Without it the page says
 * reviews are unavailable and hides the form — which is the right failure, since
 * a form that silently discards what someone wrote is worse than no form.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const PAGE = join(ROOT, 'pages', 'reviews.html');
const arg = process.argv[2];

if (!arg) {
  console.error('usage: node tools/set-reviews-url.mjs <worker-url> | --clear');
  process.exit(2);
}

const url = arg === '--clear' ? '' : arg.replace(/\/+$/, '');
/* http is allowed only against loopback, so a local Worker can be tested; a
   real deployment over plain http would put what people write on the wire. */
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/i;
if (url && !/^https:\/\/[a-z0-9.-]+$/i.test(url) && !LOOPBACK.test(url)) {
  console.error(`Refusing: "${url}" does not look like a Worker URL.`);
  process.exit(1);
}

/* A typo'd subdomain would leave the page quietly broken, so check before
   wiring it in. An empty list is the correct response on a fresh deploy. */
if (url) {
  console.log(`Checking ${url} …`);
  const res = await fetch(url, { headers: { Origin: 'https://radiotests.org' } })
    .catch((e) => { console.error(`  unreachable: ${e.message}`); process.exit(1); });

  if (!res.ok) { console.error(`  HTTP ${res.status}`); process.exit(1); }

  const cors = res.headers.get('access-control-allow-origin');
  if (!cors) {
    console.error('  no Access-Control-Allow-Origin — the browser will block this.');
    console.error('  Check ALLOWED_DOMAINS in worker/parc-reviews.js.');
    process.exit(1);
  }

  const data = await res.json().catch(() => null);
  if (!data || !Array.isArray(data.reviews)) {
    console.error('  did not return a review list; is this the reviews Worker?');
    process.exit(1);
  }
  console.log(`  ok — ${data.count} approved review(s), CORS allows ${cors}`);
}

const before = readFileSync(PAGE, 'utf8');
const after = before.replace(/(<div id="reviews"[^>]*\sdata-reviews-endpoint=")[^"]*(")/,
                             `$1${url}$2`);
if (after === before && url) {
  console.error('Could not find data-reviews-endpoint on <div id="reviews">.');
  process.exit(1);
}
writeFileSync(PAGE, after);

console.log(url ? `\nWired in. Rebuild and deploy:` : `\nCleared. Rebuild and deploy:`);
console.log('  node tools/deploy.mjs --push');
