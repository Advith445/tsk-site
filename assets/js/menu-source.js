/*
 * TSK menu source: reads the owner's Google Sheet and exposes window.TSKMenu.
 *
 * COLUMN MAP (headers are found by trimmed, case-insensitive name, never by position)
 *
 * Menu tab, ONE ROW PER OPTION
 *   Section ..................... dish.section (id) and the section it is grouped under
 *   Dish ........................ dish.name; rows with the same Section + Dish form one dish
 *   Option ...................... dish.options[].label ("" when blank), in row order
 *   Price (₹) ................... dish.options[].price (integer; "₹1,099" -> 1099)
 *   Type ........................ dish.options[].diet (Veg -> veg, Egg -> egg, Non-veg -> nonveg)
 *   On website .................. row is used only when TRUE / true / yes / 1 (no column = all rows)
 *   Popular order ............... dish.popular (positive integer) and dish.popularRank
 *   Photo (Google Drive link) ... dish.photoId (Drive links) and dish.photo; use TSKMenu.photoUrl()
 *   Description ................. dish.description
 *   Item code ................... ignored
 *   Required: Section, Dish, Price (₹), Type. The others are optional.
 *   Photo, Description and Popular order come from the dish's first row, or the first later row that has them.
 *
 * Sections tab
 *   Section ..................... section.name, and the display order of sections
 *   Description shown under the heading ... section.blurb
 *   A Menu section missing here is appended (empty blurb); a section with no dishes is dropped.
 *
 * Derived: section.id, dish.id (unique across sections and dishes), dish.available (true),
 *          data.updated (ISO fetch time), data.warnings (skipped rows, unreadable photo links).
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- CONFIG
  var CONFIG = {
    SHEET_ID: '1VEYV7BGNcUGx93y3vQiiTNAgh97ABuqoGu65xQgBMzc',
    TABS: { menu: 'Menu', sections: 'Sections' },
    // Optional per-tab CSV URL. Leave '' to use the sheet above; paste a "Publish to web"
    // CSV link here to swap it in by editing one line.
    URL_OVERRIDE: { menu: '', sections: '' },
    REFRESH_MINUTES: 5,
    REFETCH_ON_SHOW_MS: 60 * 1000,
    FETCH_TIMEOUT_MS: 10000,
    CACHE_KEY: 'tsk-menu-v1'
  };

  var RUPEE = '₹';

  // ------------------------------------------------------------------- CSV
  // RFC 4180: quoted commas and newlines, doubled quotes, CRLF / LF / CR, leading BOM.
  // Returns every record (blank ones included, so record numbers stay meaningful).
  function parseCsv(text) {
    text = String(text == null ? '' : text);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var rows = [], row = [], field = '', inQuotes = false, i = 0, n = text.length, c;
    while (i < n) {
      c = text.charAt(i);
      if (inQuotes) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"' && field === '') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r' || c === '\n') {
        if (c === '\r' && text.charAt(i + 1) === '\n') i++;
        row.push(field); field = ''; rows.push(row); row = []; i++; continue;
      }
      field += c; i++;
    }
    if (inQuotes) throw new Error('Malformed CSV: unterminated quote');
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function isBlankRow(row) {
    for (var i = 0; i < row.length; i++) if (String(row[i]).trim() !== '') return false;
    return true;
  }

  // Skips leading blank records; returns {header, rows:[{cells, no}]} with `no` = 1-based record number.
  function readTable(csv, tabName) {
    var all = parseCsv(csv), start = 0;
    while (start < all.length && isBlankRow(all[start])) start++;
    if (start >= all.length) throw new Error(tabName + ' tab is empty');
    var header = Object.create(null);
    all[start].forEach(function (h, idx) {
      var key = String(h).replace(/^﻿/, '').trim().toLowerCase();
      if (key && !(key in header)) header[key] = idx;
    });
    var rows = [];
    for (var r = start + 1; r < all.length; r++) {
      if (!isBlankRow(all[r])) rows.push({ cells: all[r], no: r + 1 });
    }
    return { header: header, rows: rows };
  }

  function cell(row, idx) {
    if (idx === undefined) return '';
    var v = row.cells[idx];
    return v == null ? '' : String(v).trim();
  }

  // ---------------------------------------------------------------- helpers
  function norm(s) { return String(s).replace(/\s+/g, ' ').trim().toLowerCase(); }

  function slug(s) {
    return String(s).toLowerCase().replace(/&/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function uniqueId(base, used) {
    base = base || 'item';
    var id = base, n = 2;
    while (used[id]) { id = base + '-' + n; n++; }
    used[id] = true;
    return id;
  }

  function parsePrice(raw) {
    var s = String(raw).replace(/[₹,\s ]/g, '');
    if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
    var n = Math.round(parseFloat(s));
    return n > 0 ? n : NaN;
  }

  function parseDiet(raw) {
    var k = String(raw).toLowerCase().replace(/[\s_-]+/g, '');
    return k === 'veg' ? 'veg' : k === 'egg' ? 'egg' : k === 'nonveg' ? 'nonveg' : '';
  }

  function parseRank(raw) {
    var s = String(raw).trim();
    if (!/^\d+(\.0+)?$/.test(s)) return 0;
    var n = parseInt(s, 10);
    return n > 0 ? n : 0;
  }

  function isOn(raw) {
    var v = String(raw).trim().toLowerCase();
    return v === 'true' || v === 'yes' || v === '1';
  }

  // -> {id} for Google Drive links, {url} for other http(s) links, null when unusable.
  function parsePhoto(raw) {
    var s = String(raw).trim();
    if (!/^https?:\/\//i.test(s)) return null;
    var m;
    if (/^https?:\/\/(?:drive|docs)\.google\.com\//i.test(s)) {
      m = s.match(/\/file\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/) || s.match(/[?&]id=([A-Za-z0-9_-]+)/);
      return m ? { id: m[1] } : { url: s };
    }
    return { url: s };
  }

  function photoUrl(dish, width) {
    if (!dish) return '';
    var w = Math.round(Number(width));
    if (!(w > 0)) w = 480;
    if (dish.photoId) return 'https://lh3.googleusercontent.com/d/' + encodeURIComponent(dish.photoId) + '=w' + w + '-rw';
    return dish.photo || '';
  }

  // en-IN digit grouping: 1,099 and 1,00,000
  function formatPrice(n) {
    n = Number(n);
    if (!isFinite(n)) return '';
    var neg = n < 0, s = String(Math.round(Math.abs(n)));
    var last3 = s.slice(-3), rest = s.slice(0, -3);
    if (rest) rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',';
    return (neg ? '-' : '') + RUPEE + rest + last3;
  }

  // ------------------------------------------------------------------ parse
  // Pure. Throws when the input is not a valid menu (missing columns, no priced dish).
  function parse(menuCsv, sectionsCsv, fetchedAt) {
    var warnings = [];
    var menu = readTable(menuCsv, 'Menu');
    var H = menu.header;
    var iSection = H['section'], iDish = H['dish'], iOption = H['option'], iPrice = H['price (' + RUPEE + ')'],
        iType = H['type'], iOn = H['on website'], iPop = H['popular order'],
        iPhoto = H['photo (google drive link)'], iDesc = H['description'];
    var missing = [];
    if (iSection === undefined) missing.push('Section');
    if (iDish === undefined) missing.push('Dish');
    if (iPrice === undefined) missing.push('Price (' + RUPEE + ')');
    if (iType === undefined) missing.push('Type');
    if (missing.length) throw new Error('Menu tab is missing column(s): ' + missing.join(', '));

    var sheet = readTable(sectionsCsv, 'Sections');
    if (sheet.header['section'] === undefined) throw new Error('Sections tab is missing column: Section');
    var iBlurb = sheet.header['description shown under the heading'];
    if (iBlurb === undefined) {
      Object.keys(sheet.header).some(function (k) {
        if (k.indexOf('description') === 0) { iBlurb = sheet.header[k]; return true; }
        return false;
      });
    }

    // Group option rows into dishes.
    var dishByKey = Object.create(null), dishes = [], menuSectionOrder = [], menuSectionName = Object.create(null);
    menu.rows.forEach(function (row) {
      var dishName = cell(row, iDish);
      if (!dishName) return;
      if (iOn !== undefined && !isOn(cell(row, iOn))) return;
      var where = 'Menu row ' + row.no + ' (' + dishName + ')';
      var sectionName = cell(row, iSection);
      if (!sectionName) { warnings.push(where + ': skipped, Section is blank'); return; }
      var price = parsePrice(cell(row, iPrice));
      if (isNaN(price)) { warnings.push(where + ': skipped, price "' + cell(row, iPrice) + '" is not a positive number'); return; }
      var diet = parseDiet(cell(row, iType));
      if (!diet) { warnings.push(where + ': skipped, Type "' + cell(row, iType) + '" is not Veg, Egg or Non-veg'); return; }

      var sKey = norm(sectionName);
      if (!menuSectionName[sKey]) { menuSectionName[sKey] = sectionName; menuSectionOrder.push(sKey); }
      var key = sKey + '\u0001' + norm(dishName);
      var dish = dishByKey[key];
      if (!dish) {
        dish = dishByKey[key] = { sKey: sKey, name: dishName, options: [], description: '', rank: 0, photo: null };
        dishes.push(dish);
      }
      dish.options.push({ label: cell(row, iOption), price: price, diet: diet });
      if (!dish.description) dish.description = cell(row, iDesc);
      if (!dish.rank) dish.rank = parseRank(cell(row, iPop));
      var photoRaw = cell(row, iPhoto);
      if (photoRaw && !dish.photo) {
        dish.photo = parsePhoto(photoRaw);
        if (!dish.photo) warnings.push(where + ': photo link ignored, "' + photoRaw + '" is not an http(s) link');
      }
    });
    if (!dishes.length) throw new Error('Menu has no priced dishes');

    // Sections: Sections-tab order, then any Menu-only section; drop empty ones.
    var order = [], sectionInfo = Object.create(null);
    sheet.rows.forEach(function (row) {
      var name = cell(row, sheet.header['section']);
      var k = norm(name);
      if (!name || sectionInfo[k]) return;
      sectionInfo[k] = { name: name, blurb: cell(row, iBlurb) };
      order.push(k);
    });
    menuSectionOrder.forEach(function (k) {
      if (!sectionInfo[k]) { sectionInfo[k] = { name: menuSectionName[k], blurb: '' }; order.push(k); }
    });
    var hasDishes = Object.create(null);
    dishes.forEach(function (d) { hasDishes[d.sKey] = true; });
    order = order.filter(function (k) { return hasDishes[k]; });

    // ids: unique across sections and dishes together.
    var used = Object.create(null), sectionId = Object.create(null);
    var sections = order.map(function (k) {
      var id = uniqueId(slug(sectionInfo[k].name), used);
      sectionId[k] = id;
      return { id: id, name: sectionInfo[k].name, blurb: sectionInfo[k].blurb };
    });
    var out = [];
    order.forEach(function (k) {
      dishes.forEach(function (d) {
        if (d.sKey !== k) return;
        var dish = {
          id: uniqueId(slug(d.name), used),
          section: sectionId[k],
          name: d.name,
          popular: d.rank > 0,
          popularRank: d.rank > 0 ? d.rank : null,
          available: true,
          options: d.options,
          description: d.description,
          photo: '',
          photoId: ''
        };
        if (d.photo && d.photo.id) { dish.photoId = d.photo.id; dish.photo = photoUrl(dish, 480); }
        else if (d.photo && d.photo.url) dish.photo = d.photo.url;
        out.push(dish);
      });
    });

    var when = fetchedAt instanceof Date ? fetchedAt.toISOString() : (fetchedAt || new Date().toISOString());
    return { sections: sections, dishes: out, updated: when, warnings: warnings };
  }

  // ---------------------------------------------------------- hash and cache
  // cyrb53: 53-bit string hash. `updated` is left out, so only real changes count.
  function hashOf(data) {
    var s = JSON.stringify({ sections: data.sections, dishes: data.dishes, warnings: data.warnings });
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57, ch;
    for (var i = 0; i < s.length; i++) {
      ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16) + ':' + s.length;
  }

  function saveCache(data, fetchedAt) {
    try { localStorage.setItem(CONFIG.CACHE_KEY, JSON.stringify({ fetchedAt: fetchedAt, data: data })); } catch (e) { /* storage unavailable */ }
  }

  function readCache() {
    try {
      var obj = JSON.parse(localStorage.getItem(CONFIG.CACHE_KEY));
      if (obj && obj.data && Array.isArray(obj.data.dishes) && obj.data.dishes.length && Array.isArray(obj.data.sections)) return obj;
    } catch (e) { /* missing, unreadable or storage unavailable */ }
    return null;
  }

  // ---------------------------------------------------------------- network
  function tabUrl(key) {
    if (CONFIG.URL_OVERRIDE[key]) return CONFIG.URL_OVERRIDE[key];
    return 'https://docs.google.com/spreadsheets/d/' + CONFIG.SHEET_ID +
      '/gviz/tq?tqx=out:csv&headers=1&sheet=' + encodeURIComponent(CONFIG.TABS[key]);
  }

  function fetchText(url) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, CONFIG.FETCH_TIMEOUT_MS) : null;
    var opts = { cache: 'no-store' };
    if (ctl) opts.signal = ctl.signal;
    return fetch(url, opts).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then(function (text) {
      if (timer) clearTimeout(timer);
      return text;
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  function fetchMenu() {
    return Promise.all([fetchText(tabUrl('menu')), fetchText(tabUrl('sections'))]).then(function (t) {
      var at = new Date().toISOString();
      return { data: parse(t[0], t[1], at), fetchedAt: at };   // throws on invalid: good data is never replaced
    });
  }

  // ------------------------------------------------------------------ state
  var current = null;          // { data, hash, meta }
  var subscribers = [];
  var inflight = null;
  var loadPromise = null;
  var initialPending = false;
  var lastAttempt = 0;
  var timer = null;
  var scheduled = false;

  function notify() {
    subscribers.slice().forEach(function (fn) {
      try { fn(current.data, current.meta); }
      catch (e) { if (typeof console !== 'undefined' && console.error) console.error(e); }
    });
  }

  function accept(result) {
    var hash = hashOf(result.data);
    var changed = !current || current.hash !== hash;
    current = { data: result.data, hash: hash, meta: { source: 'network', fetchedAt: result.fetchedAt } };
    saveCache(result.data, result.fetchedAt);
    if (changed && !initialPending) notify();
  }

  function refresh() {
    if (inflight) return inflight;
    lastAttempt = Date.now();
    inflight = fetchMenu().then(function (result) {
      inflight = null;
      accept(result);
    }, function (err) {
      inflight = null;
      throw err;
    });
    return inflight;
  }

  function quietRefresh() { refresh().catch(function () { /* keep the data we have */ }); }

  function startTimer() {
    stopTimer();
    timer = setInterval(quietRefresh, CONFIG.REFRESH_MINUTES * 60 * 1000);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function stopTimer() {
    if (timer !== null) { clearInterval(timer); timer = null; }
  }

  function onVisibility() {
    if (document.hidden) { stopTimer(); return; }
    startTimer();
    if (Date.now() - lastAttempt > CONFIG.REFETCH_ON_SHOW_MS) quietRefresh();
  }

  function startSchedule() {
    if (scheduled) return;
    scheduled = true;
    var hasDoc = typeof document !== 'undefined' && document && typeof document.addEventListener === 'function';
    if (hasDoc) document.addEventListener('visibilitychange', onVisibility);
    if (!hasDoc || !document.hidden) startTimer();
  }

  function settle() { initialPending = false; loadPromise = null; }

  // ----------------------------------------------------------------- public
  function load() {
    if (current) return Promise.resolve(current.data);
    if (loadPromise) return loadPromise;
    initialPending = true;
    loadPromise = refresh().then(function () {
      return current.data;
    }, function (err) {
      var saved = readCache();
      if (saved) {
        current = { data: saved.data, hash: hashOf(saved.data), meta: { source: 'cache', fetchedAt: saved.fetchedAt } };
        return current.data;
      }
      throw err;
    }).then(function (data) {
      settle();
      return data;
    }, function (err) {
      settle();
      throw err;
    });
    startSchedule();
    return loadPromise;
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') throw new TypeError('TSKMenu.subscribe needs a function');
    subscribers.push(fn);
    return function unsubscribe() {
      var i = subscribers.indexOf(fn);
      if (i >= 0) subscribers.splice(i, 1);
    };
  }

  var api = { load: load, subscribe: subscribe, parse: parse, photoUrl: photoUrl, formatPrice: formatPrice };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.TSKMenu = api;
})();
