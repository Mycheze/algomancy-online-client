/* Storybook's config. Plain JS on purpose: a .ts here would need a tsconfig,
 * and engine/test/153 requires every tsconfig to be in the gate, which must
 * never wait on Storybook.
 *
 * The previews use the site's REAL stylesheet: ui/bundle.css, the pieces under
 * ui/styles/ concatenated exactly as the build writes them for the browser
 * (`npm run css` makes it before Storybook starts). While the dev server runs,
 * the plugin below rewrites it whenever a piece changes, so editing
 * ui/styles/components/button.css repaints the button story. */
import { writeFileSync } from 'node:fs';
import { sep } from 'node:path';

import { BUNDLE_CSS, REPO_ROOT, STYLES_DIR } from '../../engine/scripts/paths.mjs';
import { concatStyles } from '../../ui/scripts/styles.mjs';

/** keep ui/bundle.css in step with ui/styles/ while `storybook dev` runs */
const liveStyles = () => ({
  name: 'algomancy-live-styles',
  configureServer(server) {
    server.watcher.add(STYLES_DIR);
    server.watcher.on('change', (file) => {
      if (!file.startsWith(STYLES_DIR + sep) || !file.endsWith('.css')) return;
      try { writeFileSync(BUNDLE_CSS, concatStyles()); } catch (err) { console.error('bundle.css not rebuilt:', err); }
    });
  },
});

/** @type {import('@storybook/html-vite').StorybookConfig} */
const config = {
  stories: ['../stories/**/*.stories.ts'],
  framework: { name: '@storybook/html-vite', options: {} },
  core: { disableTelemetry: true },
  async viteFinal(vite) {
    vite.plugins = [...(vite.plugins ?? []), liveStyles()];
    // the stories import ../../ui/components and the preview ../../ui/bundle.css:
    // both outside this package, inside the repo
    vite.server = { ...vite.server, fs: { ...vite.server?.fs, allow: [...(vite.server?.fs?.allow ?? []), REPO_ROOT] } };
    return vite;
  },
};
export default config;
