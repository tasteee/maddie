import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  accentChords, clearChordDynamics, createEditor, humanizeChords, levelChords, loadScaled, pitchRangeChords, rampChords, type ChordRegion,
} from '../src/core';

const chord = (start: number, duration: number): Omit<ChordRegion, 'id'> => ({
  symbol: 'Cmaj7', root: 0, intervals: [0, 4, 7, 11], pitches: [60, 64, 67, 71], start, duration, velocity: 0.8,
});

const setup = () => {
  const editor = createEditor({ doc: { ppq: 480, key: { root: 0, scale: 'major' } } });
  editor.chordTrack.enable();
  editor.chordTrack.add(chord(0, 1920));
  editor.chordTrack.add(chord(1920, 1920));
  editor.commands.selectAll();
  return editor;
};

const velocitiesOf = (editor: ReturnType<typeof setup>, regionId: string) =>
  editor.notes().filter((note) => note.chordRegionId === regionId).map((note) => note.velocity);

beforeAll(loadScaled);

describe('chord dynamics', () => {
  it('sets a plain chord level and keeps it through a move', () => {
    const editor = setup();
    const [first] = editor.chordRegions!;
    editor.chordTrack.commitChanged(levelChords([first], 0.5), 'Velocity');
    expect(velocitiesOf(editor, first.id).every((velocity) => velocity === 0.5)).toBe(true);
    const moved = editor.chordTrack.planResize(first.id, 'end', 960)!;
    editor.chordTrack.commit(editor.chordTrack.prepare(moved)!, 'Resize chord');
    expect(velocitiesOf(editor, first.id).every((velocity) => velocity === 0.5)).toBe(true);
  });

  it('ramps across the selection as one line', () => {
    const editor = setup();
    const regions = editor.chordRegions!;
    const ramped = rampChords(regions, 0.2, 1, true);
    expect(ramped[0].dynamics!.ramp!.from).toBeCloseTo(0.2);
    expect(ramped[0].dynamics!.ramp!.to).toBeCloseTo(0.6);
    expect(ramped[1].dynamics!.ramp!.from).toBeCloseTo(0.6);
    expect(ramped[1].dynamics!.ramp!.to).toBeCloseTo(1);
    const each = rampChords(regions, 0.2, 1, false);
    expect(each.every((region) => region.dynamics!.ramp!.from === 0.2 && region.dynamics!.ramp!.to === 1)).toBe(true);
  });

  it('reapplies a pitch-based velocity range after a new voicing or performance pattern', async () => {
    const scaled = await loadScaled();
    const editor = setup();
    const [first] = editor.chordRegions!;
    editor.select([first.id]);
    const lo = 50 / 127;
    const hi = 90 / 127;
    const byPitch = () => editor.selectedNotes.slice().sort((a, b) => a.pitch - b.pitch);
    const pitches = () => byPitch().map((note) => note.pitch);
    editor.chordTrack.commitChanged(pitchRangeChords([first], lo, hi), 'Velocity range');
    expect(byPitch()[0].velocity).toBeCloseTo(lo);
    expect(byPitch().at(-1)?.velocity).toBeCloseTo(hi);

    const originalPitches = pitches();
    editor.chordTrack.commit(editor.chordTrack.previewStyle({ voicing: 'open' })!, 'Voice chord');
    expect(pitches()).not.toEqual(originalPitches);
    expect(byPitch()[0].velocity).toBeCloseTo(lo);
    expect(byPitch().at(-1)?.velocity).toBeCloseTo(hi);

    const templateId = scaled.performanceTemplates.find((template) => template.category === 'Rhythms')!.id;
    editor.chordTrack.commit(editor.chordTrack.previewStyle({ templateId })!, 'Apply rhythm');
    expect(editor.selectedChordRegions[0].dynamics?.pitchRange).toEqual({ min: lo, max: hi });
    const hits = velocitiesOf(editor, first.id);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((value) => value >= lo && value <= hi)).toBe(true);
    editor.chordTrack.commitChanged(pitchRangeChords(editor.selectedChordRegions, hi, hi), 'Fixed velocity');
    expect(velocitiesOf(editor, first.id).every((value) => value === hi)).toBe(true);
  });

  it('mutes a chord and its pattern without moving hits, and keeps the mute during revoicing', async () => {
    const scaled = await loadScaled();
    const editor = setup();
    const templateId = scaled.performanceTemplates.find((template) => template.category === 'Rhythms')!.id;
    editor.chordTrack.commit(editor.chordTrack.previewStyle({ templateId })!, 'Apply rhythm');
    const [first, second] = editor.chordRegions!;
    editor.select([first.id]);
    const original = editor.notes();
    const hits = () => editor.notes().filter((note) => note.chordRegionId === first.id);
    editor.commands.toggleMute();
    expect(editor.selectedChordRegions[0]).toEqual({ ...first, muted: true });
    expect(editor.chordRegions![1]).toBe(second);
    expect(editor.notes()).toEqual(original.map((note) => note.chordRegionId === first.id ? { ...note, muted: true } : note));
    const audition = vi.spyOn(editor, 'auditionNotes');
    const stop = editor.chordTrack.auditionLoop(editor.selectedChordRegions[0]);
    expect(audition).not.toHaveBeenCalled();
    stop();
    audition.mockRestore();
    editor.undo();
    expect(editor.notes()).toEqual(original);
    editor.redo();
    editor.chordTrack.commit(editor.chordTrack.previewStyle({ inversion: 1 })!, 'Voice chord');
    expect(hits().length).toBeGreaterThan(0);
    expect(hits().every((note) => note.muted)).toBe(true);
    editor.commands.toggleMute([hits()[0].id]);
    expect(editor.selectedChordRegions[0].muted).toBeUndefined();
    expect(hits().some((note) => note.muted)).toBe(false);
  });

  it('ramps the hits of a patterned chord and keeps the shaping after a new pattern', async () => {
    const scaled = await loadScaled();
    const editor = setup();
    const templateId = scaled.performanceTemplates.find((template) => template.category === 'Rhythms')!.id;
    editor.chordTrack.commit(editor.chordTrack.previewStyle({ templateId })!, 'Apply rhythm');
    const first = editor.chordRegions![0];
    editor.chordTrack.commitChanged(rampChords([first], 0.1, 1, false), 'Ramp');
    const hits = editor.notes().filter((note) => note.chordRegionId === first.id).sort((a, b) => a.start - b.start);
    expect(hits[0].velocity).toBeLessThan(hits[hits.length - 1].velocity);
    const otherTemplate = scaled.performanceTemplates.find((template) => template.category === 'Rhythms' && template.id !== templateId)!.id;
    editor.commands.selectAll();
    editor.chordTrack.commit(editor.chordTrack.previewStyle({ templateId: otherTemplate })!, 'Apply rhythm');
    expect(editor.chordRegions![0].dynamics?.ramp).toEqual({ from: 0.1, to: 1 });
  });

  it('humanizes the same way on every rebuild, and differently with a new seed', () => {
    const editor = setup();
    const first = editor.chordRegions![0];
    editor.chordTrack.commitChanged(humanizeChords([first], 0.2, 7), 'Humanize');
    const take = velocitiesOf(editor, first.id);
    expect(new Set(take).size).toBeGreaterThan(1);
    const resized = editor.chordTrack.planResize(first.id, 'end', 1000)!;
    editor.chordTrack.commit(editor.chordTrack.prepare(resized)!, 'Resize chord');
    expect(velocitiesOf(editor, first.id)).toEqual(take);
    editor.chordTrack.commitChanged(humanizeChords([editor.chordRegions![0]], 0.2, 8), 'Humanize');
    expect(velocitiesOf(editor, first.id)).not.toEqual(take);
  });

  it('accents downbeats and clears back to plain', () => {
    const editor = setup();
    const [first, second] = editor.chordRegions!;
    editor.chordTrack.commitChanged(accentChords([first, second], 'downbeats'), 'Accent');
    expect(velocitiesOf(editor, first.id).every((velocity) => Math.abs(velocity - 0.96) < 1e-9)).toBe(true);
    editor.chordTrack.commitChanged(clearChordDynamics(editor.chordRegions!), 'Clear');
    expect(editor.chordRegions!.every((region) => region.dynamics === undefined)).toBe(true);
    expect(velocitiesOf(editor, first.id).every((velocity) => velocity === 0.8)).toBe(true);
  });
});
