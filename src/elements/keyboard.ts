import { unsafeCSS } from 'lit';
import { customElement } from 'lit/decorators.js';
import { isBlackKey, pitchClass, displayPitch, ZOOM_LIMITS, type Editor } from '../core';
import type { Engine } from '../engine/engine';
import { clampScrollRow, handleWheel } from '../engine/interact';
import { CanvasElement } from './canvas-element';
import type { Palette } from './tokens';
import keyboardCss from './keyboard.css?raw';

@customElement('maddie-keyboard')
export class MaddieKeyboard extends CanvasElement {
  static styles = [
    ...CanvasElement.styles,
    unsafeCSS(keyboardCss),
  ];

  connectedCallback() {
    super.connectedCallback();
    this.title = 'Click to preview a note, drag up or down to resize rows.';
    this.addEventListener('pointerdown', this.previewOrResize);
    this.addEventListener('wheel', (event) => {
      if (this.ed) handleWheel(this.ed, event, 0, this.local(event).y, { horizontal: false });
    }, { passive: false });
  }

  private previewOrResize = (event: PointerEvent) => {
    const ed = this.ed;
    const engine = this.engine;
    const isPrimary = event.button === 0;
    if (!ed || !engine || !isPrimary) return;
    const pointerId = event.pointerId;
    this.setPointerCapture(pointerId);
    const view = engine.displayView(performance.now());
    const y = this.local(event).y;
    const anchor = view.scrollRow + y / view.rowHeight;
    const pitch = ed.rowMap.pitchAt(anchor);
    let isDragging = false;
    const move = (next: PointerEvent) => {
      const isSamePointer = next.pointerId === pointerId;
      if (!isSamePointer) return;
      const difference = event.clientY - next.clientY;
      if (Math.abs(difference) >= 3) isDragging = true;
      if (!isDragging) return;
      const rowHeight = Math.min(ZOOM_LIMITS.rowHeight[1], Math.max(ZOOM_LIMITS.rowHeight[0], view.rowHeight + Math.trunc(difference / 8)));
      const scrollRow = clampScrollRow(ed, anchor - y / rowHeight, rowHeight);
      ed.setView({ rowHeight, scrollRow });
    };
    const preview = (next: PointerEvent) => {
      const shouldPreview = !isDragging && next.pointerId === pointerId && ed.rowMap.length > 0;
      if (!shouldPreview) return;
      ed.audition(pitch);
      const notes = ed.notes().filter((note) => note.pitch === pitch);
      const shouldAdd = event.shiftKey || event.metaKey || event.ctrlKey;
      if (notes.length) ed.select(notes.map((note) => note.id), shouldAdd ? 'add' : 'replace');
    };
    const finish = (next: PointerEvent) => {
      const isSamePointer = next.pointerId === pointerId;
      if (!isSamePointer) return;
      this.removeEventListener('pointermove', move);
      this.removeEventListener('pointerup', preview);
      this.removeEventListener('lostpointercapture', finish);
    };
    this.addEventListener('pointermove', move);
    this.addEventListener('pointerup', preview);
    this.addEventListener('lostpointercapture', finish);
  };

  protected draw(ctx: CanvasRenderingContext2D, now: number, ed: Editor, engine: Engine, p: Palette) {
    const w = this.width;
    const h = this.height;
    const view = engine.displayView(now);
    const rowHeight = view.rowHeight;
    const rows = engine.rows;
    const isFolded = ed.view.fold === 'used' || (ed.view.fold === 'scale' && Boolean(ed.key));
    const sounding = new Set(engine.held);
    if (ed.transport.playing) {
      const pos = ed.transport.position;
      for (const entry of ed.notesAllTracks(pos, pos + 1, { audibleOnly: true })) {
        if (!entry.note.muted) sounding.add(entry.note.pitch);
      }
    }

    ctx.fillStyle = p['key-white'];
    ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.font = `500 10px ${p.font}`;

    for (const pitch of rows.pitches()) {
      const y = (rows.rowOf(pitch, now) - view.scrollRow) * rowHeight;
      const isOffscreen = y > h || y + rowHeight < 0;
      if (isOffscreen) continue;
      const alpha = rows.alphaOf(pitch, now);
      if (alpha <= 0.01) continue;
      const isC = pitchClass(pitch) === 0;
      const isBlack = isBlackKey(pitch);
      const isSounding = sounding.has(pitch);
      ctx.globalAlpha = alpha;
      if (isSounding) {
        ctx.fillStyle = p.accent;
        ctx.fillRect(0, y, w, rowHeight);
      }
      if (isBlack) {
        ctx.fillStyle = p['key-black'];
        ctx.beginPath();
        ctx.roundRect(0, y, 30, rowHeight - 1, [0, 3, 3, 0]);
        ctx.fill();
      }
      ctx.fillStyle = isC ? p.border : p['line-row'];
      ctx.fillRect(0, Math.round(y + rowHeight) - 1, w, 1);
      const shouldLabel = rowHeight >= 10 ? isFolded || isC : rowHeight >= 2 && isC && !isFolded;
      if (shouldLabel) {
        ctx.fillStyle = isSounding ? p['note-text'] : p['text-faint'];
        ctx.fillText(displayPitch(pitch), w - 6, y + rowHeight / 2);
      }
    }
    ctx.textAlign = 'start';
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.border;
    ctx.fillRect(w - 1, 0, 1, h);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'maddie-keyboard': MaddieKeyboard;
  }
}
