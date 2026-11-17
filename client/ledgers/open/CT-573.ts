import type { CardTicket } from '../tickets.ts';

export default {
  id: 573, area: "engine", severity: "major",
  cards: ["Spellbind", "Umbral Decay"],
  title: "a Modular card offers every card you can pay for; only a graft or an augment may be applied to it",
  detail: "Report #389, Nyar (judge L2): \"I was able to mod umbral decay to my Spellbind. It doesn't have a graft to be able to graft onto Spellbind. And also the Afflicting Attribute does not have an Augment so it also should not be able to be applied.\" A judge at level 2 outranks the owner (steward SKILL §5, \"Who outranks whom\"), and the owner has reversed his own call (2026-11-17): \"Modular should only offer grafts or augments as mods, not any card.\" CR 724.2 (effects.modular.any-card, U17) and attr.modular.anything (U20) state the opposite and rest on his 2026-08-23 call alone (\"I think it's legal to apply ANYTHING to a Modular card\"). The old triage closed #389 by-design on that call; do not repeat it.",
  evidence: "KYYD (Nyar v proud, constructed, 2026-11-13, replays 163/163): [130] Nyar plays Spellbind; [131]-[137] apply Fester, Fester, Oracle of the Flame and Umbral Decay as its Modular mods, Umbral Decay from the bin. Umbral Decay prints no graft and no augment (\"{Battle} {Afflicting} Blight Spell — Put two -1/-1 counters on target unit\"). 91-modular pins today's behaviour: \"CR 724.2: the {Modular} menu offers every card you can pay for\", \"CR 724.4b: an [Augment]-TEXT mod is accepted and does nothing\".",
  fix: "The Modular menu offers only cards that carry a graft or an augment the Modular card can take. Rewrite U17 effects.modular.any-card and U20 attr.modular.anything (and every record carrying the 2026-08-23 call: sweep per the CR README's comments step 3) on Nyar's call — sources.judge {quote, by: \"Nyar\", level: 2, adopted: \"2026-11-17\", from: \"report #389\"}, basis judge — dropping the owner entry it replaces; then cr:render, cr:check. Check 724.2a, 724.4b and 724.5 for what no longer holds. Flip 91-modular's pins and title the new guard with #389.",
  proof: null,
  verify: "Replay KYYD to [131]: Umbral Decay must not be offered as a Modular mod for Spellbind; Fester (a graft) still is. Whole-pool: every card the Modular menu offers has a graft or augment.",
  progress: "Filed 2026-11-17, reopening #389.",
} satisfies CardTicket;
