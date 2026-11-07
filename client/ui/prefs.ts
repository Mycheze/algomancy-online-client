/* The player's own settings, in one place: the Settings tab of the profile
 * reads and writes them here (owner, 2026-11-07: "a settings tab for password
 * reset and other settings we're going to add (like accessible colors mode)").
 *
 * Every one of them lives in THIS BROWSER (localStorage), like the in-game ⋯
 * menu's toggles always have: the table reads algoAutopass, algoBluffHaste,
 * algoSound and algoMotion live on every decision, so writing the same keys
 * here is all it takes for a change on the Settings tab to reach the next game.
 * The key names and their defaults stay owned by the modules that read them
 * (audio.ts, anim.ts, main.ts); this module only adds the colours.
 *
 * The colours: `accessible` puts data-colors="accessible" on <html>, and
 * styles/tokens.css's one theme block does the rest (its comment has the
 * numbers). Applied at boot by initAccounts, before the first paint. */
import { setSoundOn, soundOn } from './audio.ts';
import { motionOn, setMotionOn } from './anim.ts';

export type ColourMode = 'standard' | 'accessible';
const COLOURS_KEY = 'algoColors';

export function colourMode(): ColourMode {
  try { return localStorage.getItem(COLOURS_KEY) === 'accessible' ? 'accessible' : 'standard'; } catch { return 'standard'; }
}

/** put the chosen palette on the page (the attribute tokens.css keys on) */
export function applyColourMode(doc: { documentElement?: { dataset?: DOMStringMap } } | undefined = globalThis.document): void {
  const ds = doc?.documentElement?.dataset;
  if (!ds) return;
  if (colourMode() === 'accessible') ds['colors'] = 'accessible';
  else delete ds['colors'];
}

export function setColourMode(m: ColourMode): void {
  try {
    if (m === 'accessible') localStorage.setItem(COLOURS_KEY, 'accessible');
    else localStorage.removeItem(COLOURS_KEY);
  } catch { /* storage off: this page still changes */ }
  applyColourMode();
}

/** the table's two pass preferences, as main.ts reads them */
const flag = (key: string): boolean => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const setFlag = (key: string, on: boolean): void => { try { localStorage.setItem(key, on ? '1' : ''); } catch { /* off */ } };

export interface Prefs {
  colours: ColourMode;
  sound: boolean;
  motion: boolean;
  autoPass: boolean;
  bluffHaste: boolean;
}

export function readPrefs(): Prefs {
  return {
    colours: colourMode(), sound: soundOn(), motion: motionOn(),
    autoPass: flag('algoAutopass'), bluffHaste: flag('algoBluffHaste'),
  };
}

export type PrefName = keyof Prefs;
export const isPrefName = (n: unknown): n is PrefName =>
  n === 'colours' || n === 'sound' || n === 'motion' || n === 'autoPass' || n === 'bluffHaste';

/** set one setting from the Settings tab's buttons (value is the button's data-v) */
export function setPref(name: PrefName, value: string): void {
  const on = value === 'on';
  if (name === 'colours') setColourMode(value === 'accessible' ? 'accessible' : 'standard');
  else if (name === 'sound') setSoundOn(on);
  else if (name === 'motion') setMotionOn(on);
  else if (name === 'autoPass') setFlag('algoAutopass', on);
  else setFlag('algoBluffHaste', on);
}
