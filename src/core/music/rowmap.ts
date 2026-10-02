import type { Key } from '../types';
import { isBlackKey, MAX_PITCH, MIN_PITCH } from './pitch';
import { inScale } from './scale';

export type FoldMode = 'none' | 'scale' | 'used';

export interface Row {
  pitch: number;
  inScale: boolean;
  black: boolean;
}

/**
 * Maps screen rows ↔ pitches. Row 0 is the top (highest pitch).
 * Every vertical calculation goes through this, so folding works everywhere.
 */
export class RowMap {
  readonly rows: readonly Row[];
  private readonly index = new Int16Array(128).fill(-1);
  /** Fractional row for every pitch, including folded-away ones (they sit between neighbours). */
  readonly virtual = new Float32Array(128);

  constructor(pitches: readonly number[], key: Key | null) {
    const sorted = [...new Set(pitches)].sort((a, b) => b - a);
    this.rows = sorted.map((pitch) => ({ pitch, inScale: inScale(pitch, key), black: isBlackKey(pitch) }));
    this.rows.forEach((r, i) => (this.index[r.pitch] = i));
    for (let p = MIN_PITCH; p <= MAX_PITCH; p++) this.virtual[p] = this.computeVirtual(p);
  }

  get length() {
    return this.rows.length;
  }

  /** Row of a pitch, or `null` if folded away. */
  rowOf(pitch: number): number | null {
    const r = this.index[pitch];
    return r === undefined || r < 0 ? null : r;
  }

  /** Pitch at a row. Clamps to the map's range. */
  pitchAt(row: number): number {
    const r = Math.max(0, Math.min(this.rows.length - 1, Math.floor(row)));
    return this.rows[r]?.pitch ?? 60;
  }

  has(pitch: number) {
    return this.rowOf(pitch) !== null;
  }

  private computeVirtual(pitch: number): number {
    const row = this.rowOf(pitch);
    if (row !== null) return row;
    for (let p = pitch + 1; p <= MAX_PITCH; p++) {
      const r = this.rowOf(p);
      if (r !== null) return r + 0.5;
    }
    for (let p = pitch - 1; p >= MIN_PITCH; p--) {
      const r = this.rowOf(p);
      if (r !== null) return r - 0.5;
    }
    return 0;
  }
}

export interface RowMapOptions {
  fold: FoldMode;
  key: Key | null;
  used?: Iterable<number>;
  min?: number;
  max?: number;
}

export function buildRowMap({ fold, key, used = [], min = MIN_PITCH, max = MAX_PITCH }: RowMapOptions): RowMap {
  const all: number[] = [];
  for (let p = max; p >= min; p--) all.push(p);
  if (fold === 'scale' && key) return new RowMap(all.filter((p) => inScale(p, key)), key);
  if (fold === 'used') {
    const set = [...used];
    if (set.length) return new RowMap(set, key);
  }
  return new RowMap(all, key);
}
