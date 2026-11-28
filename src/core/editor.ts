import { ChordTrackCommands } from './chord-track';
import { Commands } from './commands';
import { Emitter } from './emitter';
import { History } from './history';
import { buildRowMap, type RowMap } from './music/rowmap';
import { ticksToSeconds } from './music/timeline';
import { NoteIndex } from './notes';
import type { Output, OutputResolverT } from './output';
import { invertPatches, type MetaKey, type MetaValues, type Patch } from './patches';
import { createCapture, type CaptureT } from './capture';
import { SectionCommands } from './sections';
import { Recorder } from './recorder';
import { Transport } from './transport';
import { getAudibleTrackIds, getTrackColor } from './tracks';
import type { ChordRegion, MaddieDoc, Note, NoteId, Tick, Track, TrackChangesT, TrackMetaT, TrackNoteT } from './types';
import { DEFAULT_VIEW, minScrollTick, ZOOM_LIMITS, type ViewState } from './view';
import { clampVelocity } from './music/velocity';

export const DEFAULT_VOLUME = { level: 0.8, muted: false };

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
  sectionselection: undefined;
  beforechange: BeforeChangeEvent;
  selection: { ids: ReadonlySet<NoteId> };
  view: ViewChangeEvent;
  transport: { state: Transport['state']; position: Tick };
  history: { canUndo: boolean; canRedo: boolean };
  noteon: { note: Note; time: number; track?: string };
  /** The track list, track settings, or the active track changed. */
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
  /** Select these notes or regions when the transaction commits. */
  selectionAfter?: readonly string[];
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
    sections: partial.sections ?? [],
    tracks: partial.tracks?.length ? partial.tracks : [{ id: DEFAULT_TRACK, notes: [] }],
  };
}

interface Tx {
  label: string;
  patches: Patch[];
  exactTracks: Set<string>;
  origin: Origin;
  gestureId?: string;
  selectionBefore: NoteId[];
  select?: readonly string[];
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
  /** Remembers live notes played outside a take, so they can be kept after the fact. */
  readonly capture: CaptureT;
  readonly commands: Commands;
  /** The default output. Every track without its own route sounds here. */
  output: Output | null;
  /** Turns a track's own route into an output. Set by the host (the OutputRouter does it). */
  outputResolver: OutputResolverT | null = null;
  audioContext: AudioContext | null;
  activeTrackId: string;

  readonly sections = new SectionCommands(this);
  readonly chordTrack = new ChordTrackCommands(this);
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
  volume = { ...DEFAULT_VOLUME };
  private live = new Map<number, { note: Note; output: Output | null }>();
  // Every output a note was sent to, so stop and seek can silence all of them.
  private usedOutputs = new Set<Output>();
  /** Internal clipboard. Notes relative to tick 0. */
  clipboard: Note[] = [];

