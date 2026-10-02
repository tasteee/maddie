import { describe, expect, it } from 'vitest';
import {
  barsInRange,
  buildRowMap,
  createEditor,
  detectKey,
  formatKey,
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
import { demoSong } from '../playground/demo-song';

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

describe('computer keyboard mapping', () => {
  it('maps each key to a semitone by default', async () => {
    const { pitchForOffset } = await import('../src/engine/computer-keyboard');
    const ed = createEditor();
    ed.transact('key', (tx) => tx.setMeta('key', { root: 2, scale: 'minor' }));
    expect([0, 1, 2, 3].map((o) => pitchForOffset(ed, o))).toEqual([36, 37, 38, 39]);
  });
  it('maps keys to scale steps from the tonic when scale mode is on', async () => {
    const { pitchForOffset, keyLabelsByPitch } = await import('../src/engine/computer-keyboard');
    const ed = createEditor();
    ed.transact('key', (tx) => tx.setMeta('key', { root: 2, scale: 'minor' })); // D minor
    ed.setView({ keyboardScale: true });
    // D E F G A B♭ C D
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((o) => pitchForOffset(ed, o))).toEqual([38, 40, 41, 43, 45, 46, 48, 50]);
    expect(keyLabelsByPitch(ed).get(38)).toBe('Z');
    expect(keyLabelsByPitch(ed).has(39)).toBe(false);
  });
  it('falls back to semitones with no key', async () => {
    const { pitchForOffset } = await import('../src/engine/computer-keyboard');
    const ed = createEditor();
    ed.setView({ keyboardScale: true });
    expect(pitchForOffset(ed, 1)).toBe(37);
  });
});

describe('pitch nudge through folds', () => {
  const setup = (fold: 'scale' | 'used') => {
    const ed = createEditor();
    ed.transact('key', (tx) => tx.setMeta('key', { root: 0, scale: 'major' })); // C major
    ed.setView({ fold });
    return ed;
  };
  it('scale fold: steps to the next scale note', () => {
    const ed = setup('scale');
    const [n] = ed.commands.add([{ pitch: 64, start: 0, duration: 120, velocity: 0.8 }]); // E4
    ed.commands.nudgePitch([n.id], 1);
    expect(ed.getNote(n.id)!.pitch).toBe(65); // F4
    ed.commands.nudgePitch([n.id], 1);
    expect(ed.getNote(n.id)!.pitch).toBe(67); // G4, skips F♯
  });
  it('scale fold: an off-scale note steps onto the scale', () => {
    const ed = setup('scale');
    const [n] = ed.commands.add([{ pitch: 61, start: 0, duration: 120, velocity: 0.8 }]); // C♯4
    ed.commands.nudgePitch([n.id], 1);
    expect(ed.getNote(n.id)!.pitch).toBe(62);
    ed.commands.nudgePitch([n.id], -1);
    expect(ed.getNote(n.id)!.pitch).toBe(60);
  });
  it('used fold: moves between used rows, blocked at the edge', () => {
    const ed = setup('used');
    const [a, , c] = ed.commands.add([
      { pitch: 60, start: 0, duration: 120, velocity: 0.8 },
      { pitch: 67, start: 0, duration: 120, velocity: 0.8 },
      { pitch: 72, start: 480, duration: 120, velocity: 0.8 },
    ]);
    ed.commands.nudgePitch([a.id], 1);
    expect(ed.getNote(a.id)!.pitch).toBe(67);
    // Top row selected with another: nothing has room above, so nothing moves.
    ed.commands.nudgePitch([a.id, c.id], 1);
    expect(ed.getNote(a.id)!.pitch).toBe(67);
    expect(ed.getNote(c.id)!.pitch).toBe(72);
  });
});

describe('pitch nudge audition', () => {
  it('plays the moved chord, cuts the previous one, stops after 0.5s', async () => {
    const { vi } = await import('vitest');
    vi.useFakeTimers();
    const log: string[] = [];
    const ed = createEditor({
      output: { noteOn: (e) => log.push(`on ${e.pitch}`), noteOff: (e) => log.push(`off ${e.pitch}`), allNotesOff: () => {} },
    });
    const chord = ed.commands.add([60, 64, 67].map((pitch) => ({ pitch, start: 0, duration: 480, velocity: 0.8 })));
    ed.commands.nudgePitch(chord.map((n) => n.id), 1);
    expect(log).toEqual(['on 61', 'on 65', 'on 68']);
    log.length = 0;
    ed.commands.nudgePitch(chord.map((n) => n.id), 1);
    expect(log).toEqual(['off 61', 'off 65', 'off 68', 'on 62', 'on 66', 'on 69']);
    log.length = 0;
    vi.advanceTimersByTime(500);
    expect(log).toEqual(['off 62', 'off 66', 'off 69']);
    vi.useRealTimers();
  });
});

describe('detectKey', () => {
  const mk = (pitches: number[], dur = 480) => pitches.map((pitch, i) => ({ pitch, start: i * dur, duration: dur }));

  it('finds C major from a C major scale and cadence', () => {
    const g = detectKey(mk([60, 62, 64, 65, 67, 69, 71, 72, 67, 60]))!;
    expect(formatKey(g.key)).toBe('C Major');
    expect(g.fit).toBe(1);
  });

  it('finds A minor from the relative minor notes', () => {
    const g = detectKey(mk([45, 57, 60, 64, 62, 60, 59, 57, 52, 57]))!;
    expect(formatKey(g.key)).toBe('A Minor');
  });

  it('prefers harmonic minor when the raised 7th shows up', () => {
    const g = detectKey(mk([45, 57, 59, 60, 62, 64, 65, 68, 69, 64, 57]))!;
    expect(formatKey(g.key)).toBe('A Harmonic Minor');
    expect(g.outside).toBe(0);
  });

  it('picks the closest scale when nothing fits perfectly', () => {
    const g = detectKey(mk([60, 62, 64, 65, 67, 69, 71, 72, 60, 61]))!;
    expect(g.key.root).toBe(0);
    expect(g.outside).toBe(1);
    expect(g.fit).toBeLessThan(1);
  });

  it('finds C minor in the demo song (not its relative major)', () => {
    expect(formatKey(detectKey(demoSong())!.key)).toBe('C Minor');
  });

  it('returns null with no notes', () => {
    expect(detectKey([])).toBeNull();
  });
});
