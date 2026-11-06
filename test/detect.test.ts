import { describe, expect, it } from 'vitest';
import { analyzeChords, analyzeSelection, detectChord, parseKey, type Note } from '../src/core';

const PPQ = 960;
const BEAT = PPQ;
const BAR = PPQ * 4;
const CHORD_OPTIONS = { key: null, minDuration: PPQ / 2 };

let noteCounter = 0;
const buildNote = (pitch: number, start: number, duration: number): Note => {
  noteCounter += 1;
  return { id: `n${noteCounter}`, pitch, start, duration, velocity: 0.8 };
};

const buildChordNotes = (pitches: number[], start: number, duration: number): Note[] => pitches.map((pitch) => buildNote(pitch, start, duration));

describe('detectChord', () => {
  it('names triads from any octave spread', () => {
    expect(detectChord([60, 64, 67])?.name).toBe('C');
    expect(detectChord([48, 64, 79])?.name).toBe('C');
    expect(detectChord([57, 60, 64])?.name).toBe('Am');
    expect(detectChord([62, 65, 69])?.name).toBe('Dm');
  });

  it('names sevenths and extensions', () => {
    expect(detectChord([60, 64, 67, 71])?.name).toBe('Cmaj7');
    expect(detectChord([67, 71, 74, 77])?.name).toBe('G7');
    expect(detectChord([60, 63, 67, 70, 74])?.name).toBe('Cm9');
  });

  it('writes a slash chord when the bass is not the root', () => {
    const firstInversion = detectChord([64, 67, 72]);
    expect(firstInversion?.name).toBe('C/E');
    expect(firstInversion?.root).toBe(0);
    expect(firstInversion?.bass).toBe(4);
    expect(detectChord([67, 72, 76])?.name).toBe('C/G');
  });

  it('prefers the chord rooted on the bass note', () => {
    expect(detectChord([60, 64, 67, 69])?.name).toBe('C6');
    expect(detectChord([57, 60, 64, 67])?.name).toBe('Am7');
  });

  it('prefers a slash chord over an exotic add chord', () => {
    expect(detectChord([64, 67, 71, 72])?.name).toBe('Cmaj7/E');
  });

  it('names sus chords and power chords', () => {
    expect(detectChord([60, 62, 67])?.name).toBe('Csus2');
    expect(detectChord([60, 65, 67])?.name).toBe('Csus4');
    expect(detectChord([60, 67])?.name).toBe('C5');
    expect(detectChord([60, 67, 72])?.name).toBe('C5');
  });

  it('returns null for too few or unrelated notes', () => {
    expect(detectChord([])).toBeNull();
    expect(detectChord([60])).toBeNull();
    expect(detectChord([60, 64])).toBeNull();
    expect(detectChord([60, 61, 62, 63, 64, 65])).toBeNull();
  });

  it('labels the degree in a key', () => {
    const key = parseKey('C major')!;
    expect(detectChord([67, 71, 74], key)?.degree).toBe('V');
    expect(detectChord([57, 60, 64], key)?.degree).toBe('vi');
    expect(detectChord([57, 60, 64])?.degree).toBe('');
  });

  it('prefers a chord that fits the key when two readings tie', () => {
    const dMinorKey = parseKey('D minor')!;
    expect(detectChord([62, 65, 69, 71], dMinorKey)?.name).toBe('Dm6');
  });
});

describe('analyzeChords', () => {
  it('finds a progression in order', () => {
    const notes = [
      ...buildChordNotes([60, 64, 67], 0, BAR),
      ...buildChordNotes([57, 60, 64], BAR, BAR),
      ...buildChordNotes([65, 69, 72], BAR * 2, BAR),
      ...buildChordNotes([55, 59, 62], BAR * 3, BAR),
    ];
    const spans = analyzeChords(notes, CHORD_OPTIONS);
    expect(spans.map((span) => span.chord.name)).toEqual(['C', 'Am', 'F', 'G']);
    expect(spans[0].start).toBe(0);
    expect(spans[0].end).toBe(BAR);
    expect(spans[3].end).toBe(BAR * 4);
  });

  it('finds nothing in a single-note melody', () => {
    const melody = [60, 62, 64, 65, 67, 69, 71, 72].map((pitch, index) => buildNote(pitch, index * BEAT, BEAT));
    expect(analyzeChords(melody, CHORD_OPTIONS)).toEqual([]);
  });

  it('keeps one chord when a note is released a little early', () => {
    const notes = [buildNote(60, 0, BAR), buildNote(64, 0, BAR - 20), buildNote(67, 0, BAR)];
    const spans = analyzeChords(notes, CHORD_OPTIONS);
    expect(spans.map((span) => span.chord.name)).toEqual(['C']);
    expect(spans[0].end).toBeGreaterThan(BAR - 50);
  });

  it('drops a chord shorter than the minimum', () => {
    const notes = [...buildChordNotes([60, 64, 67], 0, BAR), ...buildChordNotes([62, 65, 69], BAR, 100)];
    const spans = analyzeChords(notes, CHORD_OPTIONS);
    expect(spans.map((span) => span.chord.name)).toEqual(['C']);
  });

  it('ignores muted notes', () => {
    const notes = buildChordNotes([60, 64, 67], 0, BAR);
    notes[0].muted = true;
    notes[1].muted = true;
    expect(analyzeChords(notes, CHORD_OPTIONS)).toEqual([]);
  });

  it('collects the ids of the notes in each span', () => {
    const notes = buildChordNotes([60, 64, 67], 0, BAR);
    const spans = analyzeChords(notes, CHORD_OPTIONS);
    expect(spans[0].noteIds.sort()).toEqual(notes.map((note) => note.id).sort());
  });
});

describe('analyzeSelection', () => {
  const selectionOptions = { key: null, minDuration: PPQ / 8 };

  it('names a block chord', () => {
    const notes = buildChordNotes([60, 64, 67, 71], 0, BAR);
    expect(analyzeSelection(notes, selectionOptions).map((span) => span.chord.name)).toEqual(['Cmaj7']);
  });

  it('names a selected arpeggio as one chord', () => {
    const notes = [buildNote(60, 0, BEAT), buildNote(64, BEAT, BEAT), buildNote(67, BEAT * 2, BEAT)];
    expect(analyzeSelection(notes, selectionOptions).map((span) => span.chord.name)).toEqual(['C']);
  });

  it('returns nothing for a lone note', () => {
    expect(analyzeSelection([buildNote(60, 0, BEAT)], selectionOptions)).toEqual([]);
  });
});
