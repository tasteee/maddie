import type { RowMap } from '../core';
import { clamp, easeInOut, lerp } from './ease';

/** Animated row positions, so folding glides instead of jumping. */
export class RowLayout {
  private prev: RowMap | null = null;
  private t0 = 0;
  private dur = 0;

  constructor(public map: RowMap) {}

  /** Returns true if the rows actually changed. */
  update(map: RowMap, dur: number, now: number): boolean {
    if (map === this.map) return false;
    const same =
      map.length === this.map.length && map.rows.every((r, i) => r.pitch === this.map.rows[i].pitch && r.inScale === this.map.rows[i].inScale);
    if (same) {
      this.map = map;
      return false;
    }
    this.prev = dur > 0 ? this.map : null;
    this.map = map;
    this.t0 = now;
    this.dur = dur;
    return true;
  }

  private progress(now: number) {
    if (!this.prev || this.dur <= 0) return 1;
    const t = clamp((now - this.t0) / this.dur, 0, 1);
    if (t >= 1) this.prev = null;
    return easeInOut(t);
  }

  /** Row (fractional) for a pitch (fractional ok). Row 0 = top. */
  rowOf(pitch: number, now: number): number {
    const lo = Math.floor(pitch);
    const f = pitch - lo;
    const at = (p: number) => {
      const c = Math.max(0, Math.min(127, p));
      const t = this.progress(now);
      const next = this.map.virtual[c];
      return t >= 1 || !this.prev ? next : lerp(this.prev.virtual[c], next, t);
    };
    return f === 0 ? at(lo) : lerp(at(lo), at(lo + 1), f);
  }

  /** Visibility of a pitch's row (1 = shown, 0 = folded away). */
  alphaOf(pitch: number, now: number): number {
    const t = this.progress(now);
    const next = this.map.has(pitch) ? 1 : 0;
    if (t >= 1 || !this.prev) return next;
    return lerp(this.prev.has(pitch) ? 1 : 0, next, t);
  }

  animating(now: number) {
    return !!this.prev && now - this.t0 < this.dur;
  }

  /** All pitches worth drawing right now (union during a transition). */
  pitches(): number[] {
    if (!this.prev) return this.map.rows.map((r) => r.pitch);
    const set = new Set([...this.prev.rows.map((r) => r.pitch), ...this.map.rows.map((r) => r.pitch)]);
    return [...set].sort((a, b) => b - a);
  }
}
