// Local natural-language parser (Indonesian) for common commands. Returns { script, source: 'local' }
// or null when any part is not understood, so the caller can fall back to the LLM server.
const NUM = '(\\d+(?:[.,]\\d+)?)';
const num = (s) => Number(String(s).replace(',', '.'));

// Each rule: regex on one lowercase clause -> DSL statement.
const RULES = [
  [new RegExp(`^(?:lepas landas|take ?off|terbang)(?: ke)?(?: ketinggian)?(?: ${NUM})?(?: ?(?:meter|m))?$`), (m) => `takeoff(${m[1] ? num(m[1]) : 5});`],
  [/^(?:mendarat|landing|land|turun ke tanah)$/, () => 'land();'],
  [/^(?:pulang|kembali(?: ke)?(?: home| titik awal| pangkalan)?|return home)$/, () => 'return_home();'],
  [new RegExp(`^(?:melayang|hover|diam)(?: ${NUM})?(?: ?(?:detik|s))?$`), (m) => `hover(${m[1] ? num(m[1]) : 3});`],
  [new RegExp(`^(naik|turun|maju|mundur|kiri|kanan)(?: ${NUM})?(?: ?(?:meter|m))?$`), (m) => `move(${m[1]}, ${m[2] ? num(m[2]) : 5});`],
  [new RegExp(`^putar(?: (kiri|kanan))?(?: ${NUM})?(?: derajat)?$`), (m) => `rotate(${m[1] === 'kiri' ? '-' : ''}${m[2] ? num(m[2]) : 90});`],
  [/^(?:foto|ambil foto|potret)$/, () => 'photo();'],
  [/^(?:rekam|mulai rekam|mulai merekam)$/, () => 'record("start");'],
  [/^(?:berhenti rekam|stop rekam|selesai rekam)$/, () => 'record("stop");'],
  [/^(?:semprot|mulai semprot)$/, () => 'spray("on");'],
  [/^(?:berhenti semprot|stop semprot)$/, () => 'spray("off");'],
  [/^(?:ambil paket|ambil barang|pickup)$/, () => 'pickup();'],
  [/^(?:lepas paket|jatuhkan paket|taruh paket|drop)$/, () => 'drop();'],
  [/^(?:tandai|tandai temuan)$/, () => 'mark();'],
];

export function parseNatural(text) {
  const clauses = String(text).toLowerCase().replace(/(\d),(\d)/g, '$1.$2').replace(/(?<!\d)\.|\.(?!\d)|!/g, ' ').split(/\s*(?:,|;|\blalu\b|\bkemudian\b|\blalu\s+di\b|\bdan\b)\s*/)
    .map((c) => c.trim().replace(/\s+/g, ' ')).filter(Boolean);
  if (!clauses.length) return null;
  const out = [];
  for (const c of clauses) {
    const rule = RULES.find(([re]) => re.test(c));
    if (!rule) return null;
    out.push(rule[1](rule[0].exec(c)));
  }
  return { script: out.join('\n'), warnings: [], source: 'local' };
}
