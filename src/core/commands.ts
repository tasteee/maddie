import type { Editor, TransactOptions, TxApi } from './editor';
import { createId, createTrackId } from './editor';
import { resolveGrid, snapTick } from './music/grid';
import { clampPitch, MAX_PITCH, MIN_PITCH } from './music/pitch';
import { transposeDegrees } from './music/scale';
import { timeSigAt } from './music/timeline';
import { clampVelocity } from './music/velocity';
import { fromMidiFile, type MidiImport } from './midi/read';
import { areRoutesEqual, getTrackName, pickNewTrackColor, pickNewTrackName, TRACK_COLORS } from './tracks';
import type { Key, Note, NoteId, NoteInput, Tick, Track, TrackRouteT } from './types';

type Ids = Iterable<NoteId> | undefined;

/**
 * Every built-in edit. Each is one undo step.
 * `ids` defaults to the current selection.
 */
export class Commands {
  constructor(private editor: Editor) {}

  private ids(ids: Ids): NoteId[] {
    return [...(ids ?? this.editor.selection)];
  }

  private notesOf(ids: Ids): Note[] {
    return this.ids(ids)
      .map((id) => this.editor.getNote(id))
      .filter((n): n is Note => !!n);
  }

  /** Current grid size in ticks. */
  gridTicks(at: Tick = 0): number {
    const { view, meta, ppq } = this.editor;
    return resolveGrid(view.grid, ppq, view.pxPerTick, timeSigAt(at, meta.timeSignature));
  }

  add(inputs: NoteInput[], { select = true, ...opts }: TransactOptions & { select?: boolean } = {}): Note[] {
    if (this.editor.chordRegions) return [];
    const notes = inputs.map((n) => normalize({ ...n, id: n.id ?? createId() }));
    this.editor.transact(
      notes.length === 1 ? 'Add note' : 'Add notes',
      (tx) => notes.forEach((n) => tx.add(n)),
      opts,
    );
    if (select) this.editor.select(notes.map((n) => n.id));
    return notes;
  }

  delete(ids?: Ids, opts?: TransactOptions) {
    const list = this.ids(ids);
    if (this.editor.chordRegions) return this.editor.chordTrack.delete(list);
    this.editor.transact(list.length === 1 ? 'Delete note' : 'Delete notes', (tx) => list.forEach((id) => tx.remove(id)), opts);
  }

  /** Apply arbitrary per-note changes in one step. */
  update(changes: Array<Partial<Note> & { id: NoteId }>, label = 'Edit notes', opts?: TransactOptions) {
    this.editor.transact(
      label,
      (tx) => {
        for (const { id, ...c } of changes) {
          const n = this.editor.getNote(id);
          if (n) tx.update(id, normalize({ ...n, ...c }));
        }
      },
      opts,
    );
  }

  move(ids: Ids, { ticks = 0, pitches = 0 }: { ticks?: Tick; pitches?: number }, opts?: TransactOptions) {
    const notes = this.notesOf(ids);
    if (!notes.length) return;
    const minStart = Math.min(...notes.map((n) => n.start));
    const dt = Math.max(-minStart, ticks);
    const lo = Math.min(...notes.map((n) => n.pitch));
    const hi = Math.max(...notes.map((n) => n.pitch));
    const dp = Math.max(MIN_PITCH - lo, Math.min(MAX_PITCH - hi, pitches));
    this.update(
      notes.map((n) => ({ id: n.id, start: n.start + dt, pitch: n.pitch + dp })),
      'Move notes',
      opts,
    );
  }

  resize(ids: Ids, { edge = 'end', ticks }: { edge?: 'start' | 'end'; ticks: Tick }, opts?: TransactOptions) {
    const min = Math.max(1, Math.round(this.editor.ppq / 64));
    this.update(
      this.notesOf(ids).map((n) => {
        if (edge === 'end') return { id: n.id, duration: Math.max(min, n.duration + ticks) };
        const end = n.start + n.duration;
        const start = Math.max(0, Math.min(end - min, n.start + ticks));
        return { id: n.id, start, duration: end - start };
      }),
      'Resize notes',
      opts,
    );
  }

