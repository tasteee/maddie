import { barsInRange, pitchClass, resolveGrid, snapTick, timeSigAt, type Editor, type Note, type NoteColorMode } from '../core';
import type { NoteDisplay } from '../engine/animation';
import { clamp, easeOut } from '../engine/ease';
import type { DisplayView, Engine } from '../engine/engine';
import { crisp } from '../engine/interact';
import { mix, normalizeColor, withAlpha } from '../engine/theme';
import type { Palette } from './tokens';

export interface NoteState {
  selected: boolean;
  hovered: boolean;
  /** 0–1 flash while the playhead crosses the note. */
  playing: number;
}

export interface NoteStyle {
  fill?: string;
  outline?: string;
}

// Most music lives here; notes outside clamp to the ends.
const PITCH_LOW = 24; // C1
const PITCH_HIGH = 88; // E6

/**
 * Base color for a note in the current color mode.
 * `pitch`: hue sweeps C1 → E6 (clamped), lightness lifts slightly with pitch.
 * `pitch-class`: 12 hues, every C the same.
 */
export function noteBase(p: Palette, pitch: number, mode: NoteColorMode, selected: boolean): string {
  if (mode === 'mono') return selected ? p['note-selected'] : p.note;
  const key = `${mode}:${mode === 'pitch' ? Math.round(pitch) : pitchClass(Math.round(pitch))}`;
  let c = p.pitchCache.get(key);
  if (!c) {
    const { lightness, chroma, hueLow, hueHigh } = p.pitch;
    let t: number;
    let l = lightness;
    if (mode === 'pitch') {
      t = clamp((pitch - PITCH_LOW) / (PITCH_HIGH - PITCH_LOW), 0, 1);
      l = lightness - 0.06 + t * 0.12;
    } else {
      t = pitchClass(Math.round(pitch)) / 12;
    }
    // Linear (the long way round the wheel): 265 → 15 sweeps indigo, cyan, green, yellow, orange, red.
    const hue = (((mode === 'pitch' ? hueLow + (hueHigh - hueLow) * t : hueLow + t * 360) % 360) + 360) % 360;
    c = normalizeColor(`oklch(${l} ${chroma} ${hue})`);
    p.pitchCache.set(key, c);
  }
  return c;
}

/** Fill for a note: base color, faded by velocity, lit while playing or hovered. */
export function noteFill(p: Palette, base: string, note: { velocity: number; muted?: boolean }, state: NoteState) {
  const vel = state.selected ? 1 : p.noteMinOpacity + (1 - p.noteMinOpacity) * note.velocity;
  let color = withAlpha(base, note.muted ? vel * 0.3 : vel);
  if (state.hovered && !state.selected) color = mix(color, withAlpha(base, 1), 0.4);
  if (state.playing > 0) color = mix(withAlpha(base, 1), p.dark ? 'rgba(255,255,255,1)' : 'rgba(0,0,0,1)', 0.28 * state.playing);
  return color;
}

// How strongly a ghost note shows. Muted tracks sit further back than playing ones.
const GHOST_EDGE_ALPHA = 0.45;
const GHOST_MUTED_EDGE_ALPHA = 0.3;

/** Track colors are CSS colors. Canvas needs rgba, and the conversion is slow, so each is converted once. */
export function resolveTrackColor(p: Palette, color: string): string {
  const cacheKey = `track:${color}`;
  const cached = p.pitchCache.get(cacheKey);
  if (cached) return cached;
  const token = /^var\((--accent-spark-[1-5])\)$/.exec(color)?.[1];
  const value = token ? p.trackTokens.getPropertyValue(token).trim() : color;
  const resolved = normalizeColor(value);
  p.pitchCache.set(cacheKey, resolved);
  return resolved;
}

/**
 * Notes of the other tracks, in their own colors, drawn behind the active track.
 * Read-only: they never take part in hit-testing or selection.
 */
