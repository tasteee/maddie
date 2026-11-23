import { css, html } from 'lit';
import { confirmPlainChordPlacement } from './zest';
import { showEditorToast } from './zest';
import { customElement } from 'lit/decorators.js';
import {
  clampPitch,
  createId,
  degreeOf,
  inScale,
  loadScaled,
  isBlackKey,
  nearestInScale,
  pitchClass,
  pitchOfDegree,
  resolveGrid,
  snapTick,
  timeSigAt,
  type ChordRegion,
  type ChordDraft,
  type ChordTrackEdit,
  type Editor,
  type Note,
  type NoteId,
} from '../core';
import type { ChordDrag, ChordDragPhase, DisplayView, Engine, Toast } from '../engine/engine';
import { clamp } from '../engine/ease';
import { clampScrollRow, handleWheel, maxScrollTick } from '../engine/interact';
import { normalizeColor, withAlpha } from '../engine/theme';
import { CanvasElement } from './canvas-element';
import { icons } from './icons';
import { importMidiFiles } from './midi-io';
import { drawGhostNotes, drawPlayhead, drawTimeGrid, noteFill, playingFlash, resolveTrackColor, roundRect, type NoteState, type NoteStyle } from './paint';
import type { Palette } from './tokens';
import './zest';

const CHORD_ZONE_PX = 10;

type ChordDropPlanT =
  | { kind: 'place'; start: number; draft: ChordDraft; label: string }
  | { kind: 'edit'; start: number; draft: ChordDraft; edit: ChordTrackEdit; newId: string; label: string; commitLabel: string; insertion?: number };

const QUARTERS = ['', '¼', '½', '¾'];