  /**
   * Scale the selection in time, like resizing it as one block.
   * Starts spread out from the first note and durations scale by the same `factor`,
   * so gaps and overlaps keep their shape. 2 = double, 0.5 = half.
   */
  stretch(ids: Ids, factor: number, opts?: TransactOptions) {
    const notes = this.notesOf(ids);
    if (!notes.length || !(factor > 0) || factor === 1) return;
    const anchor = Math.min(...notes.map((n) => n.start));
    this.update(
      notes.map((n) => ({ id: n.id, start: anchor + (n.start - anchor) * factor, duration: n.duration * factor })),
      factor > 1 ? 'Stretch notes' : 'Squash notes',
      opts,
    );
  }

  /** `absolute`: set to value. `relative`: add value. `scale`: multiply by value. */
  setVelocity(ids: Ids, { mode = 'absolute', value }: { mode?: 'absolute' | 'relative' | 'scale'; value: number }, opts?: TransactOptions) {
    this.update(
      this.notesOf(ids).map((n) => ({
        id: n.id,
        velocity: clampVelocity(mode === 'absolute' ? value : mode === 'relative' ? n.velocity + value : n.velocity * value),
      })),
      'Change velocity',
      opts,
    );
  }

  /**
   * Fit velocities into [lo, hi] (0–1), keeping each note's relative position.
   * If the notes all share one velocity, they ramp from lo to hi in time order.
   */
  setVelocityRange(ids: Ids, lo: number, hi: number, opts?: TransactOptions) {
    this.update(remapVelocities(this.notesOf(ids), lo, hi), 'Change velocity', opts);
  }

  /**
   * Arrow-key pitch move. With a fold on, one step = one visible row
   * (scale fold: scale rows only), and nothing moves if any note has no row left.
   * Otherwise a step is a scale degree (scale lock) or a semitone. Octaves are always 12 semitones.
   * The moved notes are auditioned together for half a second.
   */
  nudgePitch(ids: Ids, steps: number, opts?: TransactOptions) {
    const { view, key } = this.editor;
    const before = this.notesOf(ids);
    if (Math.abs(steps) !== 1) this.transpose(ids, { semitones: steps }, opts);
    else if (view.fold === 'scale' || view.fold === 'used') this.transpose(ids, { rows: steps }, opts);
    else if (view.scaleLock && key) this.transpose(ids, { degrees: steps }, opts);
    else this.transpose(ids, { semitones: steps }, opts);
    // Let the user hear where the notes landed (only if they moved).
    const after = this.notesOf(ids);
    if (after.some((n, i) => n.pitch !== before[i]?.pitch)) this.editor.auditionChord(after.map((n) => n.pitch));
  }

  /** By semitones, by scale degrees (needs a key), or by visible rows of the current fold. */
  transpose(ids: Ids, by: { semitones: number } | { degrees: number } | { rows: number }, opts?: TransactOptions) {
    if ('rows' in by) return this.transposeRows(ids, by.rows, opts);
    const key = this.editor.key;
    const notes = this.notesOf(ids);
    if ('degrees' in by && key) {
      this.update(
        notes.map((n) => ({ id: n.id, pitch: clampPitch(transposeDegrees(n.pitch, by.degrees, key)) })),
        'Transpose',
        opts,
      );
    } else {
      const semis = 'semitones' in by ? by.semitones : by.degrees;
      this.move(ids, { pitches: semis }, opts);
    }
  }

  /** Move each note `rows` rows through the fold. All or nothing: blocked if any note runs out of rows. */
  private transposeRows(ids: Ids, rows: number, opts?: TransactOptions) {
    const notes = this.notesOf(ids);
    if (!notes.length || !rows) return;
    const { view, key, rowMap } = this.editor;
    const scaleOnly = view.fold === 'scale' && !!key;
    // Ascending pitches the notes may land on.
    const lanes = rowMap.rows
      .filter((r) => !scaleOnly || r.inScale)
      .map((r) => r.pitch)
      .sort((a, b) => a - b);
    const changes: Array<{ id: NoteId; pitch: number }> = [];
    for (const n of notes) {
      const i = lanes.indexOf(n.pitch);
      let target: number;
      // A note off the lanes (e.g. out of scale) steps to the nearest lane in that direction first.
      if (i >= 0) target = i + rows;
      else if (rows > 0) target = lanes.findIndex((p) => p > n.pitch) + rows - 1;
      else target = lanes.filter((p) => p < n.pitch).length - 1 + rows + 1;
      const pitch = lanes[target];
      if (target < 0 || pitch === undefined || (rows > 0 ? pitch <= n.pitch : pitch >= n.pitch)) return;
      changes.push({ id: n.id, pitch });
    }
    this.update(changes, 'Transpose', opts);
  }

