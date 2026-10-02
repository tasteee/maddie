import type { Editor } from '../core';
import { clamp } from './ease';
import { Engine } from './engine';

/** Furthest the view can scroll right. */
export function maxScrollTick(editor: Editor) {
  const bar = editor.ppq * 4;
  return Math.max(editor.contentEnd() + bar * 16, bar * 64);
}

export function clampScrollRow(editor: Editor, row: number, rowHeight = editor.view.rowHeight) {
  return clamp(row, 0, Engine.for(editor).maxScrollRow(rowHeight));
}

/**
 * Shared wheel / trackpad handling.
 * - wheel / two-finger: scroll
 * - shift+wheel: horizontal scroll
 * - ⌘/ctrl+wheel or pinch: zoom time, anchored at the pointer
 * - alt+wheel: zoom rows, anchored at the pointer
 */
export function handleWheel(editor: Editor, e: WheelEvent, x: number, y: number, { vertical = true, horizontal = true } = {}) {
  e.preventDefault();
  const v = editor.view;
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  let dx = e.deltaX * unit;
  let dy = e.deltaY * unit;

  if ((e.ctrlKey || e.metaKey) && horizontal) {
    const factor = Math.exp(-clamp(dy, -80, 80) * 0.01);
    const anchor = v.scrollTick + x / v.pxPerTick;
    const px = v.pxPerTick * factor;
    editor.setView({ pxPerTick: px });
    const applied = editor.view.pxPerTick;
    editor.setView({ scrollTick: clamp(anchor - x / applied, 0, maxScrollTick(editor)) });
    return;
  }

  if (e.altKey && vertical) {
    const factor = Math.exp(-clamp(dy || dx, -80, 80) * 0.006);
    const anchor = (v.scrollRow ?? 0) + y / v.rowHeight;
    editor.setView({ rowHeight: v.rowHeight * factor });
    const rh = editor.view.rowHeight;
    editor.setView({ scrollRow: clampScrollRow(editor, anchor - y / rh, rh) });
    return;
  }

  if (e.shiftKey && !dx) {
    dx = dy;
    dy = 0;
  }
  const next: { scrollTick?: number; scrollRow?: number } = {};
  if (horizontal && dx) next.scrollTick = clamp(v.scrollTick + dx / v.pxPerTick, 0, maxScrollTick(editor));
  if (vertical && dy) next.scrollRow = clampScrollRow(editor, (v.scrollRow ?? 0) + dy / v.rowHeight);
  editor.setView(next);
}

/** Pixel-crisp 1px line position. */
export const crisp = (v: number) => Math.round(v) + 0.5;
