import { css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { inScale, isBlackKey, pitchClass, pitchName, type Editor } from '../core';
import type { Engine } from '../engine/engine';
import { handleWheel } from '../engine/interact';
import { mix, withAlpha } from '../engine/theme';
import { CanvasElement } from './canvas-element';
import { roundRect } from './paint';
import type { Palette } from './tokens';

/** Piano keys / row labels. Follows fold and scroll. Click or drag to audition. */
@customElement('maddie-keyboard')
export class MaddieKeyboard extends CanvasElement {
  static styles = [
    ...CanvasElement.styles,
    css`
      :host {
        width: var(--_keyboard-width);
        cursor: pointer;
        background: var(--_key-white);
      }
    `,
  ];

  private hoverPitch: number | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('aria-hidden', 'true');
    this.addEventListener('pointerdown', this.onDown);
    this.addEventListener('pointermove', this.onMove);
    this.addEventListener('pointerleave', () => {
      this.hoverPitch = null;
      this.engine?.invalidate();
    });
    this.addEventListener('wheel', (e) => this.ed && handleWheel(this.ed, e, 0, this.local(e).y, { horizontal: false }), {
      passive: false,
    });
  }

  private pitchAt(y: number) {
    const ed = this.ed!;
    return ed.rowMap.pitchAt((ed.view.scrollRow ?? 0) + y / ed.view.rowHeight);
  }

  private onMove = (e: PointerEvent) => {
    if (!this.ed) return;
    const pitch = this.pitchAt(this.local(e).y);
    if (pitch !== this.hoverPitch) {
      this.hoverPitch = pitch;
      this.engine?.invalidate();
    }
  };

  private onDown = (e: PointerEvent) => {
    const ed = this.ed;
    const engine = this.engine;
    if (!ed || !engine || e.button !== 0) return;
    this.setPointerCapture(e.pointerId);
    let current = this.pitchAt(this.local(e).y);
    const velocity = 0.25 + 0.75 * Math.min(1, this.local(e).x / this.width);
    const press = (pitch: number) => {
      engine.held = new Set([pitch]);
      ed.audition(pitch, velocity);
      engine.invalidate();
    };
    press(current);
    const move = (ev: PointerEvent) => {
      const pitch = this.pitchAt(this.local(ev).y);
      if (pitch !== current) press((current = pitch));
    };
    const up = () => {
      engine.held = new Set();
      engine.invalidate();
      this.removeEventListener('pointermove', move);
      this.removeEventListener('pointerup', up);
      this.removeEventListener('pointercancel', up);
    };
    this.addEventListener('pointermove', move);
    this.addEventListener('pointerup', up);
    this.addEventListener('pointercancel', up);
  };

  protected draw(ctx: CanvasRenderingContext2D, now: number, ed: Editor, engine: Engine, p: Palette) {
    const { width: w, height: h } = this;
    const v = engine.displayView(now);
    const rh = v.rowHeight;
    const rows = engine.rows;
    const key = ed.key;
    const highlight = ed.view.scaleHighlight && key;
    const piano = ed.view.fold === 'none';

    // Pitches sounding under the playhead.
    const sounding = new Set(engine.held);
    if (ed.transport.playing) {
      const pos = ed.transport.position;
      for (const n of ed.notesInRange(pos, pos + 1)) sounding.add(n.pitch);
    }

    ctx.fillStyle = p['key-white'];
    ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = 'middle';

    for (const pitch of rows.pitches()) {
      const y = (rows.rowOf(pitch, now) - v.scrollRow) * rh;
      if (y > h || y + rh < 0) continue;
      const alpha = rows.alphaOf(pitch, now);
      if (alpha <= 0.01) continue;
      ctx.globalAlpha = alpha;
      const black = isBlackKey(pitch);
      const out = highlight && !inScale(pitch, key);
      const on = sounding.has(pitch);
      const hovered = this.hoverPitch === pitch;
      const pc = pitchClass(pitch);

      if (piano && black) {
        const kw = Math.round(w * 0.58);
        ctx.fillStyle = on ? p.accent : hovered ? mix(p['key-black'], p.accent, 0.35) : p['key-black'];
        roundRect(ctx, 0, y + 0.5, kw, rh - 1, 2.5);
        ctx.fill();
        if (out && !on) {
          ctx.fillStyle = withAlpha(p['key-black'], 0.55);
          ctx.fill();
        }
      } else {
        if (on || hovered) {
          ctx.fillStyle = on ? p.accent : p.hover;
          ctx.fillRect(0, y, w, rh);
        } else if (!piano && black) {
          ctx.fillStyle = p['row-black'];
          ctx.fillRect(0, y, w, rh);
        }
        if (out && !on) {
          ctx.fillStyle = withAlpha(p['row-out'], 0.75);
          ctx.fillRect(0, y, w, rh);
        }
      }

      // Separators: where two white keys meet (B|C, E|F), or every row when folded.
      if (!piano || pc === 0 || pc === 5) {
        ctx.fillStyle = pc === 0 ? p['line-beat'] : p['line-row'];
        ctx.fillRect(0, Math.round(y + rh) - 1, w, 1);
      }

      // Labels: every C on a piano; every row when folded.
      const isRoot = key && pc === key.root;
      if ((piano && pc === 0) || (!piano && rh >= 12)) {
        ctx.font = `${pc === 0 ? 600 : 500} ${Math.min(10.5, rh - 3)}px ${p.font}`;
        ctx.fillStyle = on ? p['note-text'] : isRoot ? p.accent : pc === 0 ? p['text-muted'] : p['text-faint'];
        const label = pitchName(pitch);
        const tw = ctx.measureText(label).width;
        ctx.fillText(label, w - tw - 8, y + rh / 2 + 0.5);
      } else if (isRoot && !on && rh >= 8) {
        ctx.fillStyle = p.accent;
        ctx.beginPath();
        ctx.arc(w - 10, y + rh / 2, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Edge against the roll.
    ctx.fillStyle = p.border;
    ctx.fillRect(w - 1, 0, 1, h);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'maddie-keyboard': MaddieKeyboard;
  }
}