  quantize(ids?: Ids, { grid, strength = 1, ends = false }: { grid?: number; strength?: number; ends?: boolean } = {}, opts?: TransactOptions) {
    const sigs = this.editor.meta.timeSignature;
    this.update(
      this.notesOf(ids).map((n) => {
        const g = grid ?? this.gridTicks(n.start);
        const start = Math.round(n.start + (snapTick(n.start, g, sigs) - n.start) * strength);
        let duration = n.duration;
        if (ends) {
          const end = n.start + n.duration;
          duration = Math.max(g, Math.round(end + (snapTick(end, g, sigs) - end) * strength) - start);
        }
        return { id: n.id, start, duration };
      }),
      'Quantize',
      opts,
    );
  }

  /**
   * Velocity from `from` on the first note to `to` on the last, in even steps.
   * Notes are ordered by start; notes that start together share a step.
   * If every note starts together (one chord), the steps go from the lowest pitch to the highest.
   */
  rampVelocity(ids: Ids, from: number, to: number, opts?: TransactOptions) {
    this.update(rampVelocities(this.notesOf(ids), from, to), 'Ramp velocity', opts);
  }

  /**
   * Spread notes that start together (a chord) so they sound one after another.
   * `down` plays the lowest pitch first, like a downstroke on a guitar. `up` plays the highest first.
   * `amount` is 0–1. At 1 the last note starts halfway through the chord's shortest note.
   * Every note keeps its end, so only the starts move. Single notes are left alone.
   */
  strum(ids: Ids, direction: StrumDirectionT, amount: number, opts?: TransactOptions) {
    this.update(strumChanges(this.notesOf(ids), direction, amount), 'Strum', opts);
  }

  /**
   * Random nudges to timing and velocity, so programmed parts feel played.
   * `timing` is the max offset in ticks; `velocity` the max offset (0–1).
   */
  humanize(ids?: Ids, { timing = 0, velocity = 0, random = Math.random }: { timing?: Tick; velocity?: number; random?: () => number } = {}, opts?: TransactOptions) {
    const jitter = () => random() * 2 - 1;
    this.update(
      this.notesOf(ids).map((n) => ({
        id: n.id,
        start: Math.max(0, Math.round(n.start + jitter() * timing)),
        velocity: clampVelocity(n.velocity + jitter() * velocity),
      })),
      'Humanize',
      opts,
    );
  }

  /** Copies placed right after the selection, aligned to the bar grid. */
  duplicate(ids?: Ids): Note[] {
    const notes = this.notesOf(ids);
    if (!notes.length) return [];
    const start = Math.min(...notes.map((n) => n.start));
    const end = Math.max(...notes.map((n) => n.start + n.duration));
    const g = this.gridTicks(start);
    const span = Math.max(g, Math.ceil((end - start) / g) * g);
    return this.addCopies(notes, span, 'Duplicate');
  }

  /** @internal Add copies of notes offset in time/pitch. Used by duplicate and ⌘-drag. */
  addCopies(notes: Note[], ticks: Tick, label = 'Copy notes', pitches = 0, opts?: TransactOptions): Note[] {
    if (this.editor.chordRegions) return [];
    const copies = notes.map((n) => normalize({ ...n, id: createId(), start: n.start + ticks, pitch: n.pitch + pitches }));
    this.editor.transact(label, (tx) => copies.forEach((n) => tx.add(n)), opts);
    this.editor.select(copies.map((n) => n.id));
    return copies;
  }

  copy(ids?: Ids) {
    if (this.editor.chordRegions && ids === undefined) return this.editor.chordTrack.copy();
    const notes = this.notesOf(ids);
    if (!notes.length) return;
    const start = Math.min(...notes.map((n) => n.start));
    this.editor.chordTrack.clearClipboard();
    this.editor.clipboard = notes.map(({ chordRegionId: _owner, ...note }) => ({ ...note, start: note.start - start }));
  }

