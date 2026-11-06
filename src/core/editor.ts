import { Commands } from './commands';
import { Emitter } from './emitter';
import { History } from './history';
import { buildRowMap, type RowMap } from './music/rowmap';
import { NoteIndex } from './notes';
import type { Output } from './output';
import { invertPatches, type MetaKey, type MetaValues, type Patch } from './patches';
import { Recorder } from './recorder';
import { Transport } from './transport';
import { getAudibleTrackIds, getTrackColor } from './tracks';
import type { MaddieDoc, Note, NoteId, Tick, Track, TrackChangesT, TrackMetaT, TrackNoteT } from './types';
import { DEFAULT_VIEW, ZOOM_LIMITS, type ViewState } from './view';
import { clampVelocity } from './music/velocity';

export type Origin = 'user' | 'api' | 'history' | 'remote' | 'load';

export interface ChangeEvent {
  patches: readonly Patch[];
  origin: Origin;
  label: string;
  gestureId?: string;
}

export interface BeforeChangeEvent extends ChangeEvent {
  /** Veto the change. It is rolled back and never reaches history. */
  preventDefault(): void;
  readonly defaultPrevented: boolean;
}

export interface ViewChangeEvent {
  view: ViewState;
  prev: ViewState;
  /** Should the change be animated (keyboard zoom, fold)? */
  animate: boolean;
}

export interface EditorEvents extends Record<string, unknown> {
  change: ChangeEvent;
  beforechange: BeforeChangeEvent;
  selection: { ids: ReadonlySet<NoteId> };
  view: ViewChangeEvent;
  transport: { state: Transport['state']; position: Tick };
  history: { canUndo: boolean; canRedo: boolean };
  noteon: { note: Note; time: number; track?: string };
  /** The track list, a track's name, color, mute or solo, or the active track changed. */
  tracks: { tracks: readonly TrackMetaT[]; activeId: string };
}

export interface EditorOptions {
  doc?: Partial<MaddieDoc>;
  view?: Partial<ViewState>;
  output?: Output | null;
  audioContext?: AudioContext | null;
  historyLimit?: number;
}

export interface TransactOptions {
  origin?: Origin;
  /** Edits with the same gestureId merge into one undo step. */
  gestureId?: string;
}

