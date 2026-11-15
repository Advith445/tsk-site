/* TSK site.js · SPEC §3.5 mobile nav, §3.7 reveals, §4.6 old anchors, §4.4 copy buttons.
   Markup this file expects:
   - nav:    <button aria-controls="mobile-nav" aria-expanded="false"> and <dialog id="mobile-nav"> holding [data-nav-close]
   - reveal: every <main> > <section> and every .warli; nothing to add in the HTML
   - copy:   <button type="button" data-copy="text to copy"><span data-copy-label>Copy address</span></button> */
(function () {
  'use strict';
  var doc = document;
  var root = doc.documentElement;

  /* ---- §4.6: anchors of the old one-page site, on / only ---- */
  var moved = {
    '#reserve': '/tsk-site/visit/#reserve',
    '#inside': '/tsk-site/visit/#inside',
    '#visit': '/tsk-site/visit/',
    '#catering': '/tsk-site/catering/',
    '#menu': '/tsk-site/menu/'
  };
  var path = location.pathname;
  if ((path === '/tsk-site/' || path === '/tsk-site/index.html') && Object.prototype.hasOwnProperty.call(moved, location.hash)) {
    location.replace(moved[location.hash]);
    return;
  }

  /* ---- §3.5: mobile nav. showModal() gives the focus trap, Esc and focus return ---- */
  var opener = doc.querySelector('[aria-controls="mobile-nav"]');
  var nav = doc.getElementById('mobile-nav');
  if (opener && nav) {
    if (typeof nav.showModal !== 'function') {
      opener.hidden = true;
    } else {
      opener.addEventListener('click', function () {
        if (nav.open) return;
        nav.showModal();
        opener.setAttribute('aria-expanded', 'true');
        root.classList.add('nav-open');
      });
      nav.addEventListener('close', function () {
        opener.setAttribute('aria-expanded', 'false');
        root.classList.remove('nav-open');
      });
      nav.addEventListener('click', function (e) {
        if (e.target.closest('a, [data-nav-close]')) nav.close();
      });
      var desktop = window.matchMedia('(min-width:1024px)');
      var onDesktop = function () { if (desktop.matches && nav.open) nav.close(); };
      if (desktop.addEventListener) desktop.addEventListener('change', onDesktop);
      else desktop.addListener(onDesktop);
    }
  }

  /* ---- §3.7: reveals. Only what is below the viewport right now starts hidden ---- */
  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!still && 'IntersectionObserver' in window) {
    var fold = window.innerHeight || root.clientHeight;
    var target = null;
    if (location.hash.length > 1) {
      try { target = doc.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (e) {}
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var cl = entry.target.classList;
        if (cl.contains('warli')) {
          cl.remove('warli--wait');
        } else {
          cl.remove('reveal-wait');
          cl.add('reveal-in');
        }
        io.unobserve(entry.target);
      });
    });
    doc.querySelectorAll('main > section, .warli').forEach(function (el) {
      if (el.getBoundingClientRect().top < fold) return;
      if (target && el.contains(target)) return;
      el.classList.add(el.classList.contains('warli') ? 'warli--wait' : 'reveal-wait');
      io.observe(el);
    });
  }

  /* ---- §4.4 V1: copy buttons ---- */
  doc.querySelectorAll('[data-copy]').forEach(function (btn) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      btn.hidden = true;
      return;
    }
    var label = btn.querySelector('[data-copy-label]') || btn;
    var text = label.textContent;
    var timer;
    label.setAttribute('aria-live', 'polite');
    btn.addEventListener('click', function () {
      navigator.clipboard.writeText(btn.getAttribute('data-copy')).then(function () {
        label.textContent = 'Copied';
        clearTimeout(timer);
        timer = setTimeout(function () { label.textContent = text; }, 2000);
      }, function () {});
    });
  });
})();
