import { createDoc, createId, DEFAULT_METRONOME, DEFAULT_VOLUME, type Editor, type ViewState } from '../core';
import { Engine } from '../engine/engine';
import { releaseAll } from '../engine/computer-keyboard';
import { MidiInput } from '../engine/midi-input';
import { MIDI_SOURCE, OutputRouter } from '../engine/output-router';
import { PROJECT_VIEW_KEYS, readProject, restoreProjectView, type MaddieProject } from './project-file';

export const PROJECT_STORAGE_KEY = 'maddie.projects.v1';
const EMPTY_LOOP = { enabled: false, start: 0, end: 0 };
const UNTITLED = 'Untitled Project';
const VIEWPORT_KEYS = new Set<keyof ViewState>(['scrollTick', 'scrollRow', 'pxPerTick', 'rowHeight']);

type ProjectEntry = { id: string; file: MaddieProject };
type ProjectShelf = { activeId: string; projects: ProjectEntry[] };
type ProjectStorage = Pick<Storage, 'getItem' | 'setItem'>;

export class Projects {
  private projects = new Map<string, MaddieProject>();
  private listeners = new Set<() => void>();
  private dirty = new Set<string>();
  private active: string;
  private pendingSave = false;
  private viewportSave?: ReturnType<typeof setTimeout>;
  private switching = false;
  private lastRaw?: string | null;
  private lastShelf?: ProjectShelf;
  private readonly router: OutputRouter;
  private readonly midi: MidiInput;
  private readonly engine: Engine;
  storageError = '';

  constructor(private readonly editor: Editor, private readonly storage: ProjectStorage | null) {
    this.router = OutputRouter.for(editor);
    this.midi = MidiInput.for(editor);
    this.engine = Engine.for(editor);
    let shelf: ProjectShelf | undefined;
    try { shelf = this.readShelf(); }
    catch { this.storageError = 'Saved projects could not be read.'; }
    for (const project of shelf?.projects ?? []) this.projects.set(project.id, project.file);
    this.active = shelf?.activeId ?? createId();
    if (!this.projects.has(this.active)) this.projects.set(this.active, this.blank());
    this.load(this.current);

    editor.on('change', this.schedule);
    editor.on('tracks', this.schedule);
    editor.on('view', ({ view, prev }) => {
      const settingsChanged = PROJECT_VIEW_KEYS.some((key) => !VIEWPORT_KEYS.has(key) && view[key] !== prev[key]);
      if (settingsChanged) this.schedule();
      else if (view.scrollRow !== prev.scrollRow || view.scrollTick !== prev.scrollTick ||
        view.pxPerTick !== prev.pxPerTick || view.rowHeight !== prev.rowHeight) this.scheduleViewport();
    });
    const transport = editor.transport;
    let { loop, metronome, marker } = transport;
    let volume = editor.volume;
    editor.on('transport', () => {
      const changed = loop !== transport.loop || marker !== transport.marker ||
        metronome.volume !== transport.metronome.volume || metronome.enabled !== transport.metronome.enabled ||
        volume.level !== editor.volume.level || volume.muted !== editor.volume.muted;
      ({ loop, metronome, marker } = transport);
      volume = editor.volume;
      if (changed) this.schedule();
    });
    let { source, portId } = this.router;
    this.router.onChange(() => {
      if (source === this.router.source && portId === this.router.portId) return;
      ({ source, portId } = this.router);
      this.schedule();
    });
    if (!shelf) this.flush();
  }

