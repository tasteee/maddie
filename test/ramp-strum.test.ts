import { describe, expect, it } from 'vitest';
import { createEditor, rampVelocities, strumChanges, type Note } from '../src/core';

const PPQ = 960;
const makeNote = (id: string, pitch: number, start: number, duration = PPQ): Note => ({ id, pitch, start, duration, velocity: 0.8 });

describe('velocity ramp', () => {
  it('steps evenly from the first note to the last', () => {
    const notes = Array.from({ length: 11 }, (_, index) => makeNote(`n${index}`, 60, index * PPQ));
    const steps = rampVelocities(notes, 0, 1).map((change) => Math.round(change.velocity * 100));
    expect(steps).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });

  it('orders by time, not by the order notes are given', () => {
    const notes = [makeNote('late', 60, 2 * PPQ), makeNote('early', 60, 0), makeNote('middle', 60, PPQ)];
    const byId = Object.fromEntries(rampVelocities(notes, 0.2, 0.6).map((change) => [change.id, change.velocity]));
    expect(byId.early).toBeCloseTo(0.2);
    expect(byId.middle).toBeCloseTo(0.4);
    expect(byId.late).toBeCloseTo(0.6);
  });

  it('gives notes that start together the same step', () => {
    const notes = [makeNote('a', 60, 0), makeNote('b', 64, 0), makeNote('c', 60, PPQ)];
    const byId = Object.fromEntries(rampVelocities(notes, 0, 1).map((change) => [change.id, change.velocity]));
    expect(byId.a).toBe(0);
    expect(byId.b).toBe(0);
    expect(byId.c).toBe(1);
  });

  it('ramps a single chord from its lowest pitch to its highest', () => {
    const notes = [makeNote('high', 67, 0), makeNote('low', 60, 0), makeNote('mid', 64, 0)];
    const byId = Object.fromEntries(rampVelocities(notes, 0, 1).map((change) => [change.id, change.velocity]));
    expect(byId.low).toBe(0);
    expect(byId.mid).toBe(0.5);
    expect(byId.high).toBe(1);
  });

  it('is one undo step through the command', () => {
    const editor = createEditor();
    const added = editor.commands.add([0, 1, 2].map((index) => ({ pitch: 60, start: index * PPQ, duration: PPQ, velocity: 0.8 })));
    editor.commands.rampVelocity(undefined, 0, 1);
    const velocities = (): number[] => editor.notes().map((note) => note.velocity).sort();
    expect(velocities()).toEqual([0, 0.5, 1]);
    editor.undo();
    expect(velocities()).toEqual([0.8, 0.8, 0.8]);
    expect(added).toHaveLength(3);
  });
});

describe('strum', () => {
  const chord = [makeNote('low', 60, 0), makeNote('mid', 64, 0), makeNote('high', 67, 0)];

  it('down starts the lowest note first and keeps every note end', () => {
    const changes = strumChanges(chord, 'down', 1);
    const byId = Object.fromEntries(changes.map((change) => [change.id, change]));
    expect(byId.low.start).toBe(0);
    expect(byId.mid.start).toBe(PPQ / 4);
    expect(byId.high.start).toBe(PPQ / 2);
    for (const change of changes) expect(change.start + change.duration).toBe(PPQ);
  });

  it('up starts the highest note first', () => {
    const byId = Object.fromEntries(strumChanges(chord, 'up', 1).map((change) => [change.id, change]));
    expect(byId.high.start).toBe(0);
    expect(byId.low.start).toBe(PPQ / 2);
  });

  it('scales the spread with the amount, and 0 changes nothing', () => {
    const half = Object.fromEntries(strumChanges(chord, 'down', 0.5).map((change) => [change.id, change.start]));
    expect(half.high).toBe(PPQ / 4);
    const none = strumChanges(chord, 'down', 0);
    expect(none.every((change) => change.start === 0)).toBe(true);
  });

  it('strums each chord on its own and leaves single notes alone', () => {
    const notes = [...chord, makeNote('c2a', 60, PPQ), makeNote('c2b', 64, PPQ), makeNote('solo', 72, 2 * PPQ)];
    const ids = strumChanges(notes, 'down', 1).map((change) => change.id);
    expect(ids).toContain('c2b');
    expect(ids).not.toContain('solo');
  });

  it('works through the command and undoes in one step', () => {
    const editor = createEditor();
    editor.commands.add([60, 64, 67].map((pitch) => ({ pitch, start: 0, duration: PPQ, velocity: 0.8 })));
    editor.commands.strum(undefined, 'down', 1);
    const starts = (): number[] => editor.notes().map((note) => note.start).sort((a, b) => a - b);
    expect(starts()).toEqual([0, PPQ / 4, PPQ / 2]);
    editor.undo();
    expect(starts()).toEqual([0, 0, 0]);
  });
});