let idCounter = 0;
export const createId = () => `n${(Date.now() % 1e8).toString(36)}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export const createTrackId = () => `t${createId().slice(1)}`;

const DEFAULT_TRACK = 'track-1';

export function createDoc(partial: Partial<MaddieDoc> = {}): MaddieDoc {
  return {
    version: 1,
    ppq: partial.ppq ?? 960,
    tempo: partial.tempo?.length ? partial.tempo : [{ tick: 0, bpm: 120 }],
    timeSignature: partial.timeSignature?.length ? partial.timeSignature : [{ tick: 0, numerator: 4, denominator: 4 }],
    key: partial.key ?? null,
    tracks: partial.tracks?.length ? partial.tracks : [{ id: DEFAULT_TRACK, notes: [] }],
  };
}

interface Tx {
  label: string;
  patches: Patch[];
  origin: Origin;
  gestureId?: string;
  selectionBefore: NoteId[];
}

/**
 * The headless editor. One per piano roll. No DOM.
 * Every doc mutation goes through `transact` (usually via `commands`).
 */
export class Editor extends Emitter<EditorEvents> {
  readonly history: History;
  readonly transport: Transport;
  /** Records live notes while the transport plays. */
  readonly recorder: Recorder;
  readonly commands: Commands;
  output: Output | null;
  audioContext: AudioContext | null;
  activeTrackId: string;

  private tracks = new Map<string, { track: TrackMetaT; notes: NoteIndex }>();
  // Track order before the latest change, so a removed active track hands over to its neighbor.
  private trackOrder: string[] = [];
  private trackListCache: TrackMetaT[] | null = null;
  private _meta: MetaValues & { ppq: number };
  private _view: ViewState;
  private _selection = new Set<NoteId>();
  private tx: Tx | null = null;
  private docCache: MaddieDoc | null = null;
  private rowMapCache: RowMap | null = null;
  /** Master volume (0–1) and mute. Applied via `output.setVolume`, or by scaling velocity. */
  volume = { level: 0.8, muted: false };
  private live = new Map<number, Note>();
  /** Internal clipboard. Notes relative to tick 0. */
  clipboard: Note[] = [];

  constructor(options: EditorOptions = {}) {
    super();
    const doc = createDoc(options.doc);
    this._meta = { ppq: doc.ppq, tempo: doc.tempo, timeSignature: doc.timeSignature, key: doc.key };
    for (const t of doc.tracks) {
      const { notes, ...track } = t;
      this.tracks.set(t.id, { track, notes: new NoteIndex(notes) });
    }
    this.activeTrackId = doc.tracks[0].id;
    this.trackOrder = [...this.tracks.keys()];
    this._view = { ...DEFAULT_VIEW, ...options.view };
    this.history = new History(options.historyLimit);
    this.transport = new Transport(this);
    this.recorder = new Recorder(this);
    this.commands = new Commands(this);
    this.output = options.output ?? null;
    this.audioContext = options.audioContext ?? null;
  }

  // ── Read ──────────────────────────────────────────────────────────

  get ppq() {
    return this._meta.ppq;
  }

  get meta(): Readonly<MetaValues & { ppq: number }> {
    return this._meta;
  }

  get key() {
    return this._meta.key;
  }

  /** Immutable snapshot of the whole document. Cached until the next change. */
  get doc(): MaddieDoc {
    if (!this.docCache) {
      this.docCache = {
        version: 1,
        ppq: this._meta.ppq,
        tempo: this._meta.tempo,
        timeSignature: this._meta.timeSignature,
        key: this._meta.key,
        tracks: [...this.tracks.values()].map(({ track, notes }) => ({ ...track, notes: [...notes.all()] })),
      };
    }
    return this.docCache;
  }

  /** Replace the whole document. Clears history by default. */
  setDoc(doc: Partial<MaddieDoc>, { keepHistory = false, origin = 'load' as Origin } = {}) {
    const next = createDoc(doc);
    this._meta = { ppq: next.ppq, tempo: next.tempo, timeSignature: next.timeSignature, key: next.key };
    this.tracks.clear();
    for (const t of next.tracks) {
      const { notes, ...track } = t;
      this.tracks.set(t.id, { track, notes: new NoteIndex(notes) });
    }
    if (!this.tracks.has(this.activeTrackId)) this.activeTrackId = next.tracks[0].id;
    this.trackOrder = [...this.tracks.keys()];
    this._selection.clear();
    if (!keepHistory) this.history.clear();
    this.invalidate();
    this.emit('change', { patches: [], origin, label: 'Load' });
    this.emit('selection', { ids: this._selection });
    this.emitTracks();
    this.emitHistory();
  }

  get trackIds() {
    return [...this.tracks.keys()];
  }

  /** Every track without its notes, in order. */
  get trackList(): readonly TrackMetaT[] {
    if (!this.trackListCache) this.trackListCache = [...this.tracks.values()].map((entry) => entry.track);
    return this.trackListCache;
  }

  /** The color a track draws in. */
  getTrackColor(trackId: string): string {
    const index = this.trackIds.indexOf(trackId);
    const track = this.tracks.get(trackId)?.track;
    if (!track) return getTrackColor({ id: trackId }, 0);
    return getTrackColor(track, index);
  }

  /** Does this track play? Not muted, and soloed if anything is soloed. */
  isTrackAudible(trackId: string): boolean {
    return getAudibleTrackIds(this.trackList).has(trackId);
  }

  /** Is there at least one note in any track? */
  get hasAnyNotes(): boolean {
    for (const entry of this.tracks.values()) {
      if (entry.notes.size > 0) return true;
    }
    return false;
  }

  /** Make a track the one being edited. Clears the selection, which belongs to one track. Not an undo step. */
  setActiveTrack(trackId: string) {
    if (!this.tracks.has(trackId)) throw new Error(`[maddie] Unknown track "${trackId}"`);
    if (trackId === this.activeTrackId) return;
    this.activeTrackId = trackId;
    this.resetSelection();
    this.invalidate();
    this.emitTracks();
  }

  private index(track = this.activeTrackId): NoteIndex {
    const t = this.tracks.get(track);
    if (!t) throw new Error(`[maddie] Unknown track "${track}"`);
    return t.notes;
  }

  /** Notes of a track, sorted by start. */
  notes(track = this.activeTrackId): readonly Note[] {
    return this.index(track).all();
  }

  getNote(id: NoteId, track = this.activeTrackId) {
    return this.index(track).get(id);
  }

  /** Notes overlapping [from, to). */
  notesInRange(from: Tick, to: Tick, track = this.activeTrackId) {
    return this.index(track).range(from, to);
  }

  /** Notes starting in [from, to). Used by the scheduler. */
  notesStarting(from: Tick, to: Tick, track = this.activeTrackId) {
    return this.index(track).starting(from, to);
  }

  /**
   * Notes of every track overlapping [from, to), each with its track id.
   * `audibleOnly` leaves out tracks that are muted or not soloed.
   */
  notesAllTracks(from: Tick, to: Tick, { audibleOnly = false } = {}): TrackNoteT[] {
    const audibleIds = getAudibleTrackIds(this.trackList);
    const found: TrackNoteT[] = [];
    for (const [trackId, entry] of this.tracks) {
      const isSilent = audibleOnly && !audibleIds.has(trackId);
      if (isSilent) continue;
      for (const note of entry.notes.range(from, to)) found.push({ trackId, note });
    }
    return found;
  }

  /** Notes starting in [from, to) on tracks that play. Used by the scheduler. */
  notesStartingAudible(from: Tick, to: Tick): TrackNoteT[] {
    const audibleIds = getAudibleTrackIds(this.trackList);
    const found: TrackNoteT[] = [];
    for (const [trackId, entry] of this.tracks) {
      if (!audibleIds.has(trackId)) continue;
      for (const note of entry.notes.starting(from, to)) found.push({ trackId, note });
    }
    return found;
  }

  /** End of the last note: in one track, or (no argument) in any track. */
  contentEnd(track?: string): Tick {
    if (track) return this.index(track).end();
    let end = 0;
    for (const entry of this.tracks.values()) end = Math.max(end, entry.notes.end());
    return end;
  }

  /** Rows for the current fold mode and key. */
  get rowMap(): RowMap {
    if (!this.rowMapCache) {
      const used = this._view.fold !== 'none' ? this.usedPitches() : [];
      this.rowMapCache = buildRowMap({ fold: this._view.fold, key: this._meta.key, used });
    }
    return this.rowMapCache;
  }

  // ── Selection ─────────────────────────────────────────────────────

  get selection(): ReadonlySet<NoteId> {
    return this._selection;
  }

  get selectedNotes(): Note[] {
    const idx = this.index();
    return [...this._selection].map((id) => idx.get(id)).filter((n): n is Note => !!n);
  }

  select(ids: Iterable<NoteId>, mode: 'replace' | 'add' | 'toggle' | 'remove' = 'replace') {
    const next = mode === 'replace' ? new Set<NoteId>() : new Set(this._selection);
    for (const id of ids) {
      if (!this.index().has(id)) continue;
      if (mode === 'remove' || (mode === 'toggle' && next.has(id))) next.delete(id);
      else next.add(id);
    }
    if (next.size === this._selection.size && [...next].every((id) => this._selection.has(id))) return;
    this._selection = next;
    this.emit('selection', { ids: next });
  }

  clearSelection() {
    this.select([]);
  }

  // ── View ──────────────────────────────────────────────────────────

  get view(): Readonly<ViewState> {
    return this._view;
  }

  setView(partial: Partial<ViewState>, { animate = false } = {}) {
    const prev = this._view;
    const next = { ...prev, ...partial };
    next.pxPerTick = Math.min(ZOOM_LIMITS.pxPerTick[1], Math.max(ZOOM_LIMITS.pxPerTick[0], next.pxPerTick));
    next.rowHeight = Math.min(ZOOM_LIMITS.rowHeight[1], Math.max(ZOOM_LIMITS.rowHeight[0], next.rowHeight));
    next.scrollTick = Math.max(0, next.scrollTick);
    next.noteVelocity = clampVelocity(next.noteVelocity);
    let changed = false;
    for (const k in next) if (next[k as keyof ViewState] !== prev[k as keyof ViewState]) changed = true;
    if (!changed) return;
    if (next.fold !== prev.fold) this.rowMapCache = null;
    this._view = next;
    this.emit('view', { view: next, prev, animate });
  }

  // ── Mutation ──────────────────────────────────────────────────────

  /**
   * Group edits into one undoable step. Nested calls join the outer one.
   * Ops apply immediately, so later ops in the same transaction see earlier ones.
   */
  transact<T>(label: string, fn: (tx: TxApi) => T, opts: TransactOptions = {}): T {
    if (this.tx) return fn(this.txApi);
    this.tx = {
      label,
      patches: [],
      origin: opts.origin ?? 'user',
      gestureId: opts.gestureId,
      selectionBefore: [...this._selection],
    };
    let result: T;
    try {
      result = fn(this.txApi);
    } catch (err) {
      this.rollback(this.tx.patches);
      this.tx = null;
      throw err;
    }
    const tx = this.tx;
    this.tx = null;
    this.finish(tx);
    return result;
  }

  /** Apply patches from elsewhere (sync, collab). Not added to history. */
  applyPatches(patches: readonly Patch[], { origin = 'remote' as Origin } = {}) {
    if (!patches.length) return;
    for (const p of patches) this.applyPatch(p);
    const hasNewActiveTrack = this.settleActiveTrack();
    this.invalidate();
    this.pruneSelection();
    this.emit('change', { patches, origin, label: 'Remote' });
    this.emitTracksIfChanged(patches, hasNewActiveTrack);
  }

  undo() {
    const entry = this.history.popUndo();
    if (!entry) return;
    const patches = invertPatches(entry.patches);
    for (const p of patches) this.applyPatch(p);
    const hasNewActiveTrack = this.settleActiveTrack();
    this.invalidate();
    this._selection = new Set(entry.selectionBefore.filter((id) => this.index().has(id)));
    this.emit('change', { patches, origin: 'history', label: `Undo ${entry.label}` });
    this.emit('selection', { ids: this._selection });
    this.emitTracksIfChanged(patches, hasNewActiveTrack);
    this.emitHistory();
  }

  redo() {
    const entry = this.history.popRedo();
    if (!entry) return;
    for (const p of entry.patches) this.applyPatch(p);
    const hasNewActiveTrack = this.settleActiveTrack();
    this.invalidate();
    this._selection = new Set(entry.selectionAfter.filter((id) => this.index().has(id)));
    this.emit('change', { patches: entry.patches, origin: 'history', label: `Redo ${entry.label}` });
    this.emit('selection', { ids: this._selection });
    this.emitTracksIfChanged(entry.patches, hasNewActiveTrack);
    this.emitHistory();
  }

  // ── Sound ─────────────────────────────────────────────────────────

  setVolume(volume: Partial<Editor['volume']>) {
    this.volume = { ...this.volume, ...volume, level: Math.max(0, Math.min(1, volume.level ?? this.volume.level)) };
    this.output?.setVolume?.(this.volume.muted ? 0 : this.volume.level);
    this.emit('transport', { state: this.transport.state, position: this.transport.position });
  }

  /** Velocity after master volume, for outputs without `setVolume`. */
  private outVelocity(v: number) {
    return this.output?.setVolume ? v : v * this.volume.level;
  }

  /** Start a held note (computer keyboard, MIDI input). Recorded while `recorder.recording`. */
  liveNoteOn(pitch: number, velocity = this._view.noteVelocity) {
    this.liveNoteOff(pitch);
    const note: Note = { id: `live-${pitch}`, pitch, start: 0, duration: 0, velocity };
    this.live.set(pitch, note);
    this.recorder.noteOn(pitch, velocity);
    if (!this.output || this.volume.muted) return;
    this.output.noteOn({ note, pitch, velocity: this.outVelocity(velocity), time: 0 });
  }

  liveNoteOff(pitch: number) {
    const note = this.live.get(pitch);
    if (!note) return;
    this.live.delete(pitch);
    this.recorder.noteOff(pitch);
    this.output?.noteOff({ note, pitch, velocity: 0, time: 0 });
  }

  /** Release every held note. */
  liveAllOff() {
    for (const pitch of [...this.live.keys()]) this.liveNoteOff(pitch);
  }

  /** Preview a pitch while editing. */
  audition(pitch: number, velocity = this._view.noteVelocity) {
    const out = this.output;
    if (!out || this.volume.muted) return;
    velocity = this.outVelocity(velocity);
    const note: Note = { id: 'audition', pitch, start: 0, duration: 0, velocity };
    const e = { note, pitch, velocity, time: 0, duration: 0.35 };
    if (out.audition) out.audition(e);
    else out.noteOn(e);
  }

  private chord: { notes: Note[]; started: Set<Note>; timers: Array<ReturnType<typeof setTimeout>> } | null = null;

  /**
   * Play several pitches together for `seconds`. A new call cuts the previous one off.
   * `humanize` strums the notes a few ms apart and gives each a random velocity (60–80 of 127).
   */
  auditionChord(pitches: Iterable<number>, seconds = 0.5, velocity = this._view.noteVelocity, { humanize = false } = {}) {
    this.stopChord();
    const out = this.output;
    if (!out || this.volume.muted) return;
    const notes = [...new Set(pitches)].map(
      (pitch): Note => ({ id: `chord-${pitch}`, pitch, start: 0, duration: 0, velocity: humanize ? (60 + Math.random() * 20) / 127 : velocity }),
    );
    if (!notes.length) return;
    const chord = { notes, started: new Set<Note>(), timers: [] as Array<ReturnType<typeof setTimeout>> };
    this.chord = chord;
    const start = (note: Note) => {
      chord.started.add(note);
      out.noteOn({ note, pitch: note.pitch, velocity: this.outVelocity(note.velocity), time: 0 });
    };
    for (const note of notes) {
      const delay = humanize ? Math.random() * 40 : 0;
      if (delay) chord.timers.push(setTimeout(() => start(note), delay));
      else start(note);
    }
    chord.timers.push(setTimeout(() => this.stopChord(), seconds * 1000));
  }

  private stopChord() {
    const chord = this.chord;
    if (!chord) return;
    this.chord = null;
    chord.timers.forEach(clearTimeout);
    for (const note of chord.started) this.output?.noteOff({ note, pitch: note.pitch, velocity: 0, time: 0 });
  }

  /** @internal Called by the transport scheduler. */
  dispatchNote(note: Note, time: number, duration: number, track?: string) {
    this.emit('noteon', { note, time, track });
    if (this.volume.muted) return;
    const e = { note, pitch: note.pitch, velocity: this.outVelocity(note.velocity), time, duration };
    this.output?.noteOn(e);
    this.output?.noteOff({ ...e, time: time + duration });
  }

  /** @internal */
  emitTransport() {
    this.emit('transport', { state: this.transport.state, position: this.transport.position });
  }

  // ── Internals ─────────────────────────────────────────────────────

  private readonly txApi: TxApi = {
    add: (note) => this.record({ op: 'add', track: this.activeTrackId, note }),
    remove: (id) => {
      const note = this.index().get(id);
      if (note) this.record({ op: 'remove', track: this.activeTrackId, note });
    },
    update: (id, changes) => {
      const from = this.index().get(id);
      if (!from) return;
      const to = { ...from, ...changes, id };
      if (!noteChanged(from, to)) return;
      this.record({ op: 'replace', track: this.activeTrackId, from, to });
    },
    setMeta: (key, value) => {
      const from = this._meta[key];
      if (JSON.stringify(from) === JSON.stringify(value)) return;
      this.record({ op: 'meta', key, from, to: value });
    },
    addTrack: (track, index = this.tracks.size) => {
      const hasTrack = this.tracks.has(track.id);
      if (hasTrack) throw new Error(`[maddie] Track "${track.id}" already exists`);
      const clampedIndex = Math.max(0, Math.min(this.tracks.size, index));
      this.record({ op: 'track-add', track, index: clampedIndex });
    },
    removeTrack: (id) => {
      const entry = this.tracks.get(id);
      if (!entry) return;
      const isLastTrack = this.tracks.size <= 1;
      if (isLastTrack) throw new Error('[maddie] A document needs at least one track');
      const track: Track = { ...entry.track, notes: [...entry.notes.all()] };
      const index = this.trackIds.indexOf(id);
      this.record({ op: 'track-remove', track, index });
    },
    updateTrack: (id, changes) => {
      const entry = this.tracks.get(id);
      if (!entry) return;
      const from: TrackChangesT = {};
      const to: TrackChangesT = {};
      for (const key of Object.keys(changes) as Array<keyof TrackChangesT>) {
        const isSame = entry.track[key] === changes[key];
        if (isSame) continue;
        Object.assign(from, { [key]: entry.track[key] });
        Object.assign(to, { [key]: changes[key] });
      }
      const hasChanges = Object.keys(to).length > 0;
      if (!hasChanges) return;
      this.record({ op: 'track-update', id, from, to });
    },
  };

  private record(p: Patch) {
    if (!this.tx) throw new Error('[maddie] Patches must be recorded inside transact()');
    this.applyPatch(p);
    this.tx.patches.push(p);
  }

  private applyPatch(p: Patch) {
    this.trackListCache = null;
    switch (p.op) {
      case 'add':
        this.index(p.track).set(p.note);
        break;
      case 'remove':
        this.index(p.track).delete(p.note.id);
        break;
      case 'replace':
        this.index(p.track).set(p.to);
        break;
      case 'meta':
        this._meta = { ...this._meta, [p.key]: p.to };
        break;
      case 'track-add':
        this.insertTrack(p.track, p.index);
        break;
      case 'track-remove':
        this.tracks.delete(p.track.id);
        break;
      case 'track-update':
        this.updateTrackMeta(p.id, p.to);
        break;
    }
  }

  private insertTrack(track: Track, index: number) {
    const { notes, ...meta } = track;
    const entries = [...this.tracks.entries()];
    entries.splice(index, 0, [track.id, { track: meta, notes: new NoteIndex(notes) }]);
    this.tracks = new Map(entries);
  }

  private updateTrackMeta(id: string, changes: TrackChangesT) {
    const entry = this.tracks.get(id);
    if (!entry) return;
    entry.track = { ...entry.track, ...changes };
  }

  /**
   * After tracks were added or removed: if the active track is gone, the track that took its place becomes active.
   * Returns true when the active track changed.
   */
  private settleActiveTrack(): boolean {
    const ids = this.trackIds;
    const wasActiveKept = this.tracks.has(this.activeTrackId);
    const previousOrder = this.trackOrder;
    this.trackOrder = ids;
    if (wasActiveKept) return false;
    const previousIndex = previousOrder.indexOf(this.activeTrackId);
    const nextIndex = Math.min(Math.max(previousIndex, 0), ids.length - 1);
    this.activeTrackId = ids[nextIndex];
    this.resetSelection();
    return true;
  }

  private resetSelection() {
    const hadSelection = this._selection.size > 0;
    this._selection = new Set();
    if (hadSelection) this.emit('selection', { ids: this._selection });
  }

  private usedPitches(): Set<number> {
    const pitches = new Set<number>();
    for (const entry of this.tracks.values()) {
      for (const note of entry.notes.all()) pitches.add(note.pitch);
    }
    return pitches;
  }

  private emitTracks() {
    this.emit('tracks', { tracks: this.trackList, activeId: this.activeTrackId });
  }

  private emitTracksIfChanged(patches: readonly Patch[], hasNewActiveTrack: boolean) {
    const hasTrackPatch = patches.some((p) => p.op === 'track-add' || p.op === 'track-remove' || p.op === 'track-update');
    if (hasTrackPatch || hasNewActiveTrack) this.emitTracks();
  }

  private rollback(patches: Patch[]) {
    for (const p of invertPatches(patches)) this.applyPatch(p);
    this.settleActiveTrack();
  }

  private finish(tx: Tx) {
    if (!tx.patches.length) return;
    let prevented = false;
    const before: BeforeChangeEvent = {
      patches: tx.patches,
      origin: tx.origin,
      label: tx.label,
      gestureId: tx.gestureId,
      preventDefault: () => (prevented = true),
      get defaultPrevented() {
        return prevented;
      },
    };
    this.emit('beforechange', before);
    if (prevented) {
      this.rollback(tx.patches);
      this.pruneSelection();
      return;
    }
    const hasNewActiveTrack = this.settleActiveTrack();
    this.invalidate();
    this.pruneSelection();
    if (tx.origin !== 'remote' && tx.origin !== 'load') {
      this.history.push({
        label: tx.label,
        gestureId: tx.gestureId,
        patches: tx.patches,
        selectionBefore: tx.selectionBefore,
        selectionAfter: [...this._selection],
      });
    }
    this.emit('change', { patches: tx.patches, origin: tx.origin, label: tx.label, gestureId: tx.gestureId });
    this.emitTracksIfChanged(tx.patches, hasNewActiveTrack);
    this.emitHistory();
  }

  private pruneSelection() {
    const idx = this.index();
    const kept = [...this._selection].filter((id) => idx.has(id));
    if (kept.length !== this._selection.size) {
      this._selection = new Set(kept);
      this.emit('selection', { ids: this._selection });
    }
  }

  private invalidate() {
    this.docCache = null;
    this.rowMapCache = null;
    this.trackListCache = null;
  }

  private emitHistory() {
    this.emit('history', { canUndo: this.history.canUndo, canRedo: this.history.canRedo });
  }
}

export interface TxApi {
  add(note: Note): void;
  remove(id: NoteId): void;
  update(id: NoteId, changes: Partial<Omit<Note, 'id'>>): void;
  setMeta<K extends MetaKey>(key: K, value: MetaValues[K]): void;
  /** Insert a track (at the end by default). Its notes come with it. */
  addTrack(track: Track, index?: number): void;
  /** Remove a track and its notes. The last track can't be removed. */
  removeTrack(id: string): void;
  updateTrack(id: string, changes: TrackChangesT): void;
}

function noteChanged(a: Note, b: Note) {
  return (
    a.pitch !== b.pitch ||
    a.start !== b.start ||
    a.duration !== b.duration ||
    a.velocity !== b.velocity ||
    a.channel !== b.channel ||
    a.muted !== b.muted ||
    a.data !== b.data
  );
}

export function createEditor(options?: EditorOptions) {
  return new Editor(options);
}
