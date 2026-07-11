/* board.js — renders a "What's the play?" board.
 *
 * Shared by the play page (index.html) and the editor's live preview
 * (editor.html), both fed by the same server-built payload (wtp.payload). One
 * renderer, one payload shape: what the designer sees while editing is exactly
 * what a player sees, because it IS the same code looking at the same data.
 *
 * Everything here is escaped and assembled locally — the payload is plain text
 * (card names, notes, roles), never markup. The solution is markdown and is
 * rendered by the host page, which already has marked + DOMPurify.
 *
 * Exposes: window.WtpBoard.render(el, puzzle, opts)
 *   opts.onZoom(src, name)  — called when a card is clicked (open a lightbox)
 *   opts.totals             — start with column totals shown
 * and window.WtpBoard.holdZoom(root) — middle-button hold to read a card.
 */
(function () {
  'use strict';

  const esc = s => String(s == null ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const titleCase = s => String(s || '').replace(/\b\w/g, c => c.toUpperCase());

  // Mirrors wtp.ROLE_TAG, so a unit is labelled the same on the board image the
  // bot posts and on the board the website draws.
  const ROLE_TAG = { attacking: 'ATK', blocking: 'BLK' };

  // Counters on a unit, drawn as the die you'd sit on it at the table (the
  // manual's own convention). Signed: +3 is three +1/+1 counters, -2 is two
  // -1/-1. It's one number because the rules make it one — "if both a +1/+1
  // counter and a -1/-1 counter are placed on a unit, the two cancel out and
  // will both be removed" — so a unit is never holding some of each.
  //
  // Deliberately NOT the same badge as a temporary buff: a counter is permanent,
  // and whether a 4/4 is still a 4/4 next turn can be the whole puzzle.
  function dieHtml(n) {
    if (!n) return '';
    const kind = n > 0 ? '+1/+1' : '-1/-1';
    return `<span class="ctr ${n > 0 ? 'up' : 'down'}"
      title="${Math.abs(n)} ${kind} counter${Math.abs(n) === 1 ? '' : 's'} — permanent"
      >${n > 0 ? '+' : '−'}${Math.abs(n)}</span>`;
  }

  const counterTip = n => !n ? ''
    : `${Math.abs(n)} ${n > 0 ? '+1/+1' : '-1/-1'} counter${Math.abs(n) === 1 ? '' : 's'}`;

  // A unit tile: art, plus every modifier that's been applied to it. The stat
  // strip shows the EFFECTIVE stats (printed + counters + buffs), because that's
  // the number you'd have to work out at the table and getting it wrong is the
  // whole reason this tool exists.
  function unitHtml(u) {
    const art = u.art_url
      ? `<img src="${esc(u.art_url)}" alt="${esc(u.card)}" loading="lazy">`
      : `<div class="noart">${esc(u.card)}<br><small>no card by that name</small></div>`;

    let stats = '';
    if (u.power != null) {
      // Bigger, smaller, or as printed — colour it so a changed unit is obviously
      // changed and nobody reads the printed stats off the art.
      const up = u.buff_p > 0 || u.buff_t > 0 || u.counters > 0;
      const down = u.buff_p < 0 || u.buff_t < 0 || u.counters < 0;
      const dir = up && !down ? 'up' : down && !up ? 'down' : up ? 'both' : '';
      const base = dir ? `<span class="base">(${esc(u.base)})</span>` : '';
      const dmg = u.damage ? `<span class="dmg">${u.damage} dmg</span>` : '';
      stats = `<div class="wstats"><b class="pt ${dir}">${u.power}/${u.toughness}</b>${base}${dmg}</div>`;
    }

    let bar = '';
    if (u.power != null && u.damage > 0 && u.toughness > 0) {
      const pct = Math.min(100, Math.round(100 * u.damage / u.toughness));
      bar = `<div class="dmgbar"><i style="width:${pct}%"></i></div>`;
    }

    const role = u.role
      ? `<span class="role ${esc(u.role)}" title="${esc(u.role)}">${esc(ROLE_TAG[u.role] || u.role)}</span>` : '';
    const modn = (u.mods && u.mods.length)
      ? `<span class="modn" title="${esc(u.mods.join(' + '))}">+${u.mods.length}</span>` : '';
    const note = u.note ? `<span class="unote">${esc(u.note)}</span>` : '';
    const cls = 'wu' + ((u.mods && u.mods.length) ? ' modded' : '');
    const tip = [u.card, counterTip(u.counters),
      u.mods && u.mods.length ? '+ ' + u.mods.join(' + ') : '', u.note]
      .filter(Boolean).join(' · ');

    // The badges stack down the right edge: the counters on the unit, then the
    // cards under it. Two different things, so they don't share a corner.
    const badges = (dieHtml(u.counters) || modn)
      ? `<div class="badges">${dieHtml(u.counters)}${modn}</div>` : '';

    return `<div class="${cls}" data-card="${esc(u.card)}" data-full="${esc(u.art_url || '')}" title="${esc(tip)}">
      ${art}${role}${badges}${note}${bar}${stats}</div>`;
  }

  // A face-up card in a hand or bin — same tile, no combat state.
  function cardHtml(c) {
    const art = c.art_url
      ? `<img src="${esc(c.art_url)}" alt="${esc(c.card)}" loading="lazy">`
      : `<div class="noart">${esc(c.card)}<br><small>no card by that name</small></div>`;
    return `<div class="wu" data-card="${esc(c.card)}" data-full="${esc(c.art_url || '')}"
      title="${esc(c.card)}">${art}</div>`;
  }

  const colPower = col => col.reduce((n, u) => n + (u.power || 0), 0);

  // One side's formation. `flip` is the opponent: their column reads back-row
  // first so the FRONT row lands at the bottom, nearest the middle — the way it
  // sits on the table facing you.
  function formationHtml(side, cols, flip) {
    if (!side.columns.length) {
      return `<div class="empty-note">${esc(side.name)} has no units in play.</div>`;
    }
    const cells = [];
    for (let i = 0; i < cols; i++) {
      const col = side.columns[i] || [];
      const units = flip ? col.slice().reverse() : col.slice();
      const sum = `<div class="colsum" title="combined power of this column">Σ ${colPower(col)}</div>`;
      // The total sits on the side facing the middle, next to the fight it feeds.
      const body = units.map(unitHtml).join('');
      cells.push(`<div class="col">${flip ? body + sum : sum + body}</div>`);
    }
    return `<div class="formation ${flip ? 'opp' : 'you'}" style="--cols:${cols}">${cells.join('')}</div>`;
  }

  // The numbers still belong on the bar even though the resource CARDS are on the
  // board now — you shouldn't have to count a row of art to find out how much
  // mana is open. Mana = the un-expended ones; affinity = every one that isn't
  // face down (an expended resource still counts towards a card's element
  // requirement, it just can't be spent again).
  function resHtml(side, icons) {
    const aff = side.affinity || {};
    const bits = Object.keys(aff).map(e => {
      const ic = icons && icons[e];
      const label = ic ? `<img src="${esc(ic)}" alt="${esc(e)}">` : esc(titleCase(e));
      return `<span class="res" title="${esc(e)} affinity — expended resources still count">${label}${aff[e]}</span>`;
    });
    if (!side.resources || !side.resources.length) {
      return '<span class="hidden-hand">no resources</span>';
    }
    return `<span class="mana" title="mana open right now (un-expended resources)">${side.mana} mana</span>` + bits.join('');
  }

  function pbarHtml(side, icons) {
    return `<div class="pbar">
      <span class="pname">${esc(side.name)}</span>
      <span class="life">${side.life}<small> life</small></span>
      <span class="spacer"></span>${resHtml(side, icons)}
    </div>`;
  }

  // A resource card. Tapped sideways if it's been expended, face down if dormant.
  function resourceHtml(r) {
    const cls = 'rc' + (r.state === 'expended' ? ' tapped' : r.state === 'dormant' ? ' dormant' : '');
    const tip = r.state === 'expended' ? `${r.kind} — expended (still gives affinity, no mana)`
      : r.state === 'dormant' ? `${r.kind} — dormant (face down: no affinity, no mana)`
        : `${r.kind} — open (1 mana)`;
    return `<div class="${cls}" data-kind="${esc(r.kind)}" data-state="${esc(r.state)}" title="${esc(tip)}">
      <img src="${esc(r.art_url || '')}" alt="${esc(r.card)}" loading="lazy">
      ${r.state === 'dormant' ? `<span class="rtag">${esc(r.kind[0].toUpperCase())}</span>` : ''}
    </div>`;
  }

  function resourceRow(side) {
    if (!side.resources || !side.resources.length) return '';
    return `<div class="zone"><div class="zlabel">RESOURCES</div>
      <div class="rzone">${side.resources.map(resourceHtml).join('')}</div></div>`;
  }

  function zoneHtml(label, cards) {
    if (!cards || !cards.length) return '';
    return `<div class="zone"><div class="zlabel">${esc(label)}</div>
      <div class="zrow">${cards.map(cardHtml).join('')}</div></div>`;
  }

  // The opponent's hand: what you can actually see of it — any cards the puzzle
  // says are face up, then the rest as backs.
  function handHtml(label, side) {
    const backs = side.hand_count
      ? `<div class="backs">${Array.from({ length: Math.min(side.hand_count, 12) },
          () => `<img src="${esc(side.cardback_url || '')}" alt="face-down card">`).join('')}</div>`
      : '';
    const faceUp = (side.hand || []).map(cardHtml).join('');
    if (!backs && !faceUp) return '';
    return `<div class="zone"><div class="zlabel">${esc(label)}</div>
      <div class="zrow">${faceUp}${backs}</div></div>`;
  }

  function boardHtml(p, opts) {
    const icons = opts.icons || {};
    const cols = Math.max(p.you.columns.length, p.opponent.columns.length, 1);
    const oppName = (p.opponent.name || 'Opponent').toUpperCase();
    return `<div class="wtp-board${opts.totals ? ' totals' : ''}"><div class="wtp-inner">
      <div class="wtp-main">
        ${handHtml(oppName + "'S HAND", p.opponent)}
        ${pbarHtml(p.opponent, icons)}
        ${resourceRow(p.opponent)}
        ${formationHtml(p.opponent, cols, true)}
        <div class="midline"><span>${esc(p.status || '')}</span></div>
        ${formationHtml(p.you, cols, false)}
        ${resourceRow(p.you)}
        ${pbarHtml(p.you, icons)}
        ${zoneHtml('YOUR HAND', p.you.hand)}
      </div>
      <div class="wtp-rail">
        ${zoneHtml(oppName + "'S BIN", p.opponent.bin)}
        ${zoneHtml('YOUR BIN', p.you.bin)}
      </div>
    </div></div>`;
  }

  // The status line is built here rather than shipped in the payload so the
  // editor's preview updates it live without a round trip... except it IS in the
  // payload (wtp.status_line) for the bot. Keep them in step: this mirrors it.
  function statusLine(p) {
    const turn = p.turn === 'you' ? 'Your turn' : `${p.opponent.name}'s turn`;
    const init = p.initiative === 'you'
      ? 'You have initiative' : `${p.opponent.name} has initiative`;
    return `${p.phase} phase · ${turn} · ${init}`;
  }

  function render(el, p, opts) {
    opts = opts || {};
    p = Object.assign({}, p);
    p.status = statusLine(p);
    el.innerHTML = boardHtml(p, opts);

    // Clicking a card opens the host's lightbox — the art is small on the board
    // and the puzzle often turns on a line of rules text you need to actually read.
    if (opts.onZoom) {
      el.querySelectorAll('.wu[data-full]').forEach(tile => {
        const full = tile.getAttribute('data-full');
        if (!full) return;
        tile.style.cursor = 'zoom-in';
        tile.addEventListener('click', () => opts.onZoom(full, tile.dataset.card));
      });
    }
    return el.querySelector('.wtp-board');
  }

  // ---- hold-to-read ----
  // The cards on the board are too small to read, and a puzzle usually turns on a
  // line of rules text. Hold the MIDDLE mouse button over any card — on the board,
  // in a hand, in the palette — and it comes up full size; let go and it's gone.
  // A hold rather than a click because reading a card isn't an edit: you don't
  // want it to select the card, arm a slot, or leave a dialog to dismiss.
  function holdZoom(root, opts) {
    opts = opts || {};
    root = root || document;
    let box = null;

    const close = () => { if (box) { box.remove(); box = null; } };

    function open(src, name) {
      close();
      box = document.createElement('div');
      box.className = 'holdzoom';
      box.innerHTML = `<figure><img src="${esc(src)}" alt="${esc(name || '')}">
        ${name ? `<figcaption>${esc(name)}</figcaption>` : ''}</figure>`;
      document.body.appendChild(box);
    }

    root.addEventListener('mousedown', e => {
      if (e.button !== 1) return;                       // middle button only
      const tile = e.target.closest('.wu, .rc, .rescard');
      if (!tile) return;
      const img = tile.querySelector('img');
      // data-full is the card's true art even when the tile is showing something
      // else (a dormant resource is drawn face down, but the designer holding the
      // button wants to see what it IS).
      const src = tile.getAttribute('data-full') || (img && img.getAttribute('src'));
      if (!src) return;
      // Middle-click is autoscroll in Chrome and paste on X11 — neither is what
      // "let me read this card" should do.
      e.preventDefault();
      open(src, tile.dataset.card || tile.dataset.name || tile.dataset.kind
        || (img && img.alt) || '');
    });

    // Release ANYWHERE puts it away — on the window, not the board, or letting go
    // past the edge of the card would leave you staring at art you can't dismiss.
    // Same for tabbing away mid-hold.
    window.addEventListener('mouseup', close);
    window.addEventListener('blur', close);
    root.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });

    return { close };
  }

  window.WtpBoard = { render, statusLine, boardHtml, holdZoom, dieHtml, counterTip };
})();