export function drawGhostNotes(
  ctx: CanvasRenderingContext2D,
  engine: Engine,
  v: DisplayView,
  p: Palette,
  width: number,
  height: number,
  now: number,
) {
  const from = v.scrollTick;
  const to = from + width / v.pxPerTick;
  const ghosts = engine.editor.view.ghostNotes ? engine.ghostNotes(from, to) : [];
  const rowHeight = v.rowHeight;
  const radius = p.noteRadius;
  const inner = Math.max(2, rowHeight - 2);
  ctx.lineWidth = 1;
  for (const ghost of ghosts) {
    const note = ghost.note;
    const rowAlpha = engine.rows.alphaOf(Math.round(note.pitch), now);
    if (rowAlpha <= 0.01) continue;
    const x = (note.start - v.scrollTick) * v.pxPerTick;
    const noteWidth = Math.max(3, note.duration * v.pxPerTick);
    const row = engine.rows.rowOf(note.pitch, now);
    const y = (row - v.scrollRow) * rowHeight + 1;
    const isOffscreen = x > width || x + noteWidth < 0 || y > height || y + inner < 0;
    if (isOffscreen) continue;
    const color = resolveTrackColor(p, ghost.color);
    const edgeAlpha = ghost.isAudible ? GHOST_EDGE_ALPHA : GHOST_MUTED_EDGE_ALPHA;
    ctx.globalAlpha = rowAlpha;
    ctx.strokeStyle = withAlpha(color, edgeAlpha);
    roundRect(ctx, x + 0.5, y + 0.5, Math.max(0, noteWidth - 3), inner - 1, radius);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** How bright a note flashes while the playhead is on it. */
export function playingFlash(editor: Editor, note: Note, position: number): number {
  if (!editor.transport.playing) return 0;
  if (position < note.start || position >= note.start + note.duration) return 0;
  return 0.35 + 0.65 * (1 - easeOut(clamp((position - note.start) / (editor.ppq / 2), 0, 1)));
}

/** Vertical grid: subdivisions, beats, bars. Lines fade in/out with zoom. */
export function drawTimeGrid(
  ctx: CanvasRenderingContext2D,
  editor: Editor,
  engine: Engine,
  v: DisplayView,
  p: Palette,
  width: number,
  top: number,
  height: number,
  now: number,
) {
  const { ppq, meta } = editor;
  const from = v.scrollTick;
  const to = from + width / v.pxPerTick;
  const bars = barsInRange(Math.max(0, from - ppq * 16), to, meta.timeSignature, ppq);
  const grid = resolveGrid(editor.view.grid, ppq, v.pxPerTick, bars[0]?.sig);
  const subPx = grid * v.pxPerTick;
  const gridFade = easeOut(clamp((now - engine.gridChangedAt) / engine.motion.slow, 0, 1));
  const subAlpha = subPx >= MIN_LINE_PX ? gridFade : 0;
  const showBeats = ppq * v.pxPerTick >= MIN_LINE_PX;
  const x = (t: number) => (t - from) * v.pxPerTick;

  ctx.lineWidth = 1;
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const barLen = (bars[i + 1]?.tick ?? bar.tick + (ppq * 4 * bar.sig.numerator) / bar.sig.denominator) - bar.tick;
    const beat = ppq;
    // Subdivisions.
    if (subAlpha > 0.01) {
      ctx.strokeStyle = withAlpha(p['line-sub'], subAlpha);
      ctx.beginPath();
      for (let t = bar.tick + grid; t < bar.tick + barLen - 0.5; t += grid) {
        if (Math.abs((t - bar.tick) % beat) < 0.5) continue;
        const xx = x(t);
        if (xx < -1 || xx > width + 1) continue;
        ctx.moveTo(crisp(xx), top);
        ctx.lineTo(crisp(xx), top + height);
      }
      ctx.stroke();
    }
    // Beats.
    if (showBeats) {
      ctx.strokeStyle = p['line-beat'];
      ctx.beginPath();
      for (let t = bar.tick + beat; t < bar.tick + barLen - 0.5; t += beat) {
        const xx = x(t);
        if (xx < -1 || xx > width + 1) continue;
        ctx.moveTo(crisp(xx), top);
        ctx.lineTo(crisp(xx), top + height);
      }
      ctx.stroke();
    }
  }
  // Bars (thinned when zoomed far out).
  const barPx = (bars[0] ? (ppq * 4 * bars[0].sig.numerator) / bars[0].sig.denominator : ppq * 4) * v.pxPerTick;
  const every = barPx >= MIN_BAR_PX ? 1 : Math.pow(2, Math.ceil(Math.log2(MIN_BAR_PX / barPx)));
  ctx.strokeStyle = p['line-bar'];
  ctx.beginPath();
  for (const bar of bars) {
    if ((bar.index - 1) % every) continue;
    const xx = x(bar.tick);
    if (xx < -1 || xx > width + 1) continue;
    ctx.moveTo(crisp(xx), top);
    ctx.lineTo(crisp(xx), top + height);
  }
  ctx.stroke();
}

// The grid's drawing thresholds, shared with snapping so nothing snaps to a hidden line.
const MIN_LINE_PX = 4;
const MIN_BAR_PX = 12;

/**
 * The drawn grid line nearest `tick`: bar lines (thinned when zoomed out), beat lines,
 * and subdivisions, each only while the grid draws it at this zoom.
 */
export function nearestVisibleLine(editor: Editor, tick: number, pxPerTick: number): number {
  const { ppq, meta } = editor;
  const sigs = meta.timeSignature;
  const near = barsInRange(Math.max(0, tick - ppq * 32), tick + ppq * 32, sigs, ppq);
  const firstSig = near[0]?.sig;
  const barTicks = firstSig ? (ppq * 4 * firstSig.numerator) / firstSig.denominator : ppq * 4;
  const barPx = barTicks * pxPerTick;
  const barEvery = barPx >= MIN_BAR_PX ? 1 : Math.pow(2, Math.ceil(Math.log2(MIN_BAR_PX / barPx)));
  const candidates = near.filter((bar) => (bar.index - 1) % barEvery === 0).map((bar) => bar.tick);

  const areBeatsDrawn = ppq * pxPerTick >= MIN_LINE_PX;
  if (areBeatsDrawn) candidates.push(snapTick(tick, ppq, sigs));
  const grid = resolveGrid(editor.view.grid, ppq, pxPerTick, timeSigAt(Math.max(0, tick), sigs));
  const areSubdivisionsDrawn = grid * pxPerTick >= MIN_LINE_PX;
  if (areSubdivisionsDrawn) candidates.push(snapTick(tick, grid, sigs));

  const hasCandidates = candidates.length > 0;
  if (!hasCandidates) return Math.max(0, Math.round(tick));
  let nearest = candidates[0];
  for (const candidate of candidates) {
    const isCloser = Math.abs(candidate - tick) < Math.abs(nearest - tick);
    if (isCloser) nearest = candidate;
  }
  return Math.max(0, nearest);
}

/** Loop region tint. */
export function drawLoop(ctx: CanvasRenderingContext2D, editor: Editor, v: DisplayView, p: Palette, height: number, alpha = 0.025) {
  const loop = editor.transport.loop;
  if (!loop.enabled || loop.end <= loop.start) return;
  const x0 = (loop.start - v.scrollTick) * v.pxPerTick;
  const x1 = (loop.end - v.scrollTick) * v.pxPerTick;
  ctx.fillStyle = withAlpha(p.loop, alpha);
  ctx.fillRect(x0, 0, x1 - x0, height);
}

/** Playhead line. Dimmed while stopped. */
export function drawPlayhead(ctx: CanvasRenderingContext2D, editor: Editor, v: DisplayView, p: Palette, height: number) {
  const pos = editor.transport.position;
  const x = (pos - v.scrollTick) * v.pxPerTick;
  ctx.fillStyle = p.playhead;
  ctx.fillRect(Math.round(x), 0, 1, height);
}

/** Rounded rect path (radius clamped to size). */
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, rr);
}

export type { NoteDisplay };
