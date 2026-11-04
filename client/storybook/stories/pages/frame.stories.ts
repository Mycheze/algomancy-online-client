/* The app frame (ui/pages/frame.ts): the toolbar and the bottom bar every page
 * after the home is drawn in, around a stand-in page. */
import { frameHtml, toolsHtml, TOOL_NAMES, type FrameProps } from '../../../ui/pages/frame.ts';
import { segmented } from '../../../ui/components/segmented.ts';
import { CHROME, page } from './_page.ts';

const TABS = segmented({ ariaLabel: 'Tabs', options: [
  { label: 'First tab', value: 'a', on: true }, { label: 'Second', value: 'b', on: false }, { label: 'Third', value: 'c', on: false }] });
const LIST = `<div class="framebar"><input class="dksearch" placeholder="find something"><span class="framespacer"></span>${
  segmented({ size: 'sm', ariaLabel: 'Sort', options: [{ label: 'newest', value: 'n', on: true }, { label: 'name', value: 'm', on: false }] })}</div>
  <div class="framelist" data-scroll="story">${Array.from({ length: 40 }, (_, i) => `<div style="padding:12px 16px;border-top:1px solid var(--color-border)">Row ${i + 1}</div>`).join('')}</div>
  <p class="framenote">A line under the list.</p>`;

const base: FrameProps = { page: 'storypage', title: 'A page', back: { dataBtn: 'story-close', label: 'Home' }, chrome: CHROME, mainHtml: LIST, fill: true };

export default {
  title: 'Pages/Frame',
  render: (p: FrameProps) => page(frameHtml(p)),
  args: base,
};

/** a list page: filters fixed, the list scrolling inside its surface */
export const ListPage = { name: 'A list page' };
/** tabs in the toolbar's centre, as the metagame's */
export const WithTabs = { name: 'Tabs in the toolbar', args: { ...base, centerHtml: TABS } };
/** a page that goes back somewhere other than home */
export const BackToSomewhere = { name: 'Back to the deck', args: { ...base, back: { dataBtn: 'x', label: 'Deck', icon: 'back' } } };
/** the page's own tools before the shared ones */
export const PageTools = { name: 'With a page tool', args: { ...base, toolsHtml: '<button class="primary">Copy</button>' } };
export const SignedOut = { name: 'Signed out (no bell)', args: { ...base, chrome: { signedIn: false, alerts: 0 } } };
/** the shared tools alone, as the home draws all five */
export const AllTools = { name: 'The shared tools', render: () => `<div style="display:flex">${toolsHtml(CHROME, TOOL_NAMES)}</div>` };
