#!/usr/bin/env node
/**
 * Generates sitemap.xml from tools/site-data.mjs.
 *
 * Only indexable public pages are listed. A sitemap containing noindex URLs
 * sends search engines contradictory signals, so VE shells and transactional
 * pages (payhere, waitlist) are omitted.
 */
import { writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SITE, PAGES } from './site-data.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

// Rough crawl priority: the pages candidates actually need, first.
const PRIORITY = {
  'index.html': '1.0',
  'pages/calendar.html': '0.9',
  'pages/Online_InstructionSeparation.html': '0.9',
  'pages/inperson.html': '0.8',
  'pages/faq.html': '0.8',
  'pages/whatnext.html': '0.7',
};

const urls = Object.entries(PAGES)
  .filter(([, meta]) => !meta.noindex)
  .map(([rel]) => {
    let lastmod = new Date().toISOString().slice(0, 10);
    try { lastmod = statSync(join(ROOT, rel)).mtime.toISOString().slice(0, 10); } catch {}
    return { loc: `${SITE.origin}/${rel}`, lastmod, priority: PRIORITY[rel] || '0.6' };
  })
  .sort((a, b) => Number(b.priority) - Number(a.priority));

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;
writeFileSync(join(ROOT, 'sitemap.xml'), xml);
console.log(`sitemap.xml: ${urls.length} public URLs`);
