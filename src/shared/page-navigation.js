import './page-navigation.css';

/** Page-only preferences and anchors: never touch personal data or catalog state. */
export function createPageNavigation() {
  const lifetime = new AbortController();
  const listen = (target, event, callback) =>
    target.addEventListener(event, callback, { signal: lifetime.signal });
  const root = document.documentElement;
  const directory = document.querySelector('[data-page-directory]');
  const toolbar = document.querySelector('.toolbar');
  const fold = document.getElementById('timeline');
  const preferenceKey = 'recsys:layout:v1:' + root.dataset.pageKind + ':public-timeline';
  let frame = null,
    printState = null;

  if (fold) {
    try {
      fold.open = localStorage.getItem(preferenceKey) === 'open';
    } catch {
      // Native details remains usable when browser storage is unavailable.
    }
    listen(fold, 'toggle', () => {
      if (printState !== null) return;
      try {
        localStorage.setItem(preferenceKey, fold.open ? 'open' : 'closed');
      } catch {}
    });
    listen(window, 'beforeprint', () => {
      if (printState === null) printState = fold.open;
      fold.open = true;
    });
    listen(window, 'afterprint', () => {
      if (printState !== null) fold.open = printState;
      printState = null;
    });
  }

  // Both bars may wrap at larger text sizes; do not hard-code their heights.
  function measureBars() {
    root.style.setProperty(
      '--directory-offset',
      Math.ceil(directory?.getBoundingClientRect().height || 0) + 'px',
    );
    root.style.setProperty(
      '--filters-offset',
      Math.ceil(toolbar?.getBoundingClientRect().height || 0) + 'px',
    );
  }
  const observer = new ResizeObserver(measureBars);
  if (directory) observer.observe(directory);
  if (toolbar) observer.observe(toolbar);
  measureBars();

  function hashTarget(hash) {
    try {
      const id = decodeURIComponent(hash.slice(1));
      return id ? document.getElementById(id) : null;
    } catch {
      return null;
    }
  }
  function revealHash() {
    const target = hashTarget(location.hash);
    if (!target) return;
    // Include the target itself so #timeline and #source-index also expand.
    for (let node = target; node; node = node.parentElement)
      if (node.tagName === 'DETAILS') node.open = true;
    for (const link of directory?.querySelectorAll('a[href^="#"]') || []) {
      const section = hashTarget(link.hash);
      if (section && (section === target || section.contains(target)))
        link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = null;
      measureBars();
      const focus =
        target.tagName === 'DETAILS' ? target.querySelector(':scope > summary') : target;
      if (focus) {
        if (!focus.matches('a, button, input, select, textarea, summary, [tabindex]'))
          focus.setAttribute('tabindex', '-1');
        focus.focus({ preventScroll: true });
      }
      target.scrollIntoView({ block: 'start', behavior: 'auto' });
    });
  }
  listen(window, 'hashchange', revealHash);
  listen(document, 'click', (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
    if (!link || (link.target && link.target !== '_self')) return;
    const hash = link.getAttribute('href');
    if (!hashTarget(hash)) return;
    event.preventDefault();
    // A repeated anchor click produces no hashchange, but must still reveal it.
    if (location.hash === hash) revealHash();
    else location.hash = hash;
  });
  revealHash();

  return {
    revealHash,
    dispose() {
      lifetime.abort();
      observer.disconnect();
      cancelAnimationFrame(frame);
      if (fold && printState !== null) fold.open = printState;
      root.style.removeProperty('--directory-offset');
      root.style.removeProperty('--filters-offset');
    },
  };
}
