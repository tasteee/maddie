import type { ChordRegion, Tick } from './types';

/** Which hits a chord's accent preset makes louder. */
export type ChordAccentT = 'none' | 'downbeats' | 'offbeats' | 'backbeats';

/**
 * How a chord's notes get their velocities. Stored on the chord, not its notes, because a
 * chord track rebuilds its notes after every edit: shaping kept here survives that.
 * - `ramp`: velocity at the chord's start and end, in a straight line. Replaces the chord's level.
 * - `pitchRange`: velocity bounds for the lowest to highest pitch in the chord's voicing.
 * - `humanize`: random spread of up to ±`amount`, the same every rebuild for a given `seed`.
 * - `accent`: louder hits on the chosen beats, softer elsewhere.
 */
export type ChordDynamicsT = {
  ramp?: { from: number; to: number };
  pitchRange?: { min: number; max: number };
  humanize?: { amount: number; seed: number };
  accent?: ChordAccentT;
};

export const CHORD_ACCENTS: { value: ChordAccentT; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'downbeats', label: 'Downbeats' },
  { value: 'offbeats', label: 'Offbeats' },
  { value: 'backbeats', label: 'Backbeats (2 and 4)' },
];

/** A pattern's own accents are kept: its velocities scale by the chord's level over this. */
export const PATTERN_REFERENCE_VELOCITY = 0.8;
const ACCENT_STRONG = 1.2;
const ACCENT_WEAK = 0.8;
const MIN_VELOCITY = 1 / 127;

const clampVelocity = (value: number) => Math.min(1, Math.max(MIN_VELOCITY, value));

/** A steady 0–1 number from a string and a seed: the same inputs always give the same number. */
const seededUnit = (text: string, seed: number): number => {
  let hash = (seed ^ 0x9e3779b9) >>> 0;
  for (const char of text) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x85ebca6b) >>> 0;
    hash = (hash ^ (hash >>> 13)) >>> 0;
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0xc2b2ae35) >>> 0;
  return (hash >>> 0) / 0xffffffff;
};

/** The chord's level at a tick: its ramp, or its single velocity. */
export const chordLevelAt = (region: ChordRegion, tick: Tick): number => {
  const range = region.dynamics?.pitchRange;
  if (range) return (range.min + range.max) / 2;
  const ramp = region.dynamics?.ramp;
  if (!ramp) return region.velocity;
  const progress = region.duration > 0 ? (tick - region.start) / region.duration : 0;
  const clamped = Math.min(1, Math.max(0, progress));
  return ramp.from + (ramp.to - ramp.from) * clamped;
};

const accentFactor = (accent: ChordAccentT | undefined, tick: Tick, ppq: number): number => {
  const hasAccent = !!accent && accent !== 'none';
  if (!hasAccent) return 1;
  const isOnBeat = tick % ppq === 0;
  const isOnHalfBeat = tick % (ppq / 2) === 0;
  const beatIndex = Math.floor(tick / ppq);
  const isStrongByAccent = {
    downbeats: isOnBeat,
    offbeats: isOnHalfBeat && !isOnBeat,
    backbeats: isOnBeat && beatIndex % 2 === 1,
    none: false,
  };
  const isStrong = isStrongByAccent[accent];
  return isStrong ? ACCENT_STRONG : ACCENT_WEAK;
};

/**
 * One note's velocity in a chord. `patternVelocity` is the pattern's own velocity for the hit
 * (0–1), or undefined for a plain chord, whose notes all take the chord's level.
 */
export const shapeChordVelocity = (region: ChordRegion, note: { id: string; start: Tick; pitch?: number; patternVelocity?: number }, ppq: number): number => {
  const range = region.dynamics?.pitchRange;
  let level = chordLevelAt(region, note.start);
  if (range && range.min !== range.max && note.pitch !== undefined) {
    const low = Math.min(...region.pitches);
    const high = Math.max(...region.pitches);
    const position = high > low ? Math.max(0, Math.min(1, (note.pitch - low) / (high - low))) : 0.5;
    level = range.min + position * (range.max - range.min);
  }
  const isPatternHit = note.patternVelocity !== undefined;
  const base = isPatternHit ? note.patternVelocity! * (level / PATTERN_REFERENCE_VELOCITY) : level;
  const accented = base * accentFactor(region.dynamics?.accent, note.start, ppq);
  const humanize = region.dynamics?.humanize;
  const spread = humanize ? (seededUnit(note.id, humanize.seed) * 2 - 1) * humanize.amount : 0;
  return range ? Math.max(range.min, Math.min(range.max, accented + spread)) : clampVelocity(accented + spread);
};

const end = (region: ChordRegion) => region.start + region.duration;

/** Drop empty shaping so a chord with none has no `dynamics` at all. */
export const withDynamics = (region: ChordRegion, dynamics: ChordDynamicsT): ChordRegion => {
  const hasAny = !!dynamics.ramp || !!dynamics.pitchRange || !!dynamics.humanize || (!!dynamics.accent && dynamics.accent !== 'none');
  const { dynamics: _old, ...rest } = region;
  return hasAny ? { ...rest, dynamics } : rest;
};

/**
 * Ramp velocity over chords. `isOneLine`: one straight line from the first chord's start to the
 * last chord's end. Otherwise every chord ramps from `from` to `to` on its own.
 */
export const rampChords = (regions: readonly ChordRegion[], from: number, to: number, isOneLine: boolean): ChordRegion[] => {
  const sorted = [...regions].sort((a, b) => a.start - b.start);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return [];
  const span = Math.max(1, end(last) - first.start);
  const at = (tick: Tick) => from + (to - from) * ((tick - first.start) / span);
  return sorted.map((region) => {
    const ramp = isOneLine ? { from: at(region.start), to: at(end(region)) } : { from, to };
    return withDynamics(region, { ...region.dynamics, ramp, pitchRange: undefined });
  });
};

/** Random velocity spread on chords, with a fresh seed so Apply always gives a new take. */
export const humanizeChords = (regions: readonly ChordRegion[], amount: number, seed: number): ChordRegion[] =>
  regions.map((region) => {
    const humanize = amount > 0 ? { amount, seed } : undefined;
    return withDynamics(region, { ...region.dynamics, humanize });
  });

export const accentChords = (regions: readonly ChordRegion[], accent: ChordAccentT): ChordRegion[] =>
  regions.map((region) => withDynamics(region, { ...region.dynamics, accent }));

/** One base level for each chord. Clears ramps and pitch ranges. */
export const levelChords = (regions: readonly ChordRegion[], velocity: number): ChordRegion[] =>
  regions.map((region) => withDynamics({ ...region, velocity: clampVelocity(velocity) }, { ...region.dynamics, ramp: undefined, pitchRange: undefined }));

/** Reapply these velocity bounds whenever a chord generates notes. Equal bounds give every hit one level. */
export const pitchRangeChords = (regions: readonly ChordRegion[], from: number, to: number): ChordRegion[] => {
  const pitchRange = { min: clampVelocity(Math.min(from, to)), max: clampVelocity(Math.max(from, to)) };
  const velocity = (pitchRange.min + pitchRange.max) / 2;
  return regions.map((region) => withDynamics({ ...region, velocity }, { ...region.dynamics, ramp: undefined, pitchRange }));
};

/** Back to plain: one level, no ramp, humanize or accent. */
export const clearChordDynamics = (regions: readonly ChordRegion[]): ChordRegion[] =>
  regions.map((region) => withDynamics(region, {}));
