// DSL parser, validator and compiler (pure JS). Grammar and limits: DRONELAB_SHARED.md section 3.
// Statements end with ';' and blocks use '{ }'. The 60-statement limit counts statements, not lines,
// so the one-line example from the spec still works.

export const MAX_STATEMENTS = 60;
export const LABELS = ['person', 'fire', 'smoke', 'landmark', 'dropzone', 'defect', 'building', 'obstacle', 'target'];
const DIRS = ['maju', 'mundur', 'kiri', 'kanan', 'naik', 'turun'];

// Argument kinds: [min, max] numbers, or an array of allowed words. `opt` marks an optional last argument.
const COMMANDS = {
  takeoff: [[1, 50]],
  land: [],
  hover: [[0.5, 60]],
  goto: [{ axis: 'x' }, { axis: 'z' }, { opt: [0, 50] }],
  move: [DIRS, [0.5, 100]],
  rotate: [[-720, 720]],
  look: [[-90, 30]],
  photo: [],
  record: [['start', 'stop']],
  spray: [['on', 'off']],
  pickup: [], drop: [], mark: [],
  return_home: [],
};

// ---- tokenizer ----
function tokenize(src) {
  const toks = [];
  let i = 0, line = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    const start = i;
    let m;
    if ((m = /^-?\d+(\.\d+)?/.exec(src.slice(i)))) { toks.push({ t: 'num', v: Number(m[0]), start, end: i + m[0].length, line }); i += m[0].length; continue; }
    if ((m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(src.slice(i)))) { toks.push({ t: 'id', v: m[0], start, end: i + m[0].length, line }); i += m[0].length; continue; }
    if (c === '"') {
      const e = src.indexOf('"', i + 1);
      if (e < 0 || src.slice(i, e).includes('\n')) return { error: { line, message: 'Tanda kutip (") tidak ditutup' } };
      toks.push({ t: 'str', v: src.slice(i + 1, e), start, end: e + 1, line }); i = e + 1; continue;
    }
    if ((m = /^(<=|>=|==|!=)/.exec(src.slice(i)))) { toks.push({ t: 'op', v: m[0], start, end: i + 2, line }); i += 2; continue; }
    if ('(){};,<>'.includes(c)) { toks.push({ t: 'p', v: c, start, end: i + 1, line }); i++; continue; }
    return { error: { line, message: `Karakter tidak dikenal: ${c}` } };
  }
  return { toks };
}

class SyntaxErr extends Error { constructor(line, message) { super(message); this.line = line; } }