  get isSaving() { return this.pendingSave; }
  get activeId() { return this.active; }
  get current() { return this.projects.get(this.active)!; }
  get entries(): ProjectEntry[] {
    return [...this.projects].map(([id, file]) => ({ id, file })).reverse()
      .sort((a, b) => (b.file.updatedAt ?? 0) - (a.file.updatedAt ?? 0));
  }

  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): MaddieProject {
    return {
      ...this.current,
      doc: this.editor.doc,
      settings: {
        ...this.current.settings,
        activeTrackId: this.editor.activeTrackId,
        loop: this.editor.transport.loop,
        marker: this.editor.transport.marker,
        volume: this.editor.volume,
        metronomeEnabled: this.editor.transport.metronome.enabled,
        metronomeVolume: this.editor.transport.metronome.volume,
        fold: this.editor.view.fold,
        view: this.editor.view,
        soundId: this.router.source || undefined,
        midiPortId: this.router.portId,
      },
    };
  }

  newProject() {
    const names = new Set(this.entries.map((entry) => entry.file.name));
    const candidates = Array.from({ length: names.size + 1 }, (_, index) => UNTITLED + ' ' + (index + 2));
    const blank = this.blank();
    blank.name = candidates.find((name) => !names.has(name)) ?? UNTITLED;
    this.switchTo(createId(), blank);
  }

  importProject(file: MaddieProject) {
    this.switchTo(createId(), file);
  }

  open(id: string) {
    if (id === this.active) return;
    this.refreshLibrary();
    const file = this.projects.get(id);
    if (file) this.switchTo(id, file);
  }

  refreshLibrary = () => {
    try {
      const shelf = this.readShelf();
      let changed = false;
      for (const { id, file } of shelf?.projects ?? []) {
        if (id === this.active || this.dirty.has(id) || this.projects.get(id) === file) continue;
        this.projects.set(id, file);
        changed = true;
      }
      if (changed) this.notify();
    } catch {
      // Leave the working copy intact. The next save reports storage errors.
    }
  };

  save(name: string) {
    this.projects.set(this.active, { ...this.current, name: name.trim() || this.current.name, updatedAt: Date.now() });
    const saved = this.flush();
    this.notify();
    return saved;
  }

  flush = (): boolean => {
    const wasEdited = this.pendingSave;
    clearTimeout(this.viewportSave);
    this.viewportSave = undefined;
    this.pendingSave = false;
    if (this.switching) return false;
    const file = this.snapshot();
    if (wasEdited) file.updatedAt = Date.now();
    this.projects.set(this.active, file);
    this.dirty.add(this.active);
    try {
      const shelf = this.readShelf();
      const projects = new Map((shelf?.projects ?? []).map(({ id, file }) => [id, file]));
      for (const id of this.dirty) projects.set(id, this.projects.get(id)!);
      const next = { activeId: this.active, projects: [...projects].map(([id, file]) => ({ id, file })) };
      const json = JSON.stringify(next);
      if (!this.storage) throw new Error('Storage unavailable');
      if (json !== this.lastRaw) this.storage.setItem(PROJECT_STORAGE_KEY, json);
      this.lastRaw = json;
      this.lastShelf = next;
      this.dirty.clear();
      this.refreshLibrary();
      if (this.storageError) {
        this.storageError = '';
        this.notify();
      }
      if (wasEdited) this.notify();
      return true;
    } catch {
      if (!this.storageError) {
        this.storageError = 'Browser storage is unavailable or full. Export a .maddie file to keep a copy.';
        this.engine.toast(this.storageError, 'error');
      }
      this.notify();
      return false;
    }
  };

  private schedule = () => {
    if (this.switching || (this.pendingSave && this.viewportSave === undefined)) return;
    clearTimeout(this.viewportSave);
    this.viewportSave = undefined;
    this.markPending();
    // Batch events from a single edit while persisting before the next user action.
    queueMicrotask(() => {
      if (this.pendingSave && this.viewportSave === undefined) this.flush();
    });
  };

  private scheduleViewport() {
    if (this.switching || this.pendingSave) return;
    // Scrolling and playhead follow can update on every frame.
    this.viewportSave = setTimeout(this.flush, 250);
    this.markPending();
  }

  private markPending() {
    if (this.pendingSave) return;
    this.pendingSave = true;
    this.notify();
  }

  private switchTo(id: string, file: MaddieProject) {
    releaseAll(this.editor);
    this.midi.resetPerformance();
    this.editor.stopChord();
    this.editor.recorder.stop();
    if (this.editor.transport.state !== 'stopped') this.editor.transport.stop();
    this.flush();
    this.active = id;
    this.projects.set(id, file);
    this.load(file);
    this.flush();
    this.notify();
  }

  private load(file: MaddieProject) {
    this.switching = true;
    try {
      const ed = this.editor;
      const { activeTrackId, loop, marker, soundId, midiPortId, volume, metronomeEnabled, metronomeVolume } = file.settings ?? {};
      const view = restoreProjectView(file.settings);
      ed.capture.clear();
      ed.setDoc(file.doc);
      ed.setActiveTrack(activeTrackId && ed.trackIds.includes(activeTrackId) ? activeTrackId : ed.trackIds[0]);
      ed.transport.seek(marker ?? 0);
      ed.transport.setLoop(loop ?? EMPTY_LOOP);
      ed.transport.setMetronome({
        enabled: metronomeEnabled ?? DEFAULT_METRONOME.enabled,
        volume: metronomeVolume ?? DEFAULT_METRONOME.volume,
      });
      // Apply folding before the saved scroll position so row reflow doesn't shift it.
      ed.setView({ fold: view.fold, scrollRow: null });
      if (view.scrollRow !== null && this.engine.viewport.height) {
        view.scrollRow = Math.min(view.scrollRow, this.engine.maxScrollRow(view.rowHeight));
      }
      // App settings belong to the person, not the project: opening a project must not reset them.
      ed.setView({ ...view, ghostNotes: ed.view.ghostNotes });
      if (view.scrollRow === null) this.engine.centerOnNotes();
      const sounds = this.router.sounds;
      const source = soundId === MIDI_SOURCE || !sounds.length
        ? soundId ?? ''
        : (sounds.find((sound) => sound.id === soundId) ?? sounds[0]).id;
      this.router.restoreRoute(source, midiPortId ?? null);
      ed.setVolume(volume ?? DEFAULT_VOLUME);
      if (view.midiInput || source === MIDI_SOURCE) void this.restoreMidiAccess();
    } finally {
      this.switching = false;
    }
  }

  private async restoreMidiAccess() {
    if (typeof navigator === 'undefined' || !navigator.permissions) return;
    try {
      const permission = await navigator.permissions.query({ name: 'midi' });
      if (permission.state !== 'granted') return;
      if (this.editor.view.midiInput) void this.midi.request();
      if (this.router.source === MIDI_SOURCE) void this.router.request();
    } catch {
      // MIDI can still be enabled from the input or output controls.
    }
  }

  private readShelf(): ProjectShelf | undefined {
    const raw = this.storage?.getItem(PROJECT_STORAGE_KEY) ?? null;
    if (raw === this.lastRaw) return this.lastShelf;
    if (!raw) {
      this.lastRaw = raw;
      this.lastShelf = undefined;
      return;
    }
    const value = JSON.parse(raw) as Partial<ProjectShelf> | null;
    if (!value || typeof value.activeId !== 'string' || !Array.isArray(value.projects)) throw new Error('Invalid project library');
    const projects = value.projects.map(({ id, file }) => {
      if (typeof id !== 'string' || !id) throw new Error('Invalid project identifier');
      return { id, file: readProject(file) };
    });
    if (new Set(projects.map((project) => project.id)).size !== projects.length) throw new Error('Duplicate project identifier');
    this.lastRaw = raw;
    return this.lastShelf = { activeId: value.activeId, projects };
  }

  private blank(): MaddieProject {
    return { format: 'maddie', version: 1, name: UNTITLED, doc: createDoc(), updatedAt: Date.now() };
  }

  private notify() {
    this.listeners.forEach((listener) => listener());
  }
}
