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
