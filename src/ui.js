// Generic menu overlay: a title, optional body HTML, and a list of buttons.
// Works with mouse, keyboard and controller (the 'nav' events come from input.js while menuMode is on).
import { events } from './events.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export { esc };

// Next focusable (enabled) index in direction dir (-1 or 1), wrapping around. Pure, so it is testable.
export function moveFocus(items, index, dir) {
  const n = items.length;
  for (let k = 1; k <= n; k++) {
    const i = (((index + dir * k) % n) + n) % n;
    if (items[i].enabled !== false) return i;
  }
  return index;
}

export function createMenu(root) {
  const el = document.createElement('div');
  el.id = 'menu';
  el.innerHTML = '<div class="card"><h1></h1><p class="sub"></p><div class="body"></div><div class="list"></div><p class="foot"></p></div>';
  root.appendChild(el);
  const q = (c) => el.querySelector(c);
  let spec = null, index = 0, buttons = [];

  const menu = {
    get isOpen() { return spec !== null; },
    // spec: { title, subtitle, body (html, trusted), items: [{label, note, enabled, action | step(dir)}], onBack, foot, dim, rebuild, tick }
    // Items with step(dir) change a value with Left/Right (and OK = +1); the screen is rebuilt via spec.rebuild().
    open(s, keepIndex = false) {
      const prev = index;
      spec = s;
      q('h1').textContent = s.title;
      q('.sub').textContent = s.subtitle || '';
      q('.body').innerHTML = s.body || '';
      q('.foot').textContent = s.foot || '';
      el.classList.toggle('dim', s.dim !== false && !s.hero);
      el.classList.toggle('hero', !!s.hero); // main menu: left column over the live 3D backdrop
      el.classList.toggle('small', !s.hero && !s.body && s.items.length <= 4); // pause, loading, errors
      el.classList.toggle('wide', !!s.wide); // help: three columns
      const list = q('.list');
      list.innerHTML = '';
      buttons = s.items.map((it, i) => {
        if (it.heading) { // section title inside a list: not a button, never focused
          const h = document.createElement('div');
          h.className = 'mh';
          h.innerHTML = `<span>${esc(it.label)}</span><small>${esc(it.note || '')}</small>`;
          list.appendChild(h);
          return h;
        }
        const b = document.createElement('button');
        b.className = 'mi';
        b.disabled = it.enabled === false;
        const note = it.key ? `<span class="key">${esc(it.note || '')}</span>` : esc(it.note || '');
        b.innerHTML = `<span>${esc(it.label)}</span><small>${note}</small>`;
        if (it.step) b.classList.add('stepper'); // value changed with left / right
        b.addEventListener('click', () => { b.blur(); index = i; menu.activate(); }); // blur: Enter/Space must not click twice
        b.addEventListener('mouseenter', () => { if (!b.disabled && index !== i) { index = i; paint(); } }); // the mouse moves the same highlight as the keys
        list.appendChild(b);
        return b;
      });
      index = keepIndex ? Math.min(prev, s.items.length - 1) : Math.max(0, s.items.findIndex((it) => it.enabled !== false));
      el.style.display = 'flex';
      if (!keepIndex) q('.card').scrollTop = 0; // a new screen starts at its title, even if the focused item is far down
      paint(keepIndex);
    },
    close() { spec = null; el.style.display = 'none'; },
    activate() {
      const it = spec && spec.items[index];
      if (!it || it.enabled === false) return;
      if (it.step) menu.step(1); else it.action();
    },
    step(dir) {
      const it = spec && spec.items[index];
      if (!it || !it.step || it.enabled === false) return;
      it.step(dir);
      if (spec && spec.rebuild) menu.open(spec.rebuild(), true);
    },
    refresh() { if (spec && spec.rebuild) menu.open(spec.rebuild(), true); },
    tick() { if (spec && spec.tick) spec.tick(el); }, // ~10 Hz, for live screens (stick test)
  };

  function paint(scroll = true) {
    buttons.forEach((b, i) => b.classList.toggle('sel', i === index));
    if (scroll && buttons[index] && buttons[index].scrollIntoView) buttons[index].scrollIntoView({ block: 'nearest' });
  }

  events.on('nav', ({ dir }) => {
    if (!spec) return;
    if (dir === 'up' || dir === 'down') { index = moveFocus(spec.items, index, dir === 'up' ? -1 : 1); paint(); }
    else if (dir === 'left' || dir === 'right') menu.step(dir === 'left' ? -1 : 1);
    else if (dir === 'ok') menu.activate();
    else if (dir === 'back' && spec.onBack) spec.onBack();
  });

  el.style.display = 'none';
  return menu;
}
