// Small governments often post jobs only as PDFs. This reads the text layer of ordinary PDFs with no dependency.
// It handles common fonts and ToUnicode maps. Scanned or unusual PDFs return '', and the app then asks you to paste the text.
import { inflateSync } from 'node:zlib';

function streams(buf) {
  const out = [];
  let at = 0;
  while ((at = buf.indexOf('stream', at)) >= 0) {
    if (buf.subarray(at - 3, at).toString('latin1') === 'end') { at += 6; continue; }
    let start = at + 6;
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;
    const end = buf.indexOf('endstream', start);
    if (end < 0) break;
    const dictStart = Math.max(0, buf.lastIndexOf('obj', at));
    const dict = buf.subarray(dictStart, at).toString('latin1');
    let data = buf.subarray(start, end);
    if (/FlateDecode/.test(dict)) {
      try { data = inflateSync(data); }
      catch { try { data = inflateSync(data, { finishFlush: 1 }); } catch { at = end + 9; continue; } }
    } else if (/\/Filter/.test(dict)) { at = end + 9; continue; }
    out.push({ dict, text: data.toString('latin1') });
    at = end + 9;
  }
  return out;
}

const hex = (h) => { const s = h.replace(/\s/g, ''); return s.length % 2 ? `${s}0` : s; };

function parseToUnicode(cmap) {
  const map = new Map();
  const toStr = (h) => String.fromCodePoint(...(hex(h).match(/.{4}/g) ?? [hex(h)]).map((x) => parseInt(x, 16)).filter((c) => c > 0 && !(c >= 0xd800 && c <= 0xdfff)));
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F\s]+)>\s*<([0-9a-fA-F\s]*)>/g)) map.set(parseInt(hex(m[1]), 16), toStr(m[2]));
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16), dst = parseInt(m[3], 16);
      for (let c = lo; c <= hi && c - lo < 2000; c++) map.set(c, String.fromCodePoint(dst + c - lo));
    }
  }
  return map;
}

function unescapeLiteral(s) {
  return s.replace(/\\(\d{1,3}|[nrtbf()\\]|\r?\n)/g, (_, c) => {
    if (/^\d/.test(c)) return String.fromCharCode(parseInt(c, 8));
    return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[c] ?? '';
  });
}

function decodeHex(h, maps) {
  const clean = hex(h);
  for (const width of [4, 2]) {
    const codes = (clean.match(new RegExp(`.{${width}}`, 'g')) ?? []).map((x) => parseInt(x, 16));
    for (const map of maps) {
      const hits = codes.filter((c) => map.has(c)).length;
      if (codes.length && hits / codes.length > 0.8) return codes.map((c) => map.get(c) ?? '').join('');
    }
  }
  return '';
}

export function pdfToText(buf) {
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return '';
  const all = streams(buf);
  const maps = all.filter((s) => /beginbfchar|beginbfrange/.test(s.text)).map((s) => parseToUnicode(s.text));
  let out = '';
  for (const s of all) {
    if (!/\bBT\b/.test(s.text)) continue;
    // Word processors emit one fragment per run, so a new line starts only when the vertical position changes.
    let y = null;
    const re = /\[((?:[^\]\\]|\\.)*)\]\s*TJ|\(((?:[^()\\]|\\.|\((?:[^()\\]|\\.)*\))*)\)\s*(?:Tj|'|")|<([0-9a-fA-F\s]+)>\s*Tj|(-?[\d.]+)\s+(-?[\d.]+)\s+T[dD]\b|\bT\*|(?:-?[\d.]+\s+){4}(-?[\d.]+)\s+(-?[\d.]+)\s+Tm\b/g;
    let m;
    while ((m = re.exec(s.text))) {
      if (m[1] !== undefined) {
        for (const p of m[1].matchAll(/\(((?:[^()\\]|\\.)*)\)|<([0-9a-fA-F\s]+)>|(-?[\d.]+)/g)) {
          if (p[1] !== undefined) out += unescapeLiteral(p[1]);
          else if (p[2] !== undefined) out += decodeHex(p[2], maps);
          else if (+p[3] < -180) out += ' ';
        }
      } else if (m[2] !== undefined) out += unescapeLiteral(m[2]);
      else if (m[3] !== undefined) out += decodeHex(m[3], maps);
      else if (m[4] !== undefined) { if (Math.abs(+m[5]) > 0.01) out += '\n'; }
      else if (m[7] !== undefined) {
        if (y === null || Math.abs(+m[7] - y) > 1) out += '\n';
        y = +m[7];
      } else out += '\n';
    }
    out += '\n\n';
  }
  const text = out.replace(/[^\S\n]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  // Undecodable fonts produce symbols instead of words, and bad text must not reach an evaluation.
  const words = text.match(/[A-Za-z]{3,}/g) ?? [];
  return words.length >= 30 && words.join('').length / text.length > 0.45 ? text : '';
}
