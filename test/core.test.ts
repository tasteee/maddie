import { describe, expect, it } from 'vitest';
import {
  barsInRange,
  buildRowMap,
  createEditor,
  formatBBT,
  fromMidiVelocity,
  gridTicks,
  nearestInScale,
  parseKey,
  remapVelocities,
  secondsToTicks,
  snapTick,
  ticksToSeconds,
  toMidiVelocity,
  transposeDegrees,
} from '../src/core';

const PPQ = 960;

describe('music', () => {
  it('converts velocity at the edges', () => {
    expect(toMidiVelocity(1)).toBe(127);
    expect(toMidiVelocity(0)).toBe(1);
    expect(fromMidiVelocity(127)).toBe(1);
  });

  it('parses grids', () => {
    expect(gridTicks('1/16', PPQ)).toBe(240);
    expect(gridTicks('1/8T', PPQ)).toBe(320);
    expect(gridTicks('1/8.', PPQ)).toBe(720);
    expect(gridTicks('auto', PPQ)).toBeNull();
  });

  it('snaps', () => {
    expect(snapTick(130, 240)).toBe(240);
    expect(snapTick(110, 240)).toBe(0);
    expect(snapTick(239, 240, [], 'floor')).toBe(0);
  });

  it('parses keys and moves by scale degree', () => {
    const key = parseKey('C minor')!;
    expect(key).toEqual({ root: 0, scale: 'minor' });
    expect(parseKey('F# dorian')).toEqual({ root: 6, scale: 'dorian' });
    expect(nearestInScale(64, key)).toBe(65); // E → F (tie goes up)
    expect(transposeDegrees(60, 2, key)).toBe(63); // C → E♭
    expect(transposeDegrees(60, -1, key)).toBe(58); // C → B♭
  });

  it('converts ticks ↔ seconds through tempo changes', () => {
    const tempo = [
      { tick: 0, bpm: 120 },
      { tick: PPQ * 4, bpm: 60 },
    ];
    expect(ticksToSeconds(PPQ * 4, tempo, PPQ)).toBeCloseTo(2);
    expect(ticksToSeconds(PPQ * 5, tempo, PPQ)).toBeCloseTo(3);
    expect(secondsToTicks(3, tempo, PPQ)).toBeCloseTo(PPQ * 5);
  });

  it('lists bars across time signature changes', () => {
    const sigs = [
      { tick: 0, numerator: 4, denominator: 4 },
      { tick: PPQ * 8, numerator: 3, denominator: 4 },
    ];
    const bars = barsInRange(0, PPQ * 14, sigs, PPQ);
    expect(bars.map((b) => b.index)).toEqual([1, 2, 3, 4]);
    expect(bars[3].tick).toBe(PPQ * 11);
    expect(formatBBT(PPQ * 9, sigs, PPQ)).toBe('3.2.1');
  });

  it('folds rows to the scale', () => {
    const map = buildRowMap({ fold: 'scale', key: parseKey('C major') });
    expect(map.length).toBe(75);
    expect(map.rowOf(61)).toBeNull();
    expect(map.virtual[61]).toBe(map.rowOf(62)! + 0.5);
  });

  it('never folds away a pitch that has notes', () => {
    const map = buildRowMap({ fold: 'scale', key: parseKey('C minor'), used: [64] });
    expect(map.rowOf(64)).not.toBeNull();
    expect(map.rows.find((r) => r.pitch === 64)!.inScale).toBe(false);
  });
});

