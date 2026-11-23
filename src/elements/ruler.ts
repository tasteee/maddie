import { unsafeCSS } from 'lit';
import { customElement } from 'lit/decorators.js';
import { barsInRange, beatLength, resolveGrid, snapTick, timeSigAt, ZOOM_LIMITS, type Editor } from '../core';
import type { Engine } from '../engine/engine';
import { clamp } from '../engine/ease';
import { crisp, handleWheel } from '../engine/interact';
import { withAlpha } from '../engine/theme';
import { CanvasElement } from './canvas-element';
import { roundRect } from './paint';
import type { Palette } from './tokens';
import rulerCss from './ruler.css?raw';

const LOOP_STRIP = 10;
const LOOP_HANDLE = 6;

/** Bars and beats. Click to set the marker, drag to draw a loop, click the loop bar to toggle it. */
@customElement('maddie-ruler')
export class MaddieRuler extends CanvasElement {
  static styles = [
    ...CanvasElement.styles,
    unsafeCSS(rulerCss),
  ];

  connectedCallback() {
    super.connectedCallback();
    this.title = 'Click to seek. Drag left or right to draw a loop, or up or down to zoom.';
    this.addEventListener('pointerdown', this.onDown);
    this.addEventListener('pointermove', this.onHover);
    this.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private onWheel = (event: WheelEvent) => {
    if (this.ed) handleWheel(this.ed, event, this.local(event).x, 0, { vertical: false });
  };

  private loopHit(x: number, y: number, view: { scrollTick: number; pxPerTick: number }) {
    const loop = this.ed!.transport.loop;
    if (loop.end <= loop.start || y > LOOP_STRIP + LOOP_HANDLE) return null;
    const left = (loop.start - view.scrollTick) * view.pxPerTick;
    const right = (loop.end - view.scrollTick) * view.pxPerTick;
    // Leave the middle clickable even when the loop is only a few pixels wide.
    const handle = Math.min(LOOP_HANDLE, (right - left) / 3);
    if (Math.abs(x - left) <= handle) return 'start';
    if (Math.abs(x - right) <= handle) return 'end';
    if (y <= LOOP_STRIP && x > left && x < right) return 'bar';
    return null;
  }

  private onHover = (event: PointerEvent) => {
    if (!this.ed || event.buttons) return;
    const { x, y } = this.local(event);
    const hit = this.loopHit(x, y, this.engine!.displayView(performance.now()));
    this.style.cursor = hit === 'bar' ? 'pointer' : hit ? 'ew-resize' : '';
  };

  private onDown = (event: PointerEvent) => {
    const ed = this.ed;
    if (!ed || event.button !== 0 || !event.isPrimary) return;
    const { pointerId } = event;
    this.setPointerCapture(pointerId);
    const point = this.local(event);
    const view = this.engine!.displayView(performance.now());
    const hit = this.loopHit(point.x, point.y, view);
    const loop = ed.transport.loop;
    const { timeSignature } = ed.meta;
    const toTick = (x: number) => view.scrollTick + x / view.pxPerTick;
    const anchor = toTick(point.x);
    const snapLoop = (tick: number, alt: boolean) => {
      if (alt || !ed.view.snap) return Math.max(0, Math.round(tick));
      const sig = timeSigAt(Math.max(0, tick), timeSignature);
      const grid = Math.max(resolveGrid(ed.view.grid, ed.ppq, view.pxPerTick, sig), beatLength(sig, ed.ppq));
      return Math.max(0, snapTick(tick, grid, timeSignature));
    };
    const start = snapLoop(anchor, event.altKey);
    let gesture: 'loop' | 'zoom' | undefined;
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      const dx = next.clientX - event.clientX;
      const dy = next.clientY - event.clientY;
      if (!gesture) {
        if (hit ? Math.abs(dx) < 3 : Math.max(Math.abs(dx), Math.abs(dy)) < 3) return;
        gesture = hit || Math.abs(dx) >= Math.abs(dy) ? 'loop' : 'zoom';
        this.style.cursor = gesture === 'zoom' ? 'ns-resize' : 'ew-resize';
      }
      if (gesture === 'zoom') {
        const pxPerTick = clamp(view.pxPerTick * Math.exp(-dy * 0.02), ...ZOOM_LIMITS.pxPerTick);
        ed.setView({ pxPerTick, scrollTick: Math.max(0, anchor - point.x / pxPerTick) });
        return;
      }
      const edge = hit === 'start' ? loop.start : hit === 'end' ? loop.end : anchor;
      const tick = snapLoop(edge + dx / view.pxPerTick, next.altKey);
      if (hit === 'start') ed.transport.setLoop({ start: Math.min(tick, loop.end - 1), enabled: true });
      else if (hit === 'end') ed.transport.setLoop({ end: Math.max(tick, loop.start + 1), enabled: true });
      else if (tick !== start) ed.transport.setLoop({ start: Math.min(start, tick), end: Math.max(start, tick), enabled: true });
    };
    const finish = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      this.removeEventListener('pointermove', move);
      this.removeEventListener('pointerup', finish);
      this.removeEventListener('lostpointercapture', finish);
      this.style.cursor = '';
      if (next.type !== 'pointerup') return;
      move(next);
      this.onHover(next);
      if (gesture) return;
      if (hit) {
        ed.transport.setLoop({ enabled: !loop.enabled });
      } else {
        const tick = Math.max(0, snapTick(anchor, ed.ppq / 4, timeSignature));
        ed.transport.seek(tick);
        ed.setView({ cursor: tick });
      }
    };
    this.addEventListener('pointermove', move);
    this.addEventListener('pointerup', finish);
    this.addEventListener('lostpointercapture', finish);
  };

  protected draw(ctx: CanvasRenderingContext2D, now: number, ed: Editor, engine: Engine, p: Palette) {
    const { width: w, height: h } = this;
    const v = engine.displayView(now);
    const x = (t: number) => (t - v.scrollTick) * v.pxPerTick;
    ctx.fillStyle = p.surface;
    ctx.fillRect(0, 0, w, h);

    const loop = ed.transport.loop;
    if (loop.end > loop.start) {
      const start = x(loop.start);
      const width = x(loop.end) - start;
      if (loop.enabled) {
        ctx.fillStyle = withAlpha(p.accent, 0.12);
        ctx.fillRect(start, 0, width, h);
      }
      ctx.fillStyle = loop.enabled ? p.accent : p['text-faint'];
      roundRect(ctx, start, 2, width, 6, Math.min(3, width / 2));
      ctx.fill();
      if (width >= 2 * LOOP_HANDLE) {
        ctx.fillStyle = p.surface;
        ctx.fillRect(start + 3, 3, 1, 4);
        ctx.fillRect(start + width - 4, 3, 1, 4);
      }
    }

    // Ticks and bar numbers.
    const { ppq, meta } = ed;
    const to = v.scrollTick + w / v.pxPerTick;
    const bars = barsInRange(Math.max(0, v.scrollTick - ppq * 16), to, meta.timeSignature, ppq);
    const barPx = bars[0] ? ((ppq * 4 * bars[0].sig.numerator) / bars[0].sig.denominator) * v.pxPerTick : 100;
    const labelEvery = barPx >= 34 ? 1 : Math.pow(2, Math.ceil(Math.log2(34 / barPx)));
    ctx.font = `500 11px ${p.font}`;
    ctx.textBaseline = 'middle';
    for (const bar of bars) {
      const bx = x(bar.tick);
      const beat = beatLength(bar.sig, ppq);
      const beatPx = beat * v.pxPerTick;
      if (beatPx > 8) {
        ctx.fillStyle = withAlpha(p['text-faint'], clamp((beatPx - 8) / 12, 0, 1) * 0.8);
        for (let b = 1; b < bar.sig.numerator; b++) {
          const xx = bx + b * beatPx;
          if (xx >= 0 && xx <= w) ctx.fillRect(crisp(xx) - 0.5, h - 6, 1, 6);
        }
      }
      if ((bar.index - 1) % labelEvery) continue;
      if (bx < -40 || bx > w) continue;
      ctx.fillStyle = p['text-faint'];
      ctx.fillRect(crisp(bx) - 0.5, h - 10, 1, 8);
      ctx.fillStyle = p['text-muted'];
      ctx.fillText(String(bar.index), bx + 6, h / 2 + 1);
    }

    const px = Math.round(x(ed.transport.position));
    ctx.fillStyle = p.playhead;
    ctx.beginPath();
    ctx.moveTo(px - 4.5, h - 10);
    ctx.lineTo(px + 4.5, h - 10);
    ctx.lineTo(px, h - 1);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = p.border;
    ctx.fillRect(0, h - 1, w, 1);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'maddie-ruler': MaddieRuler;
  }
}
