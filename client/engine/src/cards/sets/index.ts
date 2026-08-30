/* Batch modules: each card-scripting batch lives in its own file so parallel
 * work never collides. Import order = registration order = deck order, so
 * APPEND new imports here, never reorder existing ones (replays depend on it). */
import './batch-attrs.ts';
import './batch-water-metal.ts';
import './batch-fire-wood.ts';
import './batch-fire-a.ts';
import './batch-fire-b.ts';
import './batch-water-a.ts';
import './batch-water-b.ts';
import './batch-earth-a.ts';
import './batch-earth-b.ts';
import './batch-earth-c.ts';
import './batch-hybrids-fwe.ts';
import './batch-wood-a.ts';
import './batch-wood-b.ts';
import './batch-wood-c.ts';
import './batch-metal-a.ts';
import './batch-metal-b.ts';
import './batch-metal-c.ts';
import './batch-hybrids-wm-a.ts';
import './batch-hybrids-wm-b.ts';
// ── Light & Dark expansion ──
import './batch-light-a.ts';
import './batch-light-b.ts';
import './batch-light-c.ts';
import './batch-dark-a.ts';
import './batch-dark-b.ts';
import './batch-dark-c.ts';
import './batch-hybrids-ld-a.ts';
import './batch-hybrids-ld-b.ts';
import './batch-hybrids-ld-c.ts';
