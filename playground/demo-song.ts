import type { NoteInput } from '../src/core';

const PPQ = 960;
const BAR = PPQ * 4;
const E = PPQ / 2; // eighth
const S = PPQ / 4; // sixteenth

/** A short C minor loop: chords, bass, melody. */
export function demoSong(): NoteInput[] {
  const notes: NoteInput[] = [];
  const add = (pitch: number, start: number, duration: number, velocity: number) =>
    notes.push({ pitch, start, duration, velocity });

  // Cm – A♭ – E♭ – B♭
  const chords = [
    [60, 63, 67],
    [56, 60, 63],
    [58, 63, 67],
    [58, 62, 65],
  ];
  const bass = [36, 32, 39, 34];

  chords.forEach((chord, bar) => {
    const t = bar * BAR;
    chord.forEach((p, i) => {
      add(p, t, PPQ * 1.5, 0.62 - i * 0.04);
      add(p, t + PPQ * 2, PPQ * 1.5, 0.52 - i * 0.04);
    });
    add(bass[bar], t, PPQ * 0.75, 0.9);
    add(bass[bar], t + PPQ * 1.5, E, 0.7);
    add(bass[bar] + 12, t + PPQ * 2.5, E, 0.6);
    add(bass[bar], t + PPQ * 3, PPQ * 0.75, 0.78);
  });

  const melody: Array<[number, number, number, number]> = [
    [79, 0, E + S, 0.86],
    [75, E + S, S, 0.6],
    [77, PPQ, E, 0.7],
    [79, PPQ * 1.5, PPQ, 0.82],
    [80, BAR, E, 0.9],
    [79, BAR + E, E, 0.66],
    [77, BAR + PPQ, PPQ, 0.74],
    [75, BAR + PPQ * 2.5, E, 0.58],
    [74, BAR * 2, E + S, 0.8],
    [75, BAR * 2 + E + S, S, 0.55],
    [77, BAR * 2 + PPQ, E, 0.7],
    [79, BAR * 2 + PPQ * 1.5, PPQ * 1.5, 0.88],
    [82, BAR * 3, E, 0.95],
    [79, BAR * 3 + E, E, 0.7],
    [77, BAR * 3 + PPQ, E, 0.66],
    [74, BAR * 3 + PPQ * 1.5, PPQ * 2, 0.78],
  ];
  for (const [p, t, d, v] of melody) add(p, t, d, v);
  return notes;
}
