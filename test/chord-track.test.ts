import { beforeAll, describe, expect, it } from 'vitest';
import { createEditor, loadScaled, type ChordRegion } from '../src/core';

const chord = (start: number, duration: number, root = 0): Omit<ChordRegion, 'id'> => ({
  symbol: root === 0 ? 'Cmaj7' : 'Am7',
  root,
  intervals: root === 0 ? [0, 4, 7, 11] : [0, 3, 7, 10],
  pitches: root === 0 ? [60, 64, 67, 71] : [57, 60, 64, 67],
  start,
  duration,
  velocity: 0.8,
});

beforeAll(loadScaled);

describe('Chord Tracks', () => {
  it('selects a chord through any note and protects the generated pitches', () => {
    const editor = createEditor();
    const midi = editor.activeTrackId;
    editor.commands.addTrack({ chords: true });
    expect(editor.chordTrack.add(chord(0, 480))).toBe(true);
    expect(editor.chordTrack.add(chord(479, 480, 9))).toBe(false);

    const notes = editor.notes();
    editor.select([notes[0].id]);
    expect(editor.selectedChordRegions).toHaveLength(1);
    expect(editor.selectedNotes).toEqual(notes);

    editor.commands.update([{ id: notes[0].id, pitch: 1 }]);
    expect(editor.notes()).toEqual(notes);
    expect(editor.commands.add([notes[0]])).toEqual([]);
    expect(editor.notes(midi)).toEqual([]);
  });

  it('reorders unequal regions in one edit and clamps resizing at its new neighbor', () => {
    const editor = createEditor();
    editor.chordTrack.enable();
    editor.chordTrack.add(chord(0, 480));
    editor.chordTrack.add(chord(480, 960, 9));
    const [first, second] = editor.chordRegions!;
    const plan = editor.chordTrack.planMove(first.id, 1080);
    const edit = editor.chordTrack.prepare(plan!)!;
    expect(editor.chordTrack.commit(edit, 'Move chord')).toBe(true);
    expect(editor.chordRegions?.map(({ id, start, duration }) => [id, start, duration])).toEqual([
      [second.id, 0, 960], [first.id, 960, 480],
    ]);
    const resized = editor.chordTrack.planResize(second.id, 'end', 1020);
    expect(resized?.[0].duration).toBe(960);
    editor.undo();
    expect(editor.chordRegions).toEqual([first, second]);
  });

  it('keeps factory pattern phase and fractional region boundaries through apply and render to MIDI', async () => {
    const scaled = await loadScaled();
    const editor = createEditor({ doc: { ppq: 480, key: { root: 0, scale: 'major' } } });
    editor.chordTrack.enable();
    editor.chordTrack.add(chord(241, 659));
    editor.chordTrack.add(chord(900, 900, 9));
    editor.commands.selectAll();
    const source = editor.chordRegions!;
    const template = scaled.performanceTemplates.find((item) => item.category === 'Rhythms')!;
    const edit = editor.chordTrack.previewStyle({ voicing: 'drop2', templateId: template.id })!;
    expect(editor.chordRegions).toBe(source);
    const [first, second] = edit.regions;
    expect(first.performance?.groupId).toBe(second.performance?.groupId);
    expect(first.pitches).not.toEqual(source[0].pitches);

    const toChord = (region: ChordRegion) => ({
      symbol: region.symbol, chordType: region.symbol, rootPitch: region.root, intervals: region.intervals, midiNotes: region.pitches,
    });
    const progression = edit.regions.map((region) => ({
      id: region.id, chord: toChord(region), startBeat: (region.start - first.start) / editor.ppq, durationBeats: region.duration / editor.ppq,
    }));
    const context = { key: 'C', scale: 'major', octave: Math.floor(Math.min(...second.pitches) / 12) - 1 };
    const performance = scaled.adaptPerformanceTemplate({
      ...context, template, midiNotes: second.pitches, chordRootPitch: second.root,
    });
    const expectedStarts = scaled.applyPerformance({ ...context, progression, performance }).notes
      .filter((hit) => hit.chordId === second.id)
      .map((hit) => first.start + Math.round(hit.startBeat * editor.ppq));
    expect(expectedStarts.length).toBeGreaterThan(0);
    expect(edit.notes.filter((note) => note.chordRegionId === second.id).map((note) => note.start)).toEqual(expectedStarts);
    for (const note of edit.notes) {
      const region = edit.regions.find((item) => item.id === note.chordRegionId)!;
      expect(note.start).toBeGreaterThanOrEqual(region.start);
      expect(note.start + note.duration).toBeLessThanOrEqual(region.start + region.duration);
    }

    expect(editor.chordTrack.commit(edit, 'Style chords')).toBe(true);
    const saved = createEditor({ doc: JSON.parse(JSON.stringify(editor.doc)) });
    expect(saved.chordRegions).toEqual(editor.chordRegions);
    expect(saved.notes()).toEqual(editor.notes());
    expect(editor.chordTrack.renderToMidi()).toBe(true);
    expect(editor.chordRegions).toBeUndefined();
    expect(editor.notes().map((note) => note.chordRegionId)).toEqual(edit.notes.map(() => undefined));
    expect(editor.selectedNotes).toHaveLength(edit.notes.length);
    editor.undo();
    expect(editor.chordRegions).toBe(edit.regions);
    expect(editor.selectedChordRegions).toHaveLength(2);
    editor.redo();
    expect(editor.chordRegions).toBeUndefined();
    expect(editor.selectedNotes).toHaveLength(edit.notes.length);
  });

  it('swaps adjacent regions with the arrow action and keeps their lengths and selection', async () => {
    const { actions } = await import('../src/engine/keymap');
    const editor = createEditor();
    editor.chordTrack.enable();
    editor.chordTrack.add(chord(0, 300));
    editor.chordTrack.add(chord(300, 240, 9));
    editor.chordTrack.add(chord(540, 400));
    const [first, middle, last] = editor.chordRegions!;
    editor.select([middle.id]);
    actions.nudgeLeft(editor);
    expect(editor.chordRegions?.map(({ id, start, duration }) => [id, start, duration])).toEqual([
      [middle.id, 0, 240], [first.id, 240, 300], [last.id, 540, 400],
    ]);
    actions.nudgeRight(editor);
    expect(editor.chordRegions?.map((region) => region.id)).toEqual([first.id, middle.id, last.id]);
    expect(editor.selectedChordRegions.map((region) => region.id)).toEqual([middle.id]);
  });

  it.each([
    { action: 'nudgeRight', selectedIndex: 0, nudged: 120, touching: 140, swapped: 380 },
    { action: 'nudgeLeft', selectedIndex: 1, nudged: 360, touching: 300, swapped: 0 },
  ] as const)('$action nudges through a gap and swaps on the next press after contact', async ({
    action, selectedIndex, nudged, touching, swapped,
  }) => {
    const { actions } = await import('../src/engine/keymap');
    const editor = createEditor({ doc: { ppq: 480 }, view: { grid: '1/16', snap: true } });
    editor.chordTrack.enable();
    editor.chordTrack.add(chord(0, 300));
    editor.chordTrack.add(chord(440, 240, 9));
    const regions = editor.chordRegions!;
    const selected = regions[selectedIndex];
    const neighbor = regions[1 - selectedIndex];
    editor.select([selected.id]);

    for (const start of [nudged, touching]) {
      actions[action](editor);
      expect(editor.selectedChordRegions[0]).toMatchObject({ id: selected.id, start });
      expect(editor.chordRegions?.[1 - selectedIndex]).toEqual(neighbor);
    }
    actions[action](editor);
    expect(editor.selectedChordRegions[0]).toMatchObject({ id: selected.id, start: swapped, duration: selected.duration });
    expect(editor.chordRegions?.[selectedIndex].id).toBe(neighbor.id);
  });

  it('keeps a gap inside the selection from extending a swap to a distant chord', async () => {
    const { actions } = await import('../src/engine/keymap');
    const editor = createEditor();
    editor.chordTrack.enable();
    editor.chordTrack.add(chord(0, 120));
    editor.chordTrack.add(chord(240, 120, 9));
    editor.chordTrack.add(chord(360, 120));
    const [first, second, third] = editor.chordRegions!;
    editor.select([first.id, second.id]);

    actions.nudgeRight(editor);

    expect(editor.chordRegions?.map(({ id, start }) => [id, start])).toEqual([
      [first.id, 0], [third.id, 240], [second.id, 360],
    ]);
  });

  it('uses the auditioned register and hit timing for a configured placement', async () => {
    const scaled = await loadScaled();
    const editor = createEditor({ doc: { ppq: 480, key: { root: 3, scale: 'major' } } });
    editor.chordTrack.enable();
    const templateId = scaled.performanceTemplates.find((template) => template.category === 'StrummedSequences')!.id;
    const options = { octave: 3, inversion: 1, voicing: 'closed' as const, templateId };
    const harmony = { root: 3, symbol: 'Eb', intervals: [0, 4, 7] };
    const high = editor.chordTrack.draft(harmony, options);
    const low = editor.chordTrack.draft(harmony, { ...options, octave: 2 });
    expect(low.region.pitches).toEqual(high.region.pitches.map((pitch) => pitch - 12));
    expect(low.notes.length).toBeGreaterThan(0);
    expect(editor.chordTrack.placeDraft(low, 500)).toBe(true);
    const noteData = ({ pitch, start, duration, velocity }: typeof low.notes[number]) => ({ pitch, start, duration, velocity });
    expect(editor.notes().map(noteData)).toEqual(low.notes.map((note) => noteData({ ...note, start: 500 + note.start })));
    expect(editor.selectedChordRegions[0].inversion).toBe(1);
    const guitar = (octave: number) => editor.chordTrack.draft(harmony, { ...options, octave, voicing: 'guitar' }).region.pitches;
    expect(guitar(2)).toEqual(guitar(3).map((pitch) => pitch - 12));
  });

  it('trims a patterned chord from the left without moving the hits that remain', async () => {
    const scaled = await loadScaled();
    const editor = createEditor({ doc: { ppq: 480, key: { root: 0, scale: 'major' } } });
    editor.chordTrack.enable();
    editor.chordTrack.add(chord(0, 1920));
    editor.commands.selectAll();
    const templateId = scaled.performanceTemplates.find((template) => template.category === 'Rhythms')!.id;
    editor.chordTrack.commit(editor.chordTrack.previewStyle({ templateId })!, 'Apply rhythm');
    const region = editor.chordRegions![0];
    const hitsAfter = (tick: number) => editor.notes()
      .filter((note) => note.start >= tick)
      .map((note) => [note.pitch, note.start, note.start + note.duration])
      .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const before = hitsAfter(960);
    expect(before.length).toBeGreaterThan(0);
    const trimmed = editor.chordTrack.planResize(region.id, 'start', 960)!;
    editor.chordTrack.commit(editor.chordTrack.prepare(trimmed)!, 'Resize chord');
    expect(editor.chordRegions![0].start).toBe(960);
    expect(hitsAfter(960)).toEqual(before);
  });

  it('trims a plain chord from the left by moving its start', () => {
    const editor = createEditor({ doc: { ppq: 480 } });
    editor.chordTrack.enable();
    editor.chordTrack.add(chord(0, 1920));
    const region = editor.chordRegions![0];
    const trimmed = editor.chordTrack.planResize(region.id, 'start', 480)!;
    editor.chordTrack.commit(editor.chordTrack.prepare(trimmed)!, 'Resize chord');
    expect(editor.notes().every((note) => note.start === 480 && note.duration === 1440)).toBe(true);
  });

  it('pastes and duplicates independent regions with a copied performance phase', async () => {
    const scaled = await loadScaled();
    const editor = createEditor({ doc: { ppq: 480, key: { root: 0, scale: 'major' } } });
    editor.chordTrack.enable();
    editor.chordTrack.add(chord(0, 659));
    editor.chordTrack.add(chord(659, 900, 9));
    editor.commands.selectAll();
    const templateId = scaled.performanceTemplates.find((template) => template.category === 'Rhythms')!.id;
    const edit = editor.chordTrack.previewStyle({ templateId })!;
    editor.chordTrack.commit(edit, 'Apply rhythm');
    const original = editor.chordRegions![1];
    const relativeHits = () => {
      const selected = editor.selectedChordRegions[0];
      return editor.selectedNotes.map((note) => [note.pitch, note.start - selected.start, note.duration]);
    };
    editor.select([original.id]);
    const expected = relativeHits();
    expect(expected.length).toBeGreaterThan(0);
    editor.commands.copy();
    await editor.chordTrack.paste(600);
    const pasted = editor.selectedChordRegions[0];
    expect(pasted.start).toBe(original.start + original.duration);
    expect(pasted.id).not.toBe(original.id);
    expect(pasted.performance?.groupId).not.toBe(original.performance?.groupId);
    expect(relativeHits()).toEqual(expected);
    await editor.chordTrack.duplicate();
    expect(editor.selectedChordRegions[0].start).toBe(pasted.start + pasted.duration);
    expect(relativeHits()).toEqual(expected);
    editor.undo();
    expect(editor.selectedChordRegions[0].id).toBe(pasted.id);
  });

  it('rejects a staged edit after the regions change and restores a vetoed conversion', () => {
    const editor = createEditor();
    editor.chordTrack.enable();
    editor.chordTrack.add(chord(0, 480));
    const staged = editor.chordTrack.previewStyle({ voicing: 'open' })!;
    editor.chordTrack.add(chord(480, 480, 9));
    expect(editor.chordTrack.commit(staged, 'Style chords')).toBe(false);
    const notes = editor.notes();
    editor.on('beforechange', (event) => event.preventDefault());
    expect(editor.chordTrack.renderToMidi()).toBe(false);
    expect(editor.chordRegions).toHaveLength(2);
    expect(editor.notes()).toEqual(notes);
    expect(editor.selectedChordRegions).toHaveLength(1);
  });
});
