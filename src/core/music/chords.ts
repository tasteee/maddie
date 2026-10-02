import type { Key } from '../types';
import { clampPitch, pitchClass, pitchClassName } from './pitch';
import { SCALES } from './scale';

export type ChordFamily = 'triad' | 'power' | 'sus' | 'sixth' | 'seventh' | 'ninth' | 'eleventh' | 'thirteenth' | 'add' | 'omit';

export interface ChordType {
  id: string;
  /** Written after the root: `m7`, `sus4`, `add9`. Empty for a major triad. */
  symbol: string;
  name: string;
  /** Semitones above the root, low to high. */
  intervals: readonly number[];
  family: ChordFamily;
}

export const CHORD_FAMILIES: Array<{ id: ChordFamily; label: string }> = [
  { id: 'triad', label: 'Triads' },
  { id: 'power', label: 'Power' },
  { id: 'sus', label: 'Sus' },
  { id: 'sixth', label: '6ths' },
  { id: 'seventh', label: '7ths' },
  { id: 'ninth', label: '9ths' },
  { id: 'eleventh', label: '11ths' },
  { id: 'thirteenth', label: '13ths' },
  { id: 'add', label: 'Add' },
  { id: 'omit', label: 'No 3 / No 5' },
];

type Def = [symbol: string, name: string, intervals: number[]];

