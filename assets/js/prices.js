/* TSK prices.js · SPEC §4.1 H3, §5.2 price line, §10.
   Fills every [data-price-for="dish-id"] from window.TSKMenu (load, then subscribe for the 5-minute refreshes).
   Price line: one option -> "₹389"; several -> "Regular ₹389 · Family ₹779", breaking only between pairs;
   mixed-diet dishes put a diet mark before each pair. A span is hidden when the menu cannot be loaded
   or has no dish with that id; while the first load is pending it stays empty (its height is reserved in CSS). */
(function () {
  'use strict';
  var doc = document;
  var api = window.TSKMenu;
  var DIET = { veg: 'Veg', egg: 'Egg', nonveg: 'Non-veg' };

  function spans() { return doc.querySelectorAll('[data-price-for]'); }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function hide(el) { clear(el); el.hidden = true; }

  function mark(diet) {
    var frag = doc.createDocumentFragment();
    var box = doc.createElement('span');
    box.className = 'diet diet--' + diet;
    var label = doc.createElement('span');
    label.className = 'visually-hidden';
    label.textContent = DIET[diet];
    frag.appendChild(box);
    frag.appendChild(label);
    return frag;
  }

  function fill(el, dish) {
    var opts = dish.options || [];
    var diets = [];
    opts.forEach(function (o) { if (diets.indexOf(o.diet) === -1) diets.push(o.diet); });
    var mixed = diets.length > 1;
    clear(el);
    opts.forEach(function (o, i) {
      var pair = doc.createElement('span');
      pair.className = 'price-opt';
      if (mixed && DIET[o.diet]) pair.appendChild(mark(o.diet));
      pair.appendChild(doc.createTextNode((o.label ? o.label + ' ' : '') + api.formatPrice(o.price)));
      if (i < opts.length - 1) {
        var sep = doc.createElement('span');
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = ' ·';
        pair.appendChild(sep);
        el.appendChild(pair);
        el.appendChild(doc.createTextNode(' '));
      } else {
        el.appendChild(pair);
      }
    });
    el.hidden = false;
  }

  function render(data) {
    var byId = Object.create(null);
    ((data && data.dishes) || []).forEach(function (d) { byId[d.id] = d; });
    Array.prototype.forEach.call(spans(), function (el) {
      var dish = byId[el.getAttribute('data-price-for')];
      if (dish && dish.available !== false && dish.options && dish.options.length) fill(el, dish);
      else hide(el);
    });
  }

  function hideAll() { Array.prototype.forEach.call(spans(), hide); }

  if (!api || typeof api.load !== 'function' || !spans().length) {
    if (spans().length) hideAll();
    return;
  }
  api.subscribe(render);
  api.load().then(render, hideAll);
})();
