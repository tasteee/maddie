import { describe, expect, it, vi } from 'vitest';
import { createEditor, fromMidiFile, getAudibleTrackIds, toMidiFile } from '../src/core';

const PPQ = 960;
const note = (pitch: number, start = 0) => ({ pitch, start, duration: PPQ / 2, velocity: 0.8 });

const buildTwoTrackEditor = () => {
  const editor = createEditor();
  editor.commands.add([note(60)]);
  const second = editor.commands.addTrack({ name: 'Bass' });
  editor.commands.add([note(36, PPQ)]);
  return { editor, firstId: editor.trackIds[0], secondId: second.id };
};

describe('track api', () => {
  it('adds a track, makes it active, and undoes cleanly', () => {
    const editor = createEditor();
    const track = editor.commands.addTrack({ name: 'Lead' });
    expect(editor.trackIds).toHaveLength(2);
    expect(editor.activeTrackId).toBe(track.id);
    editor.undo();
    expect(editor.trackIds).toHaveLength(1);
    expect(editor.activeTrackId).toBe(editor.trackIds[0]);
    editor.redo();
    expect(editor.trackIds).toHaveLength(2);
    expect(editor.trackList[1].name).toBe('Lead');
  });

  it('names and colors new tracks without repeats', () => {
    const editor = createEditor();
    const second = editor.commands.addTrack();
    const third = editor.commands.addTrack();
    expect(second.name).toBe('Track 2');
    expect(third.name).toBe('Track 3');
    expect(new Set([second.color, third.color]).size).toBe(2);
  });

  it('removes a track with its notes, and undo brings both back', () => {
    const { editor, firstId, secondId } = buildTwoTrackEditor();
    expect(editor.commands.removeTrack(secondId)).toBe(true);
    expect(editor.trackIds).toEqual([firstId]);
    expect(editor.activeTrackId).toBe(firstId);
    editor.undo();
    expect(editor.trackIds).toEqual([firstId, secondId]);
    expect(editor.notes(secondId).map((n) => n.pitch)).toEqual([36]);
  });

  it('keeps the last track', () => {
    const editor = createEditor();
    expect(editor.commands.removeTrack(editor.trackIds[0])).toBe(false);
    expect(editor.trackIds).toHaveLength(1);
  });

  it('renames, recolors, mutes and solos with undo', () => {
    const { editor, firstId } = buildTwoTrackEditor();
    editor.commands.renameTrack(firstId, '  Piano ');
    editor.commands.setTrackColor(firstId, '#ff0000');
    editor.commands.setTrackMuted(firstId, true);
    editor.commands.setTrackSolo(firstId, true);
    expect(editor.trackList[0]).toMatchObject({ name: 'Piano', color: '#ff0000', muted: true, solo: true });
    expect(editor.doc.tracks[0]).toMatchObject({ name: 'Piano', muted: true, solo: true });
    editor.undo();
    editor.undo();
    editor.undo();
    editor.undo();
    expect(editor.trackList[0].name).toBeUndefined();
    expect(editor.trackList[0].muted).toBeUndefined();
    editor.redo();
    expect(editor.trackList[0].name).toBe('Piano');
  });

  it('fires a tracks event for list, meta and active changes', () => {
    const { editor, firstId } = buildTwoTrackEditor();
    const activeIds: string[] = [];
    editor.on('tracks', (e) => activeIds.push(e.activeId));
    editor.setActiveTrack(firstId);
    editor.commands.renameTrack(firstId, 'A');
    editor.commands.addTrack();
    // Set active, rename, add (list change), then the new track becomes active.
    expect(activeIds).toHaveLength(4);
    expect(activeIds[0]).toBe(firstId);
  });

  it('clears the selection when the active track changes', () => {
    const { editor, firstId, secondId } = buildTwoTrackEditor();
    editor.select(editor.notes().map((n) => n.id));
    expect(editor.selection.size).toBe(1);
    editor.setActiveTrack(firstId);
    expect(editor.selection.size).toBe(0);
    editor.setActiveTrack(secondId);
    expect(editor.notes().map((n) => n.pitch)).toEqual([36]);
  });

  it('rejects an unknown active track', () => {
    const editor = createEditor();
    expect(() => editor.setActiveTrack('nope')).toThrow();
  });

  it('edits the active track only', () => {
    const { editor, firstId, secondId } = buildTwoTrackEditor();
    expect(editor.notes(firstId)).toHaveLength(1);
    expect(editor.notes(secondId)).toHaveLength(1);
    editor.setActiveTrack(firstId);
    editor.commands.selectAll();
    editor.commands.delete();
    expect(editor.notes(firstId)).toHaveLength(0);
    expect(editor.notes(secondId)).toHaveLength(1);
  });
});

