import { customRulesHtml, type CustomRulesView } from '../../../ui/pages/customrules.ts';
import type { CustomRules } from '../../../ui/customrules.ts';
import { RULES_STANDARD, STANDARD_RULES } from './_page.ts';

const STANDARD = STANDARD_RULES;

const BEGINNER = { ...STANDARD, elements: 2, packSize: 5, simpleOnly: true, bans: ['Overwhelm'] } as CustomRules;

export default {
  title: 'Pages/Custom rules panel',
  render: (v: CustomRulesView) => `<div style="max-width:380px" class="homecard">${customRulesHtml(v)}</div>`,
  args: RULES_STANDARD,
};

export const Closed = {};
export const OpenStandard = { name: 'Open, standard', args: { ...RULES_STANDARD, open: true } };
export const Beginner = {
  name: 'Beginner, a ban, the pool line',
  args: {
    ...RULES_STANDARD, open: true, active: BEGINNER, rules: BEGINNER,
    summary: ['2 elements', 'Packs of 5', 'Simple cards only', '1 ban'],
    pool: '<span class="crok">✓ 312 cards: enough for two players</span>',
  },
};
export const Refused = {
  name: 'A pool the server would refuse',
  args: {
    ...RULES_STANDARD, open: true, active: { ...BEGINNER, packSize: 15 }, rules: { ...BEGINNER, packSize: 15 },
    summary: ['2 elements', 'Packs of 15', 'Simple cards only'], advancedOpen: true,
    pool: '<span class="crbad">✗ too few cards for packs of 15</span>',
  },
};
export const Typing = {
  name: 'Typing a ban',
  args: { ...RULES_STANDARD, open: true, banDraft: 'ign', suggestions: '<button data-btn="cr-ban" data-name="Ignis Sprite">Ignis Sprite</button>' },
};
