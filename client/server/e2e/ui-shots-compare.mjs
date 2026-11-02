/* Compare two ui-shots.mjs output directories.
 *
 *   node client/server/e2e/ui-shots-compare.mjs <before> <after> [<report dir>] [--fuzz N]
 *
 * --fuzz N (default 0 = exact): a pixel whose every channel is within ±N
 * counts as unchanged, and such files are reported apart from the identical
 * ones. Two runs of one build were 521/523 byte-identical; the other two were
 * ±2 on the edge columns of the card-stats table's 26px thumbnails (image
 * downscaling), which --fuzz 3 absorbs. A real change is far above that.
 *
 * Byte-identical PNGs pass. For every PNG that differs it writes
 * <report dir>/<name>.png: BEFORE | AFTER | the changed pixels (magenta on a
 * dimmed copy of AFTER), and lists it with the changed-pixel count and the
 * box they sit in. A file present on one side only is listed as added or
 * removed. <report dir>/index.html shows every difference as an image pair.
 * Default report dir: <after>/../<after's name>-diff.
 *
 * Exit 0 when nothing differs, 1 when something does, 2 on bad arguments.
 *
 * No dependencies: Chrome writes 8-bit, non-interlaced RGB or RGBA PNGs, and
 * node:zlib is enough to read and write those. Anything else (a PNG this
 * reader cannot decode) is still reported as differing, without a picture.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

// ── PNG in and out ─────────────────────────────────────────────────────

/** → { w, h, px: RGBA Buffer } or null when the format is not one Chrome writes */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  let off = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const kind = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (type !== 2 && type !== 6)) return null;
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const cur = Buffer.alloc(stride), prev = Buffer.alloc(stride);
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      px[o] = cur[x * bpp]; px[o + 1] = cur[x * bpp + 1]; px[o + 2] = cur[x * bpp + 2];
      px[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255;
    }
    cur.copy(prev);
  }
  return { w, h, px };
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = b => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (kind, data) => {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(kind, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
};
export function encodePng({ w, h, px }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

/** BEFORE | AFTER | changes, 8px gutters; sizes may differ */
function sideBySide(a, b, fuzz = 0) {
  const G = 8, w = a.w + b.w + Math.max(a.w, b.w) + 2 * G, h = Math.max(a.h, b.h);
  const px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { px[i * 4] = 255; px[i * 4 + 1] = 0; px[i * 4 + 2] = 255; px[i * 4 + 3] = 255; }
  const blit = (img, x0) => { for (let y = 0; y < img.h; y++) img.px.copy(px, (y * w + x0) * 4, y * img.w * 4, (y + 1) * img.w * 4); };
  blit(a, 0); blit(b, a.w + G);
  const x0 = a.w + b.w + 2 * G;
  let n = 0, x1 = Infinity, y1 = Infinity, x2 = -1, y2 = -1;
  for (let y = 0; y < Math.max(a.h, b.h); y++) {
    for (let x = 0; x < Math.max(a.w, b.w); x++) {
      const inA = x < a.w && y < a.h, inB = x < b.w && y < b.h;
      const ia = (y * a.w + x) * 4, ib = (y * b.w + x) * 4, o = (y * w + x0 + x) * 4;
      const same = inA && inB && (a.px.readUInt32BE(ia) === b.px.readUInt32BE(ib) || (fuzz > 0
        && Math.abs(a.px[ia] - b.px[ib]) <= fuzz && Math.abs(a.px[ia + 1] - b.px[ib + 1]) <= fuzz
        && Math.abs(a.px[ia + 2] - b.px[ib + 2]) <= fuzz && Math.abs(a.px[ia + 3] - b.px[ib + 3]) <= fuzz));
      if (same) {
        // the unchanged picture, dimmed to a third, so the magenta reads
        px[o] = b.px[ib] / 3; px[o + 1] = b.px[ib + 1] / 3; px[o + 2] = b.px[ib + 2] / 3; px[o + 3] = 255;
      } else {
        n++; x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y);
        px[o] = 255; px[o + 1] = 0; px[o + 2] = 255; px[o + 3] = 255;
      }
    }
  }
  return { png: encodePng({ w, h, px }), changed: n, box: n ? [x1, y1, x2 - x1 + 1, y2 - y1 + 1] : null };
}

// ── the comparison ─────────────────────────────────────────────────────

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function compareDirs(beforeDir, afterDir, reportDir, fuzz = 0) {
  const pngs = d => new Set(readdirSync(d).filter(f => f.endsWith('.png')));
  const A = pngs(beforeDir), B = pngs(afterDir);
  const all = [...new Set([...A, ...B])].sort();
  const rows = [];
  let same = 0, fuzzy = 0;
  for (const f of all) {
    if (!A.has(f)) { rows.push({ f, kind: 'added' }); continue; }
    if (!B.has(f)) { rows.push({ f, kind: 'removed' }); continue; }
    const a = readFileSync(join(beforeDir, f)), b = readFileSync(join(afterDir, f));
    if (a.equals(b)) { same++; continue; }
    const da = decodePng(a), db = decodePng(b);
    if (!da || !db) { rows.push({ f, kind: 'differs', note: 'not a PNG this reader decodes' }); continue; }
    const sbs = sideBySide(da, db, fuzz);
    if (sbs.changed === 0 && da.w === db.w && da.h === db.h) {
      // same pixels in a different encoding, or every channel within ±fuzz
      if (fuzz > 0 && sideBySide(da, db, 0).changed > 0) fuzzy++; else same++;
      continue;
    }
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, f), sbs.png);
    rows.push({ f, kind: 'differs', changed: sbs.changed, box: sbs.box, size: da.w !== db.w || da.h !== db.h ? `${da.w}x${da.h} → ${db.w}x${db.h}` : null });
  }
  return { total: all.length, same, fuzzy, rows };
}

