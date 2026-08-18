/* UI layer — dumb terminal over engine.js. Hotseat: both hands visible.
 * Full re-render after every action; interaction = click-to-act with
 * legal-target highlighting (the pattern from docs/04, §7). */
'use strict';

const ART = '../../AlgomancyCards/';
let game = new Game(Math.floor(Math.random() * 1e6));
let ui = { carrying: null, columns: [], menu: null }; // builder state for attack/blocks

const $app = document.getElementById('app');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const art = name => ART + name.replace(/ /g, '-') + '.jpg';

function isCandidate(ref) {
  if (!game.pending) return false;
  return game.pending.candidates.some(c => JSON.stringify(c) === JSON.stringify(ref));
}

// ── rendering ─────────────────────────────────────────────────────────
function cardHtml(name, opts = {}) {
  const cls = ['card'];
  if (opts.playable) cls.push('playable');
  if (opts.candidate) cls.push('candidate');
  if (opts.selected) cls.push('selected');
  if (opts.carrying) cls.push('carrying');
  const badges = (opts.badges || []).map(b => `<span class="badge ${b.mod ? 'mod' : ''}">${esc(b.t || b)}</span>`).join('');
  return `<div class="${cls.join(' ')}" ${opts.data || ''} data-prev="${esc(name)}">
    <img src="${art(name)}" alt="${esc(name)}">
    ${badges ? `<div class="badges">${badges}</div>` : ''}
    ${opts.stats ? `<div class="stats">${opts.stats}</div>` : ''}
    ${opts.dmg ? `<div class="dmg">${opts.dmg}</div>` : ''}
  </div>`;
}

function unitHtml(u, opts = {}) {
  const [p, t] = game.effStats(u);
  const badges = [...game.ownAttrs(u)].map(a => ({ t: a }));
  for (const m of u.mods) badges.push({ t: '+' + m.split(' ')[0], mod: true });
  return cardHtml(u.name, {
    stats: `${p}/${t}`, dmg: u.damage ? `−${u.damage}` : '', badges,
    candidate: isCandidate({ unit: u.id }),
    selected: opts.selected, carrying: ui.carrying === u.id,
    playable: opts.clickable,
    data: `data-act="unit" data-id="${u.id}"`,
  });
}

function resHtml(r, p, i) {
  const canact = game.phase === 'planning' && !game.planningDone[p] && r.state === 'dormant' && game.players[p].activationsLeft > 0;
  return `<span class="res ${r.kind} ${r.state} ${canact ? 'canact' : ''}" title="${r.kind} (${r.state})"
    data-act="res" data-p="${p}" data-i="${i}"></span>`;
}

function playerHtml(p) {
  const pl = game.players[p];
  const acting = game.canActNow(p);
  const inBattleFormation = new Set();
  if (game.battle) {
    for (const col of game.battle.columns) col.forEach(id => inBattleFormation.add(id));
    for (const col of Object.values(game.battle.blocks)) col.forEach(id => inBattleFormation.add(id));
  }
  const units = game.unitsOf(p).filter(u => !inBattleFormation.has(u.id));
  const tokens = game.tokensOf(p);
  const handCards = pl.hand.map((n, i) => {
    const playable = game.canPlayFromHand(p, i) || game.canAugment(p, 'hand', i);
    return cardHtml(n, { playable, data: `data-act="hand" data-p="${p}" data-i="${i}"` });
  }).join('');
  const binItems = pl.bin.map((n, i) => {
    const aug = game.canAugment(p, 'bin', i);
    return `<span class="badge ${aug ? 'mod' : ''}" style="cursor:${aug ? 'pointer' : 'default'}"
      data-act="bin" data-p="${p}" data-i="${i}" data-prev="${esc(n)}">${esc(n)}</span>`;
  }).join(' ');
  const canDeclareHere = game.battle && game.battle.step === 'declare' && game.battle.attacker === p;
  return `<div class="player ${acting ? '' : 'inactive'}">
    <div class="pheader">
      <span class="pname">${esc(pl.name)}${game.initiative === p ? ' ⭐' : ''}</span>
      <span class="life ${isCandidate({ player: p }) ? 'candidate' : ''}" data-act="player" data-p="${p}">♥ ${pl.life}</span>
      <span class="resrow">${pl.resources.map((r, i) => resHtml(r, p, i)).join('')}
        <span style="color:var(--dim)">(${game.openMana(p)} mana open${game.phase === 'planning' ? `, ${pl.activationsLeft} activations` : ''})</span>
      </span>
      <span class="binline">deck ${game.deck.length} · bin ${pl.bin.length}</span>
    </div>
    <div class="zonelabel">In play</div>
    <div class="zone">${units.map(u => unitHtml(u, { clickable: canDeclareHere })).join('')
      }${tokens.map(t => cardHtml(t.name, {
        stats: 'X=' + t.x, playable: canCastToken(p, t), data: `data-act="token" data-id="${t.id}"`,
      })).join('') || ''}</div>
    <div class="zonelabel">Hand (${pl.hand.length})</div>
    <div class="zone">${handCards}</div>
    ${pl.bin.length ? `<div class="zonelabel">Bin</div><div class="zone">${binItems}</div>` : ''}
  </div>`;
}

