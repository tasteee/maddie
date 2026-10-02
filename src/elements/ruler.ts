import { css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { barsInRange, beatLength, resolveGrid, snapTick, timeSigAt, type Editor } from '../core';
import type { Engine } from '../engine/engine';
import { clamp } from '../engine/ease';
import { crisp, handleWheel } from '../engine/interact';
import { withAlpha } from '../engine/theme';
import { CanvasElement } from './canvas-element';
import { roundRect } from './paint';
import type { Palette } from './tokens';

/** Bars and beats. Click to set the marker, drag to draw a loop, click the loop bar to toggle it. */
@customElement('maddie-ruler')
export class MaddieRuler extends CanvasElement {
  static styles = [
    ...CanvasElement.styles,
    css`
      :host {
        height: var(--_ruler-height);
        cursor: text;
        background: var(--_surface);
      }
    `,
  ];

  private hoverX: number | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('pointerdown', this.onDown);
    this.addEventListener('pointermove', this.onHover);
    this.addEventListener('pointermove', (e) => {
      this.hoverX = this.local(e).x;
      this.engine?.invalidate();
    });
    this.addEventListener('pointerleave', () => {
      this.hoverX = null;
      this.engine?.invalidate();
    });
    this.addEventListener('wheel', (e) => this.ed && handleWheel(this.ed, e, this.local(e).x, 0, { vertical: false }), {
      passive: false,
    });
  }

  private tickAt(x: number) {
    const v = this.ed!.view;
    return Math.max(0, v.scrollTick + x / v.pxPerTick);
  }

  private snapped(tick: number, alt: boolean) {
    const ed = this.ed!;
    if (alt) return Math.round(tick);
    const sig = timeSigAt(tick, ed.meta.timeSignature);
    const grid = Math.max(resolveGrid(ed.view.grid, ed.ppq, ed.view.pxPerTick, sig), beatLength(sig, ed.ppq));
    return snapTick(tick, grid, ed.meta.timeSignature);
  }

  /** Height of the loop strip along the top of the ruler. */
  private static readonly STRIP = 12;

  private loopHit(x: number, y: number): 'start' | 'end' | 'bar' | null {
    const ed = this.ed!;
    const { loop } = ed.transport;
    if (loop.end <= loop.start) return null;
    const v = ed.view;
    const x0 = (loop.start - v.scrollTick) * v.pxPerTick;
    const x1 = (loop.end - v.scrollTick) * v.pxPerTick;
    if (y > MaddieRuler.STRIP + 6) return null;
    if (Math.abs(x - x1) <= 6) return 'end';
    if (Math.abs(x - x0) <= 6) return 'start';
    if (y <= MaddieRuler.STRIP && x > x0 && x < x1) return 'bar';
    return null;
  }

  private onHover = (e: PointerEvent) => {
    if (!this.ed || e.buttons) return;
    const { x, y } = this.local(e);
    const hit = this.loopHit(x, y);
    this.style.cursor = hit === 'start' || hit === 'end' ? 'ew-resize' : hit === 'bar' ? 'pointer' : 'text';
  };

  /**
   * - Click the loop bar: toggle the loop.
   * - Drag a loop edge: resize.
   * - Drag anywhere else: draw a new loop.
   * - Click anywhere else: move the play marker.
   */
  private onDown = (e: PointerEvent) => {
    const ed = this.ed;
    if (!ed || e.button !== 0) return;
    this.setPointerCapture(e.pointerId);
    const { x: x0, y: y0 } = this.local(e);
    const t0 = this.snapped(this.tickAt(x0), e.altKey);
    const hit = this.loopHit(x0, y0);
    const start = ed.transport.loop;
    let dragging = false;

    const move = (ev: PointerEvent) => {
      const x = this.local(ev).x;
      if (!dragging && Math.abs(x - x0) < 3) return;
      dragging = true;
      const t = this.snapped(this.tickAt(x), ev.altKey);
      if (hit === 'start') ed.transport.setLoop({ start: Math.min(t, start.end - 1), enabled: true });
      else if (hit === 'end') ed.transport.setLoop({ end: Math.max(t, start.start + 1), enabled: true });
      else if (t !== t0) ed.transport.setLoop({ start: Math.min(t0, t), end: Math.max(t0, t), enabled: true });
    };
    const up = () => {
      this.removeEventListener('pointermove', move);
      this.removeEventListener('pointerup', up);
      if (dragging) return;
      if (hit) {
        ed.transport.setLoop({ enabled: !ed.transport.loop.enabled });
      } else {
        ed.transport.seek(t0);
        ed.setView({ cursor: t0 });
      }
    };
    this.addEventListener('pointermove', move);
    this.addEventListener('pointerup', up);
  };

  protected draw(ctx: CanvasRenderingContext2D, now: number, ed: Editor, engine: Engine, p: Palette) {
    const { width: w, height: h } = this;
    const v = engine.displayView(now);
    const x = (t: number) => (t - v.scrollTick) * v.pxPerTick;
    ctx.fillStyle = p.surface;
    ctx.fillRect(0, 0, w, h);

    // Loop: a bar along the top (grab its edges to resize), plus a faint tint while on.
    const loop = ed.transport.loop;
    if (loop.end > loop.start) {
      const x0 = x(loop.start);
      const x1 = x(loop.end);
      if (loop.enabled) {
        ctx.fillStyle = withAlpha(p.loop, 0.08);
        ctx.fillRect(x0, 0, x1 - x0, h);
      }
      ctx.fillStyle = loop.enabled ? p.text : withAlpha(p['text-faint'], 0.7);
      roundRect(ctx, x0 + 1, 3, x1 - x0 - 2, 6, 3);
      ctx.fill();
      // Edge grips.
      ctx.fillStyle = loop.enabled ? p.surface : p['text-faint'];
      for (const gx of [x0 + 4, x1 - 5]) ctx.fillRect(Math.round(gx), 4, 1, 4);
    }

    // Ticks and bar numbers.
    const { ppq, meta } = ed;
    const to = v.scrollTick + w / v.pxPerTick;
    const bars = barsInRange(Math.max(0, v.scrollTick - ppq * 16), to, meta.timeSignature, ppq);
    const barPx = bars[0] ? ((ppq * 4 * bars[0].sig.numerator) / bars[0].sig.denominator) * v.pxPerTick : 100;
    const labelEvery = barPx >= 34 ? 1 : Math.pow(2, Math.ceil(Math.log2(34 / barPx)));
    ctx.font = `500 10.5px ${p.fontMono}`;
    ctx.textBaseline = 'middle';
    for (const bar of bars) {
      const bx = x(bar.tick);
      const beat = beatLength(bar.sig, ppq);
      const beatPx = beat * v.pxPerTick;
      if (beatPx > 8) {
        ctx.fillStyle = withAlpha(p['text-faint'], clamp((beatPx - 8) / 12, 0, 1) * 0.8);
        for (let b = 1; b < bar.sig.numerator; b++) {
          const xx = bx + b * beatPx;
          if (xx >= 0 && xx <= w) ctx.fillRect(crisp(xx) - 0.5, h - 6, 1, 4);
        }
      }
      if ((bar.index - 1) % labelEvery) continue;
      if (bx < -40 || bx > w) continue;
      ctx.fillStyle = p['text-faint'];
      ctx.fillRect(crisp(bx) - 0.5, h - 10, 1, 8);
      ctx.fillStyle = p['text-muted'];
      ctx.fillText(String(bar.index), bx + 5, h / 2 + 1);
    }

    // Hover hint.
    if (this.hoverX !== null) {
      ctx.fillStyle = withAlpha(p.text, 0.18);
      ctx.fillRect(Math.round(this.hoverX), 0, 1, h);
    }

    // Playhead marker.
    const pos = ed.transport.position;
    if (ed.transport.playing || pos > 0) {
      const px = Math.round(x(pos));
      ctx.fillStyle = p.playhead;
      ctx.beginPath();
      ctx.moveTo(px - 5, h - 9);
      ctx.lineTo(px + 5, h - 9);
      ctx.lineTo(px, h - 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(px - 0.75, h - 4, 1.5, 4);
    }

    ctx.fillStyle = p.border;
    ctx.fillRect(0, h - 1, w, 1);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'maddie-ruler': MaddieRuler;
  }
}
