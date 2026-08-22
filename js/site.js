/**
 * Site chrome: mobile menu + dropdown behaviour.
 *
 * Progressive enhancement. css/site.css opens submenus on :hover at >=901px,
 * so with JS blocked the desktop nav still works. This file adds click-to-open
 * (which is what touch devices need) and the aria-expanded state that makes the
 * menus usable with a keyboard or screen reader.
 */
(function () {
  'use strict';

  var nav = document.querySelector('.site-nav');
  if (!nav) return;

  var toggle = nav.querySelector('.nav-toggle');
  var subs = Array.prototype.slice.call(nav.querySelectorAll('.has-sub'));

  function closeAllSubs(except) {
    subs.forEach(function (li) {
      if (li === except) return;
      li.classList.remove('is-open');
      var b = li.querySelector('.nav-sub-toggle');
      if (b) b.setAttribute('aria-expanded', 'false');
    });
  }

  /* --- mobile menu --- */
  if (toggle) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (!open) closeAllSubs();
    });
  }

  /* --- dropdowns --- */
  subs.forEach(function (li) {
    var btn = li.querySelector('.nav-sub-toggle');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = !li.classList.contains('is-open');
      closeAllSubs(li);
      li.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });

  document.addEventListener('click', function (e) {
    if (!nav.contains(e.target)) closeAllSubs();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    closeAllSubs();
    if (nav.classList.contains('is-open') && toggle) {
      nav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
    }
  });

  /* Reset mobile state when resizing up to the desktop layout, so a menu left
     open on a phone doesn't strand the desktop nav in a half-open state. */
  var mq = window.matchMedia('(min-width: 901px)');
  var onChange = function (e) {
    if (!e.matches) return;
    nav.classList.remove('is-open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    closeAllSubs();
  };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else if (mq.addListener) mq.addListener(onChange);
})();
