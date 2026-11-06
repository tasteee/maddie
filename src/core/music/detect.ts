import type { Key, Note, NoteId, Tick } from '../types';
import { CHORD_TYPES, chordFitsKey, chordName, romanNumeral, type ChordFamily, type ChordType } from './chords';
import { pitchClass, pitchClassName } from './pitch';
import { SCALES } from './scale';

export type DetectedChordT = {
  root: number;
  // Pitch class of the lowest sounding note.
  bass: number;
  type: ChordType;
  // `Cm7`, or `Cmaj7/E` when the lowest note is not the root.
  name: string;
  // Roman numeral in the key. Empty with no key.
  degree: string;
};

export type ChordSpanT = {
  start: Tick;
  end: Tick;
  chord: DetectedChordT;
  // Pitches of the first slice that showed this chord, low to high.
  pitches: number[];
  noteIds: NoteId[];
};

export type AnalyzeOptionsT = {
  key: Key | null;
  // Spans shorter than this are dropped as passing notes.
  minDuration: Tick;
};

type CandidateT = {
  root: number;
  type: ChordType;
  cost: number;
  typeOrder: number;
};

type TypeMaskT = {
  type: ChordType;
  mask: number;
  typeOrder: number;
};

type SliceT = {
  start: Tick;
  end: Tick;
  notes: Note[];
};

// Simpler names win ties. Lower is simpler.
const FAMILY_COST: Record<ChordFamily, number> = {
  triad: 0,
  power: 0,
  seventh: 1,
  sixth: 2,
  sus: 2,
  ninth: 2,
  eleventh: 3,
  thirteenth: 3,
  add: 4,
  omit: 4,
};

// Real but unusual readings of common note sets. They only win when nothing else fits.
const RARE_TYPE_IDS: ReadonlySet<string> = new Set(['m♭6', 'm(add♭13)']);
const RARE_TYPE_COST = 2;

// A chord played off its root costs about two steps of complexity.
const INVERSION_COST = 2;
const OUT_OF_KEY_COST = 0.5;
const POWER_CHORD_ID = '5';
const MIN_PITCH_CLASSES = 3;
const PITCH_CLASS_COUNT = 12;

const buildMask = (pitchClasses: Iterable<number>): number => {
  let mask = 0;
  for (const pc of pitchClasses) mask |= 1 << pitchClass(pc);
  return mask;
};

const countBits = (mask: number): number => {
  let count = 0;
  for (let bit = 0; bit < PITCH_CLASS_COUNT; bit++) {
    const isSet = (mask & (1 << bit)) !== 0;
    if (isSet) count += 1;
  }
  return count;
};

const canDetectType = (type: ChordType, mask: number): boolean => {
  const isPowerChord = type.id === POWER_CHORD_ID;
  if (isPowerChord) return true;
  return countBits(mask) >= MIN_PITCH_CLASSES;
};

const buildTypeMasks = (): TypeMaskT[] => {
  const masks: TypeMaskT[] = [];
  for (const [typeOrder, type] of CHORD_TYPES.entries()) {
    const mask = buildMask(type.intervals);
    const isDetectable = canDetectType(type, mask);
    if (isDetectable) masks.push({ type, mask, typeOrder });
  }
  return masks;
};

const TYPE_MASKS: TypeMaskT[] = buildTypeMasks();

// Rotate the played pitch classes so `root` becomes 0.
const maskRelativeTo = (pitchClasses: ReadonlySet<number>, root: number): number => {
  const relative: number[] = [];
  for (const pc of pitchClasses) relative.push(pc - root);
  return buildMask(relative);
};

const findCandidatesForRoot = (pitchClasses: ReadonlySet<number>, root: number, bass: number, key: Key | null): CandidateT[] => {
  const playedMask = maskRelativeTo(pitchClasses, root);
  const candidates: CandidateT[] = [];
  const isBassRoot = root === bass;
  const inversionCost = isBassRoot ? 0 : INVERSION_COST;

  for (const entry of TYPE_MASKS) {
    const isMatch = entry.mask === playedMask;
    if (!isMatch) continue;
    const isRare = RARE_TYPE_IDS.has(entry.type.id);
    const rareCost = isRare ? RARE_TYPE_COST : 0;
    const familyCost = FAMILY_COST[entry.type.family] + rareCost;
    const fitsKey = chordFitsKey(root, entry.type, key);
    const keyCost = fitsKey ? 0 : OUT_OF_KEY_COST;
    const cost = inversionCost + familyCost + keyCost;
    candidates.push({ root, type: entry.type, cost, typeOrder: entry.typeOrder });
  }
  return candidates;
};

const compareCandidates = (a: CandidateT, b: CandidateT): number => {
  const costDifference = a.cost - b.cost;
  if (costDifference !== 0) return costDifference;
  return a.typeOrder - b.typeOrder;
};

const getDegree = (root: number, type: ChordType, key: Key | null): string => {
  if (!key) return '';
  const scaleIntervals = SCALES[key.scale].intervals;
  const isHeptatonic = scaleIntervals.length === 7;
  const semitones = root - key.root;
  const step = scaleIntervals.indexOf(pitchClass(semitones));
  const isInScale = step >= 0;
  const canUseStep = isHeptatonic && isInScale;
  const stepOrUndefined = canUseStep ? step : undefined;
  return romanNumeral(semitones, type.intervals, stepOrUndefined);
};

const buildChordName = (root: number, bass: number, type: ChordType): string => {
  const baseName = chordName(root, type);
  const isSlashChord = root !== bass;
  if (!isSlashChord) return baseName;
  return `${baseName}/${pitchClassName(bass)}`;
};

