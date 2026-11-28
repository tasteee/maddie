import { describe, expect, it } from 'vitest';
import { parseProject } from '../src/app/project-file';
import { createEditor, type ChordRegion, type Note, type Section, type Track } from '../src/core';

const bar = 1920;
const at = (number: number) => (number - 1) * bar;
const ids = (...values: string[]) => new Set(values);
const label = (id: string, durationBars: number): Section => ({ id, name: id, color: 'blue', durationBars });
const note = (id: string, start: number, duration = 120, pitch = 60): Note => ({ id, start, duration, pitch, velocity: 0.7 });
const chord = (id: string, start: number, duration = 480): ChordRegion => ({
  id, start, duration, symbol: 'C', pitches: [60, 64, 67], intervals: [0, 4, 7], root: 0, velocity: 0.7,
});

function setup(sections: readonly Section[], tracks: Track[]) {
  return createEditor({ doc: { ppq: 480, sections, tracks } });
}

describe('arrangement sections', () => {
  it('labels, splits, resizes and removes labels in place over an existing song', () => {
    const notes = [note('intro', 0), note('verse', at(4) + 17), note('chorus', at(6))];
    const ed = setup([], [{ id: 'melody', notes }]);
    const first = ed.sections.append();
    const second = ed.sections.append();
    const split = ed.sections.split(second, 6)!;
    ed.sections.resize(first, 10);
    expect(ed.sections.items.map(({ durationBars }) => durationBars)).toEqual([4, 1, 3]);
    ed.sections.resize(split, -2);
    ed.sections.remove(ids(first, split), false);
    expect(ed.sections.items).toEqual([{ ...ed.sections.items[0], id: second, durationBars: 6 }]);
    ed.sections.remove(ids(second), false);
    expect(ed.sections.items).toEqual([]);
    expect(ed.doc.tracks[0].notes).toEqual(notes);
    ed.undo();
    expect(ed.sections.items.map(({ id }) => id)).toEqual([second]);
  });

  it('swaps unequal sections with MIDI and rendered chord performances, and undoes atomically', () => {
    const performance = { templateId: 'test', groupId: 'shared', key: 'C', scale: 'major', phaseTicks: 30 };
    const c1 = { ...chord('c1', at(4) + 100), performance };
    const c2 = { ...chord('c2', at(5) + 110), performance };
    const ed = setup([label('Verse', 4), label('Chorus', 8)], [
      { id: 'midi', notes: [note('v', at(3)), note('c', at(5) + 24), note('tail', at(14))] },
      { id: 'chords', chordRegions: [c1, c2], notes: [
        { ...note('render-v', c1.start + 23), chordRegionId: c1.id },
        { ...note('render-c', c2.start + 31), chordRegionId: c2.id },
      ] },
    ]);
    const before = ed.doc;
    ed.sections.move(ids('Chorus'), 0);
    expect(ed.sections.ranges().map(({ startBar }) => startBar)).toEqual([1, 9]);
    expect(ed.doc.tracks[0].notes.map(({ id, start }) => [id, start])).toEqual([
      ['c', 24], ['v', at(11)], ['tail', at(14)],
    ]);
    const harmony = ed.doc.tracks[1];
    expect(harmony.notes.map(({ id, start }) => [id, start])).toEqual([
      ['render-c', 141], ['render-v', at(12) + 123],
    ]);
    expect(harmony.chordRegions?.[0].performance?.phaseTicks).toBe(30 + c2.start - c1.start);
    expect(harmony.chordRegions?.[1].performance?.phaseTicks).toBe(30);
    expect(ed.sections.end).toBe(at(13));
    expect(ed.transport.marker).toBe(0);
    ed.undo();
    expect(ed.doc).toEqual(before);
    ed.redo();
    expect(ed.doc.tracks[1]).toEqual(harmony);
  });

  it('leaves the whole project untouched when a held chord would collide on another track', () => {
    const ed = setup([label('A', 1), label('B', 1), label('C', 1)], [
      { id: 'midi', notes: [note('a', 0)] },
      { id: 'harmony', name: 'Harmony', chordRegions: [
        chord('sustain', at(2) + 1000, bar), chord('opening', 0),
      ].sort((a, b) => a.start - b.start), notes: [] },
    ]);
    const before = ed.doc;
    expect(() => ed.sections.move(ids('A'), 1)).toThrow('Music would overlap on Harmony at bar 2');
    expect(ed.doc).toBe(before);
    expect(ed.history.canUndo).toBe(false);
  });

  it('copies whole tails and removes non-contiguous ranges using original ownership', () => {
    const long = note('a', at(2) - 90, 240);
    const ed = setup([label('A', 1), label('B', 2), label('C', 1)], [
      { id: 'midi', notes: [long, note('b', at(2), 120, 63), note('c', at(4), 120, 65), note('tail', at(5), 120, 69)] },
    ]);
    const copy = ed.sections.insert('A', true, true)!;
    expect(ed.doc.tracks[0].notes.find((item) => item.id !== long.id && item.pitch === long.pitch))
      .toMatchObject({ start: at(3) - 90, duration: 240 });
    ed.sections.remove(ids(copy, 'C'), true);
    expect(ed.sections.items.map(({ id }) => id)).toEqual(['A', 'B']);
    expect(ed.doc.tracks[0].notes.map(({ id, start }) => [id, start])).toEqual([
      ['a', long.start], ['b', at(2)], ['tail', at(4)],
    ]);
  });

  it('uses start membership for cross-track selection and pastes back onto the original tracks', () => {
    const c = chord('c', at(2), bar + 200);
    const ed = setup([label('A', 1), label('B', 1)], [
      { id: 'midi', notes: [note('pickup', at(2) - 120, 240), note('b', at(2) + 10)] },
      { id: 'harmony', chordRegions: [c], notes: [{ ...note('render', c.start + 80), chordRegionId: c.id }] },
    ]);
    ed.sections.selectContent(ids('B'), false);
    expect([...ed.selection]).toEqual(['b']);
    expect(ed.sections.allTracksSelected).toBe(false);
    ed.sections.selectContent(ids('B'), true);
    expect([...ed.selection]).toEqual(['b']);
    ed.setActiveTrack('harmony');
    expect([...ed.selection]).toEqual(['c']);
    ed.sections.moveContent(bar * 2);
    expect(ed.sections.ranges()[1].start).toBe(at(2));
    expect(ed.doc.tracks[0].notes.map(({ start }) => start)).toEqual([at(2) - 120, at(4) + 10]);
    expect(ed.chordRegions?.[0].start).toBe(at(4));
    ed.sections.copyContent();
    ed.sections.deleteContent();
    expect(ed.doc.tracks[0].notes.map(({ id }) => id)).toEqual(['pickup']);
    expect(ed.chordRegions).toEqual([]);
    ed.sections.pasteContent(at(7));
    expect(ed.doc.tracks[0].notes[1]).toMatchObject({ start: at(7) + 10 });
    expect(ed.chordRegions?.[0]).toMatchObject({ start: at(7), duration: c.duration });
    expect(ed.notes()[0].chordRegionId).toBe(ed.chordRegions?.[0].id);
  });

  it('keeps label operations available with a changing meter and persists stable IDs', () => {
    const ed = setup([label('A', 2), label('B', 2)], [{ id: 'midi', notes: [] }]);
    ed.transact('Mixed meter', (tx) => tx.setMeta('timeSignature', [
      { tick: 0, numerator: 4, denominator: 4 },
      { tick: at(3), numerator: 3, denominator: 4 },
    ]));
    expect(ed.sections.ranges().map(({ start, end }) => [start, end])).toEqual([[0, at(3)], [at(3), at(3) + 2880]]);
    ed.sections.resize('A', 1);
    expect(ed.sections.ranges()[1].start).toBe(at(3) + 1440);
    expect(() => ed.sections.insert('A', false)).toThrow('single time signature');
    const file = { format: 'maddie', version: 1, name: 'Sections', doc: ed.doc };
    expect(parseProject(JSON.stringify(file)).doc.sections).toEqual(ed.sections.items);
    const { sections: _sections, ...oldDoc } = file.doc;
    expect(createEditor({ doc: parseProject(JSON.stringify({ ...file, doc: oldDoc })).doc }).sections.items).toEqual([]);
  });
});
