import type { Tick, TimeSigEvent } from '../types';
import { timeSigAt } from './timeline';

/**
 * `'1/16'` straight, `'1/8T'` triplet, `'1/8.'` dotted, `'bar'`, or `'auto'` (follows zoom).
 */
export type GridValue = string;

export const GRID_OPTIONS: { value: GridValue; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'bar', label: '1 Bar' },
  { value: '1/2', label: '1/2' },
  { value: '1/4', label: '1/4' },
  { value: '1/8', label: '1/8' },
  { value: '1/16', label: '1/16' },
  { value: '1/32', label: '1/32' },
  { value: '1/64', label: '1/64' },
  { value: '1/4T', label: '1/4 T' },
  { value: '1/8T', label: '1/8 T' },
  { value: '1/16T', label: '1/16 T' },
  { value: '1/8.', label: '1/8 ·' },
  { value: '1/16.', label: '1/16 ·' },
];

/** Grid size in ticks. `null` for `'auto'` (resolve with `autoGridTicks`). */
export function gridTicks(grid: GridValue, ppq: number, sig?: TimeSigEvent): number | null {
  if (grid === 'auto') return null;
  if (grid === 'bar') return sig ? (ppq * 4 * sig.numerator) / sig.denominator : ppq * 4;
  const m = /^1\/(\d+)([T.]?)$/.exec(grid);
  if (!m) return ppq / 4;
  let ticks = (ppq * 4) / Number(m[1]);
  if (m[2] === 'T') ticks = (ticks * 2) / 3;
  if (m[2] === '.') ticks = ticks * 1.5;
  return ticks;
}

const AUTO_STEPS = [64, 32, 16, 8, 4, 2, 1];

/** Finest straight division that keeps grid lines at least `minPx` apart. */
export function autoGridTicks(ppq: number, pxPerTick: number, minPx = 14): number {
  for (const div of AUTO_STEPS) {
    const ticks = (ppq * 4) / div;
    if (ticks * pxPerTick >= minPx) return ticks;
  }
  let ticks = ppq * 4;
  while (ticks * pxPerTick < minPx) ticks *= 2;
  return ticks;
}

export function resolveGrid(grid: GridValue, ppq: number, pxPerTick: number, sig?: TimeSigEvent): number {
  return gridTicks(grid, ppq, sig) ?? autoGridTicks(ppq, pxPerTick);
}

export type SnapMode = 'round' | 'floor' | 'ceil';

/** Snap a tick to the grid. The grid is anchored to the active time signature's start. */
export function snapTick(
  tick: Tick,
  grid: number,
  sigs: readonly TimeSigEvent[] = [],
  mode: SnapMode = 'round',
): Tick {
  const anchor = sigs.length ? timeSigAt(tick, sigs).tick : 0;
  const steps = (tick - anchor) / grid;
  const n = mode === 'floor' ? Math.floor(steps) : mode === 'ceil' ? Math.ceil(steps) : Math.round(steps);
  return Math.round(anchor + n * grid);
}
