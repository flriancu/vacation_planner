// Language switch for privacy.html and terms.html. Same storage key as the app (src/ui/App.tsx),
// so one choice follows you everywhere. Each page has one <article data-lang="…"> per language
// and its titles in <html data-title-ro data-title-en>.
(function () {
  var KEY = 'vacation-planner.lang';
  var root = document.documentElement;

  function show(lang, remember) {
    document.querySelectorAll('[data-lang]').forEach(function (el) {
      el.hidden = el.getAttribute('data-lang') !== lang;
    });
    document.querySelectorAll('[data-set-lang]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-set-lang') === lang));
    });
    root.lang = lang;
    document.title = root.getAttribute('data-title-' + lang) || document.title;
    if (remember) {
      try {
        localStorage.setItem(KEY, lang);
      } catch (e) {}
    }
  }

  document.querySelectorAll('[data-set-lang]').forEach(function (b) {
    b.addEventListener('click', function () {
      show(b.getAttribute('data-set-lang'), true);
    });
  });

  var stored = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch (e) {}
  // No choice yet: Romanian, the app's own default (src/ui/App.tsx).
  show(stored === 'en' ? 'en' : 'ro', false);
})();
