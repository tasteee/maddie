import type { Editor, TransactOptions } from './editor';
import { createId } from './editor';
import { resolveGrid, snapTick } from './music/grid';
import { clampPitch, MAX_PITCH, MIN_PITCH } from './music/pitch';
import { transposeDegrees } from './music/scale';
import { timeSigAt } from './music/timeline';
import { clampVelocity } from './music/velocity';
import { fromMidiFile, type MidiImport } from './midi/read';
import type { Key, Note, NoteId, NoteInput, Tick } from './types';

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
   * Load a .mid file. Replaces the active track's notes (and tempo, time
   * signature, key) in one undoable step. All MIDI tracks merge into one.
   */
  importMidi(input: ArrayBuffer | Uint8Array, { replace = true }: { replace?: boolean } = {}): MidiImport {
    const ed = this.editor;
    const midi = fromMidiFile(input, { ppq: ed.ppq });
    ed.transact('Import MIDI', (tx) => {
      if (replace) for (const n of [...ed.notes()]) tx.remove(n.id);
      for (const n of midi.notes) tx.add(normalize({ ...n, id: createId() }));
      tx.setMeta('tempo', midi.tempo);
      tx.setMeta('timeSignature', midi.timeSignature);
      if (midi.key) tx.setMeta('key', midi.key);
    });
    ed.clearSelection();
    return midi;
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