function canCastToken(p, t) {
  if (game.pending) return false;
  return (game.phase === 'battle' && p === game.priority && t.controller === p)
    || (game.phase === 'deploy' && p === game.deployPlayer && t.controller === p);
}

function battleHtml() {
  const b = game.battle;
  if (!b) return '';
  const A = game.players[b.attacker].name, D = game.players[b.defender].name;

  if (b.step === 'declare') {
    // attack builder: staged columns + one extra empty column
    const cols = ui.columns.map((col, ci) => colBuilderHtml(col, ci, b.attacker)).join('');
    const extra = colBuilderHtml([], ui.columns.length, b.attacker);
    return `<div class="battle"><h3>⚔ ${esc(A)} declares an attack — round ${game.battleRound}</h3>
      <div style="color:var(--dim);margin-bottom:6px">Click one of your units, then a slot. Front row first, 2 max per column.</div>
      <div class="cols">${cols}${extra}</div></div>`;
  }

  const attackCols = b.columns.map((col, ci) => {
    const blockers = b.blocks[ci] || [];
    const blockBuild = (b.step === 'blocks') ? blockBuilderHtml(ci) :
      blockers.map(id => game.entities[id] ? unitHtml(game.entities[id]) : '').join('');
    return `<div class="col"><div class="collabel">column ${ci + 1}</div>
      ${col.map(id => game.entities[id] ? unitHtml(game.entities[id]) : '').join('') || '<div class="slot">gone</div>'}
      <div class="vs" style="width:100%"></div>
      ${blockBuild || '<div class="slot">unblocked</div>'}
    </div>`;
  }).join('');
  const stepLabel = { attackWindow: 'response window (attack)', blocks: `${esc(D)} declares blocks`, blockWindow: 'response window (blocks)', afterWindow: 'after combat' }[b.step] || b.step;
  return `<div class="battle"><h3>⚔ ${esc(A)} attacks ${esc(D)} — ${stepLabel}</h3>
    <div class="cols">${attackCols}</div></div>`;
}

function colBuilderHtml(col, ci, owner) {
  const front = col[0] ? unitHtml(game.entities[col[0]], { selected: true }) :
    slotHtml(ci, 0, !!ui.carrying);
  const back = col[0] ? (col[1] ? unitHtml(game.entities[col[1]], { selected: true }) : slotHtml(ci, 1, !!ui.carrying)) : '';
  return `<div class="col"><div class="collabel">column ${ci + 1}</div>${front}${back}</div>`;
}
function slotHtml(ci, row, open) {
  return `<div class="slot ${open ? 'open' : ''}" data-act="slot" data-ci="${ci}" data-row="${row}">${row === 0 ? 'front' : 'back'}</div>`;
}
function blockBuilderHtml(ci) {
  const col = ui.columns[ci] || [];
  const front = col[0] ? unitHtml(game.entities[col[0]], { selected: true }) : slotHtml(ci, 0, !!ui.carrying);
  const back = col[0] ? (col[1] ? unitHtml(game.entities[col[1]], { selected: true }) : slotHtml(ci, 1, !!ui.carrying)) : '';
  return front + back;
}