describe('editor', () => {
  const note = (pitch: number, start: number) => ({ pitch, start, duration: 240, velocity: 0.8 });

  it('adds, moves and undoes', () => {
    const ed = createEditor();
    const [a] = ed.commands.add([note(60, 0)]);
    ed.commands.move([a.id], { ticks: 240, pitches: 2 });
    expect(ed.getNote(a.id)).toMatchObject({ start: 240, pitch: 62 });
    ed.undo();
    expect(ed.getNote(a.id)).toMatchObject({ start: 0, pitch: 60 });
    ed.undo();
    expect(ed.notes()).toHaveLength(0);
    ed.redo();
    ed.redo();
    expect(ed.getNote(a.id)).toMatchObject({ start: 240, pitch: 62 });
  });

  it('coalesces a gesture into one undo step', () => {
    const ed = createEditor();
    const [a] = ed.commands.add([note(60, 0)]);
    for (let i = 1; i <= 5; i++) ed.commands.setVelocity([a.id], { value: i / 10 }, { gestureId: 'g1' });
    ed.undo();
    expect(ed.getNote(a.id)!.velocity).toBe(0.8);
  });

  it('lets beforechange veto an edit', () => {
    const ed = createEditor();
    ed.on('beforechange', (e) => e.preventDefault());
    ed.commands.add([note(60, 0)]);
    expect(ed.notes()).toHaveLength(0);
    expect(ed.history.canUndo).toBe(false);
  });

  it('restores selection with undo', () => {
    const ed = createEditor();
    const [a, b] = ed.commands.add([note(60, 0), note(62, 240)]);
    ed.select([a.id]);
    ed.commands.delete();
    expect(ed.selection.size).toBe(0);
    ed.undo();
    expect([...ed.selection]).toEqual([a.id]);
    expect(ed.getNote(b.id)).toBeTruthy();
  });

  it('queries notes by range', () => {
    const ed = createEditor();
    ed.commands.add([note(60, 0), note(62, 960), { ...note(64, 0), duration: 4000 }]);
    expect(ed.notesInRange(1000, 1100).map((n) => n.pitch).sort()).toEqual([62, 64]);
  });

  it('duplicates after the selection and pastes at the cursor', () => {
    const ed = createEditor();
    ed.commands.add([note(60, 0), note(64, 240)]);
    const copies = ed.commands.duplicate();
    expect(copies.map((n) => n.start)).toEqual([480, 720]);
    ed.commands.copy();
    ed.setView({ cursor: 3840 });
    expect(ed.commands.paste().map((n) => n.start)).toEqual([3840, 4080]);
  });

  it('quantizes with strength', () => {
    const ed = createEditor();
    const [a] = ed.commands.add([note(60, 100)]);
    ed.commands.quantize([a.id], { grid: 240, strength: 0.5 });
    expect(ed.getNote(a.id)!.start).toBe(50);
  });

  it('transposes by scale degree', () => {
    const ed = createEditor({ doc: { key: parseKey('C major') } });
    const [a] = ed.commands.add([note(60, 0)]);
    ed.commands.transpose([a.id], { degrees: 2 });
    expect(ed.getNote(a.id)!.pitch).toBe(64);
  });

  it('humanizes within bounds', () => {
    const ed = createEditor();
    const notes = ed.commands.add(Array.from({ length: 20 }, (_, i) => note(60, 960 + i * 240)));
    ed.commands.humanize(undefined, { timing: 30, velocity: 0.1 });
    notes.forEach((n) => {
      const h = ed.getNote(n.id)!;
      expect(Math.abs(h.start - n.start)).toBeLessThanOrEqual(30);
      expect(Math.abs(h.velocity - n.velocity)).toBeLessThanOrEqual(0.1 + 1e-9);
    });
    ed.undo();
    expect(ed.getNote(notes[0].id)!.start).toBe(960);
  });
});

describe('velocity range', () => {
  const n = (id: string, velocity: number, start = 0) => ({ id, pitch: 60, start, duration: 1, velocity });
  it('rescales a spread into the new range', () => {
    const out = remapVelocities([n('a', 0.4), n('b', 0.5), n('c', 0.6)], 0.4, 0.5);
    expect(out.map((c) => +c.velocity.toFixed(3))).toEqual([0.4, 0.45, 0.5]);
  });
  it('ramps equal velocities by time', () => {
    const out = remapVelocities([n('b', 0.5, 2), n('a', 0.5, 1), n('c', 0.5, 3)], 0.2, 0.4);
    expect(Object.fromEntries(out.map((c) => [c.id, +c.velocity.toFixed(3)]))).toEqual({ a: 0.2, b: 0.3, c: 0.4 });
  });
  it('sets a single value', () => {
    expect(remapVelocities([n('a', 0.1), n('b', 0.9)], 0.7, 0.7).map((c) => c.velocity)).toEqual([0.7, 0.7]);
  });
});

describe('computer keyboard', () => {
  it('wraps octaves C6 → C0 and back', async () => {
    const { stepOctave, KEY_OFFSETS } = await import('../src/engine/computer-keyboard');
    expect(stepOctave(36, 1)).toBe(48);
    expect(stepOctave(84, 1)).toBe(12);
    expect(stepOctave(12, -1)).toBe(84);
    expect(KEY_OFFSETS.get('KeyZ')).toBe(0);
    expect(KEY_OFFSETS.get('KeyX')).toBe(1);
    expect(KEY_OFFSETS.get('KeyA')).toBe(10); // row above continues where Z row ended
  });
});

