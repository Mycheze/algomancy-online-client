/* Every story is drawn on the site's own stylesheet — tokens, base, every
 * page's CSS — so a component looks here exactly as it will on a page: the
 * dark background, the 13px system-ui body, the EB Garamond title face
 * (ui/fonts/, through base.css's @font-face). `npm run css` builds it. */
import '../../ui/bundle.css';

/** @type {import('@storybook/html-vite').Preview} */
const preview = {
  parameters: {
    layout: 'padded',
    controls: { expanded: true },
    options: { storySort: { order: ['Foundations', 'Components'] } },
  },
};
export default preview;
