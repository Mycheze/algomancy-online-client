import {
  bansHtml, cardsHtml, gameValuesHtml, modeHtml, poolLineHtml, type CustomRulesView,
} from '../../../ui/pages/customrules.ts';
import { RULES_BEGINNER, RULES_CARDS, RULES_STANDARD } from './_page.ts';

/* The custom rules' pieces (pages/customrules.ts), as the home's Draft tab and
 * its Game values sheet draw them. The whole tab is Pages/Home's stories. */
const pieces = (v: CustomRulesView): string => `<div class="homeplay" style="max-width:560px">
  <div class="homerows">
    <div class="homerow"><div class="homerowlabel">Mode</div><div class="homerowctl">${modeHtml(v)}</div></div>
    <div class="homerow"><div class="homerowlabel">Cards</div><div class="homerowctl">${cardsHtml(v)}</div></div>
    <div class="homerow"><div class="homerowlabel">Banned</div><div class="homerowctl">${bansHtml(v)}</div></div>
    ${poolLineHtml(v)}
  </div>
  <hr>
  ${gameValuesHtml(v)}
</div>`;

export default {
  title: 'Pages/Custom rules pieces',
  render: (v: CustomRulesView) => `<div class="homepage" style="padding:16px">${pieces(v)}</div>`,
  args: RULES_STANDARD,
};

export const Standard = {};
export const Beginner = { name: 'Beginner: the pool line, two values changed', args: RULES_BEGINNER };
export const BansAndFilter = { name: 'Two bans, the card filter open', args: RULES_CARDS };
export const Refused = {
  name: 'A pool the server would refuse',
  args: {
    ...RULES_BEGINNER, rules: { ...RULES_BEGINNER.rules, packSize: 15 }, active: { ...RULES_BEGINNER.rules, packSize: 15 },
    beginner: false, values: ['2 elements', 'Packs of 15'],
    pool: '<span class="crbad">✗ Fire + Wood leaves only 121 cards and these rules need 150. Try smaller packs, fewer cards dealt, or fewer restrictions.</span>',
  },
};
export const Typing = {
  name: 'Typing a ban',
  args: { ...RULES_STANDARD, banDraft: 'ign', suggestions: '<button data-btn="cr-ban" data-name="Ignis Sprite">Ignis Sprite</button>' },
};
