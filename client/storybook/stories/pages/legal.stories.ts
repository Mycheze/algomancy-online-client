/* The legal pages (ui/legal.ts legalPageHtml): About, AI disclosure, Privacy
 * and Terms as the sheet they open in, over a stand-in page. */
import { legalPageHtml } from '../../../ui/legal.ts';
import { overlay } from './_page.ts';

export default {
  title: 'Pages/Legal',
  render: (args: { page: string }) => overlay(`<div id="legalover">${legalPageHtml(args.page)}</div>`, 820),
  args: { page: 'about' },
};

export const About = {};
export const AiDisclosure = { name: 'AI disclosure', args: { page: 'ai' } };
export const Privacy = { args: { page: 'privacy' } };
export const Terms = { args: { page: 'terms' } };