const DEFS: Record<Exclude<ChordFamily, 'omit'>, Def[]> = {
  triad: [
    ['', 'Major', [0, 4, 7]],
    ['m', 'Minor', [0, 3, 7]],
    ['°', 'Diminished', [0, 3, 6]],
    ['+', 'Augmented', [0, 4, 8]],
    ['(♭5)', 'Major flat five', [0, 4, 6]],
  ],
  power: [
    ['5', 'Power chord', [0, 7]],
    ['5(8)', 'Power chord + octave', [0, 7, 12]],
    ['♭5', 'Flat-five power chord', [0, 6]],
  ],
  sus: [
    ['sus2', 'Suspended 2nd', [0, 2, 7]],
    ['sus4', 'Suspended 4th', [0, 5, 7]],
    ['sus2sus4', 'Suspended 2nd + 4th', [0, 2, 5, 7]],
    ['7sus2', 'Dominant 7th sus2', [0, 2, 7, 10]],
    ['7sus4', 'Dominant 7th sus4', [0, 5, 7, 10]],
    ['maj7sus2', 'Major 7th sus2', [0, 2, 7, 11]],
    ['maj7sus4', 'Major 7th sus4', [0, 5, 7, 11]],
    ['9sus4', 'Dominant 9th sus4', [0, 5, 7, 10, 14]],
    ['maj9sus4', 'Major 9th sus4', [0, 5, 7, 11, 14]],
    ['7sus4♭9', 'Dominant 7th sus4 flat 9', [0, 5, 7, 10, 13]],
    ['13sus4', 'Dominant 13th sus4', [0, 5, 7, 10, 14, 21]],
    ['sus4(♭5)', 'Sus4 flat five', [0, 5, 6]],
    ['sus2(♭5)', 'Sus2 flat five', [0, 2, 6]],
  ],
  sixth: [
    ['6', 'Major 6th', [0, 4, 7, 9]],
    ['m6', 'Minor 6th', [0, 3, 7, 9]],
    ['m♭6', 'Minor flat 6th', [0, 3, 7, 8]],
    ['6/9', 'Six nine', [0, 4, 7, 9, 14]],
    ['m6/9', 'Minor six nine', [0, 3, 7, 9, 14]],
    ['6sus4', 'Sixth sus4', [0, 5, 7, 9]],
  ],
  seventh: [
    ['maj7', 'Major 7th', [0, 4, 7, 11]],
    ['7', 'Dominant 7th', [0, 4, 7, 10]],
    ['m7', 'Minor 7th', [0, 3, 7, 10]],
    ['m(maj7)', 'Minor major 7th', [0, 3, 7, 11]],
    ['ø7', 'Half-diminished 7th', [0, 3, 6, 10]],
    ['°7', 'Diminished 7th', [0, 3, 6, 9]],
    ['+7', 'Augmented 7th', [0, 4, 8, 10]],
    ['+maj7', 'Augmented major 7th', [0, 4, 8, 11]],
    ['7♭5', 'Dominant 7th flat five', [0, 4, 6, 10]],
    ['maj7♭5', 'Major 7th flat five', [0, 4, 6, 11]],
    ['°(maj7)', 'Diminished major 7th', [0, 3, 6, 11]],
  ],
  ninth: [
    ['maj9', 'Major 9th', [0, 4, 7, 11, 14]],
    ['9', 'Dominant 9th', [0, 4, 7, 10, 14]],
    ['m9', 'Minor 9th', [0, 3, 7, 10, 14]],
    ['m(maj9)', 'Minor major 9th', [0, 3, 7, 11, 14]],
    ['ø9', 'Half-diminished 9th', [0, 3, 6, 10, 14]],
    ['ø7♭9', 'Half-diminished flat 9', [0, 3, 6, 10, 13]],
    ['°9', 'Diminished 9th', [0, 3, 6, 9, 14]],
    ['7♭9', 'Dominant 7th flat 9', [0, 4, 7, 10, 13]],
    ['7♯9', 'Dominant 7th sharp 9', [0, 4, 7, 10, 15]],
    ['m7♭9', 'Minor 7th flat 9', [0, 3, 7, 10, 13]],
    ['+9', 'Augmented 9th', [0, 4, 8, 10, 14]],
    ['+maj9', 'Augmented major 9th', [0, 4, 8, 11, 14]],
    ['9♭5', 'Dominant 9th flat five', [0, 4, 6, 10, 14]],
    ['maj9♭5', 'Major 9th flat five', [0, 4, 6, 11, 14]],
  ],
  eleventh: [
    ['11', 'Dominant 11th', [0, 4, 7, 10, 14, 17]],
    ['m11', 'Minor 11th', [0, 3, 7, 10, 14, 17]],
    ['maj11', 'Major 11th', [0, 4, 7, 11, 14, 17]],
    ['m(maj11)', 'Minor major 11th', [0, 3, 7, 11, 14, 17]],
    ['ø11', 'Half-diminished 11th', [0, 3, 6, 10, 14, 17]],
    ['m7(11)', 'Minor 7th add 11', [0, 3, 7, 10, 17]],
    ['7(11)', 'Dominant 7th add 11', [0, 4, 7, 10, 17]],
    ['maj7♯11', 'Major 7th sharp 11', [0, 4, 7, 11, 18]],
    ['maj9♯11', 'Major 9th sharp 11', [0, 4, 7, 11, 14, 18]],
    ['7♯11', 'Dominant 7th sharp 11', [0, 4, 7, 10, 18]],
    ['9♯11', 'Dominant 9th sharp 11', [0, 4, 7, 10, 14, 18]],
    ['m9♭5(11)', 'Half-diminished 11th (no 9)', [0, 3, 6, 10, 17]],
  ],
  thirteenth: [
    ['13', 'Dominant 13th', [0, 4, 7, 10, 14, 21]],
    ['maj13', 'Major 13th', [0, 4, 7, 11, 14, 21]],
    ['m13', 'Minor 13th', [0, 3, 7, 10, 14, 17, 21]],
    ['m(maj13)', 'Minor major 13th', [0, 3, 7, 11, 14, 21]],
    ['13♯11', 'Dominant 13th sharp 11', [0, 4, 7, 10, 14, 18, 21]],
    ['maj13♯11', 'Major 13th sharp 11', [0, 4, 7, 11, 14, 18, 21]],
    ['13♭9', 'Dominant 13th flat 9', [0, 4, 7, 10, 13, 21]],
    ['7(13)', 'Dominant 7th add 13', [0, 4, 7, 10, 21]],
    ['maj7(13)', 'Major 7th add 13', [0, 4, 7, 11, 21]],
    ['m7(13)', 'Minor 7th add 13', [0, 3, 7, 10, 21]],
    ['7♭13', 'Dominant 7th flat 13', [0, 4, 7, 10, 20]],
    ['7♭9♭13', 'Dominant 7th flat 9 flat 13', [0, 4, 7, 10, 13, 20]],
    ['m7♭13', 'Minor 7th flat 13', [0, 3, 7, 10, 20]],
    ['m11♭13', 'Minor 11th flat 13', [0, 3, 7, 10, 14, 17, 20]],
    ['ø11♭13', 'Half-diminished 11th flat 13', [0, 3, 6, 10, 14, 17, 20]],
  ],
  add: [
    ['add9', 'Add 9', [0, 4, 7, 14]],
    ['m(add9)', 'Minor add 9', [0, 3, 7, 14]],
    ['add11', 'Add 11', [0, 4, 7, 17]],
    ['m(add11)', 'Minor add 11', [0, 3, 7, 17]],
    ['add13', 'Add 13', [0, 4, 7, 21]],
    ['m(add13)', 'Minor add 13', [0, 3, 7, 21]],
    ['add♯11', 'Add sharp 11', [0, 4, 7, 18]],
    ['add9(11)', 'Add 9 and 11', [0, 4, 7, 14, 17]],
    ['m(add9)(11)', 'Minor add 9 and 11', [0, 3, 7, 14, 17]],
    ['add9(13)', 'Add 9 and 13', [0, 4, 7, 14, 21]],
    ['add2', 'Add 2', [0, 2, 4, 7]],
    ['m(add2)', 'Minor add 2', [0, 2, 3, 7]],
    ['add4', 'Add 4', [0, 4, 5, 7]],
    ['m(add4)', 'Minor add 4', [0, 3, 5, 7]],
    ['°(add9)', 'Diminished add 9', [0, 3, 6, 14]],
    ['m(add♭9)', 'Minor add flat 9', [0, 3, 7, 13]],
    ['add♭9', 'Add flat 9', [0, 4, 7, 13]],
    ['m(add♭13)', 'Minor add flat 13', [0, 3, 7, 20]],
  ],
};

