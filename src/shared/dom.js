/** Escape text at the HTML boundary, never trust stored or remote strings. */
export function escapeHTML(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
}

/** Recruitment links may open only HTTP(S) destinations, never executable URLs. */
export function safeHref(value) {
  if (
    typeof value !== 'string' ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return '#';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : '#';
  } catch {
    return '#';
  }
}

/** Reuse unchanged card nodes across filters and active/processed containers. */
export function createCardRenderer() {
  const cache = new Map();
  return {
    render(container, items, renderCard, stateOf = () => '') {
      const minute = Math.floor(Date.now() / 60000);
      const nodes = items.map((item, index) => {
        const signature = stateOf(item) + ':' + minute;
        let entry = cache.get(item.id);
        if (!entry || entry.item !== item || entry.signature !== signature) {
          const html = renderCard(item, index, false).trim();
          if (entry && entry.html === html) {
            entry.item = item;
            entry.signature = signature;
          } else {
            const open = entry
              ? [...entry.node.querySelectorAll('details')].map((detail) => detail.open)
              : [];
            const template = document.createElement('template');
            template.innerHTML = html;
            const parsed = template.content.firstElementChild;
            if (!parsed || parsed.tagName !== 'ARTICLE')
              throw new Error('Invalid card renderer output');
            const node = entry?.node || parsed;
            if (entry) {
              for (const attribute of [...node.attributes])
                if (!parsed.hasAttribute(attribute.name)) node.removeAttribute(attribute.name);
              for (const attribute of [...parsed.attributes])
                node.setAttribute(attribute.name, attribute.value);
              node.replaceChildren(...parsed.childNodes);
            }
            node.querySelectorAll('details').forEach((detail, i) => {
              detail.open = !!open[i];
            });
            entry = { item, signature, node, html };
            cache.set(item.id, entry);
          }
        }
        return entry.node;
      });
      const wanted = new Set(nodes);
      for (const child of [...container.children]) if (!wanted.has(child)) child.remove();
      nodes.forEach((node, index) => {
        if (container.children[index] !== node)
          container.insertBefore(node, container.children[index] ?? null);
      });
    },
    prune(ids) {
      const keep = new Set(ids);
      for (const id of cache.keys()) if (!keep.has(id)) cache.delete(id);
    },
    clear() {
      cache.clear();
    },
  };
}

/** Debounce typing but never search an unfinished Chinese/Japanese composition. */
export function bindSearch(input, render, delay = 100) {
  let timer,
    composing = false;
  const controller = new AbortController();
  const schedule = () => {
    clearTimeout(timer);
    if (!composing) timer = setTimeout(render, delay);
  };
  input.addEventListener(
    'compositionstart',
    () => {
      composing = true;
      clearTimeout(timer);
    },
    { signal: controller.signal },
  );
  input.addEventListener(
    'compositionend',
    () => {
      composing = false;
      schedule();
    },
    { signal: controller.signal },
  );
  input.addEventListener(
    'input',
    (event) => {
      if (!event.isComposing) schedule();
    },
    { signal: controller.signal },
  );
  input.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Enter' && !composing) {
        clearTimeout(timer);
        render();
      }
    },
    { signal: controller.signal },
  );
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