function promptHtml() {
  const g = game;
  if (g.phase === 'gameover')
    return `<div class="promptbar"><span class="who">${esc(g.players[g.winner].name)} wins!</span>
      <button data-btn="restart">New game</button></div>`;
  if (g.pending)
    return `<div class="promptbar pending"><span class="who">${esc(g.players[g.pending.player].name)}:</span>
      ${esc(g.pending.prompt)} — click a highlighted target</div>`;
  if (g.phase === 'planning') {
    const btns = [0, 1].map(p => g.planningDone[p]
      ? `<span style="color:var(--dim)">${esc(g.players[p].name)} ready ✓</span>`
      : `<button data-btn="doneplan" data-p="${p}">${esc(g.players[p].name)}: done planning</button>`).join(' ');
    return `<div class="promptbar"><span class="who">Planning</span>
      Click a hand card to recycle it into a resource; click dormant resources to activate (max 2). ${btns}</div>`;
  }
  if (g.phase === 'battle') {
    const b = g.battle;
    if (b.step === 'declare')
      return `<div class="promptbar"><span class="who">${esc(g.players[b.attacker].name)}:</span> build your attack
        <button class="primary" data-btn="confirmattack" ${ui.columns.some(c => c.length) ? '' : 'disabled'}>Attack!</button>
        <button data-btn="skipattack">Don't attack</button></div>`;
    if (b.step === 'blocks')
      return `<div class="promptbar"><span class="who">${esc(g.players[b.defender].name)}:</span> assign blockers (click unit, then slot)
        <button class="primary" data-btn="confirmblocks">Confirm blocks</button></div>`;
    return `<div class="promptbar"><span class="who">${esc(g.players[g.priority].name)}:</span>
      you have priority — play a battle card / cast a token / virus-augment, or
      <button class="primary" data-btn="pass">Pass</button>
      <span style="color:var(--dim)">(both pass: ${g.stack.length ? 'resolve top of stack' : 'next step'})</span></div>`;
  }
  if (g.phase === 'deploy')
    return `<div class="promptbar"><span class="who">${esc(g.players[g.deployPlayer].name)} deploying:</span>
      play cards, augment (hand or bin), cast tokens
      <button class="primary" data-btn="donedeploy">Done deploying</button></div>`;
  return `<div class="promptbar">${esc(g.phase)}</div>`;
}

function stackHtml() {
  const items = [...game.stack].reverse().map(it =>
    `<div class="stackitem ${it.negated ? 'negated' : ''} ${isCandidate({ stack: it.id }) ? 'candidate' : ''}"
      data-act="stackitem" data-id="${it.id}">
      ${esc(it.name)}${it.x ? ' ' + it.x : ''}
      <div class="by">${esc(game.players[it.controller].name)} · ${it.kind}${it.targets.length ? ' → ' + it.targets.map(tgtLabel).join(', ') : ''}</div>
    </div>`).join('');
  return `<div class="stackpanel"><h3>Stack (top first)</h3>${items || '<div class="stackempty">empty</div>'}</div>`;
}
function tgtLabel(t) {
  if (t.unit !== undefined) return esc(game.entities[t.unit]?.name || 'gone');
  if (t.player !== undefined) return esc(game.players[t.player].name);
  if (t.stack !== undefined) return esc(game.stack.find(i => i.id === t.stack)?.name || 'gone');
  return '?';
}