/** The 5th, removed from 7th-and-up chords. 3rd removed from a few common shells. */
function omitVariants(types: ChordType[]): ChordType[] {
  const out: ChordType[] = [];
  for (const t of types) {
    const iv = t.intervals;
    const hasThird = iv.includes(3) || iv.includes(4);
    // No 5: any chord with a 3rd, a perfect 5th, and at least two other notes.
    if (hasThird && iv.includes(7) && iv.length >= 4 && t.family !== 'add' && t.family !== 'sixth') {
      out.push({ id: `${t.id}-no5`, symbol: `${t.symbol}(no5)`, name: `${t.name}, no 5th`, intervals: iv.filter((i) => i !== 7), family: 'omit' });
    }
    if (t.family === 'add' && hasThird && iv.includes(7) && iv.length === 4 && iv[3] > 12) {
      out.push({ id: `${t.id}-no5`, symbol: `${t.symbol}(no5)`, name: `${t.name}, no 5th`, intervals: iv.filter((i) => i !== 7), family: 'omit' });
    }
    // No 3: 7ths, 9ths and add chords keep their colour without the 3rd.
    if (hasThird && iv.includes(7) && (t.id === '7' || t.id === 'maj7' || t.id === '9' || t.id === 'maj9' || t.id === 'add9' || t.id === '6')) {
      out.push({ id: `${t.id}-no3`, symbol: `${t.symbol}(no3)`, name: `${t.name}, no 3rd`, intervals: iv.filter((i) => i !== 3 && i !== 4), family: 'omit' });
    }
  }
  return out;
}

const BASE: ChordType[] = (Object.keys(DEFS) as Array<keyof typeof DEFS>).flatMap((family) =>
  DEFS[family].map(([symbol, name, intervals]) => ({ id: symbol || 'maj', symbol, name, intervals, family })),
);