  cut(ids?: Ids) {
    if (this.editor.chordRegions) return;
    this.copy(ids);
    this.delete(ids);
  }

  /** Paste at a tick (default: the view cursor). */
  paste(at: Tick = this.editor.view.cursor): Note[] {
    const clip = this.editor.clipboard;
    if (!clip.length) return [];
    return this.add(clip.map(({ id: _id, ...n }) => ({ ...n, start: n.start + at })));
  }

  toggleMute(ids?: Ids) {
    if (this.editor.chordRegions) {
      this.editor.chordTrack.toggleMute(ids ?? this.editor.selection);
      return;
    }
    const notes = this.notesOf(ids);
    const mute = notes.some((n) => !n.muted);
    this.update(notes.map((n) => ({ id: n.id, muted: mute })), mute ? 'Mute' : 'Unmute');
  }

  /** Extend each note to the start of the next one. */
  legato(ids?: Ids) {
    const notes = this.notesOf(ids).sort((a, b) => a.start - b.start);
    const starts = [...new Set(notes.map((n) => n.start))].sort((a, b) => a - b);
    this.update(
      notes.map((n) => {
        const next = starts.find((s) => s > n.start);
        return { id: n.id, duration: next !== undefined ? next - n.start : n.duration };
      }),
      'Legato',
    );
  }

  selectAll() {
    this.editor.select((this.editor.chordRegions ?? this.editor.notes()).map((item) => item.id));
  }

  /**
   * Load a .mid file in one undoable step. Appending preserves the document metadata by default.
   *
   * - `tracks: 'split'` (default): one Maddie track per MIDI track, named after it.
   *   The first imported track becomes the active one.
   * - `tracks: 'merge'`: every MIDI track goes into the active track (the old behavior).
   *
   * `replace` (default) clears first: all tracks when splitting, the active track's notes when merging.
   */
  importMidi(
    input: ArrayBuffer | Uint8Array,
    { replace = true, tracks = 'split', importMetadata = replace }: { replace?: boolean; tracks?: 'split' | 'merge'; importMetadata?: boolean } = {},
  ): MidiImport {
    const ed = this.editor;
    const midi = fromMidiFile(input, { ppq: ed.ppq });
    const isMerge = tracks === 'merge';
    if (isMerge && ed.chordRegions) throw new Error('Select a MIDI track to merge a MIDI file.');
    if (isMerge) this.importIntoActiveTrack(midi, replace, importMetadata);
    else if (replace || midi.tracks.length) {
      const start = replace ? 0 : ed.trackIds.length;
      const imported = this.makeImportedTracks(midi, (track, index) => ({
        name: getTrackName(track, start + index),
        color: TRACK_COLORS[(start + index) % TRACK_COLORS.length],
      }));
      this.applyImportedTracks(imported, replace, importMetadata ? midi : undefined);
    }
    return midi;
  }

  /** Append already parsed files in order, with one undo step and one color per file. */
  appendMidiFiles(files: readonly { name: string; midi: MidiImport }[]): readonly Track[] {
    if (!files.length) return [];
    const colorsInUse = [...this.editor.trackList];
    const tracks: Track[] = [];
    for (const { name, midi } of files) {
      const stem = name.replace(/\.(mid|midi|smf)$/i, '').trim() || name;
      const color = pickNewTrackColor(colorsInUse);
      const group = this.makeImportedTracks(midi, (track, index) => ({
        name: midi.tracks.length > 1 ? `${stem} — ${getTrackName(track, index)}` : stem,
        color,
      }));
      tracks.push(...group);
      // Count each file once when the palette wraps.
      colorsInUse.push(group[0]);
    }
    this.applyImportedTracks(tracks);
    const committed = new Set(this.editor.trackIds);
    return tracks.filter((track) => committed.has(track.id));
  }

  private importIntoActiveTrack(midi: MidiImport, replace: boolean, importMetadata: boolean) {
    const ed = this.editor;
    ed.transact('Import MIDI', (tx) => {
      if (replace) for (const n of [...ed.notes()]) tx.remove(n.id);
      for (const n of midi.notes) tx.add(normalize({ ...n, id: createId() }));
      if (importMetadata) this.applyImportedMeta(tx, midi);
    });
    ed.clearSelection();
  }