function render() {
  const logItems = game.log.slice(-60).map(l => `<div>${esc(l)}</div>`).join('');
  $app.innerHTML = `
    <div class="main">
      <div class="topbar">
        <span>Turn ${game.turn}</span>
        <span class="phase">${game.phase}${game.battle ? ' · round ' + game.battleRound : ''}</span>
        <span class="init">initiative: ${esc(game.players[game.initiative].name)} ⭐</span>
        <button data-btn="restart" style="margin-left:auto">New game</button>
      </div>
      ${promptHtml()}
      ${playerHtml(1)}
      ${battleHtml()}
      ${playerHtml(0)}
    </div>
    <div class="side">
      <div class="preview" id="preview"><div class="hint">hover a card to preview</div></div>
      ${stackHtml()}
      <div class="logpanel" id="log"><h3>Game log</h3>${logItems}</div>
    </div>
    ${menuHtml()}`;
  const log = document.getElementById('log');
  log.scrollTop = log.scrollHeight;
}

function menuHtml() {
  if (!ui.menu) return '';
  const m = ui.menu;
  const items = m.items.map((it, i) => `<button data-btn="menuitem" data-i="${i}">${esc(it.label)}</button>`).join('');
  return `<div class="menu" style="left:${m.x}px;top:${m.y}px">${items}<button data-btn="menuclose">cancel</button></div>`;
}

// ── interaction ───────────────────────────────────────────────────────
document.addEventListener('mouseover', e => {
  const t = e.target.closest('[data-prev]');
  if (!t) return;
  const prev = document.getElementById('preview');
  if (prev) {
    const name = t.dataset.prev;
    const c = CARDS[name];
    prev.innerHTML = `<img src="${art(name)}" alt=""><div class="hint">${c ? esc(c.text) : ''}</div>`;
  }
});

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-btn]');
  if (btn) { handleButton(btn, e); return; }
  const t = e.target.closest('[data-act]');
  if (!t) { ui.menu = null; render(); return; }
  handleAction(t, e);
});

function handleButton(btn, e) {
  const b = btn.dataset.btn;
  if (b === 'restart') { game = new Game(Math.floor(Math.random() * 1e6)); ui = { carrying: null, columns: [], menu: null }; }
  if (b === 'doneplan') game.donePlanning(+btn.dataset.p);
  if (b === 'pass') game.passPriority(game.priority);
  if (b === 'donedeploy') game.doneDeploying(game.deployPlayer);
  if (b === 'skipattack') { game.skipAttack(game.battle.attacker); ui.columns = []; ui.carrying = null; }
  if (b === 'confirmattack') {
    const cols = ui.columns.filter(c => c.length);
    if (cols.length && game.declareAttack(game.battle.attacker, cols)) { ui.columns = []; ui.carrying = null; }
  }
  if (b === 'confirmblocks') {
    const blocks = {};
    ui.columns.forEach((col, ci) => { if (col && col.length) blocks[ci] = col; });
    if (game.declareBlocks(game.battle.defender, blocks)) { ui.columns = []; ui.carrying = null; }
    else game.say('Illegal blocks (Flying needs a flyer; Evasive needs two blockers).');
  }
  if (b === 'menuitem') { const it = ui.menu.items[+btn.dataset.i]; ui.menu = null; it.go(); }
  if (b === 'menuclose') ui.menu = null;
  render();
}

