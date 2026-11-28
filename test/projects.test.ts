import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHORD_FAMILIES, createDoc, createEditor, DEFAULT_VIEW, loadScaled, pitchRangeChords, toMidiFile } from '../src/core';
import { parseProject, restoreProjectView, type MaddieProject } from '../src/app/project-file';
import { PROJECT_STORAGE_KEY, Projects } from '../src/app/projects';
import { MidiInput } from '../src/engine/midi-input';
import { MIDI_SOURCE, OutputRouter } from '../src/engine/output-router';

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

beforeEach(() => vi.stubGlobal('requestAnimationFrame', () => 1));
afterEach(() => vi.unstubAllGlobals());

describe('Maddie projects', () => {
  it('starts blank and restores the last project, including autosaved edits and settings', async () => {
    const storage = memoryStorage();
    const editor = createEditor();
    const projects = new Projects(editor, storage);
    expect(editor.notes()).toEqual([]);
    expect(editor.key).toBeNull();
    const first = projects.activeId;
    editor.commands.add([{ pitch: 60, velocity: 0.8, start: 0, duration: 300 }]);
    projects.save('First sketch');
    projects.newProject();
    expect(editor.notes()).toEqual([]);
    const bass = editor.commands.addTrack({ name: 'Bass' });
    editor.commands.add([{ pitch: 42, velocity: 0.7, start: 0, duration: 240 }]);
    editor.transport.setLoop({ start: 0, end: 960, enabled: true });
    await Promise.resolve();

    const restored = createEditor();
    const reopened = new Projects(restored, storage);
    expect(reopened.activeId).toBe(projects.activeId);
    expect(restored.activeTrackId).toBe(bass.id);
    expect(restored.notes().map((note) => note.pitch)).toEqual([42]);
    expect(restored.transport.loop).toEqual({ start: 0, end: 960, enabled: true });
    reopened.open(first);
    expect(reopened.current.name).toBe('First sketch');
    expect(restored.notes().map((note) => note.pitch)).toEqual([60]);
    expect(restored.history.canUndo).toBe(false);
  });

  it('round-trips chord regions and imports them as a separate project', async () => {
    await loadScaled();
    const storage = memoryStorage();
    const editor = createEditor();
    const projects = new Projects(editor, storage);
    const original = projects.activeId;
    editor.chordTrack.enable();
    const draft = editor.chordTrack.draft({ symbol: 'Cmaj7', root: 0, intervals: [0, 4, 7, 11] },
      { octave: 3, inversion: 1, voicing: 'closed', templateId: '' });
    editor.chordTrack.placeDraft(draft, editor.ppq);
    editor.chordTrack.commitChanged(pitchRangeChords(editor.selectedChordRegions, 50 / 127, 70 / 127), 'Velocity range');
    editor.commands.toggleMute();
    projects.save('Harmony');
    const exported = JSON.stringify(projects.snapshot());
    const project = parseProject(exported);
    projects.importProject(project);
    expect(projects.activeId).not.toBe(original);
    expect(projects.entries).toHaveLength(2);
    expect(editor.chordRegions?.[0]).toMatchObject({ symbol: 'Cmaj7', inversion: 1, muted: true,
      dynamics: { pitchRange: { min: 50 / 127, max: 70 / 127 } } });
    expect(editor.notes()).toEqual(project.doc.tracks[0].notes);
    expect(editor.notes().every((note) => note.muted)).toBe(true);
    expect(storage.getItem(PROJECT_STORAGE_KEY)).toContain('"name":"Harmony"');
  });

  it('autosaves metronome volume and fold independently and restores them per project', async () => {
    const storage = memoryStorage();
    const editor = createEditor();
    const projects = new Projects(editor, storage);
    const first = projects.activeId;

    editor.transport.setMetronome({ volume: 0 });
    await Promise.resolve();
    expect(projects.current.settings?.metronomeVolume).toBe(0);
    editor.setView({ fold: 'used' });
    await Promise.resolve();
    expect(projects.current.settings?.fold).toBe('used');

    const restored = createEditor();
    const reopened = new Projects(restored, storage);
    expect(restored.transport.metronome.volume).toBe(0);
    expect(restored.view.fold).toBe('used');
    const exported = parseProject(JSON.stringify(reopened.snapshot()));

    reopened.newProject();
    expect(restored.transport.metronome.volume).toBe(0.7);
    expect(restored.view.fold).toBe('none');
    reopened.open(first);
    expect(restored.transport.metronome.volume).toBe(0);
    expect(restored.view.fold).toBe('used');

    reopened.importProject(parseProject(JSON.stringify({ ...exported, settings: { fold: 'scale', metronomeVolume: 0.4 } })));
    expect(restored.transport.metronome.volume).toBe(0.4);
    expect(restored.view.fold).toBe('scale');
    reopened.importProject({ ...exported, settings: { loop: exported.settings?.loop } });
    expect(restored.transport.metronome.volume).toBe(0.7);
    expect(restored.view.fold).toBe('none');
    reopened.importProject(exported);
    expect(restored.transport.metronome.volume).toBe(0);
    expect(restored.view.fold).toBe('used');
  });

  it('restores editing, input, chord, audio and timeline settings without starting playback', async () => {
    const storage = memoryStorage();
    const editor = createEditor();
    const projects = new Projects(editor, storage);
    const first = projects.activeId;
    const view = {
      ...DEFAULT_VIEW,
      pxPerTick: 0.12, rowHeight: 18, scrollTick: 123.5, scrollRow: 4.5, cursor: 240,
      grid: '1/64T', snap: false, scaleLock: true, scaleHighlight: false, follow: true,
      noteLength: 180, noteVelocity: 0.45, noteColor: 'mono',
      computerKeyboard: true, keyboardBase: 60, keyboardScale: true, midiInput: true, midiDevice: 'keys',
      chordsPanel: true, chordsTab: 'project', hiddenChordFamilies: ['power', 'eleventh'], chordQuery: 'maj7',
      chordOctave: 4, chordInversion: 2, chordVoicing: 'drop2',
      chordTemplateId: 'pattern', quantizeGrid: '1/8.',
      quantizeStrength: 75, humanizeTiming: 25, humanizeVelocity: 9,
    } as const;
    editor.setView(view);
    await Promise.resolve();
    expect(projects.current.settings?.view).toEqual(view);
    editor.transport.setMetronome({ enabled: false });
    editor.setVolume({ muted: true, level: 0.3 });
    editor.transport.seek(960);
    await Promise.resolve();
    expect(projects.current.settings).toMatchObject({ marker: 960, metronomeEnabled: false, volume: { muted: true, level: 0.3 } });
    const router = OutputRouter.for(editor);
    router.restoreRoute(MIDI_SOURCE, 'out-1');
    await Promise.resolve();
    expect(projects.current.settings).toMatchObject({ soundId: MIDI_SOURCE, midiPortId: 'out-1' });

    const restored = createEditor();
    const reopened = new Projects(restored, storage);
    expect(restored.view).toEqual({ ...view, cursor: 960 });
    expect(restored.transport).toMatchObject({ state: 'stopped', marker: 960, position: 960, metronome: { enabled: false } });
    expect(restored.volume).toEqual({ muted: true, level: 0.3 });
    expect(OutputRouter.for(restored)).toMatchObject({ source: MIDI_SOURCE, portId: 'out-1' });

    reopened.newProject();
    expect(restored.view).toEqual(DEFAULT_VIEW);
    expect(restored.transport).toMatchObject({ marker: 0, metronome: { enabled: true } });
    expect(restored.volume).toEqual({ muted: false, level: 0.8 });
    reopened.open(first);
    expect(restored.view).toEqual({ ...view, cursor: 960 });
    expect(restored.transport.marker).toBe(960);
    expect(restored.history.canUndo).toBe(false);
  });

  it('restores older single-family filters as exclusions', () => {
    const project = JSON.stringify({
      format: 'maddie', version: 1, name: 'Older project', doc: createDoc(),
      settings: { view: { chordFamily: 'seventh' } },
    });
    expect(restoreProjectView(parseProject(project).settings).hiddenChordFamilies)
      .toEqual(CHORD_FAMILIES.map(({ id }) => id).filter((id) => id !== 'seventh'));
    expect(restoreProjectView({ view: { chordFamily: 'seventh', hiddenChordFamilies: [] } }).hiddenChordFamilies).toEqual([]);
  });

  it('batches viewport-only autosaves and flushes a pending viewport when switching projects', async () => {
    vi.useFakeTimers();
    try {
      const storage = memoryStorage();
      const write = vi.spyOn(storage, 'setItem');
      const editor = createEditor();
      const projects = new Projects(editor, storage);
      const first = projects.activeId;
      write.mockClear();
      editor.setView({ scrollTick: 100 });
      editor.setView({ scrollTick: 200, rowHeight: 24 });
      expect(write).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(250);
      expect(write).toHaveBeenCalledTimes(1);
      expect(projects.current.settings?.view).toMatchObject({ scrollTick: 200, rowHeight: 24 });
      editor.setView({ scrollTick: 300 });
      projects.newProject();
      projects.open(first);
      expect(editor.view.scrollTick).toBe(300);
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores MIDI routing when permission is granted and defers a browser prompt', async () => {
    const storage = memoryStorage();
    const editor = createEditor();
    const projects = new Projects(editor, storage);
    const send = vi.fn();
    const requestMIDIAccess = vi.fn(async () => ({
      inputs: new Map(), outputs: new Map([['out-1', { id: 'out-1', send }]]),
    }));
    let permission = 'prompt';
    const query = vi.fn(async () => ({ state: permission }));
    vi.stubGlobal('navigator', { permissions: { query }, requestMIDIAccess });
    projects.importProject({
      format: 'maddie', version: 1, name: 'Hardware', doc: createDoc(),
      settings: { soundId: MIDI_SOURCE, midiPortId: 'out-1', view: { midiInput: true } },
    });
    await Promise.resolve();
    expect(query).toHaveBeenCalledWith({ name: 'midi' });
    expect(requestMIDIAccess).not.toHaveBeenCalled();

    permission = 'granted';
    const restored = createEditor();
    new Projects(restored, storage);
    await vi.waitFor(() => {
      expect(OutputRouter.for(restored)).toMatchObject({ status: 'ready', portId: 'out-1' });
      expect(MidiInput.for(restored).status).toBe('ready');
      expect(restored.output).toBeTruthy();
    });
  });

  it('round-trips track gain and accepts older tracks without it', () => {
    const doc = createDoc();
    const project = { format: 'maddie', version: 1, name: 'Mix', doc };
    const load = () => parseProject(JSON.stringify(project)).doc;
    expect(createEditor({ doc: load() }).getTrackGain(doc.tracks[0].id)).toBe(1);
    doc.tracks[0].gain = 0.35;
    expect(load().tracks[0].gain).toBe(0.35);
    doc.tracks[0].gain = 1.5;
    expect(load).toThrow('invalid data');
  });

  it('rejects invalid saved settings', () => {
    const project = { format: 'maddie', version: 1, name: 'Sketch', doc: createDoc() };
    for (const settings of [
      { view: { scaleLock: 'on' } }, { view: { grid: '1/0' } }, { view: { scrollRow: -1 } },
      { view: { chordVoicing: 'unknown' } }, { volume: { level: 2, muted: false } }, { marker: -1 },
    ]) {
      expect(() => parseProject(JSON.stringify({ ...project, settings }))).toThrow('invalid data');
    }
  });

  it('rejects malformed files and inconsistent chord ownership', () => {
    const doc = createDoc();
    const project: MaddieProject = { format: 'maddie', version: 1, name: 'Invalid', doc };
    doc.tracks[0].chordRegions = [];
    doc.tracks[0].notes.push({ id: 'note', chordRegionId: 'missing', pitch: 60, velocity: 0.8, start: 0, duration: 480 });
    expect(() => parseProject(JSON.stringify(project))).toThrow('invalid data');
    expect(() => parseProject(JSON.stringify({ ...project, version: 2 }))).toThrow('unsupported version');
    expect(() => parseProject('MThd')).toThrow('not valid JSON');
  });

  it('keeps working copies when browser storage is unavailable', () => {
    const editor = createEditor();
    const projects = new Projects(editor, null);
    const first = projects.activeId;
    editor.commands.add([{ pitch: 68, velocity: 0.9, start: 0, duration: 240 }]);
    expect(projects.save('Offline')).toBe(false);
    expect(projects.storageError).toMatch(/storage/i);
    projects.newProject();
    projects.open(first);
    expect(editor.notes()[0].pitch).toBe(68);
    expect(projects.snapshot().name).toBe('Offline');
  });

  it('appends MIDI tracks at project PPQ and keeps tempo, meter, key and loop', () => {
    const editor = createEditor({ doc: { ppq: 960, tempo: [{ tick: 0, bpm: 92 }],
      timeSignature: [{ tick: 0, numerator: 3, denominator: 4 }], key: { root: 9, scale: 'minor' } } });
    const existing = editor.activeTrackId;
    editor.commands.add([{ pitch: 57, duration: 240, start: 0, velocity: 0.8 }]);
    editor.transport.setLoop({ enabled: true, start: 0, end: 2880 });
    const source = createEditor({ doc: { ppq: 480, tempo: [{ tick: 0, bpm: 180 }],
      timeSignature: [{ tick: 0, numerator: 7, denominator: 8 }], key: { root: 2, scale: 'major' } } });
    source.commands.add([{ pitch: 72, duration: 480, start: 240, velocity: 0.8 }]);
    const meta = editor.meta;
    const loop = editor.transport.loop;
    editor.commands.importMidi(toMidiFile(source.doc), { replace: false });
    expect(editor.meta).toEqual(meta);
    expect(editor.transport.loop).toEqual(loop);
    expect(editor.notes(existing)[0].pitch).toBe(57);
    expect(editor.notes()[0]).toMatchObject({ pitch: 72, start: 480, duration: 960 });
    editor.undo();
    expect(editor.trackIds).toEqual([existing]);
  });
});
