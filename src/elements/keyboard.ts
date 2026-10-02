import { css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { inScale, isBlackKey, pitchClass, pitchName, type Editor } from '../core';
import type { Engine } from '../engine/engine';
import { keyLabelsByPitch } from '../engine/computer-keyboard';
import { handleWheel } from '../engine/interact';
import { mix, withAlpha } from '../engine/theme';
import { CanvasElement } from './canvas-element';
import { noteBase, roundRect } from './paint';
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

    // Two channels, never mixed:
    //   black / white key → key shape (full piano, or a stub on the left when folded)
    //   in / out of scale → row shade (matches the grid) + a dot on every in-scale key; root gets a bigger dot.
    const kw = Math.round(w * 0.5);
    const stub = Math.min(14, Math.round(w * 0.22));
    // Dots sit at the far end of the keys, clear of the labels (and of the computer-keyboard chips when shown).
    const dotX = ed.view.computerKeyboard && rh >= 10 ? Math.min(kw - 5, 28) : 8;
    const rootTint = withAlpha(p.scale, p.dark ? 0.2 : 0.12);

    for (const pitch of rows.pitches()) {
      const y = (rows.rowOf(pitch, now) - v.scrollRow) * rh;
      if (y > h || y + rh < 0) continue;
      const alpha = rows.alphaOf(pitch, now);
      if (alpha <= 0.01) continue;
      ctx.globalAlpha = alpha;
      const black = isBlackKey(pitch);
      const pc = pitchClass(pitch);
      const out = highlight && !inScale(pitch, key);
      const isRoot = !!highlight && pc === key.root;
      const on = sounding.has(pitch);
      const hovered = this.hoverPitch === pitch;
      const color = noteBase(p, pitch, ed.view.noteColor, false);

      // Row background: the scale.
      if (on) {
        ctx.fillStyle = color;
        ctx.fillRect(0, y, w, rh);
      } else {
        if (out) {
          ctx.fillStyle = p['key-out'];
          ctx.fillRect(0, y, w, rh);
        } else if (isRoot) {
          ctx.fillStyle = rootTint;
          ctx.fillRect(0, y, w, rh);
        }
        if (hovered) {
          ctx.fillStyle = p.hover;
          ctx.fillRect(0, y, w, rh);
        }
      }

      // Key shape: black or white.
      if (black) {
        const bw = piano ? kw : stub;
        ctx.fillStyle = on ? mix(color, p['key-black'], 0.35) : hovered ? mix(p['key-black'], p.text, 0.25) : p['key-black'];
        roundRect(ctx, 0, y + (piano ? 0.5 : 1.5), bw, rh - (piano ? 1 : 3), piano ? 2.5 : 2);
        ctx.fill();
        // In dark themes a black key can sink into an out-of-scale row; a hairline keeps its shape.
        if (p.dark && !on) {
          ctx.strokeStyle = withAlpha(p.text, 0.12);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // Separators: where two white keys meet (B|C, E|F), or every row when folded.
      if (!piano || pc === 0 || pc === 5) {
        ctx.fillStyle = pc === 0 ? p['line-beat'] : p['line-row'];
        ctx.fillRect(0, Math.round(y + rh) - 1, w, 1);
      }

      // Scale marker: dot on every in-scale key, ringed dot on the root.
      if (highlight && !out && rh >= 7) {
        const cy = y + rh / 2;
        const onBlackKey = piano && black;
        const r = isRoot ? Math.min(3.5, rh / 2 - 1.5) : Math.min(2.25, rh / 2 - 2);
        ctx.beginPath();
        ctx.arc(dotX, cy, Math.max(1.25, r), 0, Math.PI * 2);
        ctx.fillStyle = on ? p['note-text'] : onBlackKey && !isRoot ? mix(p.scale, '#ffffff', 0.35) : p.scale;
        ctx.fill();
        if (isRoot && rh >= 12) {
          ctx.beginPath();
          ctx.arc(dotX, cy, r + 2, 0, Math.PI * 2);
          ctx.strokeStyle = on ? p['note-text'] : p.scale;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // Labels: every row when there's room; otherwise the Cs and the root.
      if (pc === 0 || isRoot || rh >= 12) {
        const size = Math.min(10.5, rh - 3);
        const weight = isRoot ? 700 : out ? 400 : pc === 0 || highlight ? 600 : 500;
        ctx.font = `${weight} ${size}px ${p.font}`;
        ctx.fillStyle = on
          ? p['note-text']
          : isRoot
            ? p.scale
            : out
              ? p['text-faint']
              : highlight
                ? p.text
                : pc === 0
                  ? p['text-muted']
                  : p['text-faint'];
        const label = pitchName(pitch);
        const tw = ctx.measureText(label).width;
        ctx.fillText(label, w - tw - 6, y + rh / 2 + 0.5);
      }
      ctx.globalAlpha = 1;
    }

    // Computer-keyboard hints: which key plays each row. Same chip on every row, piano or folded.
    if (ed.view.computerKeyboard && rh >= 10) {
      const labels = keyLabelsByPitch(ed);
      ctx.font = `600 ${Math.min(10, rh - 4)}px ${p.fontMono}`;
      for (const pitch of rows.pitches()) {
        const label = labels.get(pitch);
        if (!label) continue;
        const y = (rows.rowOf(pitch, now) - v.scrollRow) * rh;
        if (y > h || y + rh < 0) continue;
        const tw = ctx.measureText(label).width;
        const cw = Math.max(tw + 7, rh - 4);
        ctx.globalAlpha = rows.alphaOf(pitch, now);
        roundRect(ctx, 4, y + 2, cw, rh - 4, 3);
        ctx.fillStyle = p['key-white'];
        ctx.fill();
        ctx.strokeStyle = p.border;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = p.text;
        ctx.fillText(label, 4 + (cw - tw) / 2, y + rh / 2 + 0.5);
      }
      ctx.globalAlpha = 1;
    }

    // Color legend: a thin strip per row, so pitch colors read like a key.
    if (ed.view.noteColor !== 'mono') {
      for (const pitch of rows.pitches()) {
        const y = (rows.rowOf(pitch, now) - v.scrollRow) * rh;
        if (y > h || y + rh < 0) continue;
        ctx.globalAlpha = rows.alphaOf(pitch, now) * 0.9;
        ctx.fillStyle = noteBase(p, pitch, ed.view.noteColor, false);
        ctx.fillRect(w - 4, y + 1, 3, rh - 2);
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
