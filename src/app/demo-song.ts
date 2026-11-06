import type { NoteInput } from '../core';

const PPQ = 960;
const S = PPQ / 4; // one sixteenth

export const DEMO_TEMPO = 124;

type NoteRowT = [pitch: number, start: number, length: number, velocity: number];

/** [pitch, start (16ths), length (16ths), velocity 0–1] → notes. */
const toNotes = (rows: NoteRowT[]): NoteInput[] =>
  rows.map((row) => ({ pitch: row[0], start: row[1] * S, duration: row[2] * S, velocity: row[3] }));

/** C minor, 4 bars at 124 BPM: Cm · A♭ · E♭ · B♭. */
const CHORDS: NoteRowT[] = [
  [67, 0, 6, 0.62], [63, 0, 6, 0.62], [60, 0, 6, 0.62], // Cm
  [67, 8, 6, 0.51], [63, 8, 6, 0.51], [58, 8, 6, 0.51],
  [63, 16, 6, 0.62], [60, 16, 6, 0.62], [56, 16, 6, 0.62], // A♭
  [67, 24, 6, 0.51], [63, 24, 6, 0.51], [58, 24, 6, 0.51],
  [67, 32, 6, 0.62], [63, 32, 6, 0.62], [58, 32, 6, 0.62], // E♭
  [67, 40, 6, 0.51], [63, 40, 6, 0.51], [58, 40, 6, 0.51],
  [65, 48, 6, 0.62], [62, 48, 6, 0.62], [58, 48, 6, 0.62], // B♭
  [74, 54, 2, 0.55],
  [75, 56, 3, 0.51], [70, 56, 3, 0.51], [67, 56, 3, 0.32],
  [74, 60, 3, 0.51], [70, 60, 3, 0.51], [65, 60, 3, 0.32],
];

/** A syncopated bass line under the chords, with pickups. */
const BASS: NoteRowT[] = [
  [36, 0, 3, 1], [36, 6, 2, 0.76], [48, 10, 2, 0.65], [36, 12, 3, 0.85],
  [32, 16, 3, 1], [32, 22, 2, 0.76], [44, 26, 2, 0.65], [32, 28, 3, 0.85],
  [39, 32, 3, 1], [39, 38, 2, 0.76], [51, 42, 2, 0.65], [39, 44, 3, 0.85],
  [34, 48, 3, 1], [34, 54, 2, 0.76], [46, 58, 2, 0.65], [34, 60, 3, 0.85],
];

/** The lead melody over the chords. */
const LEAD: NoteRowT[] = [
  [79, 0, 4, 0.8], [77, 4, 2, 0.7], [75, 6, 2, 0.7],
  [77, 8, 4, 0.8], [75, 12, 2, 0.7], [72, 14, 2, 0.7],
  [75, 16, 4, 0.8], [72, 20, 2, 0.7], [68, 22, 2, 0.7],
  [70, 24, 2, 0.7], [72, 26, 4, 0.8],
  [79, 32, 4, 0.8], [75, 36, 4, 0.8], [74, 40, 4, 0.8], [75, 44, 4, 0.8],
  [77, 48, 6, 0.85], [74, 56, 4, 0.8], [67, 58, 4, 0.8], [70, 60, 4, 0.8],
];

export const demoChords = (): NoteInput[] => toNotes(CHORDS);
export const demoBass = (): NoteInput[] => toNotes(BASS);
export const demoLead = (): NoteInput[] => toNotes(LEAD);

/** Every track together. For tests and anything that wants the whole song as one list. */
export const demoSong = (): NoteInput[] => [...demoChords(), ...demoBass()];
