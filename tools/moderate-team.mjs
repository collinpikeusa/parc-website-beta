#!/usr/bin/env node
/**
 * Approve or remove team profiles.
 *
 *   REVIEWS_URL=... REVIEWS_ADMIN_KEY=... node tools/moderate-team.mjs
 *
 *   ... list            what is waiting, and what is live (default)
 *   ... approve <id>    put one on the public team page
 *   ... delete  <id>    remove it, photo and all
 *
 * Unlike reviews, nothing here appears until it is approved.
 */
const URL_BASE = (process.env.REVIEWS_URL || '').replace(/\/+$/, '');
const KEY = process.env.REVIEWS_ADMIN_KEY || '';
const [cmd = 'list', id] = process.argv.slice(2);

if (!URL_BASE || !KEY) {
  console.error('Set REVIEWS_URL and REVIEWS_ADMIN_KEY first. For example:\n');
  console.error('  export REVIEWS_URL=https://parc-reviews.<you>.workers.dev');
  console.error('  export REVIEWS_ADMIN_KEY=<the secret you set in Cloudflare>');
  process.exit(1);
}

function show(m) {
  console.log(`  ${m.id}`);
  console.log(`    ${m.name}${m.callsign ? '  ' + m.callsign : ''}${m.role ? '  — ' + m.role : ''}`);
  console.log(`    photo: ${m.hasPhoto ? 'yes' : 'none'}   sent: ${(m.at || '').slice(0, 10)}`);
  console.log(`    ${m.bio}\n`);
}

if (cmd === 'list') {
  const res = await fetch(`${URL_BASE}/team/pending?key=${encodeURIComponent(KEY)}`);
  if (res.status === 401) { console.error('Rejected — check REVIEWS_ADMIN_KEY.'); process.exit(1); }
  if (!res.ok) { console.error(`HTTP ${res.status}`); process.exit(1); }
  const d = await res.json();

  if (d.pending.length) {
    console.log(`${d.pending.length} waiting for approval:\n`);
    for (const m of d.pending) show(m);
    console.log('To publish one:  node tools/moderate-team.mjs approve <id>\n');
  } else {
    console.log('Nothing waiting.\n');
  }

  if (d.approved.length) {
    console.log(`${d.approved.length} on the public page:\n`);
    for (const m of d.approved) show(m);
  }
  process.exit(0);
}

if (!['approve', 'delete'].includes(cmd) || !id) {
  console.error('usage: moderate-team.mjs [list | approve <id> | delete <id>]');
  process.exit(2);
}

const res = await fetch(`${URL_BASE}/team/moderate?key=${encodeURIComponent(KEY)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id, action: cmd }),
});
const d = await res.json();
console.log(res.ok ? `${d.action}: ${d.id}` : `failed: ${d.error}`);
process.exit(res.ok ? 0 : 1);