  private makeImportedTracks(
    midi: MidiImport,
    describe: (track: { id: string; name?: string }, index: number) => Pick<Track, 'name' | 'color'>,
  ): Track[] {
    const importedTracks = midi.tracks.length > 0 ? midi.tracks : [{ name: undefined, notes: [] }];
    return importedTracks.map((imported, index) => {
      const draft = { id: createTrackId(), name: imported.name?.trim() || undefined };
      const notes = imported.notes.map((n) => normalize({ ...n, id: createId() }));
      return { id: draft.id, ...describe(draft, index), notes };
    });
  }

  private applyImportedTracks(newTracks: readonly Track[], replace = false, metadata?: MidiImport) {
    const ed = this.editor;
    const oldTrackIds = ed.trackIds;
    ed.transact('Import MIDI', (tx) => {
      // New tracks go in first: a document is never without a track.
      for (const track of newTracks) tx.addTrack(track);
      if (replace) for (const id of oldTrackIds) tx.removeTrack(id);
      if (metadata) this.applyImportedMeta(tx, metadata);
    });
    if (ed.trackIds.includes(newTracks[0].id)) ed.setActiveTrack(newTracks[0].id);
  }

  private applyImportedMeta(tx: TxApi, midi: MidiImport) {
    tx.setMeta('tempo', midi.tempo);
    tx.setMeta('timeSignature', midi.timeSignature);
    if (midi.key) tx.setMeta('key', midi.key);
  }

  // ── Tracks ────────────────────────────────────────────────────────

  /**
   * Add a track after the others and make it the active one.
   * It gets the next free "Track N" name and palette color unless you pass your own.
   */
  addTrack(
    input: { name?: string; color?: string; notes?: NoteInput[]; activate?: boolean; chords?: boolean } = {},
    opts?: TransactOptions,
  ): Track {
    const ed = this.editor;
    const existing = ed.trackList;
    const notes = (input.chords ? [] : input.notes ?? []).map((n) => normalize({ ...n, id: n.id ?? createId() }));
    const track: Track = {
      id: createTrackId(),
      name: input.name?.trim() || (input.chords ? 'Chords' : pickNewTrackName(existing)),
      color: input.color ?? pickNewTrackColor(existing),
      ...(input.chords ? { chordRegions: [] } : {}),
      notes,
    };
    ed.transact('Add track', (tx) => tx.addTrack(track), opts);
    const shouldActivate = input.activate ?? true;
    if (shouldActivate && ed.trackIds.includes(track.id)) ed.setActiveTrack(track.id);
    return track;
  }

  duplicateTrack = (trackId: string): Track | undefined => {
    const ed = this.editor;
    const index = ed.trackIds.indexOf(trackId);
    const hasTrack = index >= 0;
    if (!hasTrack) return;
    const source = ed.doc.tracks[index];
    const regionIds = new Map<string, string>();
    const chordRegions = source.chordRegions?.map((region) => {
      const id = createId();
      regionIds.set(region.id, id);
      return { ...region, id };
    });
    const notes = source.notes.map((note) => {
      const chordRegionId = note.chordRegionId ? regionIds.get(note.chordRegionId) : undefined;
      return { ...note, id: createId(), chordRegionId };
    });
    const track: Track = {
      ...source,
      id: createTrackId(),
      name: getTrackName(source, index) + ' copy',
      color: ed.getTrackColor(trackId),
      solo: false,
      chordRegions,
      notes,
    };
    ed.transact('Duplicate track', (tx) => tx.addTrack(track, index + 1));
    const didInsert = ed.trackIds.includes(track.id);
    if (didInsert) ed.setActiveTrack(track.id);
    return didInsert ? track : undefined;
  };

  /** Move a track to a new position in the list. One undo step. Returns false if nothing moved. */
  moveTrack(trackId: string, newIndex: number): boolean {
    const ed = this.editor;
    const oldIndex = ed.trackIds.indexOf(trackId);
    const hasTrack = oldIndex >= 0;
    const hasOtherTracks = ed.trackIds.length > 1;
    if (!hasTrack || !hasOtherTracks) return false;
    const lastIndex = ed.trackIds.length - 1;
    const targetIndex = Math.max(0, Math.min(lastIndex, newIndex));
    const isSamePlace = targetIndex === oldIndex;
    if (isSamePlace) return false;
    const source = ed.doc.tracks[oldIndex];
    ed.transact('Move track', (tx) => {
      tx.removeTrack(trackId);
      tx.addTrack(source, targetIndex);
    });
    return true;
  }

