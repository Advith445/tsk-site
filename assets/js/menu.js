/* TSK menu page · SPEC §5.2, §5.3, §10.
   Menu data comes only from window.TSKMenu (load, subscribe, photoUrl, formatPrice): this file makes no request, parses nothing and stores nothing.
   Markup it expects (menu/index.html): .menu-layout > .menu-controls [#menu-search, .menu-diet button[data-diet], nav.menu-sections]
   + .menu-body [.menu-count, .menu-results]. */
(function () {
  'use strict';

  var ORDER_URL = 'https://ownly.food/app/brand/BR443647';
  var CALL_URL = 'tel:+919949051777';
  var CALL_TEXT = '+91 99490 51777';
  var SPY_LINE = 112;      /* a heading whose top is at or above this many px from the viewport top is "current"; jumps land headings at 104 */
  var JUMP_LINE = 104;     /* same figure as scroll-margin-top in menu.css */
  var DEBOUNCE_MS = 150;
  var TINT_MS = 1500;
  var DIET_LABEL = { veg: 'Veg', egg: 'Egg', nonveg: 'Non-veg' };

  var layout = document.querySelector('.menu-layout');
  if (!layout) return;
  var controls = layout.querySelector('.menu-controls');
  var input = layout.querySelector('#menu-search');
  var dietGroup = layout.querySelector('.menu-diet');
  var nav = layout.querySelector('.menu-sections');
  var body = layout.querySelector('.menu-body');
  var count = layout.querySelector('.menu-count');
  var results = layout.querySelector('.menu-results');
  if (!controls || !input || !dietGroup || !nav || !body || !count || !results) return;

  var state = { diet: 'all', q: '', data: null, sig: '', groups: [], current: '' };
  var debounceTimer = 0;
  var tintTimer = 0;
  var spyQueued = false;

  /* ------------------------------------------------------------ helpers */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function menuApi() { return window.TSKMenu; }

  function price(n) { return menuApi().formatPrice(n); }

  function photo(dish, width) {
    try { return menuApi().photoUrl(dish, width) || ''; } catch (e) { return ''; }
  }

  function signature(data) {
    return JSON.stringify({ sections: data.sections, dishes: data.dishes });
  }

  function isDesktop() {
    return !!(window.matchMedia && window.matchMedia('(min-width:1024px)').matches);
  }

  /* ------------------------------------------------------------- search
     Lower-case, strip spaces and punctuation, collapse doubled vowels (never consonants, or "egg" would become "eg" and match "Veg"). */
  function norm(s) {
    s = String(s == null ? '' : s).toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s.replace(/[^a-z0-9ఀ-౿]+/g, '').replace(/([aeiou])\1+/g, '$1');
  }

  function queryWords(q) {
    var out = [];
    String(q).split(/\s+/).forEach(function (w) {
      w = norm(w);
      if (w) out.push(w);
    });
    return out;
  }

  /* ---------------------------------------------------------- data model */
  function setData(data) {
    var byId = {};
    var groups = [];
    (data.sections || []).forEach(function (s) {
      var g = { section: s, items: [] };
      byId[s.id] = g;
      groups.push(g);
    });
    (data.dishes || []).forEach(function (d) {
      if (d.available === false || !d.options || !d.options.length) return;
      var g = byId[d.section];
      if (!g) return;
      g.items.push({ dish: d, hay: norm(d.name) + '|' + norm(d.description) + '|' + norm(g.section.name) });
    });
    state.data = data;
    state.groups = groups;
    state.sig = signature(data);
  }

  function rankOf(d) {
    var r = Number(d.popularRank);
    return r > 0 ? r : Infinity;
  }

  function compute() {
    var words = queryWords(state.q);
    var sections = [];
    var popular = [];
    var total = 0;
    state.groups.forEach(function (g) {
      var rows = [];
      g.items.forEach(function (it) {
        var opts = state.diet === 'all' ? it.dish.options : it.dish.options.filter(function (o) { return o.diet === state.diet; });
        if (!opts.length) return;
        for (var i = 0; i < words.length; i++) if (it.hay.indexOf(words[i]) === -1) return;
        var row = { dish: it.dish, opts: opts, order: total };
        rows.push(row);
        total++;
        if (it.dish.popular) popular.push(row);
      });
      if (rows.length) sections.push({ section: g.section, rows: rows });
    });
    popular.sort(function (a, b) { return (rankOf(a.dish) - rankOf(b.dish)) || (a.order - b.order); });
    return { sections: sections, popular: popular, count: total };
  }

  /* ---------------------------------------------------------- HTML builders */
  function markHtml(diet) {
    if (!DIET_LABEL[diet]) return '';
    return '<span class="diet diet--' + diet + '"></span><span class="visually-hidden">' + DIET_LABEL[diet] + '</span>';
  }

  function priceLine(opts, mixed) {
    return opts.map(function (o, i) {
      var text = (o.label ? esc(o.label) + ' ' : '') + esc(price(o.price));
      var sep = i < opts.length - 1 ? '<span aria-hidden="true"> ·</span>' : '';
      return '<span class="dish-row__opt">' + (mixed ? markHtml(o.diet) : '') + text + sep + '</span>';
    }).join(' ');
  }

  function rowHtml(row) {
    var d = row.dish;
    var diets = [];
    row.opts.forEach(function (o) { if (diets.indexOf(o.diet) === -1) diets.push(o.diet); });
    var mixed = diets.length > 1;
    var src = photo(d, 160);
    return '<article class="dish-row' + (src ? '' : ' dish-row--bare') + '" id="' + esc(d.id) + '" tabindex="-1">' +
      (mixed ? '' : '<span class="dish-row__mark">' + markHtml(diets[0]) + '</span>') +
      '<div class="dish-row__text">' +
        '<h3 class="t-dish dish-row__name">' + esc(d.name) + '</h3>' +
        (d.popular ? '<p class="t-label dish-row__popular">Popular</p>' : '') +
        '<p class="t-price dish-row__price">' + priceLine(row.opts, mixed) + '</p>' +
        (d.description ? '<p class="t-small dish-row__desc">' + esc(d.description) + '</p>' : '') +
      '</div>' +
      (src ? '<img class="dish-row__photo" src="' + esc(src) + '" alt="" width="160" height="160" loading="lazy" decoding="async">' : '') +
    '</article>';
  }

  function sectionHtml(s) {
    return '<section class="menu-section">' +
      '<h2 class="t-h3 menu-section__title" id="' + esc(s.section.id) + '" tabindex="-1">' + esc(s.section.name) + '</h2>' +
      (s.section.blurb ? '<p class="t-small menu-section__blurb">' + esc(s.section.blurb) + '</p>' : '') +
      '<div class="menu-section__list">' + s.rows.map(rowHtml).join('') + '</div>' +
    '</section>';
  }

  function cardHtml(row) {
    var d = row.dish;
    var src = photo(d, 480);
    var lowest = Math.min.apply(null, row.opts.map(function (o) { return o.price; }));
    return '<a class="popular-card' + (src ? '' : ' popular-card--text') + '" href="#' + esc(d.id) + '">' +
      (src ? '<img class="popular-card__photo" src="' + esc(src) + '" alt="" width="480" height="360" loading="lazy" decoding="async">' : '') +
      '<span class="t-dish popular-card__name">' + esc(d.name) + '</span>' +
      '<span class="t-price popular-card__price">' + (row.opts.length > 1 ? 'from ' : '') + esc(price(lowest)) + '</span>' +
    '</a>';
  }

  function popularHtml(rows) {
    if (!rows.length) return '';
    return '<section class="menu-popular">' +
      '<h2 class="t-h3" id="menu-popular" tabindex="-1">Popular</h2>' +
      '<p class="t-small menu-popular__line">The dishes our regulars order again and again.</p>' +
      '<div class="rail menu-popular__rail">' + rows.map(cardHtml).join('') + '</div>' +
    '</section>';
  }

  function emptyHtml() {
    return '<div class="menu-empty">' +
      '<h2 class="t-h3">No dishes match that</h2>' +
      '<p class="t-body">Try a different spelling, or clear the search and filters.</p>' +
      '<button class="btn btn-ghost" type="button" data-clear>Clear search and filters</button>' +
    '</div>';
  }

  function failHtml() {
    return '<div class="menu-fail" role="alert">' +
      '<h2 class="t-h3">We couldn\'t load the menu.</h2>' +
      '<div class="menu-fail__actions">' +
        '<a class="btn btn-ghost" href="' + ORDER_URL + '">Open TSK on Ownly</a>' +
        '<a class="btn btn-ghost" href="' + CALL_URL + '">Call ' + CALL_TEXT + '</a>' +
      '</div>' +
    '</div>';
  }

  /* ------------------------------------------------------------- render */
  function setCount(n) {
    var text = n === null ? '' : (n === 1 ? '1 dish' : n + ' dishes');
    if (count.textContent !== text) count.textContent = text;
  }

  function renderNav(sections) {
    var left = nav.scrollLeft;
    nav.innerHTML = sections.map(function (s) {
      var id = esc(s.section.id);
      return '<a class="chip" href="#' + id + '" data-section="' + id + '"' + (s.section.id === state.current ? ' aria-current="true"' : '') + '>' + esc(s.section.name) + '</a>';
    }).join('');
    nav.scrollLeft = left;
  }

  function render() {
    var vis = compute();
    results.innerHTML = vis.count ? popularHtml(vis.popular) + vis.sections.map(sectionHtml).join('') : emptyHtml();
    renderNav(vis.sections);
    setCount(vis.count);
    updateSpy();
  }

  function endLoading() {
    body.classList.remove('menu-body--loading');
    body.removeAttribute('aria-busy');
  }

  function showMenu(data, firstLoad) {
    setData(data);
    endLoading();
    render();
    if (firstLoad) hashJump();
  }

  function showFailure() {
    if (state.data) return;
    endLoading();
    results.innerHTML = failHtml();
    nav.innerHTML = '';
    setCount(null);
  }

  /* ---------------------------------------------------- scroll-spy, chips */
  function reveal(chip) {
    if (nav.scrollWidth > nav.clientWidth) {
      nav.scrollLeft = chip.offsetLeft - (nav.clientWidth - chip.offsetWidth) / 2;
    }
    if (controls.scrollHeight > controls.clientHeight) {
      var c = chip.getBoundingClientRect();
      var box = controls.getBoundingClientRect();
      if (c.top < box.top) controls.scrollTop += c.top - box.top - 8;
      else if (c.bottom > box.bottom) controls.scrollTop += c.bottom - box.bottom + 8;
    }
  }

  function setCurrent(id) {
    if (id === state.current) return;
    state.current = id;
    var cur = null;
    Array.prototype.forEach.call(nav.children, function (a) {
      if (a.getAttribute('data-section') === id) { a.setAttribute('aria-current', 'true'); cur = a; }
      else a.removeAttribute('aria-current');
    });
    if (cur) reveal(cur);
  }

  function updateSpy() {
    var heads = results.getElementsByClassName('menu-section__title');
    var cur = '';
    for (var i = 0; i < heads.length; i++) {
      if (heads[i].getBoundingClientRect().top > SPY_LINE) break;
      cur = heads[i].id;
    }
    setCurrent(cur);
  }

  function queueSpy() {
    if (spyQueued) return;
    spyQueued = true;
    window.requestAnimationFrame(function () { spyQueued = false; updateSpy(); });
  }

  /* ----------------------------------------------------- URL state, jumps */
  function replaceUrl(search, hash) {
    try { history.replaceState(null, '', location.pathname + search + hash); } catch (e) { /* storage-less or sandboxed webview */ }
  }

  function syncUrl() {
    var p = [];
    if (state.diet !== 'all') p.push('diet=' + encodeURIComponent(state.diet));
    var q = state.q.trim();
    if (q) p.push('q=' + encodeURIComponent(q).replace(/%20/g, '+'));
    replaceUrl(p.length ? '?' + p.join('&') : '', location.hash);
  }

  function readUrl() {
    if (typeof URLSearchParams === 'undefined') return;
    var p = new URLSearchParams(location.search);
    var diet = p.get('diet');
    if (diet && DIET_LABEL[diet]) state.diet = diet;
    state.q = p.get('q') || '';
  }

  function tint(el) {
    clearTimeout(tintTimer);
    var prev = results.querySelector('.is-target');
    if (prev) prev.classList.remove('is-target');
    el.classList.add('is-target');
    tintTimer = setTimeout(function () { el.classList.remove('is-target'); }, TINT_MS);
  }

  /* On load with a hash: after the first render only; a hash that matches nothing is ignored. */
  function hashJump() {
    if (location.hash.length < 2) return;
    var id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { return; }
    var el = document.getElementById(id);
    if (!el || !results.contains(el)) return;
    el.scrollIntoView(true);
    if (el.classList.contains('dish-row')) tint(el);
    updateSpy();
  }

  function jump(e, a) {
    if (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var id = a.getAttribute('href').slice(1);
    var el = document.getElementById(id);
    if (!el || !results.contains(el)) return;
    e.preventDefault();
    el.scrollIntoView(true);
    replaceUrl(location.search, '#' + id);
    if (el.classList.contains('dish-row')) tint(el);
    el.focus({ preventScroll: true });
    updateSpy();
  }

  /* A filter change replaces the whole result set: if the list start is above the viewport, bring it back under the toolbar. */
  function keepResultsInView() {
    if (count.getBoundingClientRect().top < JUMP_LINE) count.scrollIntoView(true);
  }

  /* -------------------------------------------------------------- filters */
  function syncDietButtons() {
    Array.prototype.forEach.call(dietGroup.querySelectorAll('button[data-diet]'), function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-diet') === state.diet ? 'true' : 'false');
    });
  }

  function apply() {
    syncUrl();
    if (!state.data) return;
    render();
    keepResultsInView();
  }

  function clearAll() {
    clearTimeout(debounceTimer);
    state.diet = 'all';
    state.q = '';
    input.value = '';
    syncDietButtons();
    apply();
    count.focus({ preventScroll: true });
  }

  /* -------------------------------------------------------------- refresh */
  function captureAnchor() {
    var rows = results.getElementsByClassName('dish-row');
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i].getBoundingClientRect();
      if (r.bottom > 0 && r.top < window.innerHeight) return { id: rows[i].id, top: r.top };
    }
    return null;
  }

  function restoreAnchor(a) {
    if (!a) return;
    var el = document.getElementById(a.id);
    if (!el || !results.contains(el)) return;
    var delta = el.getBoundingClientRect().top - a.top;
    if (delta) window.scrollBy(0, delta);
  }

  function captureFocus() {
    var a = document.activeElement;
    if (!a || a === document.body) return null;
    var inNav = nav.contains(a);
    if (!inNav && !results.contains(a)) return null;
    return { inNav: inNav, href: a.getAttribute('href'), clear: a.hasAttribute('data-clear') };
  }

  function restoreFocus(k) {
    if (!k) return;
    var scope = k.inNav ? nav : results;
    var target = null;
    if (k.clear) target = scope.querySelector('[data-clear]');
    else if (k.href) {
      Array.prototype.some.call(scope.querySelectorAll('a'), function (a) {
        if (a.getAttribute('href') === k.href) { target = a; return true; }
        return false;
      });
    }
    if (target) target.focus({ preventScroll: true });
  }

  /* subscribe() callback: a refresh never touches the search input or diet control, never moves focus, never repeats the hash jump. */
  function onRefresh(data) {
    if (!data) return;
    if (!state.data) { showMenu(data, false); return; }       /* replaces the load-failure block */
    if (signature(data) === state.sig) return;                 /* nothing changed: touch nothing */
    var anchor = captureAnchor();
    var focus = captureFocus();
    var rail = results.querySelector('.menu-popular__rail');
    var railLeft = rail ? rail.scrollLeft : 0;
    setData(data);
    render();
    rail = results.querySelector('.menu-popular__rail');
    if (rail) rail.scrollLeft = railLeft;
    restoreAnchor(anchor);
    restoreFocus(focus);
    updateSpy();
  }

  /* --------------------------------------------------------------- events */
  input.addEventListener('input', function () {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () { state.q = input.value; apply(); }, DEBOUNCE_MS);
  });

  input.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(debounceTimer);
    if (state.q !== input.value) { state.q = input.value; apply(); }
  });

  layout.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('[data-clear]')) { clearAll(); return; }
    var b = t.closest('button[data-diet]');
    if (b && dietGroup.contains(b)) {
      var v = b.getAttribute('data-diet');
      if (v === state.diet) return;                            /* exactly one segment is always selected */
      state.diet = v;
      syncDietButtons();
      apply();
      return;
    }
    var a = t.closest('a[href^="#"]');
    if (a && (nav.contains(a) || results.contains(a))) jump(e, a);
  });

  window.addEventListener('scroll', queueSpy, { passive: true });
  window.addEventListener('resize', queueSpy);

  /* ----------------------------------------------------------------- start */
  readUrl();
  input.value = state.q;
  syncDietButtons();
  controls.hidden = false;
  count.textContent = 'Loading the menu…';

  if (!menuApi() || typeof menuApi().load !== 'function') {
    showFailure();
    return;
  }
  menuApi().subscribe(onRefresh);
  var pending;
  try { pending = menuApi().load(); } catch (e) { pending = Promise.reject(e); }
  pending.then(function (data) {
    if (state.data) onRefresh(data);                           /* a subscribe() delivery got here first */
    else showMenu(data, true);
  }, showFailure);
})();
