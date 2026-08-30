/* R216 — THE RUNNER SCREEN (docs/14 §3 and §5).
 *
 * The board is the ordinary board. This is the strip beside it that says what
 * the card is supposed to do and takes the owner's judgement.
 *
 * ── THE CONSTRAINT THAT SHAPES ALL OF IT ─────────────────────────────────
 *
 * docs/14 §5: **typing is never required to advance.** At 40 cards an hour
 * there are about ninety seconds per card, and a runner that asks for a
 * sentence before it will accept "works" is a runner that gets used twice.
 * So every one of the four buttons FILES IMMEDIATELY, carrying whatever
 * optional detail happens to be filled in. The detail box is closed by
 * default and nothing behind it is ever required.
 *
 * ── WHY THERE ARE FOUR BUTTONS ───────────────────────────────────────────
 *
 * `bad scenario` is the one people cut. Without it a wrong SETUP becomes a
 * card bug report and an agent spends a round chasing it — the failure
 * docs/13 §6 records three times over (#15, #104 and #106 were all
 * presentation problems misdiagnosed as rules problems). `slightly off` is the
 * other: right outcome, wrong amount / timing / wording / feel.
 *
 * ── WHAT THIS FILE DELIBERATELY DOES NOT DO ──────────────────────────────
 *
 * It never decides whether it is a scenario room. `NET.scenario` is set only
 * from a SERVER push, and the server only sends it for a room that was dealt
 * with a scenario id. No client-side flag, no query parameter and no
 * localStorage key can make this panel appear over a real game — which is the
 * same fail-closed shape as the admin route's 404 in server/main.ts.
 *
 * The clause list is not typed here either: it arrives derived from
 * `printed.json` (server/scenarios.ts `printedClauses`), per docs/13 §7.2's
 * standing rule. A hand-typed dropdown would keep the old wording forever
 * after an errata.
 */
import { esc } from './util.ts';

/** What the server pushes for a scenario room (server/main.ts scenarioInfo). */
export interface ScenarioInfo {
  id: string;
  card: string;
  why: string;
  expect: string;
  clauses: string[];
  verdicts: string[];
  needsLiveOpponent: boolean;
  opponentSeated: boolean;
  actionIndex: number;
  engine: string;
}

/** Human labels for the four verdicts. Keyed by the ids the SERVER validates
 * against, so a button that stopped matching would be refused rather than
 * silently filed as something else. */
const LABELS: Record<string, { icon: string; text: string; title: string }> = {
  'works': { icon: '✓', text: 'works', title: 'the card did what it prints' },
  'broken': { icon: '✗', text: 'broken', title: 'it did not' },
  'slightly-off': { icon: '≈', text: 'slightly off', title: 'right outcome, wrong amount / timing / wording / feel' },
  'bad-scenario': { icon: '⚠', text: 'bad scenario', title: 'the setup is wrong, or it could not be played at all' },
};

let info: ScenarioInfo | null = null;
/** open/closed state of the optional-detail box, and the drafts inside it.
 * Module state, not DOM state: a server push repaints this panel like
 * everything else, and a half-typed note must survive that (same reason
 * main.ts keeps `reportDraft` and `judgeDraft` outside the DOM). */
let detailOpen = false;
let noteDraft = '';
let rulingDraft = '';
let clauseDraft = '';
let busy = false;
/** the last thing that happened, shown in the panel rather than as a toast —
 * a verdict is a record, and the owner should be able to see that it landed
 * without watching for a four-second banner */
let status = '';

export function setScenario(next: ScenarioInfo | null): void {
  // a new scenario clears the drafts; the same one keeps them (every server
  // push carries the brief, and a push must not eat what is being typed)
  if (next && info && next.id !== info.id) {
    detailOpen = false; noteDraft = ''; rulingDraft = ''; clauseDraft = ''; status = '';
  }
  info = next;
}

/** The seat-1 line. docs/14 §4's ⚠ made visible: the expensive mistake is a
 * scenario that silently needs an opponent, because a hung game looks like a
 * bug. So the panel always says which of the two this is, rather than leaving
 * the owner to work it out from a board that will not move. */
function opponentLine(room: string): string {
  if (!info) return '';
  if (!info.needsLiveOpponent) {
    return `<div class="scnhint">Seat 1 is scripted: it passes and declines everything, and
      answers an unavoidable question with its first option. Nothing to open.</div>`;
  }
  if (info.opponentSeated) {
    return '<div class="scnhint scnok">Seat 1 is occupied — this scenario needs the real decisions it will make.</div>';
  }
  const href = `/?room=${encodeURIComponent(room)}&seat=1`;
  return `<div class="scnwarn"><b>This one needs a live opponent.</b>
    Open <a href="${href}" target="_blank" rel="noopener">seat 1 in another tab</a> before you play it —
    the scripted opponent is off for this scenario, so the board will not move on its own.</div>`;
}

