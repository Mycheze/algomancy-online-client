/* Learn to Play's menu (ui/pages/learn.ts), drawn from made-up progress. The
 * menu is a layer with its own scrim; the frame keeps it inside the story. */
import { learnMenuHtml, learnMenuView } from '../../../ui/pages/learn.ts';
import type { LearnProgress } from '../../../ui/learn.ts';
import type { LearnElement } from '../../../ui/lessondeck.ts';
import { frame } from '../_helpers.ts';

const saved = (element: LearnElement, seen: string[]): LearnProgress =>
  ({ v: 1, element, seen, game: {} } as unknown as LearnProgress);

export default {
  title: 'Pages/Learn to Play',
  render: (args: { progress: LearnProgress | null; el: LearnElement; armed?: string }) =>
    frame(learnMenuHtml(learnMenuView(args.progress, args.el, args.armed ?? null)), 640),
  args: { progress: null, el: 'fire' },
};

export const FirstVisit = {};
export const SavedGame = { name: 'A game to continue', args: { progress: saved('water', ['welcome']), el: 'water' } };
export const OtherElement = { name: 'Saved game, another element picked', args: { progress: saved('water', []), el: 'earth' } };
export const StartOverArmed = { name: 'Start over, pressed once', args: { progress: saved('water', ['welcome']), el: 'water', armed: 'fresh' } };
export const OtherElementArmed = { name: 'Another element, Start pressed once', args: { progress: saved('water', []), el: 'earth', armed: 'start' } };
