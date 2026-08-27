#!/usr/bin/env node
/**
 * Moderate submitted reviews from the terminal.
 *
 *   REVIEWS_URL=https://parc-reviews.<you>.workers.dev \
 *   REVIEWS_ADMIN_KEY=... node tools/moderate-reviews.mjs
 *
 *   ... list                 show what is waiting (default)
 *   ... approve <id>         publish one
 *   ... delete  <id>         discard one
 *   ... unpublish <id>       take a published one back down
 *
 * Nothing a visitor submits is public until it is approved here.
 */
const URL_BASE = (process.env.REVIEWS_URL || '').replace(/\/+$/, '');
const KEY = process.env.REVIEWS_ADMIN_KEY || '';
const [cmd = 'list', id] = process.argv.slice(2);

if (!URL_BASE || !KEY) {
  console.error('Set REVIEWS_URL and REVIEWS_ADMIN_KEY first.');
  process.exit(1);
}

if (cmd === 'list') {
  const r = await fetch(`${URL_BASE}/pending?key=${encodeURIComponent(KEY)}`);
  if (!r.ok) { console.error(`HTTP ${r.status} — check the admin key`); process.exit(1); }
  const d = await r.json();
  if (!d.count) { console.log('Nothing waiting.'); process.exit(0); }
  console.log(`${d.count} awaiting review:\n`);
  for (const p of d.pending) {
    console.log(`  ${p.id}`);
    console.log(`    ${'★'.repeat(p.rating)}${'☆'.repeat(5 - p.rating)}  ${p.name}  ${p.at.slice(0, 10)}`);
    if (p.flags && p.flags.length) console.log(`    ⚠  ${p.flags.join(', ')}`);
    console.log(`    ${p.text}\n`);
  }
  console.log('Then:  node tools/moderate-reviews.mjs approve <id>');
  process.exit(0);
}

if (!['approve', 'delete', 'unpublish'].includes(cmd) || !id) {
  console.error('usage: moderate-reviews.mjs [list | approve <id> | delete <id> | unpublish <id>]');
  process.exit(2);
}

const r = await fetch(`${URL_BASE}/moderate?key=${encodeURIComponent(KEY)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id, action: cmd }),
});
const d = await r.json();
console.log(r.ok ? `${d.action}: ${d.id}` : `failed: ${d.error}`);
process.exit(r.ok ? 0 : 1);