/** The panel. Empty string for every ordinary room. */
export function panelHtml(room: string): string {
  if (!info) return '';
  const buttons = info.verdicts.map(v => {
    const l = LABELS[v] ?? { icon: '•', text: v, title: v };
    return `<button class="scnbtn scn-${v}" data-btn="scn-verdict" data-verdict="${esc(v)}"
      title="${esc(l.title)}" ${busy ? 'disabled' : ''}>${l.icon} ${esc(l.text)}</button>`;
  }).join('');
  // `expect` is written with real line breaks and is the field the whole
  // instrument turns on — it is what lets the owner tell "the card is wrong"
  // from "the setup is wrong". Rendered as lines, escaped, never as markup.
  const expect = esc(info.expect).split('\n').map(l => `<div>${l}</div>`).join('');
  const clauseOpts = ['<option value="">(which clause? — optional)</option>']
    .concat(info.clauses.map(c =>
      `<option value="${esc(c)}"${c === clauseDraft ? ' selected' : ''}>${esc(c)}</option>`))
    .join('');
  return `<div class="scnpanel">
    <div class="scnhead">🧪 Scenario · <b>${esc(info.card)}</b>
      <span class="scnid" title="${esc(info.why)}">${esc(info.id)}</span></div>
    <div class="scnexpect">${expect}</div>
    ${opponentLine(room)}
    <div class="scnbtns">${buttons}</div>
    <details class="scndetail"${detailOpen ? ' open' : ''}>
      <summary data-btn="scn-detail">add detail (optional — never required)</summary>
      ${info.clauses.length
        ? `<select id="scn-clause" title="which printed clause was off">${clauseOpts}</select>`
        : '<div class="hint">this card prints no rules text to pick a clause from</div>'}
      <textarea id="scn-note" rows="2" placeholder="what happened? (optional)"></textarea>
      <textarea id="scn-ruling" rows="2" placeholder="what SHOULD it do? (optional)"></textarea>
    </details>
    <div class="scnstamp">stamped with engine <code>${esc(info.engine.slice(0, 10))}</code>
      · room ${esc(room)} · action ${info.actionIndex}</div>
    ${status ? `<div class="scnstatus">${esc(status)}</div>` : ''}
  </div>`;
}

export interface RunnerCtx {
  room: string;
  seat: number | null;
  rerender: () => void;
}

/** Handle a `data-btn` that belongs to the runner. Returns true when it did.
 * Same contract as acct.handleButton / pg.handlePostGameButton in main.ts. */
export function handleButton(btn: HTMLElement, ctx: RunnerCtx): boolean {
  const b = btn.dataset['btn'];
  if (!b || !b.startsWith('scn-')) return false;
  if (!info) return true;
  if (b === 'scn-detail') {
    // <summary>'s own toggle already moved the <details>; this just remembers
    // it, so the next server push does not close the box mid-sentence
    detailOpen = !detailOpen;
    return true;
  }
  if (b === 'scn-verdict') {
    const verdict = btn.dataset['verdict'] ?? '';
    if (!verdict || busy) return true;
    file(verdict, ctx);
    return true;
  }
  return true;
}

function file(verdict: string, ctx: RunnerCtx): void {
  busy = true;
  status = `filing “${verdict}”…`;
  ctx.rerender();
  // Note what is NOT in this body: the scenario id, the engine SHA and the
  // action index. All three are read off the room by the server — a verdict
  // whose engine SHA came from the browser would be worth nothing the moment
  // anybody wanted to re-run it, which is the whole R200 lesson.
  fetch('/api/verdict', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      room: ctx.room, seat: ctx.seat, verdict,
      ...(clauseDraft ? { clause: clauseDraft } : {}),
      ...(noteDraft.trim() ? { note: noteDraft.trim() } : {}),
      ...(rulingDraft.trim() ? { ruling: rulingDraft.trim() } : {}),
    }),
  })
    .then(r => r.json())
    .then((r: { ok?: boolean; error?: string }) => {
      if (r.ok) {
        status = `recorded: ${verdict}${clauseDraft ? ' · clause noted' : ''}`;
        noteDraft = ''; rulingDraft = ''; clauseDraft = '';
        detailOpen = false;
      } else {
        status = `NOT recorded — ${r.error ?? 'the server refused it'}`;
      }
    })
    .catch(err => { status = `NOT recorded — ${String(err)}`; })
    .finally(() => { busy = false; ctx.rerender(); });
}

/**
 * Put the drafts and the listeners back after a repaint.
 *
 * Called from main.ts's `rewireInputs`, which exists because a server push
 * rebuilds these nodes: without this, an opponent's action landing mid-word
 * would swallow whatever was being typed. The optional boxes are held to the
 * SAME standard as the required ones for one reason — the moment a note is
 * lost to a repaint, the owner stops writing notes.
 */
export function rewire(): void {
  const clause = document.getElementById('scn-clause') as HTMLSelectElement | null;
  if (clause) {
    clause.value = clauseDraft;
    clause.addEventListener('change', () => { clauseDraft = clause.value; });
  }
  const note = document.getElementById('scn-note') as HTMLTextAreaElement | null;
  if (note) {
    note.value = noteDraft;
    note.addEventListener('input', () => { noteDraft = note.value; });
  }
  const ruling = document.getElementById('scn-ruling') as HTMLTextAreaElement | null;
  if (ruling) {
    ruling.value = rulingDraft;
    ruling.addEventListener('input', () => { rulingDraft = ruling.value; });
  }
}

// R193 / 147-comment-conformance §4: a `draftsForTest()` accessor stood here,
// exporting the note/ruling/clause drafts for a driver to inspect. Nothing
// called it — the CDP run that verified this panel reads the DOM instead — and
// a dead exported helper carries a doc comment describing machinery nobody
// uses, which reads exactly like a description of how the code works. Removed
// rather than wired up: if a driver ever wants the drafts, the boxes are in the
// DOM and that is the more honest thing to assert against anyway.

/**
 * Does this room need a second human? `null` for an ordinary room — the
 * question does not apply and the caller keeps its normal behaviour.
 *
 * main.ts asks before drawing its "waiting for your opponent" banner: on a
 * scripted-opponent scenario there is nobody to wait for, and that sentence
 * across the top of the board sends the owner looking for a tab he does not
 * need. Which is docs/14 §4's failure mode arriving by a different door.
 */
export function needsSecondTab(): boolean | null {
  return info ? info.needsLiveOpponent : null;
}