/** Every chord type Maddie knows, in display order. */
export const CHORD_TYPES: readonly ChordType[] = (() => {
  const seen = new Set<string>();
  return [...BASE, ...omitVariants(BASE)].filter((t) => {
    const k = t.intervals.join(',');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
})();

export interface Chord {
  /** Root pitch class. */
  root: number;
  type: ChordType;
  /** `Cm7`, `F♯sus4`. */
  name: string;
  /** Roman numeral of the root in the key (`i`, `IV`, `♭VII`). Empty with no key. */
  degree: string;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
/** Chromatic position → [degree letter, accidental], relative to a major scale. */
const DEGREE_OF_SEMITONE: Array<[number, string]> = [
  [0, ''], [1, '♭'], [1, ''], [2, '♭'], [2, ''], [3, ''], [4, '♭'], [4, ''], [5, '♭'], [5, ''], [6, '♭'], [6, ''],
];

/**
 * Roman numeral for a chord root. Lowercase for minor, ° for diminished, + for augmented.
 * `step` is the root's index in a seven-note scale; otherwise it's spelled against major (♭III).
 */
export function romanNumeral(semitones: number, intervals: readonly number[], step?: number): string {
  const [deg, acc] = step === undefined ? DEGREE_OF_SEMITONE[pitchClass(semitones)] : [step, ''];
  const minor = intervals.includes(3) && !intervals.includes(4);
  const dim = minor && intervals.includes(6) && !intervals.includes(7);
  const aug = !minor && intervals.includes(4) && intervals.includes(8) && !intervals.includes(7);
  const n = ROMAN[deg];
  return acc + (minor ? n.toLowerCase() : n) + (dim ? '°' : aug ? '+' : '');
}

export const chordName = (root: number, type: ChordType) => `${pitchClassName(root)}${type.symbol}`;

/** Pitch classes in a key. No key = all twelve. */
function keyClasses(key: Key | null): Set<number> {
  if (!key) return new Set(Array.from({ length: 12 }, (_, i) => i));
  return new Set(SCALES[key.scale].intervals.map((i) => pitchClass(key.root + i)));
}

export function chordFitsKey(root: number, type: ChordType, key: Key | null): boolean {
  const pcs = keyClasses(key);
  return type.intervals.every((i) => pcs.has(pitchClass(root + i)));
}

/**
 * Every chord built only from notes in the key, grouped by root (in scale order).
 * No key: every root, every chord.
 */
export function chordsInKey(key: Key | null, types: readonly ChordType[] = CHORD_TYPES): Array<{ root: number; degree: string; chords: Chord[] }> {
  const steps = key ? SCALES[key.scale].intervals : null;
  const roots = steps ? steps.map((i) => pitchClass(key!.root + i)) : Array.from({ length: 12 }, (_, i) => i);
  const pcs = keyClasses(key);
  const heptatonic = steps?.length === 7;
  return roots.map((root, index) => {
    const step = heptatonic ? index : undefined;
    const chords = types
      .filter((t) => t.intervals.every((i) => pcs.has(pitchClass(root + i))))
      .map((type) => ({
        root,
        type,
        name: chordName(root, type),
        degree: key ? romanNumeral(root - key.root, type.intervals, step) : '',
      }));
    // The root's own label follows its plainest chord (triad, else first that fits).
    const plain = chords.find((c) => c.type.family === 'triad') ?? chords[0];
    return { root, degree: key ? (plain?.degree ?? romanNumeral(root - key.root, [], step)) : '', chords };
  });
}

/** Chord intervals for an inversion: the lowest `inversion` notes go up an octave. */
export function invert(intervals: readonly number[], inversion: number): number[] {
  const iv = [...intervals];
  const n = Math.max(0, Math.min(iv.length - 1, inversion));
  for (let i = 0; i < n; i++) iv.push(iv.shift()! + 12);
  // Keep notes rising after the octave shift (a 9th moved up may still sit below the top).
  for (let i = 1; i < iv.length; i++) while (iv[i] <= iv[i - 1]) iv[i] += 12;
  return iv;
}

/**
 * MIDI pitches for a chord with its lowest note as close to `near` as possible.
 * The chord keeps its root, so it stays in key wherever it lands.
 */
export function voiceChord(root: number, intervals: readonly number[], near: number, inversion = 0): number[] {
  const iv = invert(intervals, inversion);
  const bassClass = pitchClass(root + iv[0]);
  let bass = near - pitchClass(near - bassClass);
  if (near - bass > 6) bass += 12;
  const span = iv[iv.length - 1] - iv[0];
  while (bass + span > 127) bass -= 12;
  while (bass < 0) bass += 12;
  return iv.map((i) => clampPitch(bass + i - iv[0]));
}
