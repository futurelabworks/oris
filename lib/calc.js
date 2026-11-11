// Calculator for the dock. A small recursive-descent parser: no eval, so pasted text can't run code.
// Supports + - * / % ^, brackets, unary minus, decimals, π/pi, e, and sqrt sin cos tan log ln abs (degrees for trig).

const FUNCS = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  ln: Math.log,
  log: Math.log10,
  sin: (d) => Math.sin((d * Math.PI) / 180),
  cos: (d) => Math.cos((d * Math.PI) / 180),
  tan: (d) => Math.tan((d * Math.PI) / 180),
};

function tokenize(src) {
  const out = [];
  const s = String(src).replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/,/g, '');
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const num = s.slice(i, j);
      if ((num.match(/\./g) || []).length > 1) throw new Error('Check the number ' + num);
      out.push({ t: 'num', v: parseFloat(num) });
      i = j;
      continue;
    }
    if (/[a-zπ]/i.test(c)) {
      let j = i;
      while (j < s.length && /[a-zπ]/i.test(s[j])) j++;
      const word = s.slice(i, j).toLowerCase();
      if (word === 'pi' || word === 'π') out.push({ t: 'num', v: Math.PI });
      else if (word === 'e') out.push({ t: 'num', v: Math.E });
      else if (FUNCS[word]) out.push({ t: 'fn', v: word });
      else throw new Error(`Unknown word “${word}”`);
      i = j;
      continue;
    }
    if ('+-*/%^()'.includes(c)) { out.push({ t: c }); i++; continue; }
    throw new Error(`Unexpected “${c}”`);
  }
  return out;
}

export function evaluate(src) {
  const toks = tokenize(src);
  if (!toks.length) throw new Error('Type a sum, for example 18% of 2400 as 2400*18%');
  let p = 0;
  const peek = () => toks[p];
  const take = (t) => { if (!peek() || peek().t !== t) throw new Error(t === ')' ? 'Close the bracket' : 'Check the sum'); p++; };

  function primary() {
    const tok = peek();
    if (!tok) throw new Error('The sum ends too early');
    if (tok.t === 'num') { p++; return postfix(tok.v); }
    if (tok.t === 'fn') {
      p++;
      take('(');
      const v = expr();
      take(')');
      return postfix(FUNCS[tok.v](v));
    }
    if (tok.t === '(') { p++; const v = expr(); take(')'); return postfix(v); }
    if (tok.t === '-') { p++; return -power(); }
    if (tok.t === '+') { p++; return power(); }
    throw new Error('Check the sum');
  }
  // "18%" means 0.18
  function postfix(v) {
    while (peek() && peek().t === '%' && !(toks[p + 1] && (toks[p + 1].t === 'num' || toks[p + 1].t === '(' || toks[p + 1].t === 'fn'))) { p++; v /= 100; }
    return v;
  }
  function power() {
    const base = primary();
    if (peek() && peek().t === '^') { p++; return Math.pow(base, power()); }
    return base;
  }
  function term() {
    let v = power();
    while (peek() && ['*', '/', '%'].includes(peek().t)) {
      const op = toks[p++].t;
      const r = power();
      if (op === '*') v *= r;
      else if (op === '/') { if (r === 0) throw new Error('Can’t divide by zero'); v /= r; }
      else v %= r;
    }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = toks[p++].t;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  const result = expr();
  if (p < toks.length) throw new Error('Check the sum');
  if (!Number.isFinite(result)) throw new Error('That result is too large');
  return result;
}

export function formatResult(n) {
  const r = Math.round(n * 1e10) / 1e10;
  return Math.abs(r) >= 1e15 ? r.toExponential(6) : r.toLocaleString('en-IN', { maximumFractionDigits: 10 });
}
