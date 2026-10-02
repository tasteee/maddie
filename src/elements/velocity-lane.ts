import { css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { createId, type Editor, type Note } from '../core';
import type { Engine } from '../engine/engine';
import { clamp } from '../engine/ease';
import { handleWheel } from '../engine/interact';
import { withAlpha } from '../engine/theme';
import { CanvasElement } from './canvas-element';
import { drawTimeGrid, noteBase, noteFill, playingFlash } from './paint';
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
      const d = Math.abs(this.x(n.start) - x) - (ed.selection.has(n.id) ? 0.5 : 0);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  private onDown = (e: PointerEvent) => {
    const ed = this.ed;
    const engine = this.engine;
    if (!ed || !engine || e.button !== 0) return;
    this.setPointerCapture(e.pointerId);
    const gestureId = createId();
    const { x, y } = this.local(e);
    const hit = this.hit(x);
    const changed = new Map<string, Note>();
    let update: (ev: PointerEvent) => void;

    if (hit) {
      // Drag one stem; selected stems follow relatively.
      const group = ed.selection.has(hit.id) ? ed.selectedNotes : [hit];
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
    notes.sort((a, b) => Number(ed.selection.has(a.id)) - Number(ed.selection.has(b.id)));
    const pos = ed.transport.position;
    for (const n of notes) {
      const d = engine.notes.resolve(n, now);
      const x = Math.round((d.start - v.scrollTick) * v.pxPerTick) + 0.5;
      if (x < -4 || x > w + 4) continue;
      const selected = ed.selection.has(n.id) || n.id.startsWith('copy:');
      const hovered = engine.hoverId === n.id;
      const top = PAD_TOP + span * (1 - d.velocity);
      const base = noteBase(p, n.pitch, ed.view.noteColor, selected);
      ctx.globalAlpha = d.alpha;
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

    ctx.fillStyle = p.border;
    ctx.fillRect(0, 0, w, 1);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'maddie-velocity-lane': MaddieVelocityLane;
  }
}