  /** Remove a track and its notes. The last track stays. Returns false if nothing was removed. */
  removeTrack(trackId: string, opts?: TransactOptions): boolean {
    const ed = this.editor;
    const hasTrack = ed.trackIds.includes(trackId);
    const isLastTrack = ed.trackIds.length <= 1;
    if (!hasTrack || isLastTrack) return false;
    ed.transact('Remove track', (tx) => tx.removeTrack(trackId), opts);
    return true;
  }

  /** An empty name goes back to "Track N". */
  renameTrack(trackId: string, name: string, opts?: TransactOptions) {
    const trimmedName = name.trim();
    const nextName = trimmedName === '' ? undefined : trimmedName;
    this.editor.transact('Rename track', (tx) => tx.updateTrack(trackId, { name: nextName }), opts);
  }

  setTrackColor(trackId: string, color: string, opts?: TransactOptions) {
    this.editor.transact('Change track color', (tx) => tx.updateTrack(trackId, { color }), opts);
  }

  setTrackGain(trackId: string, gain: number, opts?: TransactOptions) {
    if (!Number.isFinite(gain)) return;
    const level = Math.max(0, Math.min(1, gain));
    if (this.editor.getTrackGain(trackId) === level) return;
    this.editor.transact('Change track gain', (tx) => tx.updateTrack(trackId, { gain: level }), opts);
  }

  /**
   * Choose where a track sounds. `undefined` puts it back on the project's default output.
   * Whatever the track was sounding on is silenced, so no note hangs on the old output.
   */
  setTrackRoute(trackId: string, route: TrackRouteT | undefined, opts?: TransactOptions) {
    const ed = this.editor;
    const hasTrack = ed.trackIds.includes(trackId);
    if (!hasTrack) return;
    const previousRoute = ed.trackList.find((track) => track.id === trackId)?.route;
    const isSame = areRoutesEqual(previousRoute, route);
    if (isSame) return;
    const previousOutput = ed.getTrackOutput(trackId);
    ed.transact('Change track output', (tx) => tx.updateTrack(trackId, { route }), opts);
    const nextOutput = ed.getTrackOutput(trackId);
    const didOutputChange = previousOutput !== nextOutput;
    if (didOutputChange) previousOutput?.allNotesOff();
  }

  setTrackMuted(trackId: string, isMuted: boolean, opts?: TransactOptions) {
    const label = isMuted ? 'Mute track' : 'Unmute track';
    this.editor.transact(label, (tx) => tx.updateTrack(trackId, { muted: isMuted }), opts);
  }

  setTrackSolo(trackId: string, isSolo: boolean, opts?: TransactOptions) {
    const label = isSolo ? 'Solo track' : 'Unsolo track';
    this.editor.transact(label, (tx) => tx.updateTrack(trackId, { solo: isSolo }), opts);
  }

  /**
   * Solo a track on its own: every other solo is cleared in the same undo step.
   * With `isAdditive`, other solos stay, so several tracks can play together.
   * Clicking the only soloed track unsolos it.
   */
  soloTrack(trackId: string, isAdditive: boolean, opts?: TransactOptions) {
    const tracks = this.editor.trackList;
    const target = tracks.find((track) => track.id === trackId);
    if (!target) return;
    const otherSoloed = isAdditive ? [] : tracks.filter((track) => track.id !== trackId && track.solo);
    const hasOtherSolos = otherSoloed.length > 0;
    const willSolo = hasOtherSolos ? true : !target.solo;
    const label = willSolo ? 'Solo track' : 'Unsolo track';
    this.editor.transact(label, (tx) => {
      for (const other of otherSoloed) tx.updateTrack(other.id, { solo: false });
      tx.updateTrack(trackId, { solo: willSolo });
    }, opts);
  }

  /** Same as `editor.setActiveTrack`. Not an undo step: it is a view of the song, like the selection. */
  setActiveTrack(trackId: string) {
    this.editor.setActiveTrack(trackId);
  }

