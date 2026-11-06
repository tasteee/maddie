import type { Editor, TransactOptions, TxApi } from './editor';
import { createId, createTrackId } from './editor';
import { resolveGrid, snapTick } from './music/grid';
import { clampPitch, MAX_PITCH, MIN_PITCH } from './music/pitch';
import { transposeDegrees } from './music/scale';
import { timeSigAt } from './music/timeline';
import { clampVelocity } from './music/velocity';
import { fromMidiFile, type MidiImport } from './midi/read';
import { getTrackName, pickNewTrackColor, pickNewTrackName, TRACK_COLORS } from './tracks';
import type { Key, Note, NoteId, NoteInput, Tick, Track } from './types';

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
    const copies = notes.map((n) => normalize({ ...n, id: createId(), start: n.start + ticks, pitch: n.pitch + pitches }));
    this.editor.transact(label, (tx) => copies.forEach((n) => tx.add(n)), opts);
    this.editor.select(copies.map((n) => n.id));
    return copies;
  }

  copy(ids?: Ids) {
    const notes = this.notesOf(ids);
    if (!notes.length) return;
    const start = Math.min(...notes.map((n) => n.start));
    this.editor.clipboard = notes.map((n) => ({ ...n, start: n.start - start }));
  }

  cut(ids?: Ids) {
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
    this.editor.select(this.editor.notes().map((n) => n.id));
  }

  /**
   * Load a .mid file in one undoable step, with its tempo, time signature and key.
   *
   * - `tracks: 'split'` (default): one Maddie track per MIDI track, named after it.
   *   The first imported track becomes the active one.
   * - `tracks: 'merge'`: every MIDI track goes into the active track (the old behavior).
   *
   * `replace` (default) clears first: all tracks when splitting, the active track's notes when merging.
   */
  importMidi(
    input: ArrayBuffer | Uint8Array,
    { replace = true, tracks = 'split' }: { replace?: boolean; tracks?: 'split' | 'merge' } = {},
  ): MidiImport {
    const ed = this.editor;
    const midi = fromMidiFile(input, { ppq: ed.ppq });
    const isMerge = tracks === 'merge';
    if (isMerge) this.importIntoActiveTrack(midi, replace);
    if (!isMerge) this.importAsTracks(midi, replace);
    return midi;
  }

  private importIntoActiveTrack(midi: MidiImport, replace: boolean) {
    const ed = this.editor;
    ed.transact('Import MIDI', (tx) => {
      if (replace) for (const n of [...ed.notes()]) tx.remove(n.id);
      for (const n of midi.notes) tx.add(normalize({ ...n, id: createId() }));
      this.applyImportedMeta(tx, midi);
    });
    ed.clearSelection();
  }

  private importAsTracks(midi: MidiImport, replace: boolean) {
    const ed = this.editor;
    const oldTrackIds = ed.trackIds;
    const keptTracks = replace ? [] : [...ed.trackList];
    const importedTracks = midi.tracks.length > 0 ? midi.tracks : [{ name: undefined, notes: [] }];
    const newTracks: Track[] = [];
    for (const imported of importedTracks) {
      const position = keptTracks.length + newTracks.length;
      const draft = { id: createTrackId(), name: imported.name?.trim() || undefined };
      const name = getTrackName(draft, position);
      const color = TRACK_COLORS[position % TRACK_COLORS.length];
      const notes = imported.notes.map((n) => normalize({ ...n, id: createId() }));
      newTracks.push({ id: draft.id, name, color, notes });
    }
    ed.transact('Import MIDI', (tx) => {
      // New tracks go in first: a document is never without a track.
      for (const track of newTracks) tx.addTrack(track);
      if (replace) for (const id of oldTrackIds) tx.removeTrack(id);
      this.applyImportedMeta(tx, midi);
    });
    ed.setActiveTrack(newTracks[0].id);
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
    input: { name?: string; color?: string; notes?: NoteInput[]; activate?: boolean } = {},
    opts?: TransactOptions,
  ): Track {
    const ed = this.editor;
    const existing = ed.trackList;
    const notes = (input.notes ?? []).map((n) => normalize({ ...n, id: n.id ?? createId() }));
    const track: Track = {
      id: createTrackId(),
      name: input.name?.trim() || pickNewTrackName(existing),
      color: input.color ?? pickNewTrackColor(existing),
      notes,
    };
    ed.transact('Add track', (tx) => tx.addTrack(track), opts);
    const shouldActivate = input.activate ?? true;
    if (shouldActivate) ed.setActiveTrack(track.id);
    return track;
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

  setTrackMuted(trackId: string, isMuted: boolean, opts?: TransactOptions) {
    const label = isMuted ? 'Mute track' : 'Unmute track';
    this.editor.transact(label, (tx) => tx.updateTrack(trackId, { muted: isMuted }), opts);
  }

  setTrackSolo(trackId: string, isSolo: boolean, opts?: TransactOptions) {
    const label = isSolo ? 'Solo track' : 'Unsolo track';
    this.editor.transact(label, (tx) => tx.updateTrack(trackId, { solo: isSolo }), opts);
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

function normalize(n: Note): Note {
  return {
    ...n,
    pitch: clampPitch(n.pitch),
    start: Math.max(0, Math.round(n.start)),
    duration: Math.max(1, Math.round(n.duration)),
    velocity: clampVelocity(n.velocity),
  };
}
