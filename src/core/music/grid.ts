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
  { value: '1/4.', label: '1/4 ·' },
  { value: '1/8.', label: '1/8 ·' },
  { value: '1/16.', label: '1/16 ·' },
];

/**
 * How a division is bent: `straight` (`'1/8'`), `triplet` (`'1/8T'`, two thirds as long)
 * or `dotted` (`'1/8.'`, half again as long).
 */
export type GridModifier = 'straight' | 'triplet' | 'dotted';

export const GRID_MODIFIERS: readonly GridModifier[] = ['straight', 'triplet', 'dotted'];

const MODIFIER_SUFFIX: Record<GridModifier, string> = { straight: '', triplet: 'T', dotted: '.' };

/** Is this a triplet grid (`'1/8T'`)? */
export const isTripletGrid = (grid: GridValue): boolean => /^1\/\d+T$/.test(grid);

/** Is this a dotted grid (`'1/8.'`)? */
export const isDottedGrid = (grid: GridValue): boolean => /^1\/\d+\.$/.test(grid);

/** Which modifier a grid has. `auto` and `bar` are `straight`. */
export const getGridModifier = (grid: GridValue): GridModifier => {
  if (isTripletGrid(grid)) return 'triplet';
  if (isDottedGrid(grid)) return 'dotted';
  return 'straight';
};

/** Only divisions (`'1/8'`, `'1/8T'`, `'1/8.'`) can be bent. Not auto or bar. */
export const canHaveModifier = (grid: GridValue): boolean => /^1\/\d+[T.]?$/.test(grid);

/** The grid without its modifier: `'1/8T'` and `'1/8.'` → `'1/8'`. Other grids are unchanged. */
export const getStraightGrid = (grid: GridValue): GridValue => (canHaveModifier(grid) ? grid.replace(/[T.]$/, '') : grid);

/** Set the modifier, keeping the size. Grids that cannot be bent are unchanged. */
export const setGridModifier = (grid: GridValue, modifier: GridModifier): GridValue => {
  if (!canHaveModifier(grid)) return grid;
  return `${getStraightGrid(grid)}${MODIFIER_SUFFIX[modifier]}`;
};

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

/** The next grid line past `tick` in a direction. Off-grid ticks land on the nearest line that way. */
export function stepGrid(tick: Tick, grid: number, sigs: readonly TimeSigEvent[], dir: -1 | 1): Tick {
  const line = snapTick(tick, grid, sigs, dir < 0 ? 'ceil' : 'floor');
  return Math.max(0, snapTick(line + dir * grid, grid, sigs));
}
