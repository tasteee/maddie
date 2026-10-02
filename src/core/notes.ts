import type { Note, NoteId, Tick } from './types';

/** Notes of one track. Fast lookup by id and by time range. */
export class NoteIndex {
  private readonly map = new Map<NoteId, Note>();
  private sorted: Note[] | null = [];
  private maxDuration = 0;

  constructor(notes: Iterable<Note> = []) {
    for (const n of notes) this.map.set(n.id, n);
    this.sorted = null;
  }

  get size() {
    return this.map.size;
  }

  get(id: NoteId) {
    return this.map.get(id);
  }

  has(id: NoteId) {
    return this.map.has(id);
  }

  set(note: Note) {
    this.map.set(note.id, note);
    this.sorted = null;
  }

  delete(id: NoteId) {
    if (this.map.delete(id)) this.sorted = null;
  }

  /** All notes, sorted by start, then pitch. */
  all(): readonly Note[] {
    if (!this.sorted) {
      this.sorted = [...this.map.values()].sort((a, b) => a.start - b.start || b.pitch - a.pitch);
      this.maxDuration = this.sorted.reduce((m, n) => Math.max(m, n.duration), 0);
    }
    return this.sorted;
  }

  /** Notes overlapping [from, to). */
  range(from: Tick, to: Tick): Note[] {
    const all = this.all();
    let lo = 0;
    let hi = all.length;
    const min = from - this.maxDuration;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (all[mid].start < min) lo = mid + 1;
      else hi = mid;
    }
    const out: Note[] = [];
    for (let i = lo; i < all.length && all[i].start < to; i++) {
      const n = all[i];
      if (n.start + n.duration > from) out.push(n);
    }
    return out;
  }

  /** Notes whose start is in [from, to). */
  starting(from: Tick, to: Tick): Note[] {
    const all = this.all();
    let lo = 0;
    let hi = all.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (all[mid].start < from) lo = mid + 1;
      else hi = mid;
    }
    const out: Note[] = [];
    for (let i = lo; i < all.length && all[i].start < to; i++) out.push(all[i]);
    return out;
  }

  /** End tick of the last note. */
  end(): Tick {
    let end = 0;
    for (const n of this.map.values()) end = Math.max(end, n.start + n.duration);
    return end;
  }
}
