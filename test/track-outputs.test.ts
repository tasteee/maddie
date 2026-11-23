import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { areRoutesEqual, createEditor, type Output, type TrackRouteT } from '../src/core';
import { parseProject } from '../src/app/project-file';
import { Projects } from '../src/app/projects';
import { OutputRouter } from '../src/engine/output-router';

const PPQ = 960;
const note = (pitch: number, start = 0) => ({ pitch, start, duration: PPQ / 2, velocity: 0.8 });

type SpyOutputT = Output & {
  played: number[];
  noteOn: ReturnType<typeof vi.fn>;
  allNotesOff: ReturnType<typeof vi.fn>;
  setVolume: ReturnType<typeof vi.fn>;
};

const createSpyOutput = (): SpyOutputT => {
  const played: number[] = [];
  const noteOn = vi.fn((event: { pitch: number }) => played.push(event.pitch));
  return { played, noteOn, noteOff: vi.fn(), allNotesOff: vi.fn(), setVolume: vi.fn() };
};

const createAudioContext = () => ({ currentTime: 1, state: 'running', outputLatency: 0, resume: async () => {} }) as unknown as AudioContext;

/** An editor whose default output and named sounds are spies. */
const createRoutedEditor = () => {
  const defaultOutput = createSpyOutput();
  const bassOutput = createSpyOutput();
  const sounds = new Map<string, Output>([['bass', bassOutput]]);
  const editor = createEditor({ audioContext: createAudioContext(), output: defaultOutput });
  editor.transport.setMetronome({ enabled: false });
  editor.outputResolver = (route) => (route.kind === 'sound' ? sounds.get(route.soundId) ?? null : null);
  return { editor, defaultOutput, bassOutput, sounds };
};

const playThrough = async (editor: ReturnType<typeof createEditor>) => {
  await editor.transport.play();
  editor.transport.stop();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', () => 1);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('per-track outputs', () => {
  it('plays tracks with no route through the default output', async () => {
    const setup = createRoutedEditor();
    setup.editor.commands.add([note(60)]);
    const second = setup.editor.commands.addTrack({ notes: [note(62)] });
    expect(second.route).toBeUndefined();

    await playThrough(setup.editor);

    expect(setup.defaultOutput.played.sort()).toEqual([60, 62]);
    expect(setup.bassOutput.played).toEqual([]);
  });

  it('plays a track with its own route through that output only', async () => {
    const setup = createRoutedEditor();
    setup.editor.commands.add([note(60)]);
    const bass = setup.editor.commands.addTrack({ notes: [note(36)] });
    setup.editor.commands.setTrackRoute(bass.id, { kind: 'sound', soundId: 'bass' });

    await playThrough(setup.editor);

    expect(setup.defaultOutput.played).toEqual([60]);
    expect(setup.bassOutput.played).toEqual([36]);
  });

  it('keeps a track silent when its route cannot sound, instead of using the default', async () => {
    const setup = createRoutedEditor();
    const lead = setup.editor.activeTrackId;
    setup.editor.commands.add([note(60)]);
    setup.editor.commands.setTrackRoute(lead, { kind: 'sound', soundId: 'missing' });

    await playThrough(setup.editor);

    expect(setup.defaultOutput.played).toEqual([]);
    expect(setup.bassOutput.played).toEqual([]);
  });

  it('follows the default output again when the route is cleared, and undo restores each step', () => {
    const setup = createRoutedEditor();
    const lead = setup.editor.activeTrackId;
    const route: TrackRouteT = { kind: 'sound', soundId: 'bass' };

    setup.editor.commands.setTrackRoute(lead, route);
    expect(setup.editor.getTrackOutput(lead)).toBe(setup.bassOutput);
    setup.editor.commands.setTrackRoute(lead, undefined);
    expect(setup.editor.getTrackOutput(lead)).toBe(setup.defaultOutput);

    setup.editor.undo();
    expect(setup.editor.trackList[0].route).toEqual(route);
    setup.editor.undo();
    expect(setup.editor.trackList[0].route).toBeUndefined();
  });

  it('does nothing when the route is unchanged', () => {
    const setup = createRoutedEditor();
    const lead = setup.editor.activeTrackId;
    setup.editor.commands.setTrackRoute(lead, { kind: 'sound', soundId: 'bass' });
    const undoStepsBefore = setup.editor.history.canUndo;
    setup.editor.commands.setTrackRoute(lead, { kind: 'sound', soundId: 'bass' });
    setup.editor.undo();
    expect(undoStepsBefore).toBe(true);
    expect(setup.editor.trackList[0].route).toBeUndefined();
  });

  it('silences the output a track just left', () => {
    const setup = createRoutedEditor();
    const lead = setup.editor.activeTrackId;
    setup.editor.commands.setTrackRoute(lead, { kind: 'sound', soundId: 'bass' });
    setup.defaultOutput.allNotesOff.mockClear();
    setup.bassOutput.allNotesOff.mockClear();

    setup.editor.commands.setTrackRoute(lead, undefined);

    expect(setup.bassOutput.allNotesOff).toHaveBeenCalledTimes(1);
    expect(setup.defaultOutput.allNotesOff).not.toHaveBeenCalled();
  });

  it('stops every output that was used when the transport stops', async () => {
    const setup = createRoutedEditor();
    setup.editor.commands.add([note(60)]);
    const bass = setup.editor.commands.addTrack({ notes: [note(36)] });
    setup.editor.commands.setTrackRoute(bass.id, { kind: 'sound', soundId: 'bass' });
    setup.defaultOutput.allNotesOff.mockClear();
    setup.bassOutput.allNotesOff.mockClear();

    await playThrough(setup.editor);

    expect(setup.defaultOutput.allNotesOff).toHaveBeenCalled();
    expect(setup.bassOutput.allNotesOff).toHaveBeenCalled();
  });

  it('gives a track output the master volume the first time it is used, and every change after', async () => {
    const setup = createRoutedEditor();
    setup.editor.setVolume({ level: 0.5 });
    const bass = setup.editor.commands.addTrack({ notes: [note(36)] });
    setup.editor.commands.setTrackRoute(bass.id, { kind: 'sound', soundId: 'bass' });

    await playThrough(setup.editor);
    expect(setup.bassOutput.setVolume).toHaveBeenLastCalledWith(0.5);

    setup.editor.setVolume({ level: 0.25 });
    expect(setup.bassOutput.setVolume).toHaveBeenLastCalledWith(0.25);
    setup.editor.setVolume({ muted: true });
    expect(setup.bassOutput.setVolume).toHaveBeenLastCalledWith(0);
  });

  it('sends live keys and auditions to the active track output', () => {
    const setup = createRoutedEditor();
    const bass = setup.editor.commands.addTrack({});
    setup.editor.commands.setTrackRoute(bass.id, { kind: 'sound', soundId: 'bass' });
    expect(setup.editor.activeTrackId).toBe(bass.id);

    setup.editor.liveNoteOn(40);
    setup.editor.liveNoteOff(40);
    setup.editor.audition(41);

    expect(setup.bassOutput.played).toEqual([40, 41]);
    expect(setup.defaultOutput.played).toEqual([]);
  });

  it('keeps the route when a track is duplicated', () => {
    const setup = createRoutedEditor();
    const lead = setup.editor.activeTrackId;
    setup.editor.commands.setTrackRoute(lead, { kind: 'sound', soundId: 'bass' });
    const copy = setup.editor.commands.duplicateTrack(lead);
    expect(copy?.route).toEqual({ kind: 'sound', soundId: 'bass' });
  });

  it('compares routes by destination', () => {
    expect(areRoutesEqual(undefined, undefined)).toBe(true);
    expect(areRoutesEqual(undefined, { kind: 'sound', soundId: 'bass' })).toBe(false);
    expect(areRoutesEqual({ kind: 'sound', soundId: 'a' }, { kind: 'sound', soundId: 'a' })).toBe(true);
    expect(areRoutesEqual({ kind: 'midi', portId: 'p' }, { kind: 'midi', portId: 'p', channel: 0 })).toBe(true);
    expect(areRoutesEqual({ kind: 'midi', portId: 'p', channel: 1 }, { kind: 'midi', portId: 'p' })).toBe(false);
    expect(areRoutesEqual({ kind: 'midi', portId: 'p' }, { kind: 'sound', soundId: 'p' })).toBe(false);
  });
});

