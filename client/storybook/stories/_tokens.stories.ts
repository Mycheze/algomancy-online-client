/* Foundations: the design tokens (ui/styles/tokens.css), drawn from the live
 * stylesheet. The values are read off the page at render time, so this page
 * can never disagree with tokens.css: edit a token and it repaints here. */

const COLOURS = [
  'bg', 'surface-sunken', 'surface', 'surface-raised', 'surface-overlay', 'scrim', 'border', 'border-strong',
  'text', 'text-muted', 'text-on-accent', 'text-on-fill', 'accent', 'link', 'confirm', 'confirm-border', 'confirm-hover',
  'success', 'success-bg', 'warning', 'warning-bg', 'danger', 'danger-bg', 'info', 'info-bg',
].map(n => `--color-${n}`);
const TEXT = ['11', '12', '13', '14', '16', '22', '26'].map(n => `--text-${n}`);
const SPACE = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(n => `--space-${n}`);
const RADII = ['sm', 'md', 'lg', 'pill'].map(n => `--radius-${n}`);
const SHADOWS = ['1', '2', '3'].map(n => `--shadow-${n}`);

const value = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const code = (s: string): string => `<code style="font-family:var(--font-mono);font-size:var(--text-11);color:var(--color-text-muted)">${s}</code>`;
const grid = (cells: string[], min = 180): string =>
  `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(${min}px,1fr));gap:12px">${cells.join('')}</div>`;

export default { title: 'Foundations/Tokens' };

export const Colours = {
  render: () => grid(COLOURS.map(n => `<div><div style="height:44px;border-radius:var(--radius-md);border:1px solid var(--color-border);background:var(${n})"></div>
    <div style="margin-top:4px">${n.slice('--color-'.length)}</div>${code(value(n))}</div>`)),
};

export const Type = {
  render: () => TEXT.map(n => `<div style="font-size:var(${n});margin:0 0 8px">${n.slice(2)} · The quick brown fox ${code(value(n))}</div>`).join('')
    + `<div style="font-family:var(--font-display);font-size:var(--text-26);font-weight:700">Card Title · EB Garamond Bold</div>`,
};

export const Space = {
  render: () => SPACE.map(n => `<div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
    <div style="width:var(${n});height:16px;background:var(--color-accent)"></div>${n.slice(2)} ${code(value(n))}</div>`).join(''),
};

export const RadiiAndShadows = {
  name: 'Radii and shadows',
  render: () => grid([
    ...RADII.map(n => `<div><div style="height:56px;background:var(--color-surface-raised);border:1px solid var(--color-border);border-radius:var(${n})"></div>${n.slice(2)} ${code(value(n))}</div>`),
    ...SHADOWS.map(n => `<div><div style="height:56px;background:var(--color-surface);border-radius:var(--radius-md);box-shadow:var(${n})"></div>${n.slice(2)}</div>`),
  ]),
};