describe('reading across tracks', () => {
  it('returns notes with their track ids', () => {
    const { editor, firstId, secondId } = buildTwoTrackEditor();
    const found = editor.notesAllTracks(0, PPQ * 4);
    // Order by pitch: track ids come from the clock, so sorting them as strings is not stable.
    const byPitchDescending = found.map((e) => [e.trackId, e.note.pitch] as const).sort((a, b) => b[1] - a[1]);
    expect(byPitchDescending).toEqual([
      [firstId, 60],
      [secondId, 36],
    ]);
    expect(editor.notesAllTracks(PPQ, PPQ * 2).map((e) => e.trackId)).toEqual([secondId]);
  });

  it('takes the content end across tracks', () => {
    const { editor, firstId } = buildTwoTrackEditor();
    expect(editor.contentEnd(firstId)).toBe(PPQ / 2);
    expect(editor.contentEnd()).toBe(PPQ + PPQ / 2);
  });

  it('knows which tracks are audible', () => {
    const { editor, firstId, secondId } = buildTwoTrackEditor();
    expect(editor.isTrackAudible(firstId) && editor.isTrackAudible(secondId)).toBe(true);
    editor.commands.setTrackMuted(firstId, true);
    expect(editor.isTrackAudible(firstId)).toBe(false);
    editor.commands.setTrackSolo(firstId, true);
    // Muted wins over solo; a solo elsewhere silences the rest.
    expect(getAudibleTrackIds(editor.trackList).size).toBe(0);
    editor.commands.setTrackMuted(firstId, false);
    expect(editor.isTrackAudible(firstId)).toBe(true);
    expect(editor.isTrackAudible(secondId)).toBe(false);
  });

  it('schedules only audible tracks', () => {
    const { editor, firstId, secondId } = buildTwoTrackEditor();
    const ids = () => editor.notesStartingAudible(0, PPQ * 4).map((e) => e.trackId).sort();
    expect(ids()).toEqual([firstId, secondId].sort());
    editor.commands.setTrackMuted(secondId, true);
    expect(ids()).toEqual([firstId]);
    editor.commands.setTrackMuted(secondId, false);
    editor.commands.setTrackSolo(secondId, true);
    expect(ids()).toEqual([secondId]);
  });

  it('reports notes in any track', () => {
    const editor = createEditor();
    expect(editor.hasAnyNotes).toBe(false);
    const second = editor.commands.addTrack({ notes: [note(60)] });
    editor.setActiveTrack(editor.trackIds[0]);
    expect(editor.notes()).toHaveLength(0);
    expect(editor.hasAnyNotes).toBe(true);
    expect(editor.notes(second.id)).toHaveLength(1);
  });

  it('plays notes from every audible track', async () => {
    vi.useFakeTimers();
    const audioContext = { currentTime: 1, state: 'running', outputLatency: 0, resume: async () => {} } as unknown as AudioContext;
    const played: number[] = [];
    const editor = createEditor({
      audioContext,
      output: { noteOn: (e) => played.push(e.pitch), noteOff: () => {}, allNotesOff: () => {} },
    });
    editor.transport.setMetronome({ enabled: false });
    editor.commands.add([note(60)]);
    editor.commands.addTrack({ notes: [note(48)] });
    const muted = editor.commands.addTrack({ notes: [note(72)] });
    editor.commands.setTrackMuted(muted.id, true);
    await editor.transport.play();
    editor.transport.stop();
    expect(played.sort()).toEqual([48, 60]);
    vi.useRealTimers();
  });
});

describe('document sync', () => {
  it('moves the active track off a removed one by remote patches', () => {
    const { editor, firstId, secondId } = buildTwoTrackEditor();
    expect(editor.activeTrackId).toBe(secondId);
    const track = { ...editor.trackList[1], notes: [...editor.notes(secondId)] };
    editor.applyPatches([{ op: 'track-remove', track, index: 1 }]);
    expect(editor.activeTrackId).toBe(firstId);
    expect(editor.trackIds).toEqual([firstId]);
  });

  it('keeps the active track when setDoc still has it', () => {
    const { editor, secondId } = buildTwoTrackEditor();
    editor.setDoc(editor.doc);
    expect(editor.activeTrackId).toBe(secondId);
  });
});

describe('midi import into tracks', () => {
  const buildSource = () => {
    const source = createEditor();
    source.commands.add([note(60), note(64, PPQ)]);
    source.commands.renameTrack(source.activeTrackId, 'Melody');
    source.commands.addTrack({ name: 'Bass', notes: [note(36)] });
    return toMidiFile(source.doc);
  };

  it('reads one entry per MIDI track', () => {
    const midi = fromMidiFile(buildSource());
    expect(midi.tracks.map((t) => [t.name, t.notes.length])).toEqual([
      ['Melody', 2],
      ['Bass', 1],
    ]);
    expect(midi.notes).toHaveLength(3);
  });

  it('makes a Maddie track per MIDI track and replaces all tracks', () => {
    const editor = createEditor();
    editor.commands.add([note(90)]);
    editor.commands.addTrack({ name: 'Old', notes: [note(91)] });
    editor.commands.importMidi(buildSource());
    expect(editor.trackList.map((t) => t.name)).toEqual(['Melody', 'Bass']);
    expect(editor.notes(editor.trackIds[1]).map((n) => n.pitch)).toEqual([36]);
    expect(editor.activeTrackId).toBe(editor.trackIds[0]);
    expect(editor.notes().map((n) => n.pitch).sort((a, b) => a - b)).toEqual([60, 64]);
  });

  it('undoes the whole import in one step', () => {
    const editor = createEditor();
    editor.commands.add([note(90)]);
    const oldId = editor.trackIds[0];
    editor.commands.importMidi(buildSource());
    editor.undo();
    expect(editor.trackIds).toEqual([oldId]);
    expect(editor.notes().map((n) => n.pitch)).toEqual([90]);
    expect(editor.activeTrackId).toBe(oldId);
  });

  it('appends tracks when not replacing', () => {
    const editor = createEditor();
    editor.commands.add([note(90)]);
    editor.commands.importMidi(buildSource(), { replace: false });
    expect(editor.trackIds).toHaveLength(3);
    expect(editor.notes(editor.trackIds[0]).map((n) => n.pitch)).toEqual([90]);
  });

  it('merges into the active track on request', () => {
    const editor = createEditor();
    editor.commands.addTrack({ name: 'Keep', notes: [note(80)] });
    const keepId = editor.activeTrackId;
    editor.commands.importMidi(buildSource(), { tracks: 'merge' });
    expect(editor.trackIds).toHaveLength(2);
    expect(editor.notes().map((n) => n.pitch).sort((a, b) => a - b)).toEqual([36, 60, 64]);
    expect(editor.activeTrackId).toBe(keepId);
  });
});
