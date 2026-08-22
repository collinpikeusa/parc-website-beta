/**
 * PARC schedule — one merged availability calendar across every exam session.
 *
 * WHAT THIS REPLACED, AND WHY
 * First the page stacked seven Calendly iframes (~4,400px of scrolling). Then it
 * put them behind seven tabs, which was no better: you still had to click
 * through seven calendars and compare by eye, and the embedded iframes clipped.
 * Both versions made the candidate do the merging.
 *
 * This does the merging for them: every session's availability in ONE month
 * grid, duplicate start times collapsed, filterable, in the viewer's own
 * timezone. Picking a time links straight to the right Calendly page to book.
 *
 * DATA
 * Prefers a live Cloudflare Worker when data-availability-endpoint is set;
 * otherwise falls back to data/availability.json, refreshed by
 * `node tools/fetch-availability.mjs`. Same JSON shape either way.
 *
 * The snapshot can be stale, so this is a FINDER, never the source of truth —
 * Calendly decides what is actually bookable at the moment of booking.
 */
(function () {
  'use strict';

  /** Candidates at or under this age are shown youth sessions.
   *  NOTE: the ARRL VEC youth rate normally applies UNDER 18. Change to 17 if
   *  an 18-year-old should not be offered the youth calendar. */
  var YOUTH_MAX_AGE = 18;

  var root = document.getElementById('schedule');
  if (!root) return;

  var WORKER_URL = (root.getAttribute('data-availability-endpoint') || '').trim();
  var SNAPSHOT_URL = '/data/availability.json';
  var GATE_KEY = 'parc-schedule-audience';

  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                'August', 'September', 'October', 'November', 'December'];

  /* Time-of-day buckets, so "I can only test after work" is one click. */
  var BANDS = [
    { id: 'morning',   label: 'Morning',    hint: '6am–noon',   from: 6,  to: 12 },
    { id: 'afternoon', label: 'Afternoon',  hint: 'noon–5pm',   from: 12, to: 17 },
    { id: 'evening',   label: 'Evening',    hint: '5pm–10pm',   from: 17, to: 22 },
    { id: 'latenight', label: 'Late night', hint: '10pm–6am',   from: 22, to: 6 }
  ];

  var state = {
    audience: null, data: null, tz: guessTz(),
    month: null, selectedDay: null, youthOnly: false,
    sessions: {},          // letter -> enabled
    bands: {}              // band id -> enabled
  };

  function guessTz() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago'; }
    catch (e) { return 'America/Chicago'; }
  }

  /* ---- date helpers (all timezone-aware) -------------------------------- */
  /** "2026-08-22" for an instant, as seen in tz. en-CA gives ISO-ish order. */
  function dayKey(d, tz) {
    return new Intl.DateTimeFormat('en-CA',
      { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }
  function hourIn(d, tz) {
    return Number(new Intl.DateTimeFormat('en-US',
      { timeZone: tz, hour: '2-digit', hour12: false }).format(d));
  }
  function timeLabel(d, tz) {
    return new Intl.DateTimeFormat('en-US',
      { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d);
  }
  function bandOf(hour) {
    for (var i = 0; i < BANDS.length; i++) {
      var b = BANDS[i];
      if (b.from < b.to ? (hour >= b.from && hour < b.to) : (hour >= b.from || hour < b.to)) return b.id;
    }
    return 'latenight';
  }

  /* ---- age gate --------------------------------------------------------- */
  /**
   * PRIVACY — a legal posture, not a preference.
   * The date of birth is read, converted to an age, and dropped. It is never
   * sent to the Worker, to Calendly, to storage, or into a URL. Only the word
   * "youth" or "general" is remembered, for this tab session. The gate invites
   * minors to enter a birthdate, which is the territory COPPA governs; moving
   * that date anywhere changes what this page is under that regulation.
   */
  function ageFrom(y, m, d) {
    var t = new Date(), age = t.getFullYear() - y;
    if (t.getMonth() + 1 < m || (t.getMonth() + 1 === m && t.getDate() < d)) age--;
    return age;
  }
  function readAudience() { try { return sessionStorage.getItem(GATE_KEY); } catch (e) { return null; } }
  function saveAudience(v) { try { sessionStorage.setItem(GATE_KEY, v); } catch (e) {} }

  function initGate() {
    var mSel = document.getElementById('dob-month');
    var dSel = document.getElementById('dob-day');
    var ySel = document.getElementById('dob-year');
    if (mSel) MONTHS.forEach(function (n, i) { mSel.appendChild(new Option(n, String(i + 1))); });
    if (dSel) for (var d = 1; d <= 31; d++) dSel.appendChild(new Option(String(d), String(d)));
    if (ySel) { var y0 = new Date().getFullYear(); for (var y = y0; y >= 1920; y--) ySel.appendChild(new Option(String(y), String(y))); }

    var existing = readAudience();
    if (existing) { start(existing); return; }

    var form = document.getElementById('age-form');
    var err = document.getElementById('age-error');
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      var m = +mSel.value, dd = +dSel.value, yy = +ySel.value;
      if (!m || !dd || !yy) { err.textContent = 'Please choose a month, day, and year.'; return; }
      var age = ageFrom(yy, m, dd);
      if (age < 0 || age > 120) { err.textContent = 'Please check that date.'; return; }
      err.textContent = '';
      var aud = age <= YOUTH_MAX_AGE ? 'youth' : 'general';
      saveAudience(aud);            // the date itself goes no further
      start(aud);
    });
    var skip = document.getElementById('age-skip');
    if (skip) skip.addEventListener('click', function () { saveAudience('general'); start('general'); });
  }

  /* ---- load ------------------------------------------------------------- */
  function start(audience) {
    state.audience = audience;
    document.getElementById('age-gate').hidden = true;
    var cal = document.getElementById('calendars');
    cal.hidden = false;
    setStatus('Loading availability…');

    fetchData()
      .then(function (data) {
        state.data = data;
        var youth = audience === 'youth';
        // Youth-only sessions are hidden from everyone else.
        state.data.sources = data.sources.filter(function (s) { return youth || !s.youth; });
        state.data.slots = data.slots
          .map(function (s) {
            var keep = s.sessions.filter(function (x) { return youth || x.letter !== 'Y'; });
            if (!keep.length) return null;
            return { start: s.start, sessions: keep,
                     remaining: keep.reduce(function (a, b) { return a + (b.remaining || 0); }, 0) };
          })
          .filter(Boolean);

        state.data.sources.forEach(function (s) { state.sessions[s.letter] = true; });
        BANDS.forEach(function (b) { state.bands[b.id] = true; });

        var first = state.data.slots[0];
        var base = first ? new Date(first.start) : new Date();
        state.month = { y: Number(dayKey(base, state.tz).slice(0, 4)),
                        m: Number(dayKey(base, state.tz).slice(5, 7)) - 1 };
        state.selectedDay = first ? dayKey(base, state.tz) : null;

        buildControls();
        render();
        setStatus('');
      })
      .catch(function () {
        setStatus('');
        document.getElementById('cal-unavailable').hidden = false;
      });
  }

  function fetchData() {
    var youth = state.audience === 'youth';
    if (WORKER_URL) {
      var u = WORKER_URL + (WORKER_URL.indexOf('?') === -1 ? '?' : '&') +
        'tz=' + encodeURIComponent(state.tz) + '&days=21' + (youth ? '&include=youth' : '');
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 5000);
      return fetch(u, ctrl ? { signal: ctrl.signal } : undefined)
        .then(function (r) { clearTimeout(timer); if (!r.ok) throw 0; return r.json(); })
        .catch(function () { return fetch(SNAPSHOT_URL).then(function (r) { return r.json(); }); });
    }
    return fetch(SNAPSHOT_URL).then(function (r) { if (!r.ok) throw 0; return r.json(); });
  }

  function setStatus(msg) {
    var el = document.getElementById('cal-status');
    if (el) { el.textContent = msg || ''; el.hidden = !msg; }
  }

  /* ---- filters ---------------------------------------------------------- */
  function buildControls() {
    /* No per-session filter. Which internal calendar a time belongs to is a PARC
       scheduling detail, not something a candidate should have to reason about —
       they just want a time that works. Every session stays enabled in state so
       bookingUrl() can still resolve the right Calendly event. */

    /* Youth candidates see general sessions too (youth availability can be thin),
       so give them a way to narrow to just the youth ones. Never shown to anyone
       else, who has no youth slots in their data at all. */
    var yWrap = document.getElementById('filter-youth-wrap');
    if (state.audience === 'youth' && yWrap) {
      yWrap.hidden = false;
      var yBtn = document.getElementById('filter-youth');
      yBtn.addEventListener('click', function () {
        state.youthOnly = !state.youthOnly;
        yBtn.classList.toggle('is-on', state.youthOnly);
        yBtn.setAttribute('aria-pressed', String(state.youthOnly));
        render();
      });
    }

    var bBox = document.getElementById('filter-bands');
    bBox.innerHTML = '';
    BANDS.forEach(function (band) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip is-on';
      b.setAttribute('aria-pressed', 'true');
      b.innerHTML = band.label + ' <span class="chip__hint">' + band.hint + '</span>';
      b.addEventListener('click', function () {
        state.bands[band.id] = !state.bands[band.id];
        b.classList.toggle('is-on', state.bands[band.id]);
        b.setAttribute('aria-pressed', String(state.bands[band.id]));
        render();
      });
      bBox.appendChild(b);
    });

    var tzSel = document.getElementById('tz-select');
    if (tzSel) {
      ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix',
       'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'].forEach(function (z) {
        tzSel.appendChild(new Option(z.split('/')[1].replace(/_/g, ' '), z));
      });
      if (![].some.call(tzSel.options, function (o) { return o.value === state.tz; })) {
        tzSel.appendChild(new Option(state.tz.replace(/_/g, ' '), state.tz));
      }
      tzSel.value = state.tz;
      tzSel.addEventListener('change', function () { state.tz = tzSel.value; render(); });
    }

    document.getElementById('cal-prev').addEventListener('click', function () { shiftMonth(-1); });
    document.getElementById('cal-next').addEventListener('click', function () { shiftMonth(1); });
  }

  function shiftMonth(n) {
    var m = state.month.m + n, y = state.month.y;
    if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
    state.month = { y: y, m: m };
    render();
  }

  /** Slots passing the current session + time-of-day filters, grouped by day. */
  function visibleByDay() {
    var out = {};
    state.data.slots.forEach(function (s) {
      var d = new Date(s.start);
      var keep = s.sessions.filter(function (x) { return state.sessions[x.letter]; });
      if (state.youthOnly) keep = keep.filter(function (x) { return x.letter === 'Y'; });
      if (!keep.length) return;
      if (!state.bands[bandOf(hourIn(d, state.tz))]) return;
      var k = dayKey(d, state.tz);
      (out[k] = out[k] || []).push({ start: s.start, date: d, sessions: keep,
        remaining: keep.reduce(function (a, b) { return a + (b.remaining || 0); }, 0) });
    });
    return out;
  }

  /* ---- render ----------------------------------------------------------- */
  function render() {
    var byDay = visibleByDay();
    renderGrid(byDay);
    renderDay(byDay);
    var total = Object.keys(byDay).reduce(function (a, k) { return a + byDay[k].length; }, 0);
    var sum = document.getElementById('cal-summary');
    if (sum) {
      sum.textContent = total
        ? total + ' available exam time' + (total === 1 ? '' : 's') +
          ' in the next ' + (state.data.days || 21) + ' days.'
        : 'No times match these filters. Try turning another one on.';
      if (total && state.audience === 'youth' && !state.youthOnly) {
        var yCount = 0;
        var byDayY = visibleByDay();
        Object.keys(byDayY).forEach(function (k) {
          byDayY[k].forEach(function (s) { if (youthPart(s)) yCount++; });
        });
        sum.textContent += ' ' + yCount + ' of them are youth sessions, marked "Youth".';
      }
    }
    renderFreshness();
  }

  /** Say plainly how old this data is.
   *
   *  When served from the build-time snapshot rather than the live Worker, the
   *  numbers can lag reality. A candidate deserves to know that before they
   *  click, rather than discovering it on Calendly's booking page. Anything
   *  older than a day says so out loud. */
  function renderFreshness() {
    var el = document.getElementById('cal-freshness');
    if (!el || !state.data || !state.data.generated) return;
    var ageMs = Date.now() - new Date(state.data.generated).getTime();
    var hours = ageMs / 3600000;
    var when = new Date(state.data.generated).toLocaleString('en-US',
      { timeZone: state.tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    if (hours < 24) {
      el.className = 'cal-freshness';
      el.textContent = 'Availability checked ' + when + '.';
    } else {
      el.className = 'cal-freshness is-stale';
      el.textContent = 'Availability last checked ' + when + ' (' + Math.round(hours / 24) +
        ' day' + (Math.round(hours / 24) === 1 ? '' : 's') + ' ago). Some of these times may ' +
        'already be taken \u2014 Calendly will show what is really free when you click through.';
    }
    el.hidden = false;
  }

  function renderGrid(byDay) {
    var y = state.month.y, m = state.month.m;
    document.getElementById('cal-month').textContent = MONTHS[m] + ' ' + y;

    var grid = document.getElementById('cal-grid');
    grid.innerHTML = '';
    DAY_NAMES.forEach(function (n) {
      var h = document.createElement('div');
      h.className = 'cal-head'; h.textContent = n;
      grid.appendChild(h);
    });

    var first = new Date(y, m, 1);
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    for (var i = 0; i < first.getDay(); i++) {
      var pad = document.createElement('div');
      pad.className = 'cal-cell is-empty';
      grid.appendChild(pad);
    }
    var todayKey = dayKey(new Date(), state.tz);
    for (var d = 1; d <= daysInMonth; d++) {
      var key = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      var slots = byDay[key] || [];
      var cell = document.createElement(slots.length ? 'button' : 'div');
      cell.className = 'cal-cell';
      if (slots.length) {
        cell.type = 'button';
        cell.classList.add('has-slots');
        // Three density steps, so a glance shows where the room is.
        cell.classList.add(slots.length >= 30 ? 'lvl-3' : slots.length >= 10 ? 'lvl-2' : 'lvl-1');
        if (key === state.selectedDay) cell.classList.add('is-selected');
        cell.setAttribute('aria-label', slots.length + ' times available on ' + MONTHS[m] + ' ' + d);
        (function (k) { cell.addEventListener('click', function () { state.selectedDay = k; render(); }); })(key);
      } else {
        cell.classList.add('is-none');
      }
      if (key === todayKey) cell.classList.add('is-today');
      cell.innerHTML = '<span class="cal-cell__num">' + d + '</span>' +
        (slots.length ? '<span class="cal-cell__count">' + slots.length + '</span>' : '');
      grid.appendChild(cell);
    }
  }

  /** Deep-link straight to Calendly's invitee form for one specific time.
   *
   *  Calendly accepts the slot's ISO start (with offset) as a path segment:
   *    /parctesting/<event-slug>/2026-08-23T13:15:00-05:00?month=…&date=…
   *  which opens "Enter Booking Details" with that time already chosen, rather
   *  than dropping the candidate on the month view to hunt for it again.
   *
   *  When several sessions offer the same time we send them to the one with the
   *  most seats left, so they are least likely to lose it to a race.
   */
  function youthPart(slot) {
    for (var i = 0; i < slot.sessions.length; i++) {
      if (slot.sessions[i].letter === 'Y') return slot.sessions[i];
    }
    return null;
  }

  function bookingUrl(slot) {
    /* A youth candidate must land on the YOUTH calendar whenever one exists at
     * that time. Picking "most seats left" instead would quietly route them to a
     * general session — a different session and, at the ARRL VEC youth rate, a
     * different fee. Seat count only breaks ties among general sessions. */
    var best = (state.audience === 'youth' && youthPart(slot)) || slot.sessions.reduce(
      function (a, b) { return (b.remaining || 0) > (a.remaining || 0) ? b : a; },
      slot.sessions[0]);
    var iso = slot.start;                       // keep the original offset
    return 'https://calendly.com/parctesting/' + best.slug + '/' + iso +
           '?month=' + iso.slice(0, 7) + '&date=' + iso.slice(0, 10);
  }

  function renderDay(byDay) {
    var panel = document.getElementById('cal-day');
    var key = state.selectedDay;
    if (!key || !byDay[key]) {
      var anyKey = Object.keys(byDay).sort()[0];
      if (!anyKey) { panel.innerHTML = '<p class="cal-day__empty">No times match these filters.</p>'; return; }
      key = state.selectedDay = anyKey;
    }
    var slots = byDay[key].slice().sort(function (a, b) { return a.date - b.date; });
    var heading = new Intl.DateTimeFormat('en-US',
      { timeZone: state.tz, weekday: 'long', month: 'long', day: 'numeric' })
      .format(new Date(slots[0].start));

    var groups = {};
    slots.forEach(function (s) { (groups[bandOf(hourIn(s.date, state.tz))] = groups[bandOf(hourIn(s.date, state.tz))] || []).push(s); });

    var html = '<h3 class="cal-day__title">' + heading +
      ' <span class="cal-day__count">' + slots.length + ' time' + (slots.length === 1 ? '' : 's') + '</span></h3>';

    BANDS.forEach(function (band) {
      var g = groups[band.id];
      if (!g || !g.length) return;
      html += '<div class="slot-group"><h4>' + band.label + '</h4><ul class="slot-list">';
      g.forEach(function (s) {
        var y = state.audience === 'youth' && youthPart(s);
        var seats = y ? (y.remaining || 0) : s.remaining;
        html += '<li><a class="slot' + (y ? ' slot--youth' : '') + '" href="' + bookingUrl(s) +
          '" target="_blank" rel="noopener">' +
          '<span class="slot__time">' + timeLabel(s.date, state.tz) +
          (y ? ' <span class="slot__youth">Youth</span>' : '') + '</span>' +
          '<span class="slot__meta">' + seats + ' seat' + (seats === 1 ? '' : 's') +
          ' left</span></a></li>';
      });
      html += '</ul></div>';
    });
    panel.innerHTML = html;
  }

  initGate();
})();
