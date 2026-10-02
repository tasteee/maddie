import { describe, expect, it } from 'vitest';
import { CHORD_TYPES, chordFitsKey, chordsInKey, invert, parseKey, pitchClass, scaleMask, voiceChord } from '../src/core';

const type = (id: string) => CHORD_TYPES.find((t) => t.id === id)!;

describe('chords', () => {
  it('has unique ids and interval sets', () => {
    expect(new Set(CHORD_TYPES.map((t) => t.id)).size).toBe(CHORD_TYPES.length);
    expect(new Set(CHORD_TYPES.map((t) => t.intervals.join())).size).toBe(CHORD_TYPES.length);
    expect(CHORD_TYPES.length).toBeGreaterThan(100);
  });

  it('only lists chords made of scale notes', () => {
    for (const name of ['C major', 'A minor', 'D dorian', 'E phrygian', 'B locrian', 'A harmonic minor', 'C minor pentatonic']) {
      const key = parseKey(name)!;
      const mask = scaleMask(key);
      for (const g of chordsInKey(key)) {
        for (const c of g.chords) for (const i of c.type.intervals) expect(mask[pitchClass(c.root + i)]).toBe(true);
      }
    }
  });

  it('finds the diatonic chords of C major', () => {
    const key = parseKey('C major')!;
    const names = chordsInKey(key).flatMap((g) => g.chords.map((c) => c.name));
    expect(names).toEqual(expect.arrayContaining(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'B°', 'Cmaj7', 'G7', 'Bø7', 'Dm9', 'G13', 'Csus2', 'Gsus4', 'Cadd9', 'C6/9', 'Fmaj7♯11', 'C5', 'Cmaj7(no5)']));
    expect(names).not.toContain('Cm');
    expect(names).not.toContain('E');
    expect(chordFitsKey(4, type('7♭9'), parseKey('A harmonic minor'))).toBe(true);
  });

  it('labels degrees', () => {
    const groups = chordsInKey(parseKey('A minor')!);
    expect(groups.map((g) => g.degree)).toEqual(['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII']);
    expect(chordsInKey(parseKey('C minor pentatonic')!).map((g) => g.degree)).toEqual(['i', '♭III', 'IV', 'v', '♭VII']);
  });

  it('inverts and voices', () => {
    expect(invert([0, 4, 7], 1)).toEqual([4, 7, 12]);
    expect(invert([0, 4, 7], 2)).toEqual([7, 12, 16]);
    expect(invert([0, 4, 7, 14], 1)).toEqual([4, 7, 14, 24]);
    // Lowest note lands on the nearest E to the pointer, chord keeps its root.
    expect(voiceChord(0, [4, 7, 12], 63)).toEqual([64, 67, 72]);
    expect(voiceChord(0, [0, 4, 7], 60)).toEqual([60, 64, 67]);
    expect(voiceChord(0, [0, 4, 7], 66)).toEqual([60, 64, 67]);
    expect(voiceChord(0, [0, 4, 7], 67)).toEqual([72, 76, 79]);
  });
});
