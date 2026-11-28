import { css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { chordLevelAt, createId, levelChords, pitchRangeChords, type ChordRegion, type Editor, type Note } from '../core';
import type { Engine } from '../engine/engine';
import { clamp } from '../engine/ease';
import { handleWheel } from '../engine/interact';
import { withAlpha } from '../engine/theme';
import { CanvasElement } from './canvas-element';
import { drawTimeGrid, noteFill, playingFlash, resolveTrackColor } from './paint';
import type { Palette } from './tokens';

const PAD_TOP = 10;
const PAD_BOTTOM = 4;

/**
 * Velocity stems. Drag a stem to set it (all selected move together).
 * Drag across empty space to paint velocities.
 */
@customElement('maddie-velocity-lane')
export class MaddieVelocityLane extends CanvasElement {
  static styles = [
    ...CanvasElement.styles,
    css`
      :host {
        height: var(--_lane-height);
        background: var(--_row-white);
        cursor: ns-resize;
      }
    `,
  ];

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('pointerdown', this.onDown);
    this.addEventListener('pointermove', (e) => {
      if (e.buttons) return;
      this.engine?.setHover(this.hit(this.local(e).x)?.id ?? null);
    });
    this.addEventListener('pointerleave', () => this.engine?.setHover(null));
    this.addEventListener('wheel', (e) => this.ed && handleWheel(this.ed, e, this.local(e).x, 0, { vertical: false }), {
      passive: false,
    });
  }

  private x(tick: number) {
    const v = this.ed!.view;
    return (tick - v.scrollTick) * v.pxPerTick;
  }

  private valueAt(y: number) {
    return clamp(1 - (y - PAD_TOP) / (this.height - PAD_TOP - PAD_BOTTOM), 0, 1);
  }

  private hit(x: number): Note | null {
    const ed = this.ed!;
    const v = ed.view;
    const notes = this.engine!.visibleNotes(v.scrollTick + (x - 6) / v.pxPerTick, v.scrollTick + (x + 6) / v.pxPerTick);
    let best: Note | null = null;
    let bestD = 7;
    for (const n of notes) {
      const d = Math.abs(this.x(n.start) - x) - (ed.isNoteSelected(n.id) ? 0.5 : 0);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  /** While a chord-velocity drag runs: the chords as they'd be, so the lines follow the pointer. */
  private draggedChords?: ReadonlyMap<string, ChordRegion>;

  /**
   * The chord knob nearest the pointer: a chord's start (level, or ramp start) or, for a ramp,
   * its end. Where two knobs meet (one chord ends as the next starts), a selected chord wins,
   * then the start of the next chord.
   */
  private chordKnobAt(x: number, y: number): { region: ChordRegion; knob: 'start' | 'end' } | null {
    const ed = this.ed;
    const regions = ed?.chordRegions ?? [];
    const span = this.height - PAD_TOP - PAD_BOTTOM;
    const yOf = (velocity: number) => PAD_TOP + span * (1 - velocity);
    let best: { region: ChordRegion; knob: 'start' | 'end' } | null = null;
    let bestScore = 10;
    const consider = (region: ChordRegion, knob: 'start' | 'end', tick: number) => {
      const distance = Math.hypot(this.x(tick) - x, yOf(chordLevelAt(region, tick)) - y);
      const isNearX = Math.abs(this.x(tick) - x) <= 8;
      if (!isNearX) return;
      const selectedBonus = ed?.selection.has(region.id) ? 1 : 0;
      const startBonus = knob === 'start' ? 0.5 : 0;
      const score = distance - selectedBonus - startBonus;
      if (score >= bestScore) return;
      bestScore = score;
      best = { region, knob };
    };
    for (const region of regions) {
      consider(region, 'start', region.start);
      const hasRamp = !!region.dynamics?.ramp;
      if (hasRamp) consider(region, 'end', region.start + region.duration);
    }
    return best;
  }

  /**
   * Chord tracks: each chord has a level line (slanted when ramped). Drag a knob to change
   * the level or a ramp end; selected chords move together. Drag across empty space to paint
   * one level onto every chord swept.
   */
  private onChordDown(e: PointerEvent, ed: Editor, engine: Engine) {
    this.setPointerCapture(e.pointerId);
    const { x, y } = this.local(e);
    const grabbed = this.chordKnobAt(x, y);
    const changed = new Map<string, ChordRegion>();
    let update: (ev: PointerEvent) => void;

    if (grabbed) {
      const isInSelection = ed.selection.has(grabbed.region.id);
      const group = isInSelection ? ed.selectedChordRegions : [grabbed.region];
      const grabTick = grabbed.knob === 'start' ? grabbed.region.start : grabbed.region.start + grabbed.region.duration;
      const offset = this.valueAt(y) - chordLevelAt(grabbed.region, grabTick);
      update = (ev) => {
        const delta = this.valueAt(this.local(ev).y) - offset - chordLevelAt(grabbed.region, grabTick);
        for (const region of group) changed.set(region.id, nudgeChordLevel(region, grabbed.knob, delta));
      };
    } else {
      let lastX = x;
      update = (ev) => {
        const point = this.local(ev);
        const low = Math.min(lastX, point.x) - 2;
        const high = Math.max(lastX, point.x) + 2;
        const value = this.valueAt(point.y);
        for (const region of ed.chordRegions ?? []) {
          const regionX = this.x(region.start);
          const isSwept = regionX >= low && regionX <= high;
          if (isSwept) changed.set(region.id, levelChords([region], value)[0]);
        }
        lastX = point.x;
      };
    }

    const preview = () => {
      this.draggedChords = new Map(changed);
      const edit = buildChordEdit(ed, changed);
      if (edit) engine.previewChords(edit);
      engine.invalidate();
    };
    update(e);
    preview();
    const move = (ev: PointerEvent) => {
      update(ev);
      preview();
    };
    const up = () => {
      this.removeEventListener('pointermove', move);
      this.removeEventListener('pointerup', up);
      this.removeEventListener('pointercancel', up);
      this.draggedChords = undefined;
      engine.clearPreview();
      if (changed.size) ed.chordTrack.commitChanged([...changed.values()], 'Chord velocity');
    };
    this.addEventListener('pointermove', move);
    this.addEventListener('pointerup', up);
    this.addEventListener('pointercancel', up);
  }

  private onDown = (e: PointerEvent) => {
    const ed = this.ed;
    const engine = this.engine;
    if (!ed || !engine || e.button !== 0) return;
    if (ed.chordRegions) return this.onChordDown(e, ed, engine);
    this.setPointerCapture(e.pointerId);
    const gestureId = createId();
    const { x, y } = this.local(e);
    const hit = this.hit(x);
    const changed = new Map<string, Note>();
    let update: (ev: PointerEvent) => void;

    if (hit) {
      // Drag one stem; selected stems follow relatively.
      const group = ed.isNoteSelected(hit.id) ? ed.selectedNotes : [hit];
      const delta = this.valueAt(y) - hit.velocity;
      update = (ev) => {
        const d = this.valueAt(this.local(ev).y) - hit.velocity - delta;
        for (const n of group) changed.set(n.id, { ...n, velocity: clamp(n.velocity + d, 0, 1) });
        engine.setPreview({ overrides: new Map(changed) });
      };
    } else {
      // Paint: every stem the pointer sweeps over takes the pointer's value.
      let lastX = x;
      update = (ev) => {
        const p = this.local(ev);
        const v = ed.view;
        const a = Math.min(lastX, p.x);
        const b = Math.max(lastX, p.x);
        const value = this.valueAt(p.y);
        for (const n of ed.notesInRange(v.scrollTick + (a - 2) / v.pxPerTick, v.scrollTick + (b + 2) / v.pxPerTick)) {
          const nx = this.x(n.start);
          if (nx >= a - 2 && nx <= b + 2) changed.set(n.id, { ...n, velocity: value });
        }
        lastX = p.x;
        engine.setPreview({ overrides: new Map(changed) });
      };
    }
    update(e);

    const move = (ev: PointerEvent) => update(ev);
    const up = () => {
      this.removeEventListener('pointermove', move);
      this.removeEventListener('pointerup', up);
      this.removeEventListener('pointercancel', up);
      if (changed.size) ed.commands.update([...changed.values()].map(({ id, velocity }) => ({ id, velocity })), 'Change velocity', { gestureId });
      if (hit && changed.has(hit.id)) ed.setView({ noteVelocity: changed.get(hit.id)!.velocity });
      engine.clearPreview();
    };
    this.addEventListener('pointermove', move);
    this.addEventListener('pointerup', up);
    this.addEventListener('pointercancel', up);
  };

  protected draw(ctx: CanvasRenderingContext2D, now: number, ed: Editor, engine: Engine, p: Palette) {
    const { width: w, height: h } = this;
    const v = engine.displayView(now);
    ctx.fillStyle = p['row-white'];
    ctx.fillRect(0, 0, w, h);
    drawTimeGrid(ctx, ed, engine, v, p, w, 0, h, now);

    // Guides at 25 / 50 / 75 / 100%.
    const span = h - PAD_TOP - PAD_BOTTOM;
    for (const g of [0.25, 0.5, 0.75, 1]) {
      ctx.fillStyle = g === 1 ? p['line-beat'] : p['line-row'];
      ctx.fillRect(0, Math.round(PAD_TOP + span * (1 - g)), w, 1);
    }

    const from = v.scrollTick;
    const to = from + w / v.pxPerTick;
    const notes = engine.visibleNotes(from - 1, to);
    notes.sort((a, b) => Number(ed.isNoteSelected(a.id)) - Number(ed.isNoteSelected(b.id)));
    const pos = ed.transport.position;
    const activeTrackColor = resolveTrackColor(p, ed.getTrackColor(ed.activeTrackId));
    for (const n of notes) {
      const d = engine.notes.resolve(n, now);
      const x = Math.round((d.start - v.scrollTick) * v.pxPerTick) + 0.5;
      if (x < -4 || x > w + 4) continue;
      const selected = ed.selection.has(n.id) || n.id.startsWith('copy:');
      const hovered = engine.hoverId === n.id;
      const top = PAD_TOP + span * (1 - d.velocity);
      const base = activeTrackColor;
      // On a chord track the hits sit behind the chords' level lines.
      const hitAlpha = ed.chordRegions ? 0.4 : 1;
      ctx.globalAlpha = d.alpha * hitAlpha;
      ctx.strokeStyle = withAlpha(base, selected || hovered ? 1 : 0.55);
      ctx.lineWidth = selected || hovered ? 2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(x, h - PAD_BOTTOM);
      ctx.lineTo(x, top);
      ctx.stroke();
      ctx.fillStyle = noteFill(p, base, { velocity: 1, muted: n.muted }, { selected, hovered, playing: playingFlash(ed, n, pos) });
      ctx.beginPath();
      ctx.arc(x, top, hovered ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      if (selected) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = p['note-outline'];
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    const isChordTrack = !!ed.chordRegions;
    if (isChordTrack) this.drawChordLevels(ctx, ed, v, p, w, span, activeTrackColor);

    ctx.fillStyle = p.border;
    ctx.fillRect(0, 0, w, 1);
  }

  /** Chord tracks: one level line per chord, slanted when ramped, with a knob to drag at each end it has. */
  private drawChordLevels(ctx: CanvasRenderingContext2D, ed: Editor, v: { scrollTick: number; pxPerTick: number }, p: Palette, w: number, span: number, color: string) {
    const toX = (tick: number) => Math.round((tick - v.scrollTick) * v.pxPerTick) + 0.5;
    const toY = (velocity: number) => PAD_TOP + span * (1 - velocity);
    for (const source of ed.chordRegions ?? []) {
      const region = this.draggedChords?.get(source.id) ?? source;
      const regionEnd = region.start + region.duration;
      const startX = toX(region.start);
      const endX = toX(regionEnd);
      const isVisible = endX >= -6 && startX <= w + 6;
      if (!isVisible) continue;
      const isSelected = ed.selection.has(region.id);
      const startY = toY(chordLevelAt(region, region.start));
      const endY = toY(chordLevelAt(region, regionEnd));
      ctx.strokeStyle = withAlpha(color, region.muted ? 0.35 : isSelected ? 1 : 0.7);
      ctx.lineWidth = isSelected ? 2.5 : 2;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      const knobs = region.dynamics?.ramp ? [[startX, startY], [endX, endY]] : [[startX, startY]];
      for (const [knobX, knobY] of knobs) {
        ctx.fillStyle = region.muted ? withAlpha(color, 0.35) : color;
        ctx.beginPath();
        ctx.arc(knobX, knobY, isSelected ? 5 : 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = p['note-outline'];
        ctx.stroke();
      }
    }
  }
}

/** Move one end of a chord's level: the level itself, or a ramp's start or end. */
const nudgeChordLevel = (region: ChordRegion, knob: 'start' | 'end', delta: number): ChordRegion => {
  const ramp = region.dynamics?.ramp;
  const range = region.dynamics?.pitchRange;
  const bounded = (value: number) => clamp(value, 1 / 127, 1);
  if (range) {
    const shift = clamp(delta, 1 / 127 - range.min, 1 - range.max);
    return pitchRangeChords([region], range.min + shift, range.max + shift)[0];
  }
  if (!ramp) return { ...region, velocity: bounded(region.velocity + delta) };
  const isStart = knob === 'start';
  const nextRamp = isStart ? { ...ramp, from: bounded(ramp.from + delta) } : { ...ramp, to: bounded(ramp.to + delta) };
  return { ...region, dynamics: { ...region.dynamics, ramp: nextRamp } };
};

/** The chord list with some chords changed, prepared for preview. */
const buildChordEdit = (ed: Editor, changed: ReadonlyMap<string, ChordRegion>) => {
  const regions = ed.chordRegions;
  if (!regions) return undefined;
  const updated = regions.map((region) => changed.get(region.id) ?? region);
  try {
    return ed.chordTrack.prepare(updated);
  } catch {
    return undefined;
  }
};

declare global {
  interface HTMLElementTagNameMap {
    'maddie-velocity-lane': MaddieVelocityLane;
  }
}
