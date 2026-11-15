/* TSK posts.js · SPEC §4.5 story cards, §10 caching.
   Markup it expects: [data-posts-limit="N"] renders the N newest posts (Home H10 uses 3);
   [data-posts-limit="all"] renders every post (the blog index, whose headings are h2).
   The data is fetched with no-cache because GitHub Pages caches files for about 10 minutes.
   Once cards are rendered, the nearest [hidden] ancestor (Home H10) is unhidden; on failure it stays hidden. */
(function () {
  'use strict';

  var boxes = document.querySelectorAll('[data-posts-limit]');
  if (!boxes.length) { return; }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text) { node.textContent = text; }
    return node;
  }

  /* "2026-11-13" -> "13 November 2026". Split by hand, so no time-zone shift can change the day. */
  function dateText(iso) {
    var parts = String(iso).split('-');
    return parseInt(parts[2], 10) + ' ' + MONTHS[parseInt(parts[1], 10) - 1] + ' ' + parts[0];
  }

  function card(post, headingTag) {
    var href = '/tsk-site/blog/' + post.slug + '/';
    var item = make('article', 'photo-card story-card');

    var figure = make('figure', 'story-card__cover');
    var img = make('img');
    img.src = post.cover;
    img.alt = post.coverAlt || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    figure.appendChild(img);
    item.appendChild(figure);

    var meta = dateText(post.date);
    if (post.readMinutes) { meta += ' · ' + post.readMinutes + ' min read'; }
    item.appendChild(make('p', 't-small story-card__meta', meta));

    var title = make(headingTag, 't-h3 story-card__title');
    var titleLink = make('a', '', post.title);
    titleLink.href = href;
    title.appendChild(titleLink);
    item.appendChild(title);

    item.appendChild(make('p', 't-body story-card__summary', post.summary));

    var more = make('a', 'link-arrow', 'Read the story ');
    more.href = href;
    var arrow = make('span', '', '→');
    arrow.setAttribute('aria-hidden', 'true');
    more.appendChild(arrow);
    item.appendChild(more);

    return item;
  }

  function render(posts) {
    var sorted = posts.slice().sort(function (a, b) {
      if (a.date === b.date) { return 0; }
      return a.date < b.date ? 1 : -1;
    });

    Array.prototype.forEach.call(boxes, function (box) {
      var limit = box.getAttribute('data-posts-limit');
      var all = limit === 'all';
      var count = all ? sorted.length : Math.min(parseInt(limit, 10) || 0, sorted.length);
      if (count < 1) { return; }

      var headingTag = all ? 'h2' : 'h3';
      while (box.firstChild) { box.removeChild(box.firstChild); }
      for (var i = 0; i < count; i++) {
        box.appendChild(card(sorted[i], headingTag));
      }

      var hiddenAncestor = box.closest('[hidden]');
      if (hiddenAncestor) { hiddenAncestor.removeAttribute('hidden'); }
    });
  }

  fetch('/tsk-site/data/posts.json', { cache: 'no-cache' })
    .then(function (response) {
      if (!response.ok) { throw new Error('posts.json ' + response.status); }
      return response.json();
    })
    .then(function (posts) {
      if (Array.isArray(posts)) { render(posts); }
    })
    .catch(function () {
      /* Home keeps H10 hidden; the blog list stays empty. Nothing else is affected. */
    });
})();