describe('route persistence', () => {
  const memoryStorage = () => {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  };

  it('saves and restores routes with the project', () => {
    const editor = createEditor();
    const projects = new Projects(editor, memoryStorage());
    const second = editor.commands.addTrack({ name: 'Bass' });
    editor.commands.setTrackRoute(second.id, { kind: 'midi', portId: 'port-1', channel: 3 });
    editor.commands.setTrackRoute(editor.trackIds[0], { kind: 'sound', soundId: 'piano' });

    const project = parseProject(JSON.stringify(projects.snapshot()));
    projects.importProject(project);

    expect(editor.trackList.map((track) => track.route)).toEqual([
      { kind: 'sound', soundId: 'piano' },
      { kind: 'midi', portId: 'port-1', channel: 3 },
    ]);
  });

  it('rejects a project with a malformed route', () => {
    const editor = createEditor();
    const projects = new Projects(editor, memoryStorage());
    const snapshot = JSON.parse(JSON.stringify(projects.snapshot()));
    const withRoute = (route: unknown) => {
      snapshot.doc.tracks[0].route = route;
      return JSON.stringify(snapshot);
    };

    expect(() => parseProject(withRoute({ kind: 'sound', soundId: 'piano' }))).not.toThrow();
    expect(() => parseProject(withRoute({ kind: 'midi', portId: null, channel: 15 }))).not.toThrow();
    expect(() => parseProject(withRoute({ kind: 'sound' }))).toThrow();
    expect(() => parseProject(withRoute({ kind: 'midi', portId: 'p', channel: 16 }))).toThrow();
    expect(() => parseProject(withRoute({ kind: 'tape' }))).toThrow();
  });
});

describe('OutputRouter track routes', () => {
  it('resolves sound routes and reports whether each route can sound', () => {
    const editor = createEditor();
    const router = OutputRouter.for(editor);
    const piano = createSpyOutput();
    router.setSounds([{ id: 'piano', label: 'Piano', output: piano }]);
    const lead = editor.activeTrackId;

    editor.commands.setTrackRoute(lead, { kind: 'sound', soundId: 'piano' });
    expect(editor.getTrackOutput(lead)).toBe(piano);
    expect(router.getRouteStatus({ kind: 'sound', soundId: 'piano' })).toBe('ready');
    expect(router.getRouteStatus({ kind: 'sound', soundId: 'gone' })).toBe('missing');
    expect(router.resolveRoute({ kind: 'sound', soundId: 'gone' })).toBeNull();
  });

  it('is silent for a MIDI route until the browser grants MIDI access', () => {
    const editor = createEditor();
    const router = OutputRouter.for(editor);
    const route: TrackRouteT = { kind: 'midi', portId: 'port-1' };

    expect(router.resolveRoute(route)).toBeNull();
    expect(router.getRouteStatus(route)).toBe('unsupported');
  });
});