/**
 * Name the chord that a set of pitches makes, or null.
 * Needs three different pitch classes (or a bare power chord).
 * The lowest note is the root unless another reading is much simpler.
 */
export const detectChord = (pitches: readonly number[], key: Key | null = null): DetectedChordT | null => {
  const hasPitches = pitches.length > 0;
  if (!hasPitches) return null;
  const lowestPitch = Math.min(...pitches);
  const bass = pitchClass(lowestPitch);
  const pitchClasses = new Set(pitches.map(pitchClass));
  const hasEnoughPitchClasses = pitchClasses.size >= 2;
  if (!hasEnoughPitchClasses) return null;

  const candidates: CandidateT[] = [];
  for (const root of pitchClasses) {
    const rootCandidates = findCandidatesForRoot(pitchClasses, root, bass, key);
    candidates.push(...rootCandidates);
  }
  const hasCandidates = candidates.length > 0;
  if (!hasCandidates) return null;

  candidates.sort(compareCandidates);
  const best = candidates[0];
  const name = buildChordName(best.root, bass, best.type);
  const degree = getDegree(best.root, best.type, key);
  return { root: best.root, bass, type: best.type, name, degree };
};

const getNoteEnd = (note: Note): Tick => note.start + note.duration;

const collectBoundaries = (notes: readonly Note[]): Tick[] => {
  const boundaries = new Set<Tick>();
  for (const note of notes) {
    boundaries.add(note.start);
    boundaries.add(getNoteEnd(note));
  }
  return [...boundaries].sort((a, b) => a - b);
};

const groupNotesByStart = (notes: readonly Note[]): Map<Tick, Note[]> => {
  const groups = new Map<Tick, Note[]>();
  for (const note of notes) {
    const group = groups.get(note.start) ?? [];
    group.push(note);
    groups.set(note.start, group);
  }
  return groups;
};

// Cut time at every note start and end. Each slice has a fixed set of sounding notes.
const buildSlices = (notes: readonly Note[]): SliceT[] => {
  const boundaries = collectBoundaries(notes);
  const startingAt = groupNotesByStart(notes);
  const slices: SliceT[] = [];
  let active: Note[] = [];

  for (const [index, start] of boundaries.entries()) {
    const end = boundaries[index + 1];
    const isLastBoundary = end === undefined;
    if (isLastBoundary) break;
    const stillSounding = active.filter((note) => getNoteEnd(note) > start);
    const justStarted = startingAt.get(start) ?? [];
    active = [...stillSounding, ...justStarted];
    const hasActiveNotes = active.length > 0;
    if (hasActiveNotes) slices.push({ start, end, notes: active });
  }
  return slices;
};

const mergeSameChord = (spans: ChordSpanT[], maxGap: Tick): ChordSpanT[] => {
  const merged: ChordSpanT[] = [];
  for (const span of spans) {
    const previous = merged[merged.length - 1];
    const hasPrevious = previous !== undefined;
    const gap = hasPrevious ? span.start - previous.end : Infinity;
    const isSameChord = hasPrevious && previous.chord.name === span.chord.name;
    const isCloseEnough = gap <= maxGap;
    const shouldMerge = isSameChord && isCloseEnough;
    if (!shouldMerge) {
      merged.push({ ...span, noteIds: [...span.noteIds] });
      continue;
    }
    previous.end = span.end;
    previous.noteIds = [...new Set([...previous.noteIds, ...span.noteIds])];
  }
  return merged;
};

const sortPitches = (notes: readonly Note[]): number[] => notes.map((note) => note.pitch).sort((a, b) => a - b);

/**
 * Find every chord in one track's notes, in time order.
 * Cuts time at each note start and end, names each slice,
 * joins neighbours with the same chord, and drops passing ones.
 */
export const analyzeChords = (notes: readonly Note[], options: AnalyzeOptionsT): ChordSpanT[] => {
  const soundingNotes = notes.filter((note) => !note.muted);
  const slices = buildSlices(soundingNotes);
  const rawSpans: ChordSpanT[] = [];

  for (const slice of slices) {
    const pitches = slice.notes.map((note) => note.pitch);
    const chord = detectChord(pitches, options.key);
    if (!chord) continue;
    const noteIds = slice.notes.map((note) => note.id);
    rawSpans.push({ start: slice.start, end: slice.end, chord, pitches: sortPitches(slice.notes), noteIds });
  }

  // Join first, so a note released a hair early does not split a chord.
  const joined = mergeSameChord(rawSpans, options.minDuration);
  const longEnough = joined.filter((span) => span.end - span.start >= options.minDuration);
  return mergeSameChord(longEnough, options.minDuration);
};

/**
 * Chords in a hand-picked set of notes (the selection).
 * Falls back to reading all of them as one chord, so a selected arpeggio still has a name.
 */
export const analyzeSelection = (notes: readonly Note[], options: AnalyzeOptionsT): ChordSpanT[] => {
  const spans = analyzeChords(notes, options);
  const hasSpans = spans.length > 0;
  if (hasSpans) return spans;

  const soundingNotes = notes.filter((note) => !note.muted);
  const pitches = soundingNotes.map((note) => note.pitch);
  const chord = detectChord(pitches, options.key);
  if (!chord) return [];

  const start = Math.min(...soundingNotes.map((note) => note.start));
  const end = Math.max(...soundingNotes.map(getNoteEnd));
  const noteIds = soundingNotes.map((note) => note.id);
  return [{ start, end, chord, pitches: sortPitches(soundingNotes), noteIds }];
};
