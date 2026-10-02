import type { Editor, Note, NoteId } from '../core';
import { NoteAnimator, ValueTween } from './animation';
import { requestFrame } from './frame';
import { RowLayout } from './rows';

export interface Preview {
  /** Replacement versions of existing notes (drag / resize / velocity). */
  overrides: Map<NoteId, Note>;
  /** Notes that don't exist yet (draw, ⌘-drag copies). */
  added: Note[];
  /** Notes hidden during the gesture (erase). */
  hidden: Set<NoteId>;
}

export type DisplayView = {
  pxPerTick: number;
  rowHeight: number;
  scrollTick: number;
  scrollRow: number;
};

export interface Motion {
  fast: number;
  medium: number;
  slow: number;
  glide: number;
}

type Renderer = (now: number) => void;

/** A chord being dragged from the chords panel onto the grid. */
export interface ChordDrag {
  /** Root pitch class. */
  root: number;
  /** Semitones above the root (already inverted). */
  intervals: readonly number[];
  name: string;
  clientX: number;
  clientY: number;
  /** Set by the piano roll while the chord is over the grid. */
  overGrid: boolean;
}

export type ChordDragPhase = 'move' | 'drop' | 'cancel';

export interface Toast {
  message: string;
  kind: 'info' | 'error';
}

const engines = new WeakMap<Editor, Engine>();

/**
 * Shared, per-editor render state: animations, drag preview, display view.
 * Every element that draws asks the engine where things are *right now*.
 */
/** Note position tweens run at half the base motion, so edits land snappy. */
const NOTE_MOTION = 0.5;

export class Engine {
  static for(editor: Editor): Engine {
    let e = engines.get(editor);
    if (!e) engines.set(editor, (e = new Engine(editor)));
    return e;
  }

  readonly notes = new NoteAnimator();
  readonly rows: RowLayout;
  readonly view: ValueTween<DisplayView>;
  preview: Preview = { overrides: new Map(), added: [], hidden: new Set() };
  motion: Motion = { fast: 90, medium: 150, slow: 220, glide: 45 };
  /** Note under the pointer in any view (roll ↔ velocity lane stay in sync). */
  hoverId: NoteId | null = null;
  /** Pitches currently held on the keyboard (for highlight). */
  held = new Set<number>();
  /** Size of the main roll viewport, used for clamping and follow. */
  viewport = { width: 0, height: 0 };
  gridChangedAt = -Infinity;
  private renderers = new Set<Renderer>();
  private toastListeners = new Set<(t: Toast) => void>();
  /** The chord being dragged from the chords panel, if any. */
  chordDrag: ChordDrag | null = null;
  private chordListeners = new Set<(drag: ChordDrag, phase: ChordDragPhase) => void>();
  private scheduled = false;

  private constructor(readonly editor: Editor) {
    this.rows = new RowLayout(editor.rowMap);
    this.view = new ValueTween(this.targetView());

    editor.on('change', (e) => {
      const now = performance.now();
      if (e.origin === 'load') {
        this.reflowRows(0, now);
      } else {
        for (const p of e.patches) {
          if (p.op === 'add' && !this.isPreviewed(p.note.id)) this.notes.markBorn(p.note.id, now);
          if (p.op === 'remove' && !e.gestureId) this.notes.markDying(p.note, now);
          if (p.op === 'remove' && e.gestureId) this.notes.forget(p.note.id);
        }
        this.notes.nextDuration = e.gestureId ? 0 : this.motion.medium * NOTE_MOTION;
        this.reflowRows(this.motion.slow, now);
      }
      this.invalidate();
    });
    editor.on('selection', () => this.invalidate());
    editor.on('transport', () => this.invalidate());
    editor.on('view', ({ view, prev, animate }) => {
      const now = performance.now();
      this.view.set(this.targetView(), animate ? this.motion.slow : 0, now);
      if (view.fold !== prev.fold) this.reflowRows(this.motion.slow, now);
      if (view.grid !== prev.grid) this.gridChangedAt = now;
      this.invalidate();
    });
  }

  /** Rows changed (fold, key): animate them, and keep the pitch at the center in view. */
  private reflowRows(dur: number, now: number) {
    const { editor } = this;
    const prev = this.rows.map;
    const next = editor.rowMap;
    if (!this.rows.update(next, dur, now)) return;
    const v = editor.view;
    const h = this.viewport.height;
    if (v.scrollRow === null || !h) return;
    const half = h / v.rowHeight / 2;
    const center = v.scrollRow + half;
    const pitch = prev.pitchAt(center);
    const frac = center - Math.floor(center);
    const max = Math.max(0, next.length - h / v.rowHeight);
    const target = Math.max(0, Math.min(max, next.virtual[pitch] + frac - half));
    if (Math.abs(target - v.scrollRow) > 0.01) editor.setView({ scrollRow: target }, { animate: dur > 0 });
  }

