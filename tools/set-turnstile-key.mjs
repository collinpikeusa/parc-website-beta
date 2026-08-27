#!/usr/bin/env node
/**
 * Puts the Cloudflare Turnstile site key into the reviews page.
 *
 *   node tools/set-turnstile-key.mjs 0x4AAAAAAA...
 *   node tools/set-turnstile-key.mjs --clear
 *
 * The SITE key is public and belongs in the markup — it is the half Cloudflare
 * expects the browser to send. The SECRET key is the other half and goes into
 * the Worker as TURNSTILE_SECRET; it must never be committed.
 *
 * With no key set the page never loads Turnstile at all, and the Worker accepts
 * submissions without a token, so the form keeps working while it is being set
 * up. Configure both halves to actually enforce the check.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const PAGE = join(ROOT, 'pages', 'reviews.html');
const arg = process.argv[2];

if (!arg) {
  console.error('usage: node tools/set-turnstile-key.mjs <site-key> | --clear');
  process.exit(2);
}

const key = arg === '--clear' ? '' : arg.trim();

/* Live site keys look like 0x4AAAAAAA…; Cloudflare's documented test keys start
   1x, 2x or 3x. Refuse anything else rather than commit a typo. */
if (key && !/^[0-3]x[A-Za-z0-9_-]{10,40}$/.test(key)) {
  console.error(`Refusing: "${key}" does not look like a Turnstile site key.`);
  console.error('Expected something like 0x4AAAAAAABBBBBBBBCCCCCC (Dashboard → Turnstile → your widget).');
  process.exit(1);
}

/* Both halves start 0x4AAAAAAA and the only easy tell is length — the secret is
   noticeably longer. Committing it would publish it, so stop rather than guess. */
if (key.length > 30) {
  console.error(`Refusing: "${key}" is ${key.length} characters, which is secret-key length.`);
  console.error('The SITE key is the shorter one. The secret goes in the Worker, never here.');
  process.exit(1);
}

const before = readFileSync(PAGE, 'utf8');
const after = before.replace(/(data-turnstile-sitekey=")[^"]*(")/, `$1${key}$2`);
if (after === before && key) {
  console.error('Could not find data-turnstile-sitekey on the reviews page.');
  process.exit(1);
}
writeFileSync(PAGE, after);

console.log(key ? `Site key set: ${key}` : 'Site key cleared.');
console.log('\nThe other half goes in the Worker, not here:');
console.log('  Workers & Pages → parc-reviews → Settings → Variables and Secrets');
console.log('  Add a secret named TURNSTILE_SECRET\n');
console.log('Then rebuild and deploy:  node tools/deploy.mjs --push');