  constructor(options: EditorOptions = {}) {
    super();
    const doc = createDoc(options.doc);
    this._meta = { ppq: doc.ppq, tempo: doc.tempo, timeSignature: doc.timeSignature, key: doc.key, sections: doc.sections ?? [] };
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
    this.capture = createCapture(this);
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
        sections: this._meta.sections,
        tracks: [...this.tracks.values()].map(({ track, notes }) => ({ ...track, notes: [...notes.all()] })),
      };
    }
    return this.docCache;
  }

  /** Replace the whole document. Clears history by default. */
  setDoc(doc: Partial<MaddieDoc>, { keepHistory = false, origin = 'load' as Origin } = {}) {
    const next = createDoc(doc);
    this.transport.clearResumePosition();
    this._meta = { ppq: next.ppq, tempo: next.tempo, timeSignature: next.timeSignature, key: next.key, sections: next.sections ?? [] };
    this.sections.reset();
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

  getTrackGain(trackId: string): number {
    return this.tracks.get(trackId)?.track.gain ?? 1;
  }

  /**
   * Where a track sounds: its own route, or the default output when it has none.
   * A track with its own route that cannot sound right now (a sound that is gone,
   * a MIDI port that is unplugged) gets null. It stays silent instead of falling back.
   */
  getTrackOutput(trackId: string): Output | null {
    const route = this.tracks.get(trackId)?.track.route;
    if (!route) return this.output;
    const resolve = this.outputResolver;
    if (!resolve) return this.output;
    return resolve(route);
  }

  get chordRegions(): readonly ChordRegion[] | undefined {
    return this.tracks.get(this.activeTrackId)?.track.chordRegions;
  }

  get selectedChordRegions(): ChordRegion[] {
    return this.chordRegions?.filter((region) => this._selection.has(region.id)) ?? [];
  }

  isNoteSelected(id: NoteId): boolean {
    const regionId = this.chordRegions && this.getNote(id)?.chordRegionId;
    return this._selection.has(regionId ?? id);
  }

  private selectionId(id: string): string | undefined {
    const regions = this.chordRegions;
    if (!regions) return this.index().has(id) ? id : undefined;
    const regionId = this.getNote(id)?.chordRegionId ?? id;
    return regions.some((region) => region.id === regionId) ? regionId : undefined;
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
    if (!this.sections.allTracksSelected) this.sections.clearContentSelection();
    this.select(this.sections.contentSelection?.get(trackId) ?? [], 'replace', true);
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
    let end = 0;
    for (const [id, entry] of this.tracks) {
      if (track && track !== id) continue;
      end = Math.max(end, entry.notes.end());
      for (const region of entry.track.chordRegions ?? []) end = Math.max(end, region.start + region.duration);
    }
    return end;
  }

  /** Rows for the current fold mode and key. */
  get rowMap(): RowMap {
    if (!this.rowMapCache) {
      const isFoldedToNotes = this._view.fold === 'used';
      const used = isFoldedToNotes ? this.usedPitches() : [];
      this.rowMapCache = buildRowMap({ fold: this._view.fold, key: this._meta.key, used });
    }
    return this.rowMapCache;
  }

  // ── Selection ─────────────────────────────────────────────────────

  /** Selected note IDs on MIDI tracks and region IDs on Chord Tracks. */
  get selection(): ReadonlySet<NoteId> {
    return this._selection;
  }

  get selectedNotes(): Note[] {
    if (this.chordRegions) return this.notes().filter((note) => note.chordRegionId && this._selection.has(note.chordRegionId));
    const idx = this.index();
    return [...this._selection].map((id) => idx.get(id)).filter((n): n is Note => !!n);
  }

  select(ids: Iterable<NoteId>, mode: 'replace' | 'add' | 'toggle' | 'remove' = 'replace', keepSectionContent = false) {
    if (!keepSectionContent) this.sections.clearContentSelection();
    const next = mode === 'replace' ? new Set<NoteId>() : new Set(this._selection);
    for (const id of new Set(Array.from(ids, (value) => this.selectionId(value)))) {
      if (id === undefined) continue;
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

  /** Set the paste destination and the next playback start together. */
  setInsertMarker(tick: Tick) {
    const cursor = Math.max(0, tick);
    this.setView({ cursor });
    this.transport.setMarker(cursor);
  }

  setView(partial: Partial<ViewState>, { animate = false } = {}) {
    const prev = this._view;
    const next = { ...prev, ...partial };
    next.pxPerTick = Math.min(ZOOM_LIMITS.pxPerTick[1], Math.max(ZOOM_LIMITS.pxPerTick[0], next.pxPerTick));
    next.rowHeight = Math.min(ZOOM_LIMITS.rowHeight[1], Math.max(ZOOM_LIMITS.rowHeight[0], next.rowHeight));
    next.scrollTick = Math.max(minScrollTick(next.pxPerTick), next.scrollTick);
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
      exactTracks: new Set(),
      origin: opts.origin ?? 'user',
      gestureId: opts.gestureId,
      selectionBefore: [...this._selection],
      select: opts.selectionAfter,
    };
    let result: T;
    try {
      result = fn(this.txApi);
      this.resolveOverlaps(this.tx.patches);
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

  /**
   * Notes never overlap: two notes on the same pitch in a MIDI track never share time.
   * The notes this transaction added or changed keep their full size. Notes they run into
   * make room: fully covered ones are removed, others are trimmed at the edge they overlap,
   * and one that surrounds an edited note ends where it starts (the tail is dropped).
   * Runs inside the transaction, so the whole edit is one undo step. Chord tracks are
   * left alone: their notes are rendered from chord regions, which never overlap.
   */
  private resolveOverlaps(patches: readonly Patch[]) {
    const touchedByTrack = new Map<string, Set<NoteId>>();
    for (const patch of patches) {
      const isNoteEdit = patch.op === 'add' || patch.op === 'replace';
      if (!isNoteEdit) continue;
      const note = patch.op === 'add' ? patch.note : patch.to;
      const ids = touchedByTrack.get(patch.track) ?? new Set<NoteId>();
      ids.add(note.id);
      touchedByTrack.set(patch.track, ids);
    }
    for (const [trackId, touchedIds] of touchedByTrack) {
      const isChordTrack = !!this.tracks.get(trackId)?.track.chordRegions;
      // The transaction API edits the active track, which is where note edits happen.
      const isOtherTrack = trackId !== this.activeTrackId || this.tx?.exactTracks.has(trackId);
      if (isChordTrack || isOtherTrack) continue;
      const touched = [...touchedIds].flatMap((id) => this.getNote(id, trackId) ?? []);
      this.resolveTouchedOverlaps(trackId, touched);
      for (const winner of touched) this.makeRoomFor(trackId, winner, touchedIds);
    }
  }

  /** Edited notes that overlap each other: the later one wins, the earlier one ends where it starts. */
  private resolveTouchedOverlaps(trackId: string, touched: Note[]) {
    const byPitch = new Map<number, Note[]>();
    for (const note of touched) byPitch.set(note.pitch, [...(byPitch.get(note.pitch) ?? []), note]);
    for (const group of byPitch.values()) {
      const sorted = [...group].sort((a, b) => a.start - b.start);
      for (let index = 0; index + 1 < sorted.length; index++) {
        const earlier = this.getNote(sorted[index].id, trackId);
        const later = sorted[index + 1];
        if (!earlier) continue;
        const isOverlapping = earlier.start + earlier.duration > later.start;
        if (!isOverlapping) continue;
        const room = later.start - earlier.start;
        const hasRoom = room > 0;
        if (hasRoom) this.txApi.update(earlier.id, { duration: room });
        if (!hasRoom) this.txApi.remove(earlier.id);
      }
    }
  }

  private makeRoomFor(trackId: string, winner: Note, protectedIds: ReadonlySet<NoteId>) {
    const current = this.getNote(winner.id, trackId);
    if (!current) return;
    const winnerEnd = current.start + current.duration;
    const neighbors = this.notesInRange(current.start, winnerEnd, trackId);
    for (const other of neighbors) {
      const isSelf = other.id === current.id;
      const isProtected = protectedIds.has(other.id);
      const isOtherPitch = other.pitch !== current.pitch;
      if (isSelf || isProtected || isOtherPitch) continue;
      const otherEnd = other.start + other.duration;
      const isOverlapping = other.start < winnerEnd && otherEnd > current.start;
      if (!isOverlapping) continue;
      const isCovered = other.start >= current.start && otherEnd <= winnerEnd;
      if (isCovered) {
        this.txApi.remove(other.id);
        continue;
      }
      const startsBefore = other.start < current.start;
      if (startsBefore) {
        this.txApi.update(other.id, { duration: current.start - other.start });
        continue;
      }
      this.txApi.update(other.id, { start: winnerEnd, duration: otherEnd - winnerEnd });
    }
  }

  /** Apply patches from elsewhere (sync, collab). Not added to history. */
  applyPatches(patches: readonly Patch[], { origin = 'remote' as Origin } = {}) {
    if (!patches.length) return;
    for (const p of patches) this.applyPatch(p);
    const hasNewActiveTrack = this.settleActiveTrack();
    this.invalidate();
    this.pruneSelection();
    this.sections.prune();
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
    this._selection = new Set(entry.selectionBefore.filter((id) => this.selectionId(id) !== undefined));
    this.sections.prune();
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
    this._selection = new Set(entry.selectionAfter.filter((id) => this.selectionId(id) !== undefined));
    this.sections.prune();
    this.emit('change', { patches: entry.patches, origin: 'history', label: `Redo ${entry.label}` });
    this.emit('selection', { ids: this._selection });
    this.emitTracksIfChanged(entry.patches, hasNewActiveTrack);
    this.emitHistory();
  }

  // ── Sound ─────────────────────────────────────────────────────────

  setVolume(volume: Partial<Editor['volume']>) {
    this.volume = { ...this.volume, ...volume, level: Math.max(0, Math.min(1, volume.level ?? this.volume.level)) };
    const masterLevel = this.volume.muted ? 0 : this.volume.level;
    this.output?.setVolume?.(masterLevel);
    for (const output of this.usedOutputs) output.setVolume?.(masterLevel);
    this.emit('transport', { state: this.transport.state, position: this.transport.position });
  }

  /** Silence every output a note was sent to: the default and each track's own. Stop, seek, loop wrap. */
  allOutputsOff() {
    this.output?.allNotesOff();
    for (const output of this.usedOutputs) output.allNotesOff();
  }

  // The first time an output is used, give it the master level, since it missed earlier changes.
  private claimOutput(output: Output) {
    if (this.usedOutputs.has(output)) return;
    this.usedOutputs.add(output);
    output.setVolume?.(this.volume.muted ? 0 : this.volume.level);
  }

  /** Output velocity after track gain and any master volume handled by the editor. */
  private outVelocity(velocity: number, trackId: string, output: Output) {
    const gain = this.getTrackGain(trackId);
    return velocity * gain * (output.setVolume ? 1 : this.volume.level);
  }

  /** Start a held note (computer keyboard, MIDI input). Recorded while `recorder.recording`. */
  liveNoteOn(pitch: number, velocity = this._view.noteVelocity) {
    this.liveNoteOff(pitch);
    const note: Note = { id: `live-${pitch}`, pitch, start: 0, duration: 0, velocity };
    const trackId = this.activeTrackId;
    const live = { note, output: null as Output | null };
    this.live.set(pitch, live);
    this.recorder.noteOn(pitch, velocity);
    this.capture.noteOn(pitch, velocity);
    const out = this.getTrackOutput(trackId);
    if (!out || this.volume.muted || this.getTrackGain(trackId) === 0) return;
    this.claimOutput(out);
    live.output = out;
    out.noteOn({ note, pitch, velocity: this.outVelocity(velocity, trackId, out), time: 0 });
  }

  liveNoteOff(pitch: number) {
    const live = this.live.get(pitch);
    if (!live) return;
    this.live.delete(pitch);
    this.recorder.noteOff(pitch);
    this.capture.noteOff(pitch);
    live.output?.noteOff({ note: live.note, pitch, velocity: 0, time: 0 });
  }

  /** Release every held note. */
  liveAllOff() {
    for (const pitch of [...this.live.keys()]) this.liveNoteOff(pitch);
  }

  /** Preview a pitch while editing. */
  audition(pitch: number, velocity = this._view.noteVelocity) {
    const trackId = this.activeTrackId;
    const out = this.getTrackOutput(trackId);
    if (!out || this.volume.muted || this.getTrackGain(trackId) === 0) return;
    this.claimOutput(out);
    const note: Note = { id: 'audition', pitch, start: 0, duration: 0, velocity };
    const e = { note, pitch, velocity: this.outVelocity(velocity, trackId, out), time: 0, duration: 0.35 };
    if (out.audition) out.audition(e);
    else out.noteOn(e);
  }

  private chord: { output: Output; started: Set<Note>; timers: Array<ReturnType<typeof setTimeout>> } | null = null;

  /**
   * Play pitches together for `seconds`, or until stopped when `seconds` is null.
   * `humanize` strums the notes a few ms apart and gives each a random velocity (60–80 of 127).
   */
  auditionChord(pitches: Iterable<number>, seconds: number | null = 0.5, velocity = this._view.noteVelocity, { humanize = false } = {}) {
    this.stopChord();
    const trackId = this.activeTrackId;
    const out = this.getTrackOutput(trackId);
    if (!out || this.volume.muted) return;
    this.claimOutput(out);
    const notes = [...new Set(pitches)].map(
      (pitch): Note => ({ id: `chord-${pitch}`, pitch, start: 0, duration: 0, velocity: humanize ? (60 + Math.random() * 20) / 127 : velocity }),
    );
    if (!notes.length) return;
    const chord = { output: out, started: new Set<Note>(), timers: [] as Array<ReturnType<typeof setTimeout>> };
    this.chord = chord;
    const start = (note: Note) => {
      if (this.volume.muted || this.getTrackGain(trackId) === 0) return;
      chord.started.add(note);
      out.noteOn({ note, pitch: note.pitch, velocity: this.outVelocity(note.velocity, trackId, out), time: 0 });
    };
    for (const note of notes) {
      const delay = humanize ? Math.random() * 40 : 0;
      if (delay) chord.timers.push(setTimeout(() => start(note), delay));
      else start(note);
    }
    const stop = () => { if (this.chord === chord) this.stopChord(); };
    if (seconds !== null) chord.timers.push(setTimeout(stop, seconds * 1000));
    return stop;
  }

  /** Audition a rendered passage without changing the transport position. */
  auditionNotes(notes: readonly Note[], origin: Tick, trackId = this.activeTrackId) {
    this.stopChord();
    const out = this.getTrackOutput(trackId);
    const audible = notes.filter((note) => !note.muted);
    if (!out || this.volume.muted || !audible.length) return;
    this.claimOutput(out);
    const { tempo, ppq } = this.meta;
    const seconds = (tick: Tick) => ticksToSeconds(tick, tempo, ppq);
    const offset = seconds(origin);
    const chord = { output: out, started: new Set<Note>(), timers: [] as Array<ReturnType<typeof setTimeout>> };
    this.chord = chord;
    for (const note of audible.sort((a, b) => a.start - b.start)) {
      const start = () => {
        if (this.volume.muted || this.getTrackGain(trackId) === 0) return;
        chord.started.add(note);
        out.noteOn({ note, pitch: note.pitch, velocity: this.outVelocity(note.velocity, trackId, out), time: 0 });
      };
      const stop = () => {
        if (!chord.started.delete(note)) return;
        out.noteOff({ note, pitch: note.pitch, velocity: 0, time: 0 });
      };
      const delay = seconds(note.start) - offset;
      if (delay <= 0) start();
      else chord.timers.push(setTimeout(start, delay * 1000));
      chord.timers.push(setTimeout(stop, (seconds(note.start + note.duration) - offset) * 1000));
    }
    return () => { if (this.chord === chord) this.stopChord(); };
  }

  stopChord() {
    const chord = this.chord;
    if (!chord) return;
    this.chord = null;
    chord.timers.forEach(clearTimeout);
    for (const note of chord.started) chord.output.noteOff({ note, pitch: note.pitch, velocity: 0, time: 0 });
  }

  /** @internal Called by the transport scheduler. */
  dispatchNote(note: Note, time: number, duration: number, track?: string) {
    this.emit('noteon', { note, time, track });
    const trackId = track ?? this.activeTrackId;
    const out = this.getTrackOutput(trackId);
    if (!out || this.volume.muted || this.getTrackGain(trackId) === 0) return;
    this.claimOutput(out);
    const e = { note, pitch: note.pitch, velocity: this.outVelocity(note.velocity, trackId, out), time, duration };
    out.noteOn(e);
    out.noteOff({ ...e, time: time + duration });
  }

  /** @internal */
  emitTransport() {
    this.emit('transport', { state: this.transport.state, position: this.transport.position });
  }

  // ── Internals ─────────────────────────────────────────────────────

  private readonly txApi: TxApi = {
    add: (note) => {
      if (!this.chordRegions) this.record({ op: 'add', track: this.activeTrackId, note });
    },
    remove: (id) => {
      if (this.chordRegions) return;
      const note = this.index().get(id);
      if (note) this.record({ op: 'remove', track: this.activeTrackId, note });
    },
    update: (id, changes) => {
      if (this.chordRegions) return;
      const from = this.index().get(id);
      if (!from) return;
      const to = { ...from, ...changes, id };
      if (!noteChanged(from, to)) return;
      this.record({ op: 'replace', track: this.activeTrackId, from, to });
    },
    setChordRegions: (regions, notes) => {
      this.replaceTrackContent(this.activeTrackId, notes, regions);
    },
    setTrackContent: (track, notes, regions) => {
      this.tx!.exactTracks.add(track);
      this.replaceTrackContent(track, notes, regions);
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

  private replaceTrackContent(track: string, notes: readonly Note[], regions?: readonly ChordRegion[]) {
    const index = this.index(track);
    const existing = new Map(notes.map((note) => [note.id, note]));
    if (this.tracks.get(track)?.track.chordRegions !== regions) {
      this.txApi.updateTrack(track, { chordRegions: regions });
    }
    for (const note of index.all()) {
      if (!existing.has(note.id)) this.record({ op: 'remove', track, note });
    }
    for (const to of notes) {
      const from = index.get(to.id);
      if (!from) this.record({ op: 'add', track, note: to });
      else if (noteChanged(from, to)) this.record({ op: 'replace', track, from, to });
    }
  }

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
    if (tx.select) this.select(tx.select);
    else this.pruneSelection();
    if (tx.origin !== 'remote' && tx.origin !== 'load') {
      this.history.push({
        label: tx.label,
        gestureId: tx.gestureId,
        patches: tx.patches,
        selectionBefore: tx.selectionBefore,
        selectionAfter: [...this._selection],
      });
    }
    this.sections.prune();
    this.emit('change', { patches: tx.patches, origin: tx.origin, label: tx.label, gestureId: tx.gestureId });
    this.emitTracksIfChanged(tx.patches, hasNewActiveTrack);
    this.emitHistory();
  }

  private pruneSelection() {
    const kept = [...this._selection].filter((id) => this.selectionId(id) !== undefined);
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
  /** Replace validated content on any track, preserving the exact note positions. */
  setTrackContent(track: string, notes: readonly Note[], regions?: readonly ChordRegion[]): void;
  setChordRegions(regions: readonly ChordRegion[] | undefined, notes: readonly Note[]): void;
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
    a.chordRegionId !== b.chordRegionId ||
    a.data !== b.data
  );
}

export function createEditor(options?: EditorOptions) {
  return new Editor(options);
}