function report(beforeDir, afterDir, reportDir, r) {
  mkdirSync(reportDir, { recursive: true });
  const rel = (from, to) => { const p = join(to); return 'file://' + p; };
  const body = r.rows.map(x => {
    const head = `<h2>${esc(x.f)} <small>${esc(x.kind)}${x.changed ? ` · ${x.changed} px changed in [x ${x.box[0]}, y ${x.box[1]}, ${x.box[2]}×${x.box[3]}]` : ''}${x.size ? ` · size ${esc(x.size)}` : ''}${x.note ? ` · ${esc(x.note)}` : ''}</small></h2>`;
    if (x.kind !== 'differs') {
      const src = x.kind === 'added' ? join(afterDir, x.f) : join(beforeDir, x.f);
      return `${head}<img src="${esc(rel(reportDir, src))}">`;
    }
    return `${head}<div class="pair"><figure><img src="${esc(rel(reportDir, join(beforeDir, x.f)))}"><figcaption>before</figcaption></figure>`
      + `<figure><img src="${esc(rel(reportDir, join(afterDir, x.f)))}"><figcaption>after</figcaption></figure></div>`
      + (existsSync(join(reportDir, x.f)) ? `<details><summary>changed pixels</summary><img src="${esc(x.f)}"></details>` : '');
  }).join('\n');
  writeFileSync(join(reportDir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>ui-shots diff</title>
<style>body{font:14px system-ui;background:#16181d;color:#ddd;margin:16px}h2{font-size:15px;margin:28px 0 8px}small{color:#999;font-weight:normal}
.pair{display:flex;gap:8px;align-items:flex-start}figure{margin:0;flex:1}img{max-width:100%;border:1px solid #444}figcaption{color:#999}</style>
<h1>${r.rows.length} of ${r.total} differ</h1><p>before: ${esc(beforeDir)}<br>after: ${esc(afterDir)}</p>${body}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const argv = process.argv.slice(2);
  const fi = argv.indexOf('--fuzz');
  const fuzz = fi >= 0 ? Number(argv.splice(fi, 2)[1]) : 0;
  const [b, a, d] = argv;
  if (!b || !a || !existsSync(b) || !existsSync(a)) {
    console.error('usage: node ui-shots-compare.mjs <before dir> <after dir> [<report dir>]');
    process.exit(2);
  }
  const before = resolve(b), after = resolve(a);
  const reportDir = resolve(d ?? join(dirname(after), `${basename(after)}-diff`));
  const r = compareDirs(before, after, reportDir, fuzz);
  for (const x of r.rows) {
    console.log(`✗ ${x.f}  ${x.kind}${x.changed ? `  ${x.changed}px in box ${x.box.join(',')}` : ''}${x.size ? `  size ${x.size}` : ''}${x.note ? `  ${x.note}` : ''}`);
  }
  console.log(`${r.same} identical${fuzz ? `, ${r.fuzzy} within ±${fuzz} per channel` : ''}, ${r.rows.length} differ (of ${r.total})`);
  if (r.rows.length) { report(before, after, reportDir, r); console.log(`side by side: ${reportDir}/index.html`); }
  process.exit(r.rows.length ? 1 : 0);
}