  private targetView(): DisplayView {
    const v = this.editor.view;
    return { pxPerTick: v.pxPerTick, rowHeight: v.rowHeight, scrollTick: v.scrollTick, scrollRow: v.scrollRow ?? 0 };
  }

  private isPreviewed(id: NoteId) {
    return this.preview.added.some((n) => n.id === id);
  }

  /** Brief status message (import result, errors). Shown by the piano roll. */
  toast(message: string, kind: Toast['kind'] = 'info') {
    this.toastListeners.forEach((l) => l({ message, kind }));
  }

  onToast(listener: (t: Toast) => void): () => void {
    this.toastListeners.add(listener);
    return () => this.toastListeners.delete(listener);
  }

  /** Chords panel → piano roll. The roll previews on `move` and places on `drop`. */
  chordDragEvent(drag: ChordDrag, phase: ChordDragPhase) {
    this.chordDrag = phase === 'move' ? drag : null;
    this.chordListeners.forEach((l) => l(drag, phase));
  }

  onChordDrag(listener: (drag: ChordDrag, phase: ChordDragPhase) => void): () => void {
    this.chordListeners.add(listener);
    return () => this.chordListeners.delete(listener);
  }

  setHover(id: NoteId | null) {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.invalidate();
  }

  setMotion(motion: Partial<Motion>) {
    this.motion = { ...this.motion, ...motion };
    this.notes.popDuration = this.motion.fast;
    this.notes.fadeDuration = this.motion.fast + 30;
  }

  addRenderer(fn: Renderer): () => void {
    this.renderers.add(fn);
    this.invalidate();
    return () => this.renderers.delete(fn);
  }

  invalidate() {
    if (this.scheduled) return;
    this.scheduled = true;
    requestFrame((now) => this.frame(now));
  }

  setPreview(preview: Partial<Preview>, glide = false) {
    this.preview = { overrides: new Map(), added: [], hidden: new Set(), ...preview };
    this.notes.nextDuration = glide ? this.motion.glide * NOTE_MOTION : 0;
    this.invalidate();
  }

  clearPreview() {
    this.preview = { overrides: new Map(), added: [], hidden: new Set() };
    this.invalidate();
  }

  get previewing() {
    const p = this.preview;
    return p.overrides.size > 0 || p.added.length > 0 || p.hidden.size > 0;
  }

  /** Notes to draw in a tick range, with the drag preview applied. */
  visibleNotes(from: number, to: number): Note[] {
    const { overrides, added, hidden } = this.preview;
    const out: Note[] = [];
    for (const n of this.editor.notesInRange(from, to)) {
      if (!hidden.has(n.id) && !overrides.has(n.id)) out.push(n);
    }
    for (const n of overrides.values()) if (!hidden.has(n.id)) out.push(n);
    for (const n of added) out.push(n);
    return out;
  }

  /** Displayed (possibly animating) view. */
  displayView(now: number): DisplayView {
    return this.view.get(now);
  }

  private frame(now: number) {
    this.scheduled = false;
    this.followPlayhead();
    for (const r of this.renderers) r(now);
    this.notes.nextDuration = 0;
    const busy =
      this.notes.consumeActive(now) ||
      this.view.animating(now) ||
      this.rows.animating(now) ||
      now - this.gridChangedAt < this.motion.slow ||
      this.editor.transport.playing;
    if (busy) this.invalidate();
  }

  private followPlayhead() {
    const { editor } = this;
    if (!editor.transport.playing || !editor.view.follow || !this.viewport.width) return;
    const v = editor.view;
    const pos = editor.transport.position;
    const visible = this.viewport.width / v.pxPerTick;
    if (pos > v.scrollTick + visible * 0.92 || pos < v.scrollTick) {
      editor.setView({ scrollTick: Math.max(0, pos - visible * 0.08) }, { animate: true });
    }
  }

  /** Scroll to the start and center the rows on the notes (or middle C). */
  centerOnNotes({ resetTime = false, animate = false } = {}) {
    const { editor } = this;
    const h = this.viewport.height;
    if (!h) return;
    const notes = editor.notes();
    const pitch = notes.length
      ? (Math.max(...notes.map((n) => n.pitch)) + Math.min(...notes.map((n) => n.pitch))) / 2
      : 60;
    const rh = editor.view.rowHeight;
    const row = editor.rowMap.virtual[Math.round(pitch)] - h / rh / 2;
    editor.setView(
      { scrollRow: Math.max(0, Math.min(this.maxScrollRow(rh), row)), ...(resetTime ? { scrollTick: 0 } : {}) },
      { animate },
    );
  }

  /** Max scroll row for the current row count and viewport. */
  maxScrollRow(rowHeight = this.editor.view.rowHeight) {
    return Math.max(0, this.editor.rowMap.length - this.viewport.height / rowHeight);
  }
}
