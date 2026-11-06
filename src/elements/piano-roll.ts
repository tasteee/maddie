import { css, html } from 'lit';
import { toaster } from './zest';
import { customElement } from 'lit/decorators.js';
import {
  clampPitch,
  createId,
  degreeOf,
  inScale,
  isBlackKey,
  nearestInScale,
  pitchClass,
  pitchName,
  pitchOfDegree,
  resolveGrid,
  snapTick,
  timeSigAt,
  voiceChord,
  type Editor,
  type Note,
  type NoteId,
} from '../core';
import type { ChordDrag, ChordDragPhase, Engine, Toast } from '../engine/engine';
import { clamp } from '../engine/ease';
import { clampScrollRow, handleWheel, maxScrollTick } from '../engine/interact';
import { normalizeColor, withAlpha } from '../engine/theme';
import { CanvasElement } from './canvas-element';
import { icons } from './icons';
import { importMidiFile } from './midi-io';
import { drawGhostNotes, drawLoop, drawPlayhead, drawTimeGrid, noteFill, playingFlash, resolveTrackColor, roundRect, type NoteState, type NoteStyle } from './paint';
import type { Palette } from './tokens';
import './zest';

type Zone = 'body' | 'start' | 'end';

interface Hit {
  note: Note;
  zone: Zone;
}

interface Gesture {
  move(e: PointerEvent): void;
  up(e: PointerEvent): void;
  cancel(): void;
}

const DRAG_THRESHOLD = 3;

/**
 * The note grid. Drag to select, move and resize notes. Double-click to add or delete.
 * Right-drag a note up or down to change its velocity (the whole selection if it is selected).
 * Renders on canvas; all state lives in the editor and engine.
 */
@customElement('maddie-piano-roll')
export class MaddiePianoRoll extends CanvasElement {
  static styles = [
    ...CanvasElement.styles,
    css`
      :host {
        min-height: 160px;
        background: var(--_row-white);
      }
      :host(:focus-visible) {
        outline: 3px solid var(--_focus);
        outline-offset: -3px;
      }
      .drop {
        position: absolute;
        inset: var(--space-sm);
        display: grid;
        place-items: center;
        border: 2px dashed color-mix(in oklch, var(--_accent) 70%, transparent);
        border-radius: var(--_radius-sm);
        background: color-mix(in oklch, var(--_bg) 78%, transparent);
        pointer-events: none;
        opacity: 0;
        transform: scale(0.985);
        transition:
          opacity var(--_motion-fast) var(--_ease),
          transform var(--_motion-medium) var(--_ease);
      }
      .drop .icon {
        width: 1rem;
        height: 1rem;
      }
      :host([dropping]) .drop {
        opacity: 1;
        transform: none;
      }
      .marquee {
        position: absolute;
        display: none;
        pointer-events: none;
        border: 1px solid color-mix(in oklab, var(--_accent) 85%, transparent);
        background: color-mix(in oklab, var(--_accent) 10%, transparent);
        border-radius: 3px;
      }
    `,
  ];

  /** Per-note style override. Return `undefined` fields to keep defaults. */
  noteStyle?: (note: Note, state: NoteState) => NoteStyle | undefined;

  private gesture: Gesture | null = null;
  private hover: { id: NoteId | null; zone: Zone | null } = { id: null, zone: null };
  private marquee!: HTMLElement;
  private lastPointer: PointerEvent | null = null;
  private autoScrollRaf = 0;

  protected renderOverlay() {
    return html`<div class="marquee" part="marquee"></div>
      <div class="drop" part="drop" aria-hidden="true">
        <z-badge size="md" kind="soft" accent="dom"><span slot="prefix">${icons.upload}</span>Drop a MIDI file to replace the notes</z-badge>
      </div>`;
  }