  setTempo(bpm: number, opts?: TransactOptions) {
    const clamped = Math.round(Math.max(20, Math.min(400, bpm)) * 100) / 100;
    const tempo = this.editor.meta.tempo.map((e, i) => (i === 0 ? { ...e, bpm: clamped } : e));
    this.editor.transact('Change tempo', (tx) => tx.setMeta('tempo', tempo), opts);
  }

  setTimeSignature(numerator: number, denominator: number) {
    const sigs = this.editor.meta.timeSignature.map((e, i) => (i === 0 ? { ...e, numerator, denominator } : e));
    this.editor.transact('Change time signature', (tx) => tx.setMeta('timeSignature', sigs));
  }

  setKey(key: Key | null) {
    this.editor.transact('Change key', (tx) => tx.setMeta('key', key));
  }
}

/** Velocity changes that fit `notes` into [lo, hi]. Pure: use with `commands.update`. */
export function remapVelocities(notes: readonly Note[], lo: number, hi: number): Array<{ id: NoteId; velocity: number }> {
  if (!notes.length) return [];
  const a = clampVelocity(Math.min(lo, hi));
  const b = clampVelocity(Math.max(lo, hi));
  const vs = notes.map((n) => n.velocity);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  if (max - min < 1e-6) {
    if (notes.length === 1 || a === b) return notes.map((n) => ({ id: n.id, velocity: a === b ? a : (a + b) / 2 }));
    const order = [...notes].sort((x, y) => x.start - y.start || x.pitch - y.pitch);
    return order.map((n, i) => ({ id: n.id, velocity: a + ((b - a) * i) / (order.length - 1) }));
  }
  return notes.map((n) => ({ id: n.id, velocity: a + ((n.velocity - min) / (max - min)) * (b - a) }));
}

/** Velocity steps from `from` to `to` over the notes, in time order. Pure: use with `commands.update`. */
export function rampVelocities(notes: readonly Note[], from: number, to: number): Array<{ id: NoteId; velocity: number }> {
  if (!notes.length) return [];
  const ordered = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const hasOneStart = ordered.every((n) => n.start === ordered[0].start);
  const slotOf = (n: Note) => (hasOneStart ? n.pitch : n.start);
  const slots = [...new Set(ordered.map(slotOf))];
  const lastSlot = slots.length - 1;
  return ordered.map((n) => {
    const progress = lastSlot === 0 ? 0 : slots.indexOf(slotOf(n)) / lastSlot;
    return { id: n.id, velocity: clampVelocity(from + (to - from) * progress) };
  });
}

export type StrumDirectionT = 'down' | 'up';
/** At full amount the last note of a strum starts this far into the chord's shortest note. */
export const MAX_STRUM_SPAN = 0.5;

/** Start and length changes that strum each group of notes sharing a start. Pure: use with `commands.update`. */
export function strumChanges(notes: readonly Note[], direction: StrumDirectionT, amount: number): Array<{ id: NoteId; start: Tick; duration: Tick }> {
  const chords = new Map<Tick, Note[]>();
  for (const note of notes) chords.set(note.start, [...(chords.get(note.start) ?? []), note]);
  const changes: Array<{ id: NoteId; start: Tick; duration: Tick }> = [];
  const strength = Math.max(0, Math.min(1, amount));
  for (const chord of chords.values()) {
    if (chord.length < 2) continue;
    const ordered = [...chord].sort((a, b) => (direction === 'down' ? a.pitch - b.pitch : b.pitch - a.pitch));
    const shortest = Math.min(...chord.map((n) => n.duration));
    const span = shortest * MAX_STRUM_SPAN * strength;
    const lastIndex = ordered.length - 1;
    ordered.forEach((note, index) => {
      const offset = Math.round((span * index) / lastIndex);
      changes.push({ id: note.id, start: note.start + offset, duration: Math.max(1, note.duration - offset) });
    });
  }
  return changes;
}

function normalize(n: Note): Note {
  return {
    ...n,
    pitch: clampPitch(n.pitch),
    start: Math.max(0, Math.round(n.start)),
    duration: Math.max(1, Math.round(n.duration)),
    velocity: clampVelocity(n.velocity),
  };
}
