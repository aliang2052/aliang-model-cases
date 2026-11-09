/* Minimal local Design Component runtime. No server or framework required. */
(() => {
  'use strict';
  let defaults = {};
  class DCLogic {
    constructor(props = defaults) {
      this.props = { ...props };
      this.state = {};
    }
    setState(update) {
      const patch = typeof update === 'function' ? update(this.state, this.props) : update;
      this.state = { ...this.state, ...patch };
      this._render?.();
    }
  }
  window.DCLogic = DCLogic;

  const hole = /^\s*{{\s*([^{}]+?)\s*}}\s*$/;
  function value(path, scope) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    return path.split('.').reduce((result, key) => result?.[key.trim()], scope);
  }
  function interpolate(text, scope) {
    return text.replace(/{{\s*([^{}]+?)\s*}}/g, (_, path) => String(value(path, scope) ?? ''));
  }
  function children(node, scope, instance) {
    const fragment = document.createDocumentFragment();
    for (const child of node.childNodes) fragment.append(render(child, scope, instance));
    return fragment;
  }
  function render(node, scope, instance) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(interpolate(node.textContent, scope));
    if (node.nodeType !== Node.ELEMENT_NODE) return node.cloneNode(true);
    if (node.localName === 'sc-for') {
      const fragment = document.createDocumentFragment();
      const items = value(hole.exec(node.getAttribute('list'))?.[1] ?? '', scope);
      if (Array.isArray(items)) items.forEach((item, index) => {
        const local = Object.assign(Object.create(scope), { [node.getAttribute('as') || 'item']: item, $index: index });
        fragment.append(children(node, local, instance));
      });
      return fragment;
    }
    if (node.localName === 'sc-if') {
      const condition = value(hole.exec(node.getAttribute('value'))?.[1] ?? '', scope);
      return condition ? children(node, scope, instance) : document.createDocumentFragment();
    }
    // Cloning keeps SVG namespaces, viewBox casing and native form attributes intact.
    const element = node.cloneNode(false);
    for (const attr of [...element.attributes]) {
      if (attr.name.startsWith('hint-')) {
        element.removeAttribute(attr.name);
        continue;
      }
      const match = hole.exec(attr.value);
      const resolved = match ? value(match[1], scope) : undefined;
      if (match && typeof resolved === 'function' && /^on/i.test(attr.name)) {
        element.removeAttribute(attr.name);
        element.addEventListener(attr.name.slice(2).toLowerCase(), event => resolved.call(instance, event));
      } else {
        element.setAttribute(attr.name, interpolate(attr.value, scope));
      }
    }
    element.append(children(node, scope, instance));
    return element;
  }

  function mount() {
    const root = document.querySelector('x-dc');
    if (!root) return;
    for (const helmet of root.querySelectorAll('helmet')) {
      document.head.append(...helmet.childNodes);
      helmet.remove();
    }
    const script = document.querySelector('script[type="text/x-dc"][data-dc-script]');
    const definitions = JSON.parse(script?.getAttribute('data-props') || '{}');
    defaults = Object.fromEntries(Object.entries(definitions)
      .filter(([, definition]) => definition && Object.hasOwn(definition, 'default'))
      .map(([key, definition]) => [key, definition.default]));
    const Component = script
      ? new Function('DCLogic', `${script.textContent}\nreturn Component;`)(DCLogic)
      : DCLogic;
    const instance = new Component(defaults);
    const template = root.cloneNode(true);
    // A block formatting context prevents first-child margins escaping the board.
    const host = document.createElement('div');
    host.dataset.dcRoot = '';
    host.style.display = 'flow-root';
    root.replaceWith(host);
    script?.remove();
    instance._render = () => host.replaceChildren(children(template, instance.renderVals?.() || {}, instance));
    instance._render();
    document.documentElement.dataset.dcReady = 'true';
    connectCanvas();
  }

  // file:// frames have opaque origins in Chrome: cooperate through postMessage,
  // never read parent.document or require --allow-file-access-from-files.
  function connectCanvas() {
    if (parent === window) return;
    let connected = false;
    let press = null;
    let suppressClick = false;
    const send = (type, data = {}) => parent.postMessage({ channel: 'dc-canvas', type, ...data }, '*');
    addEventListener('message', event => {
      if (event.source !== parent || event.data?.channel !== 'dc-canvas') return;
      if (event.data.type === 'connect') connected = true;
      if (event.data.type === 'end') press = null;
    });
    document.addEventListener('pointerdown', event => {
      if (!connected || event.button !== 0) return;
      press = { x: event.screenX, y: event.screenY };
      suppressClick = false;
      send('down', { x: event.screenX, y: event.screenY });
    }, true);
    document.addEventListener('pointermove', event => {
      if (!press) return;
      if (Math.hypot(event.screenX - press.x, event.screenY - press.y) > 4) suppressClick = true;
      send('move', { x: event.screenX, y: event.screenY });
    }, true);
    document.addEventListener('pointerup', () => {
      if (press) send('up');
      press = null;
    }, true);
    document.addEventListener('pointercancel', () => { press = null; send('up'); }, true);
    document.addEventListener('click', event => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClick = false;
    }, true);
    document.addEventListener('dragstart', event => { if (connected) event.preventDefault(); });
    document.addEventListener('wheel', event => {
      if (!connected) return;
      event.preventDefault();
      send('wheel', { x: event.clientX, y: event.clientY, dx: event.deltaX, dy: event.deltaY,
        mode: event.deltaMode, zoom: event.ctrlKey || event.metaKey });
    }, { passive: false });
    send('ready');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