function handleAction(t, e) {
  const act = t.dataset.act;
  const g = game;

  if (act === 'res') {
    const p = +t.dataset.p, i = +t.dataset.i;
    g.activateResource(p, i);
  }

  if (act === 'player' && isCandidate({ player: +t.dataset.p })) {
    g.clickTarget(g.pending.player, { player: +t.dataset.p });
  }

  if (act === 'stackitem' && isCandidate({ stack: +t.dataset.id })) {
    g.clickTarget(g.pending.player, { stack: +t.dataset.id });
  }

  if (act === 'token') {
    const tok = g.entities[+t.dataset.id];
    if (tok && canCastToken(tok.controller, tok)) g.castSpellToken(tok.controller, tok.id);
  }

  if (act === 'unit') {
    const id = +t.dataset.id;
    if (isCandidate({ unit: id })) { g.clickTarget(g.pending.player, { unit: id }); render(); return; }
    if (ui.augmenting) { // picking a host for an augment
      const { p, zone, i } = ui.augmenting;
      ui.augmenting = null;
      g.augment(p, zone, i, id);
      render(); return;
    }
    const b = g.battle;
    const u = g.entities[id];
    if (b && u && ((b.step === 'declare' && u.controller === b.attacker) || (b.step === 'blocks' && u.controller === b.defender))) {
      const placed = ui.columns.some(c => c.includes(id));
      if (placed) ui.columns = ui.columns.map(c => c.filter(x => x !== id)).filter((c, i2) => b.step === 'declare' ? c.length : true);
      else ui.carrying = (ui.carrying === id ? null : id);
    }
  }

  if (act === 'slot' && ui.carrying) {
    const ci = +t.dataset.ci, row = +t.dataset.row;
    const b = g.battle;
    if (b.step === 'blocks') { ui.columns[ci] = ui.columns[ci] || []; if (ui.columns[ci].length < 2) ui.columns[ci].push(ui.carrying); }
    else {
      if (!ui.columns[ci]) ui.columns[ci] = [];
      if (ui.columns[ci].length < 2) ui.columns[ci].push(ui.carrying);
    }
    ui.carrying = null;
  }

  if (act === 'hand') {
    const p = +t.dataset.p, i = +t.dataset.i;
    handleHandClick(p, i, e);
  }
  if (act === 'bin') {
    const p = +t.dataset.p, i = +t.dataset.i;
    if (g.canAugment(p, 'bin', i)) { ui.augmenting = { p, zone: 'bin', i }; g.say(`Pick a unit to augment with ${g.players[p].bin[i]}.`); }
  }
  render();
}

function handleHandClick(p, i, e) {
  const g = game;
  const name = g.players[p].hand[i];
  if (!name || g.pending) return;

  if (g.phase === 'planning' && !g.planningDone[p]) {
    // recycle for a resource — choose element
    ui.menu = {
      x: e.clientX, y: e.clientY,
      items: ['fire', 'water', 'earth', 'wood', 'metal'].map(el => ({
        label: `Recycle → ${el} resource`, go: () => { game.recycleForResource(p, i, el); render(); },
      })),
    };
    return;
  }

  const canPlay = g.canPlayFromHand(p, i);
  const canAug = g.canAugment(p, 'hand', i);
  if (canPlay && canAug) {
    ui.menu = {
      x: e.clientX, y: e.clientY,
      items: [
        { label: `Play ${name}`, go: () => { game.playCard(p, i); render(); } },
        { label: `Augment a unit with ${name}`, go: () => { ui.augmenting = { p, zone: 'hand', i }; game.say(`Pick a unit to augment with ${name}.`); render(); } },
      ],
    };
  } else if (canPlay) {
    g.playCard(p, i);
  } else if (canAug) {
    ui.augmenting = { p, zone: 'hand', i };
    g.say(`Pick a unit to augment with ${name}.`);
  }
}

// ?demo — jump into a scripted mid-battle: attack declared, a spell on the
// stack, response window open. Handy for seeing the interesting states fast.
function demoBattle() {
  const g = game = new Game(7);
  g.donePlanning(0); g.donePlanning(1);
  g.skipAttack(g.battle.attacker); g.skipAttack(g.battle.attacker);
  const A = g.initiative, D = 1 - A;
  const whale = g.spawnUnit(A, 'Good Whale');
  const sky = g.spawnUnit(A, 'Ephemeral Skywalker');
  g.spawnUnit(D, 'Rune Channeler');
  g.spawnUnit(D, 'Curio Drifter');
  for (let i = 0; i < 4; i++) g.players[A].resources.push({ kind: 'fire', state: 'open' });
  for (let i = 0; i < 5; i++) g.players[D].resources.push({ kind: 'water', state: 'open' });
  g.doneDeploying(g.deployPlayer); g.doneDeploying(g.deployPlayer);
  g.initiative = A;
  g.donePlanning(0); g.donePlanning(1);
  g.declareAttack(A, [[whale.id], [sky.id]]);
  g.passPriority(A);
  g.players[D].hand.push('Jelly');
  g.playCard(D, g.players[D].hand.length - 1);
  g.clickTarget(D, { unit: whale.id });     // Jelly targets the whale → on the stack
}

if (location.search.includes('demo')) demoBattle();
render();
