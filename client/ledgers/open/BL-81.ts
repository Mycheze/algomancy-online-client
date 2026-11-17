import type { BacklogTicket } from '../tickets.ts';

export default {
  id: 'BL-81',
  slug: 'cr-token-copy-wording',
  title: 'The comprehensive rules say plainly which copies are tokens, with Caleb\'s ruling as the source',
  area: 'engine',
  size: 'S',
  track: 'qol',
  said:
    'We just got a ruling from Caleb clarifying tokens. Our inferred rule is very close: 108.4b A token that '
    + 'an effect creates as a copy of a card is a token. The better wording might be `108.4b A copy of a card, '
    + 'which exists on the battlefield, that an effect creates as a copy of a card is a token.` '
    + '"Caleb Gannon — 1:58 AM: Yeah copies are tokens. I think hooba god shouldn\'t specify token, since thats '
    + 'implicit" I\'m confirming if he means ALL copies or just copies of cards that create new entities in play '
    + '(which would mean that becoming a copy of something and creating a copy of a spell may not be). '
    + 'I think our engine already does the right things, which is good. But this ruling can be tweaked to be '
    + 'clearer and more definitive.',
  means:
    'CR 108.4b (record concepts.cards.copies.token-copy in data/comprehensive-rules/rules/U03.json) reads '
    + '"A token that an effect creates as a copy of a card is a token." — circular: it assumes what it states. '
    + 'Rewrite it so a copy of a card that an effect creates on the battlefield is a token, add Caleb\'s line '
    + 'as relayed by the owner (report #419) to the record\'s sources.owner, re-verify and re-render through '
    + 'client/engine/scripts/cr/. Its siblings stay as their RAQ sources have them until Caleb answers the '
    + 'owner\'s follow-up: 108.4a "A copy of a spell is not a token." (RAQ 1355613076506017894#5, '
    + '1353864175910387742#5/#6) and 108.4c "A nontoken unit that becomes a copy of a token is still a '
    + 'nontoken unit." (RAQ 1372468222158180424#9). The example (Echo of Despair) is guarded by '
    + '393-raq-mods. Hooba-God prints "create a token that\'s a copy of me", the redundant word Caleb names; '
    + 'the printed text is unchanged, so no card edit.',
  doneWhen: [
    'The rendered comprehensive rules state 108.4b without circularity: a copy of a card an effect creates on the battlefield is a token',
    'Its record cites Caleb\'s ruling as relayed by the owner, and cr:check passes',
    'If Caleb answers that ALL copies are tokens, 108.4a and 108.4c are re-examined against the RAQ threads they cite, as a separate change',
  ],
  deps: [],
  touches: [
    'data/comprehensive-rules/rules/U03.json',
  ],
  notes: 'Filed from report #419 (2026-11-17, the owner). The engine is believed right for every copy kind; no engine change is asked.',
} satisfies BacklogTicket;
