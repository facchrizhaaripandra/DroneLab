// Command editor panel (DOM only). Tabs: Skrip, Bahasa natural. The panel does not run anything itself:
// it calls the handlers from main.js and shows the log and the active statement.
import { esc } from './ui.js';
import { SAMPLE_SCRIPT } from './dsl.js';

export function createEditor(root, h) {
  const el = document.createElement('div');
  el.id = 'editor';
  el.className = 'panel';
  el.innerHTML = `
    <div class="tabs"><button data-tab="script" class="on">Skrip</button><button data-tab="nl">Bahasa natural</button><span class="sp"></span><button data-act="close" title="Tutup (Esc)">✕</button></div>
    <div class="pane" data-pane="script">
      <textarea id="ed-src" spellcheck="false" rows="6"></textarea>
      <pre id="ed-view"></pre>
    </div>
    <div class="pane" data-pane="nl" style="display:none">
      <div class="nlrow"><input id="ed-nl" type="text" placeholder="contoh: naik 5 meter lalu foto" /><button data-act="send">Kirim</button></div>
      <p class="muted">Perintah umum diterjemahkan lokal. Sisanya dikirim ke server AI (jika ada). Hasilnya masuk ke tab Skrip untuk diperiksa sebelum dijalankan.</p>
    </div>
    <div class="btns"><button data-act="run">Jalankan</button><button data-act="step">Langkah</button><button data-act="stop">Hentikan</button><button data-act="sample">Contoh</button></div>
    <pre id="ed-log"></pre>`;
  el.style.display = 'none';
  root.appendChild(el);
  const q = (s) => el.querySelector(s);
  const src = q('#ed-src'), view = q('#ed-view'), logEl = q('#ed-log'), nl = q('#ed-nl');
  src.value = SAMPLE_SCRIPT;
  let shownState = '', shownActive = null, open = false;

  function tab(name) {
    el.querySelectorAll('.tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    el.querySelectorAll('.pane').forEach((p) => { p.style.display = p.dataset.pane === name ? 'block' : 'none'; });
    (name === 'nl' ? nl : src).focus();
  }

  const api = {
    get isOpen() { return open; },
    open() { open = true; el.style.display = 'block'; h.onOpen(); src.focus(); },
    close() { open = false; el.style.display = 'none'; src.blur(); nl.blur(); h.onClose(); },
    log(entry) {
      const d = document.createElement('div');
      d.className = entry.kind;
      d.textContent = entry.text;
      logEl.appendChild(d);
      while (logEl.childNodes.length > 60) logEl.removeChild(logEl.firstChild);
      logEl.scrollTop = logEl.scrollHeight;
    },
    logText(text, kind = 'info') { api.log({ text, kind }); },
    setScript(text) { src.value = text; },
    // Called ~10 times per second: writes the DOM only when something changed.
    sync(state, active) {
      if (state === shownState && active === shownActive) return;
      shownState = state; shownActive = active;
      const live = state === 'running' || state === 'paused';
      src.style.display = live ? 'none' : 'block';
      view.style.display = live ? 'block' : 'none';
      if (live) {
        const t = src.value, a = active;
        view.innerHTML = a ? `${esc(t.slice(0, a.start))}<mark>${esc(t.slice(a.start, a.end))}</mark>${esc(t.slice(a.end))}` : esc(t);
      }
    },
  };

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tab) tab(b.dataset.tab);
    else if (b.dataset.act === 'close') api.close();
    else if (b.dataset.act === 'run') h.onRun(src.value);
    else if (b.dataset.act === 'step') h.onStep(src.value);
    else if (b.dataset.act === 'stop') h.onStop();
    else if (b.dataset.act === 'sample') src.value = SAMPLE_SCRIPT;
    else if (b.dataset.act === 'send') sendNatural();
  });
  async function sendNatural() {
    const text = nl.value.trim();
    if (!text) return;
    const r = await h.onNatural(text);
    if (r && r.script) { src.value = r.script; tab('script'); }
  }
  el.addEventListener('keydown', (e) => {
    e.stopPropagation(); // typing here must never reach the flight keys
    if (e.key === 'Escape') { e.preventDefault(); api.close(); }
    else if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); h.onRun(src.value); }
    else if (e.key === 'Enter' && e.target === nl) { e.preventDefault(); sendNatural(); }
  });
  return api;
}