  connectedCallback() {
    super.connectedCallback();
    if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
    this.setAttribute('role', 'application');
    this.setAttribute('aria-label', 'Piano roll');
    this.addEventListener('pointerdown', this.onPointerDown);
    this.addEventListener('pointermove', this.onHoverMove);
    this.addEventListener('pointerleave', this.onLeave);
    this.addEventListener('wheel', this.onWheel, { passive: false });
    this.addEventListener('contextmenu', (e) => e.preventDefault());
    this.addEventListener('dblclick', this.onDoubleClick);
    this.addEventListener('dragenter', this.onDragEnter);
    this.addEventListener('dragover', this.onDragOver);
    this.addEventListener('dragleave', this.onDragLeave);
    this.addEventListener('drop', this.onDrop);
  }

  // ── Drag & drop MIDI ────────────────────────────────────────────

  private dragDepth = 0;

  private hasFiles(e: DragEvent) {
    return [...(e.dataTransfer?.types ?? [])].includes('Files');
  }

  private onDragEnter = (e: DragEvent) => {
    if (!this.hasFiles(e)) return;
    e.preventDefault();
    this.dragDepth++;
    this.toggleAttribute('dropping', true);
  };

  private onDragOver = (e: DragEvent) => {
    if (!this.hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };

  private onDragLeave = () => {
    if (--this.dragDepth <= 0) {
      this.dragDepth = 0;
      this.toggleAttribute('dropping', false);
    }
  };

  private onDrop = (e: DragEvent) => {
    if (!this.hasFiles(e)) return;
    e.preventDefault();
    this.dragDepth = 0;
    this.toggleAttribute('dropping', false);
    const file = e.dataTransfer?.files[0];
    if (file && this.ed) importMidiFile(this.ed, file, this);
  };

  private showToast = ({ message, kind }: Toast) => {
    const isError = kind === 'error'
    const tone = isError ? 'danger' : 'neutral'
    const duration = isError ? 4000 : 2800
    toaster.show({ title: message, tone, duration })
  };

  protected firstUpdated() {
    super.firstUpdated();
    this.marquee = this.renderRoot.querySelector('.marquee')!;
  }

  protected attach(editor: Editor, engine: Engine) {
    super.attach(editor, engine);
    this.track(editor.on('view', () => this.updateCursor()), engine.onToast(this.showToast), engine.onChordDrag(this.onChordDrag));
  }

  // ── Chord drop (from <maddie-chords>) ───────────────────────────

  /** Stable ids while one chord is dragged, so the drop doesn't re-animate the preview. */
  private chordIds: NoteId[] = [];
  private chordBass: number | null = null;

  /** The chord's notes under the pointer, or null when it's off the grid. */
  private chordNotesAt(drag: ChordDrag): Note[] | null {
    const ed = this.ed!;
    const { x, y } = this.local({ clientX: drag.clientX, clientY: drag.clientY });
    if (x < 0 || y < 0 || x > this.width || y > this.height) return null;
    const start = this.snap(this.tickAt(x), { altKey: false }, 'floor');
    const pitches = voiceChord(drag.root, drag.intervals, this.pitchAt(y));
    while (this.chordIds.length < pitches.length) this.chordIds.push(createId());
    // Chords land short (one beat). Resize them after.
    return pitches.map((pitch, i) => ({ id: this.chordIds[i], pitch, start, duration: ed.ppq, velocity: ed.view.noteVelocity }));
  }

  private onChordDrag = (drag: ChordDrag, phase: ChordDragPhase) => {
    const ed = this.ed;
    const engine = this.engine;
    if (!ed || !engine) return;
    const notes = phase === 'cancel' ? null : this.chordNotesAt(drag);
    if (phase === 'move') {
      drag.overGrid = !!notes;
      if (!notes) {
        if (this.chordBass !== null) engine.clearPreview();
        this.chordBass = null;
        return;
      }
      engine.setPreview({ added: notes }, ed.view.snap);
      const bass = notes[0].pitch;
      if (bass !== this.chordBass) ed.auditionChord(notes.map((n) => n.pitch), 0.4);
      this.chordBass = bass;
      return;
    }
    if (phase === 'drop' && notes) {
      ed.commands.add(notes);
      ed.auditionChord(notes.map((n) => n.pitch), 0.6);
      this.focus({ preventScroll: true });
    }
    engine.clearPreview();
    this.chordIds = [];
    this.chordBass = null;
  };

  protected resized() {
    if (!this.engine || !this.ed) return;
    this.engine.viewport = { width: this.width, height: this.height };
    const v = this.ed.view;
    if (v.scrollRow === null) this.centerOnContent();
    else this.ed.setView({ scrollRow: clampScrollRow(this.ed, v.scrollRow) });
  }

  /** Scroll so the notes (or middle C) are vertically centered. */
  centerOnContent() {
    this.engine?.centerOnNotes();
  }

  // ── Coordinates ─────────────────────────────────────────────────

  private tickAt(x: number) {
    const v = this.ed!.view;
    return v.scrollTick + x / v.pxPerTick;
  }

  private rowAt(y: number) {
    const v = this.ed!.view;
    return (v.scrollRow ?? 0) + y / v.rowHeight;
  }

  private pitchAt(y: number) {
    const ed = this.ed!;
    const pitch = ed.rowMap.pitchAt(this.rowAt(y));
    return ed.view.scaleLock && ed.key ? nearestInScale(pitch, ed.key) : pitch;
  }

  private gridAt(tick: number) {
    const ed = this.ed!;
    return resolveGrid(ed.view.grid, ed.ppq, ed.view.pxPerTick, timeSigAt(tick, ed.meta.timeSignature));
  }

  private snap(tick: number, e: { altKey: boolean }, mode: 'round' | 'floor' | 'ceil' = 'round') {
    const ed = this.ed!;
    if (!ed.view.snap || e.altKey) return Math.max(0, Math.round(tick));
    return Math.max(0, snapTick(tick, this.gridAt(tick), ed.meta.timeSignature, mode));
  }

  private noteRect(n: Note) {
    const ed = this.ed!;
    const v = ed.view;
    const row = ed.rowMap.rowOf(n.pitch);
    if (row === null) return null;
    return {
      x: (n.start - v.scrollTick) * v.pxPerTick,
      y: (row - (v.scrollRow ?? 0)) * v.rowHeight,
      w: Math.max(3, n.duration * v.pxPerTick),
      h: v.rowHeight,
    };
  }

  private hitTest(x: number, y: number): Hit | null {
    const ed = this.ed!;
    const engine = this.engine!;
    const from = this.tickAt(x - 10);
    const to = this.tickAt(x + 10);
    const notes = engine.visibleNotes(from, to);
    // Selected notes draw on top, so test them first.
    notes.sort((a, b) => Number(ed.selection.has(b.id)) - Number(ed.selection.has(a.id)));
    for (const n of notes) {
      const r = this.noteRect(n);
      if (!r || x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) continue;
      const edge = clamp(r.w * 0.25, 3, 8);
      const zone: Zone = x > r.x + r.w - edge ? 'end' : x < r.x + edge && r.w > 12 ? 'start' : 'body';
      return { note: n, zone };
    }
    return null;
  }

  // ── Pointer ─────────────────────────────────────────────────────

  private onPointerDown = (e: PointerEvent) => {
    const ed = this.ed;
    if (!ed || this.gesture) return;
    this.focus({ preventScroll: true });
    const { x, y } = this.local(e);

    if (e.button === 1) return this.begin(e, this.panGesture(e));
    if (e.button === 2) {
      const rightHit = this.hitTest(x, y);
      if (!rightHit) return;
      return this.begin(e, this.velocityGesture(e, rightHit.note));
    }
    if (e.button !== 0) return;

    const hit = this.hitTest(x, y);
    const clicked = this.snap(this.tickAt(x), e, 'floor');
    ed.setView({ cursor: clicked });

    if (hit) {
      if (hit.zone !== 'body') return this.begin(e, this.resizeGesture(e, hit));
      return this.begin(e, this.moveGesture(e, hit.note));
    }
    return this.begin(e, this.marqueeGesture(e));
  };

  /** Marker (or play position) before the last click-seek, so a double-click can put it back. */
  private seekUndo: { tick: number; at: number } | null = null;

  /** Stopped: move the marker. Playing: jump playback there and keep going; the marker stays where play started. */
  private clickSeek(tick: number) {
    const t = this.ed!.transport;
    const now = performance.now();
    // The second click of a double-click keeps the first one's "before".
    if (!this.seekUndo || now - this.seekUndo.at > 500) this.seekUndo = { tick: t.playing ? t.position : t.marker, at: now };
    else this.seekUndo.at = now;
    t.seek(tick, { marker: !t.playing });
  }

  private onDoubleClick = (e: MouseEvent) => {
    const ed = this.ed;
    if (!ed) return;
    // Double-click isn't a marker click: undo the seek its first click made.
    if (this.seekUndo && performance.now() - this.seekUndo.at < 500) ed.transport.seek(this.seekUndo.tick, { marker: !ed.transport.playing });
    this.seekUndo = null;
    const { x, y } = this.local(e);
    const hit = this.hitTest(x, y);
    if (hit) {
      ed.commands.delete([hit.note.id]);
      return;
    }
    const start = this.snap(this.tickAt(x), e, 'floor');
    const pitch = this.pitchAt(y);
    ed.commands.add([{ pitch, start, duration: this.defaultLength(start), velocity: ed.view.noteVelocity }]);
    ed.audition(pitch);
  };

  private begin(e: PointerEvent, gesture: Gesture) {
    this.gesture = gesture;
    this.hover = { id: null, zone: null };
    this.engine?.setHover(null);
    this.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      this.lastPointer = ev;
      gesture.move(ev);
      this.autoScroll();
    };
    const end = (ev: PointerEvent, cancel = false) => {
      this.removeEventListener('pointermove', move);
      this.removeEventListener('pointerup', up);
      this.removeEventListener('pointercancel', cancelled);
      window.removeEventListener('keydown', esc, true);
      cancelAnimationFrame(this.autoScrollRaf);
      this.autoScrollRaf = 0;
      if (this.hasPointerCapture(ev.pointerId)) this.releasePointerCapture(ev.pointerId);
      this.gesture = null;
      this.lastPointer = null;
      if (cancel) gesture.cancel();
      else gesture.up(ev);
      this.engine?.clearPreview();
      this.engine && (this.engine.held = new Set());
      this.marquee.style.display = 'none';
      this.updateCursor(ev);
    };
    const up = (ev: PointerEvent) => end(ev);
    const cancelled = (ev: PointerEvent) => end(ev, true);
    const esc = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      ev.preventDefault();
      end(e, true);
    };
    this.addEventListener('pointermove', move);
    this.addEventListener('pointerup', up);
    this.addEventListener('pointercancel', cancelled);
    window.addEventListener('keydown', esc, true);
  }

  /** Scroll when dragging near an edge. Speed grows with distance past the edge. */
  private autoScroll() {
    if (this.autoScrollRaf) return;
    const step = () => {
      this.autoScrollRaf = 0;
      const e = this.lastPointer;
      const ed = this.ed;
      if (!e || !ed || !this.gesture) return;
      const { x, y } = this.local(e);
      const edge = 28;
      const speed = (d: number) => Math.sign(d) * Math.min(24, Math.pow(Math.abs(d) / edge, 1.6) * 10);
      const dx = x < edge ? speed(x - edge) : x > this.width - edge ? speed(x - (this.width - edge)) : 0;
      const dy = y < edge ? speed(y - edge) : y > this.height - edge ? speed(y - (this.height - edge)) : 0;
      if (!dx && !dy) return;
      const v = ed.view;
      ed.setView({
        scrollTick: clamp(v.scrollTick + dx / v.pxPerTick, 0, maxScrollTick(ed)),
        scrollRow: clampScrollRow(ed, (v.scrollRow ?? 0) + dy / v.rowHeight),
      });
      this.gesture.move(e);
      this.autoScrollRaf = requestAnimationFrame(step);
    };
    this.autoScrollRaf = requestAnimationFrame(step);
  }

  private defaultLength(at: number) {
    const ed = this.ed!;
    return ed.view.noteLength ?? Math.max(this.gridAt(at), ed.ppq / 4);
  }

  /** Vertical move for a set of notes: by rows, or by scale degree when locked. */
  private shiftPitch(anchor: Note, targetPitch: number) {
    const ed = this.ed!;
    const key = ed.key;
    if (ed.view.scaleLock && key) {
      const d = degreeOf(nearestInScale(targetPitch, key), key) - degreeOf(nearestInScale(anchor.pitch, key), key);
      return (p: number) => clampPitch(pitchOfDegree(degreeOf(nearestInScale(p, key), key) + d, key));
    }
    const map = ed.rowMap;
    const from = map.rowOf(anchor.pitch) ?? map.virtual[anchor.pitch];
    const to = map.rowOf(targetPitch) ?? map.virtual[targetPitch];
    const dRow = Math.round(to - from);
    return (p: number) => {
      const row = map.rowOf(p);
      return row === null ? clampPitch(p + (targetPitch - anchor.pitch)) : map.pitchAt(clamp(row + dRow, 0, map.length - 1));
    };
  }

  private moveGesture(down: PointerEvent, anchor: Note): Gesture {
    const ed = this.ed!;
    const engine = this.engine!;
    const wasSelected = ed.selection.has(anchor.id);
    if (down.shiftKey) ed.select([anchor.id], 'toggle');
    else if (!wasSelected) ed.select([anchor.id]);
    if (!ed.selection.has(anchor.id)) return { move() {}, up() {}, cancel() {} };

    const origin = this.local(down);
    const originTick = this.tickAt(origin.x);
    const originPitch = this.pitchAt(origin.y);
    const notes = ed.selectedNotes;
    const minStart = Math.min(...notes.map((n) => n.start));
    const gestureId = createId();
    let dragging = false;
    let moved: Note[] = [];
    let copy = false;
    let lastPitch = anchor.pitch;
    ed.audition(anchor.pitch, anchor.velocity);

    return {
      move: (e) => {
        const p = this.local(e);
        if (!dragging && Math.hypot(p.x - origin.x, p.y - origin.y) < DRAG_THRESHOLD) return;
        dragging = true;
        let dx = this.tickAt(p.x) - originTick;
        let targetPitch = this.pitchAt(p.y);
        if (e.shiftKey) {
          // Lock to the dominant axis.
          if (Math.abs(p.x - origin.x) > Math.abs(p.y - origin.y)) targetPitch = originPitch;
          else dx = 0;
        }
        const newStart = dx === 0 ? anchor.start : this.snap(anchor.start + dx, e);
        const dt = Math.max(-minStart, newStart - anchor.start);
        const shift = this.shiftPitch(anchor, anchor.pitch + (targetPitch - originPitch));
        moved = notes.map((n) => ({ ...n, start: n.start + dt, pitch: shift(n.pitch) }));
        copy = e.metaKey || e.ctrlKey;
        if (copy) {
          engine.setPreview({ added: moved.map((n) => ({ ...n, id: `copy:${n.id}` })) }, ed.view.snap);
        } else {
          engine.setPreview({ overrides: new Map(moved.map((n) => [n.id, n])) }, ed.view.snap && !e.altKey);
        }
        const a = moved.find((n) => n.id === anchor.id)!;
        if (a.pitch !== lastPitch) {
          lastPitch = a.pitch;
          ed.audition(a.pitch, a.velocity);
        }
        this.setCursor(copy ? 'copy' : 'grabbing');
      },
      up: () => {
        if (!dragging) {
          // Click on a note in a group selects just that note.
          if (!down.shiftKey && wasSelected && ed.selection.size > 1) ed.select([anchor.id]);
          return;
        }
        if (copy) {
          ed.commands.add(moved.map(({ id: _id, ...n }) => n), { gestureId });
        } else {
          ed.commands.update(moved.map(({ id, start, pitch }) => ({ id, start, pitch })), 'Move notes', { gestureId });
        }
      },
      cancel: () => {},
    };
  }

  private resizeGesture(down: PointerEvent, hit: Hit): Gesture {
    const ed = this.ed!;
    const engine = this.engine!;
    if (!ed.selection.has(hit.note.id)) ed.select([hit.note.id], down.shiftKey ? 'add' : 'replace');
    const notes = ed.selectedNotes;
    const anchor = hit.note;
    const edge = hit.zone;
    const originTick = this.tickAt(this.local(down).x);
    const min = (n: Note) => (ed.view.snap && !down.altKey ? Math.min(this.gridAt(n.start), n.duration) : Math.max(1, ed.ppq / 64));
    let resized: Note[] = [];

    return {
      move: (e) => {
        const dx = this.tickAt(this.local(e).x) - originTick;
        if (edge === 'end') {
          const end = anchor.start + anchor.duration;
          const delta = this.snap(end + dx, e) - end;
          resized = notes.map((n) => ({ ...n, duration: Math.max(min(n), n.duration + delta) }));
        } else {
          const delta = this.snap(anchor.start + dx, e) - anchor.start;
          resized = notes.map((n) => {
            const end = n.start + n.duration;
            const start = clamp(n.start + delta, 0, end - min(n));
            return { ...n, start, duration: end - start };
          });
        }
        engine.setPreview({ overrides: new Map(resized.map((n) => [n.id, n])) }, ed.view.snap && !e.altKey);
      },
      up: () => {
        if (!resized.length) return;
        ed.commands.update(resized.map(({ id, start, duration }) => ({ id, start, duration })), 'Resize notes');
        const a = resized.find((n) => n.id === anchor.id);
        if (a) ed.setView({ noteLength: a.duration });
      },
      cancel: () => {},
    };
  }

  private marqueeGesture(down: PointerEvent): Gesture {
    const ed = this.ed!;
    const origin = this.local(down);
    const initial = down.shiftKey || down.metaKey || down.ctrlKey ? [...ed.selection] : [];
    let dragging = false;
    // Notes inside the box. Each one plays as it enters, so a fast sweep sounds like a chord.
    let inside = new Set<NoteId>();

    return {
      move: (e) => {
        const p = this.local(e);
        if (!dragging && Math.hypot(p.x - origin.x, p.y - origin.y) < DRAG_THRESHOLD) return;
        dragging = true;
        const x0 = Math.min(origin.x, p.x);
        const x1 = Math.max(origin.x, p.x);
        const y0 = Math.min(origin.y, p.y);
        const y1 = Math.max(origin.y, p.y);
        Object.assign(this.marquee.style, {
          display: 'block',
          left: `${x0}px`,
          top: `${y0}px`,
          width: `${x1 - x0}px`,
          height: `${y1 - y0}px`,
        });
        const hits = ed
          .notesInRange(this.tickAt(x0), this.tickAt(x1))
          .filter((n) => {
            const r = this.noteRect(n);
            return r && r.y + r.h > y0 && r.y < y1;
          });
        const played = new Set<number>();
        for (const n of hits) {
          if (inside.has(n.id) || n.muted || played.has(n.pitch)) continue;
          played.add(n.pitch);
          ed.audition(n.pitch, n.velocity);
        }
        inside = new Set(hits.map((n) => n.id));
        ed.select([...initial, ...inside]);
      },
      up: () => {
        if (dragging) return;
        if (!initial.length) ed.clearSelection();
        // A plain click on empty grid moves the play marker, or jumps playback there while playing.
        this.clickSeek(this.snap(this.tickAt(origin.x), down, 'floor'));
      },
      cancel: () => ed.select(initial),
    };
  }


  private velocityGesture(down: PointerEvent, hit: Note): Gesture {
    const ed = this.ed!;
    const engine = this.engine!;
    if (!ed.selection.has(hit.id)) ed.select([hit.id]);
    const notes = ed.selectedNotes;
    const y0 = this.local(down).y;
    let changed: Note[] = [];
    return {
      move: (e) => {
        const d = (y0 - this.local(e).y) / 160;
        changed = notes.map((n) => ({ ...n, velocity: clamp(n.velocity + d, 0, 1) }));
        engine.setPreview({ overrides: new Map(changed.map((n) => [n.id, n])) });
        this.setCursor('ns-resize');
      },
      up: () => {
        if (!changed.length) return;
        ed.commands.update(changed.map(({ id, velocity }) => ({ id, velocity })), 'Change velocity');
        ed.setView({ noteVelocity: changed.find((n) => n.id === hit.id)?.velocity ?? ed.view.noteVelocity });
      },
      cancel: () => {},
    };
  }

  private panGesture(down: PointerEvent): Gesture {
    const ed = this.ed!;
    const start = { x: down.clientX, y: down.clientY, tick: ed.view.scrollTick, row: ed.view.scrollRow ?? 0 };
    this.setCursor('grabbing');
    return {
      move: (e) => {
        const v = ed.view;
        ed.setView({
          scrollTick: clamp(start.tick - (e.clientX - start.x) / v.pxPerTick, 0, maxScrollTick(ed)),
          scrollRow: clampScrollRow(ed, start.row - (e.clientY - start.y) / v.rowHeight),
        });
      },
      up: () => {},
      cancel: () => {},
    };
  }

  // ── Hover & cursor ──────────────────────────────────────────────

  private onHoverMove = (e: PointerEvent) => {
    if (this.gesture || !this.ed) return;
    this.updateCursor(e);
  };

  private onLeave = () => {
    if (this.gesture) return;
    this.hover = { id: null, zone: null };
    this.engine?.setHover(null);
    this.engine?.invalidate();
  };

  private updateCursor(e?: { clientX: number; clientY: number }) {
    const ed = this.ed;
    if (!ed || this.gesture) return;
    let hit: Hit | null = null;
    if (e) {
      const { x, y } = this.local(e);
      if (x >= 0 && y >= 0 && x <= this.width && y <= this.height) {
        hit = this.hitTest(x, y);
      }
    }
    const prev = this.hover;
    this.hover = { id: hit?.note.id ?? null, zone: hit?.zone ?? null };
    this.engine?.setHover(this.hover.id);
    if (prev.id !== this.hover.id) this.engine?.invalidate();
    if (hit) return this.setCursor(hit.zone === 'body' ? 'grab' : 'ew-resize');
    this.setCursor('default');
  }

  private setCursor(cursor: string) {
    if (this.style.cursor !== cursor) this.style.cursor = cursor;
  }

  private onWheel = (e: WheelEvent) => {
    if (!this.ed) return;
    const { x, y } = this.local(e);
    handleWheel(this.ed, e, x, y);
    this.updateCursor(e);
  };

  // ── Drawing ─────────────────────────────────────────────────────

  protected draw(ctx: CanvasRenderingContext2D, now: number, ed: Editor, engine: Engine, p: Palette) {
    const { width: w, height: h } = this;
    const v = engine.displayView(now);
    const rows = engine.rows;
    const rh = v.rowHeight;
    const key = ed.key;
    const highlight = ed.view.scaleHighlight && key;

    // Rows. One meaning per shade: with a key shown, rows mark the scale (out = darker, root = tinted)
    // and the keyboard alone shows black/white. Without a key, rows mark black keys.
    ctx.fillStyle = p['row-white'];
    ctx.fillRect(0, 0, w, h);
    const rootTint = withAlpha(p.scale, p.dark ? 0.13 : 0.075);
    for (const pitch of rows.pitches()) {
      const y = (rows.rowOf(pitch, now) - v.scrollRow) * rh;
      if (y > h || y + rh < 0) continue;
      const alpha = rows.alphaOf(pitch, now);
      if (alpha <= 0.01) continue;
      const fill = highlight
        ? !inScale(pitch, key)
          ? p['row-out']
          : pitchClass(pitch) === key.root
            ? rootTint
            : null
        : isBlackKey(pitch)
          ? p['row-black']
          : null;
      if (fill) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = fill;
        ctx.fillRect(0, y, w, rh);
        ctx.globalAlpha = 1;
      }
      // Octave boundary under each C, faint line under the rest.
      ctx.fillStyle = pitchClass(pitch) === 0 ? p['line-beat'] : p['line-row'];
      ctx.fillRect(0, Math.round(y + rh) - 1, w, 1);
    }

    drawLoop(ctx, ed, v, p, h);
    drawTimeGrid(ctx, ed, engine, v, p, w, 0, h, now);

    // Other tracks sit behind the active one.
    drawGhostNotes(ctx, engine, v, p, w, h, now);

    // Notes. Unselected first, selected on top.
    const from = v.scrollTick;
    const to = from + w / v.pxPerTick;
    const notes = engine.visibleNotes(from, to);
    notes.sort((a, b) => Number(ed.selection.has(a.id)) - Number(ed.selection.has(b.id)));
    const pos = ed.transport.position;
    const dragging = engine.previewing;
    const radius = p.noteRadius;
    ctx.textBaseline = 'middle';
    ctx.font = `600 10px ${p.font}`;

    // The active track's notes keep the track color, drawn fully solid (other tracks are ghosts).
    const activeTrackColor = resolveTrackColor(p, ed.getTrackColor(ed.activeTrackId));

    const drawNote = (n: Note, d: ReturnType<typeof engine.notes.resolve>, state: NoteState) => {
      const x = (d.start - v.scrollTick) * v.pxPerTick;
      const nw = Math.max(3, d.duration * v.pxPerTick);
      if (x > w || x + nw < 0) return;
      const row = rows.rowOf(d.pitch, now);
      const alpha = d.alpha * rows.alphaOf(Math.round(d.pitch), now);
      if (alpha <= 0.01) return;
      const inner = Math.max(2, rh - 2);
      const nh = inner * d.scale;
      const y = (row - v.scrollRow) * rh + 1 + (inner - nh) / 2;
      if (y > h || y + nh < 0) return;
      const style = this.noteStyle?.(n, state);
      const base = style?.fill ? normalizeColor(style.fill) : activeTrackColor;
      ctx.globalAlpha = alpha;
      roundRect(ctx, x + 0.5, y, nw - 1, nh, radius);
      ctx.fillStyle = noteFill(p, base, { velocity: 1, muted: n.muted }, state);
      ctx.fill();
      // Crisp edge so quiet notes still read as shapes.
      ctx.lineWidth = 1;
      ctx.strokeStyle = n.muted ? withAlpha(base, 0.5) : base;
      if (n.muted) ctx.setLineDash([3, 2]);
      roundRect(ctx, x + 1, y + 0.5, nw - 2, nh - 1, radius - 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      if (state.selected) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = style?.outline ?? p['note-outline'];
        roundRect(ctx, x + 1.25, y + 0.75, nw - 2.5, nh - 1.5, radius - 0.5);
        ctx.stroke();
      }
      // Label.
      if (nw > 34 && rh >= 14 && d.scale > 0.95) {
        const strong = !n.muted;
        ctx.fillStyle = strong ? p['note-text'] : p.text;
        ctx.globalAlpha = alpha * 0.9;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, nw - 4, nh);
        ctx.clip();
        ctx.fillText(pitchName(n.pitch), x + 6, y + nh / 2 + 0.5);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    };

    for (const n of notes) {
      const d = engine.notes.resolve(n, now);
      const selected = ed.selection.has(n.id) || n.id.startsWith('copy:');
      drawNote(n, d, {
        selected,
        hovered: !dragging && engine.hoverId === n.id,
        playing: playingFlash(ed, n, pos),
      });
    }
    for (const { note, display } of engine.notes.resolveDying(now)) {
      drawNote(note, display, { selected: false, hovered: false, playing: 0 });
    }

    // Notes being recorded: grow from their start to the playhead.
    if (ed.recorder.recording) {
      for (const r of ed.recorder.held) {
        const note: Note = { id: `rec-${r.pitch}`, pitch: r.pitch, start: r.start, duration: 0, velocity: r.velocity };
        const duration = Math.max(1, pos - r.start);
        drawNote(note, { start: r.start, duration, pitch: r.pitch, velocity: r.velocity, alpha: 1, scale: 1 }, { selected: false, hovered: false, playing: 1 });
      }
    }

    drawPlayhead(ctx, ed, v, p, h);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'maddie-piano-roll': MaddiePianoRoll;
  }
}
