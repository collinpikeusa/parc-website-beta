/**
 * Shared page chrome: <head>, header/nav, footer.
 *
 * Imported by BOTH tools/retheme.mjs (public pages) and tools/parc-lock.mjs
 * (encrypted VE unlock shells), so a locked page is visually identical to the
 * rest of the site and there is exactly one copy of the nav in the codebase.
 */
import { SITE, NAV } from './site-data.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------- head ---------------------------------------------------------- */
export function buildHead(rel, meta) {
  const url = SITE.origin + '/' + rel.replace(/\\/g, '/');
  const title = `${meta.title} | ${SITE.short}`;
  const noindex = !!meta.noindex;
  const L = [];
  L.push('<meta charset="UTF-8">');
  L.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  L.push(`<title>${esc(title)}</title>`);
  if (meta.desc) L.push(`<meta name="description" content="${esc(meta.desc)}">`);
  L.push(`<link rel="canonical" href="${esc(url)}">`);
  if (noindex) {
    L.push('<meta name="robots" content="noindex, nofollow">');
  } else {
    L.push('<meta name="robots" content="index, follow, max-image-preview:large">');
    if (SITE.googleSiteVerification)
      L.push(`<meta name="google-site-verification" content="${esc(SITE.googleSiteVerification)}">`);
  }
  L.push('');
  if (!noindex) {
    L.push(`<meta property="og:type" content="website">`);
    L.push(`<meta property="og:site_name" content="${esc(SITE.name)}">`);
    L.push(`<meta property="og:title" content="${esc(meta.title)}">`);
    if (meta.desc) L.push(`<meta property="og:description" content="${esc(meta.desc)}">`);
    L.push(`<meta property="og:url" content="${esc(url)}">`);
    L.push(`<meta property="og:image" content="${esc(SITE.origin + SITE.ogImage)}">`);
    L.push(`<meta name="twitter:card" content="summary_large_image">`);
    L.push('');
  }
  L.push('<meta name="theme-color" content="#BA0005">');
  L.push('<link rel="icon" href="/favicon.ico" sizes="any">');
  L.push('<link rel="stylesheet" href="/css/site.css">');
  if (meta.preloadBanner !== false)
    L.push(`<link rel="preload" as="image" href="${SITE.banner}" fetchpriority="high">`);
  if (meta.schemaJson) {
    L.push('');
    L.push('<script type="application/ld+json">');
    L.push(JSON.stringify(meta.schemaJson, null, 2));
    L.push('</script>');
  }
  return L.join('\n');
}

/* ---------- header + nav -------------------------------------------------- */
export function navHtml(rel) {
  const here = '/' + rel.replace(/\\/g, '/');
  const item = (n) => {
    if (!n.children) {
      const cur = n.href === here ? ' aria-current="page"' : '';
      return `        <li><a href="${esc(n.href)}"${cur}>${esc(n.label)}</a></li>`;
    }
    const kids = n.children.map((c) => {
      const ext = c.external ? ' target="_blank" rel="noopener"' : '';
      return `            <li><a href="${esc(c.href)}"${ext}>${esc(c.label)}</a></li>`;
    }).join('\n');
    return `        <li class="has-sub">
          <button type="button" class="nav-sub-toggle" aria-expanded="false">${esc(n.label)}</button>
          <ul class="nav-sub">
${kids}
          </ul>
        </li>`;
  };
  return `      <ul class="nav-menu" id="nav-menu">
${NAV.map(item).join('\n')}
      </ul>`;
}

export function buildHeader(rel) {
  return `<a class="skip-link" href="#main">Skip to content</a>

<header class="site-header">
  <a class="site-banner" href="/index.html" aria-label="${esc(SITE.name)} home">
    <picture>
      <source media="(max-width: 700px)" srcset="${SITE.bannerMobile}">
      <img src="${SITE.banner}" width="1600" height="192" fetchpriority="high"
           alt="${esc(SITE.name)}">
    </picture>
  </a>

  <nav class="site-nav" id="menu" aria-label="Main">
    <div class="site-nav__inner">
      <button type="button" class="nav-toggle" aria-expanded="false" aria-controls="nav-menu">
        <span class="nav-toggle__bars" aria-hidden="true"></span> Menu
      </button>
${navHtml(rel)}
      <form class="nav-donate-form" action="https://www.paypal.com/cgi-bin/webscr" method="post" target="_top">
        <input type="hidden" name="cmd" value="_s-xclick">
        <input type="hidden" name="hosted_button_id" value="${SITE.paypalButton}">
        <button type="submit" class="nav-donate">Donate</button>
      </form>
    </div>
  </nav>
</header>

<main id="main">`;
}

/* ---------- footer -------------------------------------------------------- */
export function buildFooter() {
  const a = SITE.address;
  return `</main>

<footer class="site-footer">
  <div class="site-footer__inner">
    <div>
      <h2>Contact Us</h2>
      <p>${esc(SITE.name)}<br>
         ${esc(a.po)}<br>
         ${esc(a.city)}, ${esc(a.state)} ${esc(a.zip)}<br>
         ${esc(a.country)}</p>
      <p><a href="mailto:${esc(SITE.email)}">${esc(SITE.email)}</a></p>
      <p>Our examiners are volunteers. Please allow up to 24 hours for a reply.</p>
    </div>
    <div>
      <h2>Exams</h2>
      <ul>
        <li><a href="/pages/calendar.html">Schedule an exam</a></li>
        <li><a href="/pages/Online_InstructionSeparation.html">Online testing</a></li>
        <li><a href="/pages/inperson.html">In-person testing</a></li>
        <li><a href="/pages/faq.html">FAQ</a></li>
      </ul>
    </div>
    <div>
      <h2>More</h2>
      <ul>
        <li><a href="/pages/whatnext.html">What's next after passing</a></li>
        <li><a href="/pages/handiham.html">Accessible testing</a></li>
        <li><a href="/pages/donations.html">Support PARC</a></li>
        <li><a href="${esc(SITE.facebook)}" target="_blank" rel="noopener">Facebook group</a></li>
      </ul>
    </div>
  </div>
  <div class="site-footer__bottom">
    <span>&copy; 2020&ndash;${new Date().getFullYear()} ${esc(SITE.name)}</span>
    <a class="site-footer__ve" href="/pages/script.html" rel="nofollow">VE Access</a>
  </div>
</footer>`;
}