// parse(src) -> { ok, ast, errors: [{ line, message }], count }
export function parse(src, { bounds = 100 } = {}) {
  const lex = tokenize(src);
  if (lex.error) return { ok: false, ast: [], errors: [lex.error], count: 0 };
  const toks = lex.toks;
  const errors = [];
  let p = 0, count = 0;
  const peek = () => toks[p];
  const lineNow = () => (toks[p] || toks[toks.length - 1] || { line: 1 }).line;
  const fail = (msg, line = lineNow()) => { throw new SyntaxErr(line, msg); };
  const semantic = (line, msg) => errors.push({ line, message: msg });
  const take = (t, v, what) => {
    const k = toks[p];
    if (!k || k.t !== t || (v !== undefined && k.v !== v)) fail(`Diharapkan ${what || v}${k ? `, ditemukan "${src.slice(k.start, k.end)}"` : ' di akhir skrip'}`, k ? k.line : lineNow());
    p++;
    return k;
  };

  function arg(spec, name, idx) {
    const k = peek();
    if (!k) fail('Argumen kurang di akhir skrip');
    if (Array.isArray(spec) && typeof spec[0] === 'string') { // word list
      const isWord = k.t === 'id' || k.t === 'str';
      if (!isWord || !spec.includes(k.v)) {
        semantic(k.line, `${name}: argumen ${idx + 1} harus salah satu dari ${spec.join(', ')}`);
      }
      p++;
      return k.v;
    }
    if (k.t !== 'num') fail(`${name}: argumen ${idx + 1} harus angka`, k.line);
    p++;
    return k.v;
  }
  function checkRange(name, v, [lo, hi], line) {
    if (v < lo || v > hi) semantic(line, `${name}: nilai ${v} di luar batas ${lo} sampai ${hi}`);
  }

  function call() {
    const id = take('id', undefined, 'nama perintah');
    const name = id.v;
    if (name === 'detect') fail('detect() hanya boleh dipakai di dalam kondisi if', id.line);
    if (!(name in COMMANDS)) fail(`Perintah tidak dikenal: ${name}`, id.line);
    take('p', '(', '"("');
    const specs = COMMANDS[name];
    const args = [];
    for (let i = 0; i < specs.length; i++) {
      let spec = specs[i];
      const optional = spec && spec.opt;
      if (optional) {
        if (peek() && peek().t === 'p' && peek().v === ',') { p++; spec = spec.opt; } else break;
      } else if (i > 0) take('p', ',', '","');
      const v = arg(spec, name, i);
      if (spec.axis) { // goto x, z must stay inside the map
        if (Math.abs(v) > bounds) semantic(id.line, `goto: ${spec.axis} = ${v} di luar batas peta (-${bounds} sampai ${bounds})`);
      } else if (typeof v === 'number') checkRange(name, v, spec, id.line);
      args.push(v);
    }
    const close = take('p', ')', '")" (jumlah argumen salah?)');
    take('p', ';', '";" setelah perintah');
    return { type: 'call', name, args, line: id.line, start: id.start, end: close.end };
  }

  function block() {
    take('p', '{', '"{"');
    const body = [];
    while (peek() && !(peek().t === 'p' && peek().v === '}')) body.push(statement());
    take('p', '}', '"}"');
    return body;
  }

  function cond() {
    const k = take('id', undefined, 'kondisi (detect atau battery)');
    if (k.v === 'detect') {
      take('p', '(', '"("');
      const s = take('str', undefined, 'label dalam tanda kutip');
      if (!LABELS.includes(s.v)) semantic(s.line, `detect: label "${s.v}" tidak dikenal (${LABELS.join(', ')})`);
      take('p', ')', '")"');
      return { kind: 'detect', label: s.v };
    }
    if (k.v === 'battery') {
      const op = peek();
      if (!op || !((op.t === 'op') || (op.t === 'p' && (op.v === '<' || op.v === '>')))) fail('battery harus diikuti pembanding (<, >, <=, >=, ==, !=)', k.line);
      p++;
      const n = take('num', undefined, 'angka');
      return { kind: 'battery', op: op.v, value: n.v };
    }
    return fail(`Kondisi tidak dikenal: ${k.v} (hanya detect("...") dan battery < 30)`, k.line);
  }

  function statement() {
    const k = peek();
    if (!k) fail('Skrip berakhir tiba-tiba');
    if (++count > MAX_STATEMENTS) fail(`Skrip maksimal ${MAX_STATEMENTS} pernyataan`, k.line);
    if (k.t === 'id' && k.v === 'repeat') {
      p++;
      take('p', '(', '"("');
      const n = take('num', undefined, 'jumlah ulangan');
      if (!Number.isInteger(n.v) || n.v < 1 || n.v > 20) semantic(n.line, 'repeat: n harus bilangan bulat 1 sampai 20');
      const close = take('p', ')', '")"');
      const body = block();
      return { type: 'repeat', n: n.v, body, line: k.line, start: k.start, end: close.end };
    }
    if (k.t === 'id' && k.v === 'if') {
      p++;
      take('p', '(', '"("');
      const c = cond();
      const close = take('p', ')', '")"');
      const then = block();
      let otherwise = null;
      if (peek() && peek().t === 'id' && peek().v === 'else') { p++; otherwise = block(); }
      return { type: 'if', cond: c, then, else: otherwise, line: k.line, start: k.start, end: close.end };
    }
    return call();
  }

  const ast = [];
  try {
    while (p < toks.length) ast.push(statement());
  } catch (e) {
    if (!(e instanceof SyntaxErr)) throw e;
    errors.push({ line: e.line, message: e.message });
  }
  if (!errors.length && !ast.length) errors.push({ line: 1, message: 'Skrip kosong' });
  return { ok: errors.length === 0, ast, errors, count };
}

// Flatten the AST into a list of instructions with jumps, so the runtime can step through it.
// ops: cmd, rep (set counter), loop (decrement and jump back), if (jump to `else` when false), jmp.
export function compile(ast) {
  const prog = [];
  let counters = 0;
  (function emit(nodes) {
    for (const n of nodes) {
      if (n.type === 'call') prog.push({ op: 'cmd', node: n });
      else if (n.type === 'repeat') {
        const id = counters++;
        prog.push({ op: 'rep', id, n: n.n, node: n });
        const top = prog.length;
        emit(n.body);
        prog.push({ op: 'loop', id, to: top });
      } else {
        const ifi = { op: 'if', cond: n.cond, node: n, to: -1 };
        prog.push(ifi);
        emit(n.then);
        if (n.else) {
          const jmp = { op: 'jmp', to: -1 };
          prog.push(jmp);
          ifi.to = prog.length;
          emit(n.else);
          jmp.to = prog.length;
        } else ifi.to = prog.length;
      }
    }
  })(ast);
  return { prog, counters };
}

export const SAMPLE_SCRIPT = 'takeoff(5); goto(5,2); rotate(360); if (detect("target")) { hover(3); } land();';
