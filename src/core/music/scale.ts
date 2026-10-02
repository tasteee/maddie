import type { Key, ScaleId } from '../types';
import { MAX_PITCH, MIN_PITCH, parsePitchClass, pitchClass, pitchClassName } from './pitch';

export interface ScaleDef {
  name: string;
  intervals: readonly number[];
}

export const SCALES: Record<ScaleId, ScaleDef> = {
  major: { name: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: 'Minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
  dorian: { name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { name: 'Phrygian', intervals: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { name: 'Lydian', intervals: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { name: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
  locrian: { name: 'Locrian', intervals: [0, 1, 3, 5, 6, 8, 10] },
  harmonicMinor: { name: 'Harmonic Minor', intervals: [0, 2, 3, 5, 7, 8, 11] },
  melodicMinor: { name: 'Melodic Minor', intervals: [0, 2, 3, 5, 7, 9, 11] },
  majorPentatonic: { name: 'Major Pentatonic', intervals: [0, 2, 4, 7, 9] },
  minorPentatonic: { name: 'Minor Pentatonic', intervals: [0, 3, 5, 7, 10] },
  blues: { name: 'Blues', intervals: [0, 3, 5, 6, 7, 10] },
  chromatic: { name: 'Chromatic', intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

export const SCALE_IDS = Object.keys(SCALES) as ScaleId[];

const ALIASES: Record<string, ScaleId> = {
  maj: 'major',
  ionian: 'major',
  min: 'minor',
  aeolian: 'minor',
  m: 'minor',
  harmonicminor: 'harmonicMinor',
  melodicminor: 'melodicMinor',
  majorpentatonic: 'majorPentatonic',
  minorpentatonic: 'minorPentatonic',
  pentatonic: 'majorPentatonic',
};

/** "C minor", "F# dorian", "Bb harmonic minor" → Key. */
export function parseKey(input: string | null | undefined): Key | null {
  if (!input) return null;
  const m = /^\s*([a-g][#♯b♭]?)\s*(.*)$/i.exec(input);
  if (!m) return null;
  const root = parsePitchClass(m[1]);
  if (root === null) return null;
  const raw = (m[2] || 'major').replace(/[\s_-]/g, '').toLowerCase();
  const scale = (SCALE_IDS.find((id) => id.toLowerCase() === raw) ?? ALIASES[raw]) as ScaleId | undefined;
  return scale ? { root, scale } : null;
}

export const formatKey = (key: Key) => `${pitchClassName(key.root)} ${SCALES[key.scale].name}`;

const maskCache = new Map<string, boolean[]>();

/** 12 booleans, index = pitch class. */
export function scaleMask(key: Key): boolean[] {
  const id = `${key.root}:${key.scale}`;
  let mask = maskCache.get(id);
  if (!mask) {
    mask = new Array(12).fill(false);
    for (const i of SCALES[key.scale].intervals) mask[pitchClass(key.root + i)] = true;
    maskCache.set(id, mask);
  }
  return mask;
}

export const inScale = (pitch: number, key: Key | null) => !key || scaleMask(key)[pitchClass(pitch)];

/** Closest in-scale pitch. Ties go up. */
export function nearestInScale(pitch: number, key: Key | null): number {
  if (!key) return pitch;
  for (let d = 0; d < 12; d++) {
    if (pitch + d <= MAX_PITCH && inScale(pitch + d, key)) return pitch + d;
    if (pitch - d >= MIN_PITCH && inScale(pitch - d, key)) return pitch - d;
  }
  return pitch;
}

/** Scale degree index across all octaves (in-scale pitches only). */
export function degreeOf(pitch: number, key: Key): number {
  const iv = SCALES[key.scale].intervals;
  const rel = pitch - key.root;
  const oct = Math.floor(rel / 12);
  const idx = iv.indexOf(rel - oct * 12);
  return oct * iv.length + Math.max(0, idx);
}

export function pitchOfDegree(degree: number, key: Key): number {
  const iv = SCALES[key.scale].intervals;
  const oct = Math.floor(degree / iv.length);
  return key.root + oct * 12 + iv[degree - oct * iv.length];
}

/** Move a pitch by scale degrees. Off-scale pitches snap to the scale first. */
export function transposeDegrees(pitch: number, degrees: number, key: Key): number {
  return pitchOfDegree(degreeOf(nearestInScale(pitch, key), key) + degrees, key);
}

// ── Key detection ───────────────────────────────────────────────────

/** Krumhansl–Kessler key profiles. How strongly each degree implies the tonic. */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Order to prefer when several scales fit equally well. Common first. Chromatic never. */
const DETECT_ORDER: ScaleId[] = [
  'major',
  'minor',
  'harmonicMinor',
  'melodicMinor',
  'dorian',
  'mixolydian',
  'phrygian',
  'lydian',
  'locrian',
  'majorPentatonic',
  'minorPentatonic',
  'blues',
];

export interface KeyGuess {
  key: Key;
  /** Share of the music (weighted by note length) that sits in the scale, 0–1. */
  fit: number;
  /** Notes outside the scale. */
  outside: number;
}

function correlate(a: number[], b: number[]) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/**
 * The key and scale that best fit some notes. First the scales that hold the most of
 * the music (all of it if possible). Then, among those, the tonic that sounds most
 * like home (key profile, plus the lowest and last notes), then the more common scale.
 * Null when there are no notes.
 */
export function detectKey(notes: ReadonlyArray<{ pitch: number; duration: number; start?: number }>): KeyGuess | null {
  if (!notes.length) return null;
  // Weight by length, with a floor so short notes still count.
  const avg = notes.reduce((s, n) => s + n.duration, 0) / notes.length || 1;
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[pitchClass(n.pitch)] += Math.max(n.duration, avg * 0.25);
  const total = hist.reduce((s, v) => s + v, 0);

  // Tonic cues: the lowest note overall, and the bass of the first and last chords.
  // The opening bass is the strongest: it separates a key from its relative (C minor vs E♭ major).
  const lowest = (list: typeof notes) => pitchClass(list.reduce((lo, n) => (n.pitch < lo.pitch ? n : lo)).pitch);
  const starts = notes.map((n) => n.start ?? 0);
  const t0 = Math.min(...starts);
  const t1 = Math.max(...starts);
  const bass = lowest(notes);
  const first = lowest(notes.filter((n) => (n.start ?? 0) === t0));
  const last = lowest(notes.filter((n) => (n.start ?? 0) === t1));

  let best: { guess: KeyGuess; score: number } | null = null;
  for (const [order, scale] of DETECT_ORDER.entries()) {
    const iv = SCALES[scale].intervals;
    const minorish = iv.includes(3) && !iv.includes(4);
    const profile = minorish ? MINOR_PROFILE : MAJOR_PROFILE;
    for (let root = 0; root < 12; root++) {
      const mask = scaleMask({ root, scale });
      let inside = 0;
      let outside = 0;
      for (let pc = 0; pc < 12; pc++) if (mask[pc]) inside += hist[pc];
      for (const n of notes) if (!mask[pitchClass(n.pitch)]) outside++;
      const fit = inside / total;
      const rotated = Array.from({ length: 12 }, (_, i) => hist[(root + i) % 12]);
      const tonic = correlate(rotated, profile) + (first === root ? 0.35 : 0) + (last === root ? 0.1 : 0) + (bass === root ? 0.05 : 0);
      // Fit dominates; tonic decides between equal fits; scale order breaks exact ties.
      const score = Math.round(fit * 1000) * 100 + tonic * 10 - order * 0.01;
      if (!best || score > best.score) best = { guess: { key: { root, scale }, fit, outside }, score };
    }
  }
  return best!.guess;
}
