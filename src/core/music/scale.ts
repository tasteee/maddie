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
