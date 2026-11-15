/* TSK reserve.js · SPEC §4.4 V2, content pack §2 item 3.
   Drives the Reserve form on /visit/: guests stepper, Day chips (dates worked out in Asia/Kolkata whatever
   the phone's time zone), Time and Occasion chips, live summary, validation, and the WhatsApp link.
   The "Request on WhatsApp" control is a real <a>: this file only rewrites its href, and calls
   preventDefault() on a click while the form is invalid. It never navigates by script.
   Markup this file expects (all in /visit/index.html):
   - form#reserve-form holding .stepper__btn[data-step], output#rf-guests, div#rf-days (empty: filled here),
     div#rf-times > .chip[data-value][data-start?], div#rf-occasions > .chip[data-value],
     input#rf-name, input#rf-phone, textarea#rf-note, p#rf-daytime-error, p#rf-name-error,
     p#rf-summary, a#rf-send
   - data-start on a time chip: minutes after midnight, IST (e.g. 720 = 12:00). The content pack names the
     slots (Lunch, Evening, Dinner) but gives no clock times, so none is set and no slot is ever hidden
     for being less than 30 minutes away. Add data-start to each chip and the rule starts working. */
(function () {
  'use strict';

  var form = document.getElementById('reserve-form');
  if (!form) return;

  var WA = 'https://wa.me/919398693051?text=';
  var MIN_GUESTS = 1;
  var MAX_GUESTS = 9;
  var LEAD_MINUTES = 30;
  var IST_OFFSET_MS = 330 * 60000; /* UTC+05:30, no daylight saving */
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var daysBox = document.getElementById('rf-days');
  var timesBox = document.getElementById('rf-times');
  var occasionsBox = document.getElementById('rf-occasions');
  var guestsOut = document.getElementById('rf-guests');
  var nameIn = document.getElementById('rf-name');
  var phoneIn = document.getElementById('rf-phone');
  var noteIn = document.getElementById('rf-note');
  var dayTimeError = document.getElementById('rf-daytime-error');
  var nameError = document.getElementById('rf-name-error');
  var summary = document.getElementById('rf-summary');
  var send = document.getElementById('rf-send');
  var stepBtns = form.querySelectorAll('.stepper__btn');
  if (!daysBox || !timesBox || !occasionsBox || !guestsOut || !nameIn || !summary || !send) return;

  var state = { guests: 2, dayKey: null, time: null, occasion: null };
  var builtFor = null;     /* IST date key the day chips were built for */
  var showErrors = false;  /* true after the first failed attempt */

  /* ---- Asia/Kolkata time, read from a shifted Date with the getUTC* methods ---- */
  function nowIst() { return new Date(Date.now() + IST_OFFSET_MS); }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function keyOf(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function minutesNow() { var n = nowIst(); return n.getUTCHours() * 60 + n.getUTCMinutes(); }
  function dayFromToday(i) {
    var n = nowIst();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + i));
  }
  function dayLabel(i, d) {
    if (i === 0) return 'Today';
    if (i === 1) return 'Tomorrow';
    return WEEKDAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
  }

  /* ---- chips ---- */
  function chips(box) { return Array.prototype.slice.call(box.querySelectorAll('.chip')); }
  function selectIn(box, value, attr) {
    chips(box).forEach(function (c) {
      c.setAttribute('aria-pressed', c.getAttribute(attr) === value ? 'true' : 'false');
    });
  }

  function buildDays() {
    var today = keyOf(nowIst());
    builtFor = today;
    daysBox.textContent = '';
    for (var i = 0; i < 7; i++) {
      var d = dayFromToday(i);
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('data-key', keyOf(d));
      b.setAttribute('data-index', String(i));
      b.textContent = dayLabel(i, d);
      daysBox.appendChild(b);
    }
  }

  function startOf(chip) {
    var s = chip.getAttribute('data-start');
    return s === null || s === '' || isNaN(Number(s)) ? null : Number(s);
  }

  /* A slot is offered today unless it has a known start less than 30 minutes away. */
  function slotOpenToday(chip) {
    var s = startOf(chip);
    return s === null || s - minutesNow() >= LEAD_MINUTES;
  }

  /* Rebuilds what depends on the clock: the day list, Today's slots, Today itself. */
  function syncClock() {
    if (builtFor !== keyOf(nowIst())) buildDays();
    var todayKey = keyOf(nowIst());
    var anyLeft = chips(timesBox).some(slotOpenToday);
    var dayChips = chips(daysBox);
    if (dayChips[0]) dayChips[0].hidden = !anyLeft;
    if (!anyLeft && state.dayKey === todayKey) state.dayKey = null;
    var onToday = state.dayKey === todayKey;
    chips(timesBox).forEach(function (c) {
      var gone = onToday && !slotOpenToday(c);
      c.hidden = gone;
      if (gone && state.time === c.getAttribute('data-value')) state.time = null;
    });
    var stillThere = dayChips.some(function (c) { return c.getAttribute('data-key') === state.dayKey; });
    if (state.dayKey && !stillThere) state.dayKey = null;
  }

  function chosenDayLabel() {
    var found = '';
    chips(daysBox).forEach(function (c) {
      if (c.getAttribute('data-key') === state.dayKey) found = c.textContent;
    });
    return found;
  }

  /* ---- message: CP §2 item 3, optional lines left out when empty ---- */
  function clean(v) { return v.replace(/\s+/g, ' ').replace(/^ | $/g, ''); }
  function encode(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
      return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
  }
  function buildMessage() {
    var lines = ["Hi TSK Kokapet! I'd like to reserve a table.", '', 'Guests: ' + state.guests];
    function add(label, value) { if (value) lines.push(label + ': ' + value); }
    add('Day', chosenDayLabel());
    add('Time', state.time);
    add('Occasion', state.occasion);
    add('Name', clean(nameIn.value));
    add('Phone', phoneIn ? clean(phoneIn.value) : '');
    add('Note', noteIn ? clean(noteIn.value) : '');
    lines.push('', 'Please confirm the booking.');
    return lines.join('\n');
  }

  function dayTimeChosen() { return !!(state.dayKey && state.time); }
  function valid() { return dayTimeChosen() && clean(nameIn.value) !== ''; }

  function setText(el, text) { if (el && el.textContent !== text) el.textContent = text; }

  function render() {
    guestsOut.textContent = String(state.guests);
    Array.prototype.forEach.call(stepBtns, function (b) {
      var step = Number(b.getAttribute('data-step'));
      var atLimit = (step < 0 && state.guests <= MIN_GUESTS) || (step > 0 && state.guests >= MAX_GUESTS);
      b.setAttribute('aria-disabled', atLimit ? 'true' : 'false');
    });
    selectIn(daysBox, state.dayKey, 'data-key');
    selectIn(timesBox, state.time, 'data-value');
    selectIn(occasionsBox, state.occasion, 'data-value');

    setText(summary, dayTimeChosen()
      ? 'Table for ' + state.guests + ', ' + chosenDayLabel() + ', ' + state.time + '.'
      : 'Table for ' + state.guests + '. Pick a day and a time.');

    send.setAttribute('href', WA + encode(buildMessage()));

    if (showErrors) {
      setText(dayTimeError, dayTimeChosen() ? '' : 'Pick a day and a time.');
      var noName = clean(nameIn.value) === '';
      setText(nameError, noName ? 'Please add your name.' : '');
      nameIn.setAttribute('aria-invalid', noName ? 'true' : 'false');
    }
  }

  function update() { syncClock(); render(); }

  function focusFirstProblem() {
    var target = null;
    if (!state.dayKey) target = chips(daysBox)[0];
    else if (!state.time) target = chips(timesBox).filter(function (c) { return !c.hidden; })[0];
    if (!target) target = nameIn;
    if (target) target.focus();
  }

  /* ---- events ---- */
  form.addEventListener('click', function (e) {
    var step = e.target.closest('.stepper__btn');
    if (step && form.contains(step)) {
      var next = state.guests + Number(step.getAttribute('data-step'));
      if (next >= MIN_GUESTS && next <= MAX_GUESTS) state.guests = next;
      update();
      return;
    }
    var chip = e.target.closest('.chip');
    if (!chip || !form.contains(chip)) return;
    var box = chip.parentNode;
    if (box === daysBox) {
      state.dayKey = chip.getAttribute('data-key');
    } else if (box === timesBox) {
      state.time = chip.getAttribute('data-value');
    } else if (box === occasionsBox) {
      /* optional group: tapping the selected chip clears it */
      var v = chip.getAttribute('data-value');
      state.occasion = state.occasion === v ? null : v;
    }
    update();
  });

  form.addEventListener('input', update);

  /* Enter in a text field: check the form, then hand focus to the WhatsApp link.
     (A form with no submit button and two text fields never submits on Enter by itself.) */
  function checkThenFocusLink() {
    update();
    if (valid()) { send.focus(); return; }
    showErrors = true;
    update();
    focusFirstProblem();
  }
  form.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.preventDefault();
      checkThenFocusLink();
    }
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    checkThenFocusLink();
  });

  send.addEventListener('click', function (e) {
    update();
    if (valid()) return; /* a plain link: the browser follows the rewritten href */
    e.preventDefault();
    showErrors = true;
    update();
    focusFirstProblem();
  });

  /* keep Today, Tomorrow and the slots right if the page stays open */
  setInterval(update, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) update(); });
  window.addEventListener('pageshow', update);

  buildDays();
  update();
})();