/** "¾ bar", "1¼ bars", or beats when it isn't a quarter-bar step. */
const formatBars = (duration: number, bar: number) => {
  const quarters = Math.round((duration / bar) * 4);
  const isQuarterStep = Math.abs(quarters * bar / 4 - duration) < 1;
  if (!isQuarterStep) {
    const beats = Math.round((duration / (bar / 4)) * 100) / 100;
    return `${beats} ${beats === 1 ? 'beat' : 'beats'}`;
  }
  const whole = Math.floor(quarters / 4);
  const part = QUARTERS[quarters % 4];
  const isUnderOne = whole === 0;
  if (isUnderOne) return `${part} bar`;
  const isOne = quarters === 4;
  if (isOne) return '1 bar';
  return `${whole}${part} bars`;
};

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
        inset: var(--space-2);
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
        <z-badge size="md" kind="soft" tone="primary"><span slot="prefix">${icons.upload}</span>Drop MIDI files to add tracks</z-badge>
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
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length && this.ed) void importMidiFiles(this.ed, files, this);
  };

  private showToast = (toast: Toast) => {
    showEditorToast(toast.message, toast.kind === 'capture');
  };

  protected firstUpdated() {
    super.firstUpdated();
    this.marquee = this.renderRoot.querySelector('.marquee')!;
  }

  protected attach(editor: Editor, engine: Engine) {
    super.attach(editor, engine);
    const warmChordTools = () => {
      if (editor.chordRegions?.some((region) => region.performance)) void loadScaled().catch(() => {});
    };
    warmChordTools();
    window.addEventListener('keydown', this.trackAlt, true);
    window.addEventListener('keyup', this.trackAlt, true);
    this.track(editor.on('tracks', warmChordTools), editor.on('view', () => this.updateCursor()), engine.onToast(this.showToast), engine.onChordDrag(this.onChordDrag),
      () => {
        window.removeEventListener('keydown', this.trackAlt, true);
        window.removeEventListener('keyup', this.trackAlt, true);
      });
  }

  // ── Chord drop (from <maddie-chords>) ───────────────────────────

  /**
   * Where a dragged chord would land, and what dropping it does:
   * - empty space: place, 1 bar or fitted to end where the next chord starts;
   * - a chord's body: replace it (the new chord takes its start and length);
   * - a seam between two touching chords: insert, sliding the later chords right.
   * Nothing ever overlaps. Alt only skips snapping.
   */
  private chordDropPlan(drag: ChordDrag, isAltDown: boolean): ChordDropPlanT | undefined {
    const ed = this.ed!;
    const { x, y } = this.local(drag);
    const isOutside = x < 0 || y < 0 || x > this.width || y > this.height;
    if (isOutside) return;
    const view = ed.view;
    const pointerTick = this.tickAt(x);
    const zoneTicks = CHORD_ZONE_PX / view.pxPerTick;
    const bar = drag.draft.region.duration;
    const regions = ed.chordRegions;
    const end = (region: ChordRegion) => region.start + region.duration;

    if (regions) {
      for (let index = 0; index + 1 < regions.length; index++) {
        const left = regions[index];
        const right = regions[index + 1];
        const isTouching = end(left) === right.start;
        const isNearSeam = Math.abs(pointerTick - right.start) <= zoneTicks;
        if (!isTouching || !isNearSeam) continue;
        const at = right.start;
        const inserted = { ...drag.draft.region, id: createId(), start: at };
        const shifted = regions.map((region) => (region.start >= at ? { ...region, start: region.start + bar } : region));
        const moved = regions.length - index - 1;
        const edit = ed.chordTrack.prepare([...shifted, inserted]);
        if (!edit) return;
        const label = `Insert · moves ${moved} ${moved === 1 ? 'chord' : 'chords'}`;
        return { kind: 'edit', start: at, draft: drag.draft, edit, newId: inserted.id, label, insertion: at, commitLabel: 'Insert chord' };
      }
      const target = regions.find((region) => pointerTick >= region.start && pointerTick < end(region));
      if (target) {
        const isInBody = pointerTick - target.start > zoneTicks && end(target) - pointerTick > zoneTicks;
        if (!isInBody) return;
        const fitted = ed.chordTrack.fitDraft(drag.draft, target.duration);
        const replacement = { ...fitted.region, id: createId(), start: target.start };
        const edit = ed.chordTrack.prepare([...regions.filter((region) => region !== target), replacement]);
        if (!edit) return;
        return { kind: 'edit', start: target.start, draft: fitted, edit, newId: replacement.id, label: `Replace ${target.symbol}`, commitLabel: 'Replace chord' };
      }
    }

    const start = this.snap(pointerTick, { altKey: isAltDown }, 'floor');
    const next = regions?.find((region) => region.start > start);
    const room = next ? next.start - start : bar;
    const minimum = this.gridAt(start);
    const hasRoom = room >= Math.min(minimum, bar);
    if (!hasRoom) return;
    const duration = Math.min(bar, room);
    const draft = ed.chordTrack.fitDraft(drag.draft, duration);
    const isFitted = duration < bar;
    const label = isFitted ? `Fits ${formatBars(duration, bar)}` : '';
    return { kind: 'place', start, draft, label };
  }

  private revealChord(pitches: readonly number[]) {
    const ed = this.ed!;
    const rows = pitches.map((pitch) => ed.rowMap.rowOf(pitch) ?? ed.rowMap.virtual[pitch]);
    const { rowHeight, scrollRow = 0 } = ed.view;
    const top = scrollRow ?? 0;
    const hi = Math.min(...rows);
    const lo = Math.max(...rows);
    if (hi < top || lo >= top + this.height / rowHeight) {
      const center = (hi + lo) / 2 - this.height / rowHeight / 2;
      ed.setView({ scrollRow: clampScrollRow(ed, center) });
    }
  }

  private onChordDrag = async (drag: ChordDrag, phase: ChordDragPhase) => {
    const ed = this.ed;
    const engine = this.engine;
    if (!ed || !engine) return;
    const plan = phase === 'cancel' ? undefined : this.chordDropPlan(drag, this.isAltDown);
    if (!plan) {
      if (drag.overGrid || phase !== 'move') engine.clearPreview();
      drag.overGrid = false;
      drag.label = undefined;
      return;
    }
    const draft = plan.draft;
    const notes = draft.notes.map((note) => ({ ...note, start: plan.start + note.start }));
    const pitches = notes.length ? notes.map((note) => note.pitch) : draft.region.pitches;
    drag.label = plan.label || undefined;
    if (phase === 'move') {
      if (!drag.overGrid) this.revealChord(pitches);
      drag.overGrid = true;
      const isEdit = plan.kind === 'edit';
      if (isEdit) engine.previewChords(plan.edit, plan.insertion);
      if (!isEdit) engine.setPreview({ added: notes }, ed.view.snap);
      return;
    }
    const isMidiTrack = !ed.chordRegions;
    const isConfirmed = isMidiTrack ? await confirmPlainChordPlacement(this) : true;
    if (!isConfirmed) {
      engine.clearPreview();
      return;
    }
    try {
      const isEdit = plan.kind === 'edit';
      const isAdded = isEdit
        ? ed.chordTrack.commit(plan.edit, plan.commitLabel, [plan.newId])
        : ed.chordTrack.placeDraft(draft, plan.start);
      if (isAdded) {
        this.revealChord(pitches);
        ed.chordTrack.auditionPitches([draft.region]);
      }
      this.focus({ preventScroll: true });
    } catch (error) {
      engine.toast((error as Error).message, 'error');
    }
    engine.clearPreview();
  };

  /** Alt while dragging a chord from the panel skips snapping. The drag lives in another element, so track it here. */
  private isAltDown = false;
  private trackAlt = (event: KeyboardEvent) => { this.isAltDown = event.altKey; };

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
    notes.sort((a, b) => Number(ed.isNoteSelected(b.id)) - Number(ed.isNoteSelected(a.id)));
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
      if (ed.chordRegions) return;
      const rightHit = this.hitTest(x, y);
      if (!rightHit) return;
      return this.begin(e, this.velocityGesture(e, rightHit.note));
    }
    if (e.button !== 0) return;

    const hit = this.hitTest(x, y);
    const clicked = this.snap(this.tickAt(x), e, 'floor');
    ed.setView({ cursor: clicked });

    if (ed.chordRegions) {
      const chord = this.hitRegion(x, y, hit?.note.chordRegionId);
      if (chord) return this.begin(e, this.regionGesture(e, chord.region, chord.edge));
      return this.begin(e, this.marqueeGesture(e));
    }

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
    if (!ed || ed.chordRegions) return;
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

  /** Scroll horizontally when dragging near a time-axis edge. */
  private autoScroll() {
    if (this.autoScrollRaf) return;
    const step = () => {
      this.autoScrollRaf = 0;
      const e = this.lastPointer;
      const ed = this.ed;
      if (!e || !ed || !this.gesture) return;
      const { x } = this.local(e);
      const edge = 28;
      const speed = (d: number) => Math.sign(d) * Math.min(24, Math.pow(Math.abs(d) / edge, 1.6) * 10);
      const dx = x < edge ? speed(x - edge) : x > this.width - edge ? speed(x - (this.width - edge)) : 0;
      if (!dx) return;
      const v = ed.view;
      ed.setView({
        scrollTick: clamp(v.scrollTick + dx / v.pxPerTick, 0, maxScrollTick(ed)),
      });
      this.gesture.move(e);
      this.autoScrollRaf = requestAnimationFrame(step);
    };
    this.autoScrollRaf = requestAnimationFrame(step);
  }

  private regionRect(region: ChordRegion, view: Pick<DisplayView, 'scrollTick' | 'scrollRow' | 'pxPerTick' | 'rowHeight'>, pitches = region.pitches) {
    const map = this.ed!.rowMap;
    const rows = pitches.map((pitch) => map.rowOf(pitch) ?? map.virtual[pitch]);
    const y = clamp((Math.min(...rows) - (view.scrollRow ?? 0)) * view.rowHeight - 17, 0, Math.max(0, this.height - 17));
    const bottom = clamp((Math.max(...rows) + 1 - (view.scrollRow ?? 0)) * view.rowHeight + 2, y + 17, Math.max(y + 17, this.height));
    return { x: (region.start - view.scrollTick) * view.pxPerTick, y, w: Math.max(3, region.duration * view.pxPerTick), h: bottom - y };
  }

  private hitRegion(x: number, y: number, owner?: string) {
    const ed = this.ed!;
    for (const region of ed.chordRegions ?? []) {
      const rect = this.regionRect(region, { ...ed.view, scrollRow: ed.view.scrollRow ?? 0 });
      if (owner !== region.id && (owner || x < rect.x || x >= rect.x + rect.w || y < rect.y || y >= rect.y + rect.h)) continue;
      const edge = Math.min(7, rect.w / 4);
      const zone: Zone = x > rect.x + rect.w - edge ? 'end' : x < rect.x + edge ? 'start' : 'body';
      return { region, edge: zone };
    }
    return null;
  }

  private regionGesture(down: PointerEvent, region: ChordRegion, edge: Zone): Gesture {
    const ed = this.ed!;
    const engine = this.engine!;
    const source = ed.chordRegions;
    const track = ed.activeTrackId;
    const origin = this.local(down);
    const add = down.shiftKey || down.metaKey || down.ctrlKey;
    const wasSelected = ed.selection.has(region.id);
    if (!wasSelected) ed.select([region.id], add ? 'add' : 'replace');
    const selected = ed.selectedChordRegions;
    let dragging = false;
    let edit: ChordTrackEdit | undefined;
    let lastPosition = '';
    let error = '';
    const move = (event: PointerEvent) => {
      if (ed.activeTrackId !== track || ed.chordRegions !== source) return;
      const p = this.local(event);
      if (!dragging && Math.hypot(p.x - origin.x, p.y - origin.y) < DRAG_THRESHOLD) return;
      dragging = true;
      const raw = this.tickAt(p.x) - this.tickAt(origin.x) + (edge === 'end' ? region.start + region.duration : region.start);
      const tick = this.snap(raw, event);
      const octave = edge === 'body' ? Math.round((this.pitchAt(p.y) - this.pitchAt(origin.y)) / 12) : 0;
      const location = tick + ':' + octave;
      if (lastPosition === location) return;
      lastPosition = location;
      const regions = edge === 'body' ? ed.chordTrack.planMove(region.id, tick, octave, selected) : ed.chordTrack.planResize(region.id, edge, tick);
      try {
        edit = regions && ed.chordTrack.prepare(regions);
        error = '';
      } catch (cause) {
        edit = undefined;
        error = (cause as Error).message;
      }
      if (edit) {
        const placed = edit.regions.find((item) => item.id === region.id)!;
        const reordered = edit.regions.some((item, i) => item.id !== source?.[i]?.id);
        engine.previewChords(edit, reordered ? placed.start : undefined);
      } else engine.clearPreview();
    };
    return {
      move,
      up: (event) => {
        if (ed.activeTrackId !== track || ed.chordRegions !== source) return;
        if (!dragging) {
          if (wasSelected) ed.select([region.id], add ? 'toggle' : 'replace');
          ed.chordTrack.auditionPitches([region]);
          return;
        }
        move(event);
        if (edit) ed.chordTrack.commit(edit, edge === 'body' ? 'Move chords' : 'Resize chord');
        else if (error) engine.toast(error, 'error');
      },
      cancel() {},
    };
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
    this.engine?.pauseFollow();
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
    if (ed.chordRegions && e) {
      const { x, y } = this.local(e);
      const chord = this.hitRegion(x, y, hit?.note.chordRegionId);
      return this.setCursor(chord ? (chord.edge === 'body' ? 'grab' : 'ew-resize') : 'default');
    }
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

  private drawRegions(ctx: CanvasRenderingContext2D, ed: Editor, engine: Engine, view: DisplayView, p: Palette, color: string, notes: readonly Note[]) {
    const regions = engine.preview.regions ?? ed.chordRegions;
    if (!regions) return;
    const pitchesByRegion = new Map<string, Set<number>>();
    for (const note of notes) {
      if (!note.chordRegionId) continue;
      const pitches = pitchesByRegion.get(note.chordRegionId) ?? new Set<number>();
      pitches.add(note.pitch);
      pitchesByRegion.set(note.chordRegionId, pitches);
    }
    ctx.save();
    ctx.font = `600 11px ${p.font}`;
    ctx.textBaseline = 'middle';
    for (const region of regions) {
      const x = (region.start - view.scrollTick) * view.pxPerTick;
      if (x >= this.width || x + region.duration * view.pxPerTick < 0) continue;
      const pitches = [...region.pitches, ...pitchesByRegion.get(region.id) ?? []];
      const box = this.regionRect(region, view, pitches);
      const selected = ed.selection.has(region.id);
      ctx.fillStyle = withAlpha(color, selected ? 0.22 : 0.10);
      ctx.strokeStyle = withAlpha(color, selected ? 0.95 : 0.55);
      roundRect(ctx, box.x + 0.5, box.y + 0.5, Math.max(1, box.w - 1), box.h - 1, 4);
      ctx.fill();
      ctx.stroke();
      ctx.save();
      ctx.beginPath();
      ctx.rect(box.x + 2, box.y + 1, Math.max(0, box.w - 4), 16);
      ctx.clip();
      ctx.fillStyle = p.text;
      ctx.fillText(region.symbol, box.x + 6, box.y + 9);
      ctx.restore();
    }
    if (engine.preview.insertion !== undefined) {
      ctx.fillStyle = p.accent;
      const x = (engine.preview.insertion - view.scrollTick) * view.pxPerTick;
      ctx.fillRect(x - 1.5, 0, 3, this.height);
    }
    ctx.restore();
  }

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
    const rootTint = withAlpha(p.scale, 0.07);
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
      ctx.fillStyle = pitchClass(pitch) === 0 ? p.border : p['line-row'];
      ctx.fillRect(0, Math.round(y + rh) - 1, w, 1);
    }

    drawTimeGrid(ctx, ed, engine, v, p, w, 0, h, now);

    // Other tracks sit behind the active one.
    drawGhostNotes(ctx, engine, v, p, w, h, now);

    // Notes. Unselected first, selected on top.
    const from = v.scrollTick;
    const to = from + w / v.pxPerTick;
    const notes = engine.visibleNotes(from, to);
    const isSelected = (n: Note) => ed.chordRegions && n.chordRegionId ? ed.selection.has(n.chordRegionId) : ed.isNoteSelected(n.id);
    notes.sort((a, b) => Number(isSelected(a)) - Number(isSelected(b)));
    const pos = ed.transport.position;
    const dragging = engine.previewing;
    const radius = p.noteRadius;
    ctx.textBaseline = 'middle';
    ctx.font = `600 10px ${p.font}`;

    // The active track's notes keep the track color, drawn fully solid (other tracks are ghosts).
    const activeTrackColor = resolveTrackColor(p, ed.getTrackColor(ed.activeTrackId));
    this.drawRegions(ctx, ed, engine, v, p, activeTrackColor, notes);

    const isTrackAudible = ed.isTrackAudible(ed.activeTrackId);
    // TODO(design): Decide whether inactive notes should become editable.
    const drawNote = (n: Note, d: ReturnType<typeof engine.notes.resolve>, state: NoteState) => {
      const x = (d.start - v.scrollTick) * v.pxPerTick;
      const nw = Math.max(3, d.duration * v.pxPerTick);
      if (x > w || x + nw < 0) return;
      const row = rows.rowOf(d.pitch, now);
      const isSilent = !isTrackAudible || Boolean(n.muted);
      const alpha = d.alpha * rows.alphaOf(Math.round(d.pitch), now) * (isSilent ? 0.3 : 1);
      if (alpha <= 0.01) return;
      const inner = Math.max(2, rh - 2);
      const nh = inner * d.scale;
      const y = (row - v.scrollRow) * rh + 1 + (inner - nh) / 2;
      if (y > h || y + nh < 0) return;
      const style = this.noteStyle?.(n, state);
      const base = style?.fill ? normalizeColor(style.fill) : activeTrackColor;
      ctx.globalAlpha = alpha;
      roundRect(ctx, x, y, nw - 2, nh, radius);
      ctx.fillStyle = noteFill(p, base, { velocity: 1 }, state);
      ctx.fill();
      if (state.selected) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = style?.outline ?? p['note-outline'];
        roundRect(ctx, x + 1.25, y + 0.75, nw - 2.5, nh - 1.5, radius - 0.5);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    for (const n of notes) {
      const d = engine.notes.resolve(n, now);
      const selected = isSelected(n) || n.id.startsWith('copy:');
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
