/* Generate data/comprehensive-rules/sources/printed-pages.json: the text of
 * every BOOK page of the two printed rules documents, so the comprehensive-
 * rules export can quote "Manual p.23" and have a script check the quote.
 *
 * Run by hand, once per new PDF:   node engine/scripts/cr/extract-printed-pages.mjs
 * It needs `pdftotext` / `pdfinfo` (poppler-utils). Nothing on a request path
 * or in the gate runs it: the gate reads the committed JSON.
 *
 * THE MANUAL IS NOT ONE PAGE PER SHEET. Sheets 2–22 of Algomancy-Manual.pdf
 * are two-page spreads (1150.87 × 583.94 pt), and a spread is laid out in
 * three or four columns, so reading a whole sheet line by line interleaves
 * the left page with the right. Each spread is therefore cropped at its
 * midline (`pdftotext -x -y -W -H`) and each half read in pdftotext's
 * reading-order mode, which de-columns within the half. Sheet 1 (the cover)
 * and sheet 23 (the back cover) are single pages.
 *
 * PAGE NUMBERS ARE READ, NOT ASSUMED. Sheet n carries book pages 2n−2 (left)
 * and 2n−1 (right); every half whose footer prints a number is checked
 * against that, and a mismatch aborts the run. (Pages 2 and 4 print no
 * footer; the cover is p.1 and the back cover p.44 by position.)
 *
 * The 2023 Rulebook is one page per sheet with no printed numbers, so its
 * page is the sheet index. */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { CR_PRINTED_PAGES, MANUAL_PDF, REPO_ROOT, RULEBOOK_PDF } from '../paths.mjs';

/** the footer band: page numbers sit at y ≈ 549 on a 584-pt-high sheet */
const FOOTER_Y = 535;

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20 });

/** [width, height] of every sheet, in points */
function sheetSizes(pdf) {
  const out = run('pdfinfo', ['-f', '1', '-l', '999', pdf]);
  return [...out.matchAll(/^Page\s+(\d+)\s+size:\s+([\d.]+) x ([\d.]+)/gm)]
    .map(m => [Number(m[2]), Number(m[3])]);
}

/** pdftotext of one sheet, optionally cropped to [x, w]; reading-order mode */
function textOf(pdf, sheet, box) {
  const args = ['-f', String(sheet), '-l', String(sheet), '-enc', 'UTF-8'];
  if (box) args.push('-x', String(Math.floor(box.x)), '-y', '0', '-W', String(Math.ceil(box.w)), '-H', String(Math.ceil(box.h)));
  args.push(pdf, '-');
  return run('pdftotext', args)
    .replace(/[\f\x00-\x08\x0b\x0e-\x1f]/g, '')
    .split('\n').map(l => l.replace(/\s+$/, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    // a drop cap is read as its own word and the line breaks after it:
    // "Q: D\n oes Prickly…" / "1. T\n he IT…" — rejoin it
    .replace(/\b([A-Z])\n (?=[a-z])/g, '$1')
    .trim();
}

/** the page numbers printed in a sheet's footer band, with their x */
function footers(pdf, sheet) {
  const html = run('pdftotext', ['-f', String(sheet), '-l', String(sheet), '-bbox', pdf, '-']);
  const out = [];
  for (const m of html.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>([^<]*)<\/word>/g)) {
    if (Number(m[2]) > FOOTER_Y && /^\d{1,2}$/.test(m[3])) out.push({ x: Number(m[1]), n: Number(m[3]) });
  }
  return out;
}

function manualPages() {
  const pages = [];
  const sizes = sheetSizes(MANUAL_PDF);
  sizes.forEach(([w, h], i) => {
    const sheet = i + 1;
    const nums = footers(MANUAL_PDF, sheet);
    if (w < h * 1.5) {
      // a single page: the front cover or the back cover
      const page = sheet === 1 ? 1 : 2 * sheet - 2;
      pages.push({ doc: 'Manual', page, sheet, half: null, footer: nums[0]?.n ?? null, text: textOf(MANUAL_PDF, sheet) });
      return;
    }
    const mid = w / 2;
    for (const [half, x, page] of [['left', 0, 2 * sheet - 2], ['right', mid, 2 * sheet - 1]]) {
      const printed = nums.find(f => (half === 'left' ? f.x < mid : f.x >= mid));
      if (printed && printed.n !== page) {
        throw new Error(`Manual sheet ${sheet} ${half}: footer prints p.${printed.n}, expected p.${page}`);
      }
      pages.push({ doc: 'Manual', page, sheet, half, footer: printed?.n ?? null, text: textOf(MANUAL_PDF, sheet, { x, w: mid, h }) });
    }
  });
  return pages;
}

function rulebookPages() {
  return sheetSizes(RULEBOOK_PDF).map((_, i) => ({
    doc: 'Rulebook 2023', page: i + 1, sheet: i + 1, half: null, footer: null,
    text: textOf(RULEBOOK_PDF, i + 1),
  }));
}

const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const rel = p => relative(REPO_ROOT, p).split('\\').join('/');

/* A page with no text is either a crop gone wrong or a page that really is
 * all images. Only the second is acceptable, and it is checked by a different
 * route: `pdfimages -list` must find images on that sheet. Manual p.4 (the
 * left half of the components spread: four card photographs) is the one. */
const pages = [...manualPages(), ...rulebookPages()];
for (const p of pages.filter(q => !q.text)) {
  const pdf = p.doc === 'Manual' ? MANUAL_PDF : RULEBOOK_PDF;
  const images = run('pdfimages', ['-list', '-f', String(p.sheet), '-l', String(p.sheet), pdf])
    .split('\n').filter(l => /^\s*\d+\s+\d+\s+image\b/.test(l)).length;
  if (!images) throw new Error(`${p.doc} p.${p.page} read empty and its sheet has no images: a bad crop`);
  p.imageOnly = true;
}

const out = {
  _generated: '⚠ GENERATED by client/engine/scripts/cr/extract-printed-pages.mjs from the two PDFs '
    + 'below (pdftotext reading-order mode; each Manual spread cropped at its midline into two book '
    + 'pages). Never hand-edit; re-run the script when a PDF changes.',
  pdftotext: spawnSync('pdftotext', ['-v'], { encoding: 'utf8' }).stderr.split('\n')[0].trim(),
  sources: {
    Manual: { pdf: rel(MANUAL_PDF), sha256: sha256(MANUAL_PDF), pageRule: 'sheet n = book pp. 2n-2 (left) / 2n-1 (right); sheet 1 = p.1, last sheet = p.44; checked against every printed footer' },
    'Rulebook 2023': { pdf: rel(RULEBOOK_PDF), sha256: sha256(RULEBOOK_PDF), pageRule: 'page = sheet index (no printed numbers)' },
  },
  pages,
};
mkdirSync(dirname(CR_PRINTED_PAGES), { recursive: true });
writeFileSync(CR_PRINTED_PAGES, JSON.stringify(out, null, 1) + '\n');
console.log(`Wrote ${pages.length} pages (${pages.filter(p => p.doc === 'Manual').length} Manual, `
  + `${pages.filter(p => p.doc !== 'Manual').length} Rulebook) to ${rel(CR_PRINTED_PAGES)}`);
