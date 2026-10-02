import type { Note, NoteId } from '../core';
import { clamp, easeInOut, easeOut, lerp } from './ease';

/** What gets drawn for a note. Fractional pitch is fine: it's a position. */
export interface NoteDisplay {
  start: number;
  duration: number;
  pitch: number;
  velocity: number;
  /** 0–1. Pop-in / fade-out. */
  alpha: number;
  /** Vertical scale, for the place "pop". */
  scale: number;
}

interface Tween {
  from: Omit<NoteDisplay, 'alpha' | 'scale'>;
  to: Omit<NoteDisplay, 'alpha' | 'scale'>;
  t0: number;
  dur: number;
}

interface Dying {
  note: Note;
  t0: number;
}

const same = (a: Tween['to'], b: Tween['to']) =>
  a.start === b.start && a.duration === b.duration && a.pitch === b.pitch && a.velocity === b.velocity;

/**
 * Per-note animation. Targets come from the doc (or a drag preview).
 * When a target changes, the note tweens there with the duration set for this frame.
 * Direct manipulation sets a 0ms duration, so it stays 1:1.
 */
export class NoteAnimator {
  private tweens = new Map<NoteId, Tween>();
  private born = new Map<NoteId, number>();
  dying: Dying[] = [];
  /** Duration applied to target changes detected this frame. */
  nextDuration = 0;
  popDuration = 90;
  fadeDuration = 120;
  private active = false;

  resolve(note: Note, now: number): NoteDisplay {
    const target = { start: note.start, duration: note.duration, pitch: note.pitch, velocity: note.velocity };
    let tw = this.tweens.get(note.id);
    if (!tw) {
      tw = { from: target, to: target, t0: now, dur: 0 };
      this.tweens.set(note.id, tw);
    } else if (!same(tw.to, target)) {
      const current = this.sample(tw, now);
      tw.from = current;
      tw.to = target;
      tw.t0 = now;
      tw.dur = this.nextDuration;
    }
    const pos = this.sample(tw, now);
    let alpha = 1;
    let scale = 1;
    const b = this.born.get(note.id);
    if (b !== undefined) {
      const t = clamp((now - b) / this.popDuration, 0, 1);
      alpha = easeOut(t);
      scale = lerp(0.6, 1, easeOut(t));
      if (t < 1) this.active = true;
      else this.born.delete(note.id);
    }
    return { ...pos, alpha, scale };
  }

  /** Fading ghosts of deleted notes. */
  resolveDying(now: number): Array<{ note: Note; display: NoteDisplay }> {
    this.dying = this.dying.filter((d) => now - d.t0 < this.fadeDuration);
    return this.dying.map((d) => {
      const t = clamp((now - d.t0) / this.fadeDuration, 0, 1);
      this.active = true;
      const { start, duration, pitch, velocity } = d.note;
      // Shrink to center.
      const shrink = 1 - easeOut(t) * 0.5;
      return {
        note: d.note,
        display: {
          start: start + (duration * (1 - shrink)) / 2,
          duration: duration * shrink,
          pitch,
          velocity,
          alpha: 1 - easeOut(t),
          scale: 1 - t * 0.3,
        },
      };
    });
  }

  markBorn(id: NoteId, now: number) {
    if (this.popDuration > 0) this.born.set(id, now);
  }

  markDying(note: Note, now: number) {
    if (this.fadeDuration > 0) this.dying.push({ note, t0: now });
    this.tweens.delete(note.id);
  }

  forget(id: NoteId) {
    this.tweens.delete(id);
  }

  /** Did anything animate since the last call? */
  consumeActive(now: number): boolean {
    let active = this.active || this.dying.length > 0;
    if (!active) {
      for (const tw of this.tweens.values()) {
        if (tw.dur > 0 && now - tw.t0 < tw.dur) {
          active = true;
          break;
        }
      }
    }
    this.active = false;
    return active;
  }

  private sample(tw: Tween, now: number): Tween['to'] {
    if (tw.dur <= 0) return tw.to;
    const t = clamp((now - tw.t0) / tw.dur, 0, 1);
    if (t >= 1) return tw.to;
    const e = tw.dur < 80 ? easeOut(t) : easeInOut(t);
    return {
      start: lerp(tw.from.start, tw.to.start, e),
      duration: lerp(tw.from.duration, tw.to.duration, e),
      pitch: lerp(tw.from.pitch, tw.to.pitch, e),
      velocity: lerp(tw.from.velocity, tw.to.velocity, e),
    };
  }
}

/** Tweens a bag of numbers (view zoom/scroll). */
export class ValueTween<T extends Record<string, number>> {
  private from: T;
  private to: T;
  private t0 = 0;
  private dur = 0;

  constructor(initial: T) {
    this.from = { ...initial };
    this.to = { ...initial };
  }

  set(target: T, dur: number, now: number) {
    this.from = this.get(now);
    this.to = { ...target };
    this.t0 = now;
    this.dur = dur;
  }

  get(now: number): T {
    if (this.dur <= 0) return this.to;
    const t = clamp((now - this.t0) / this.dur, 0, 1);
    if (t >= 1) return this.to;
    const e = easeOut(t);
    const out = {} as Record<string, number>;
    for (const k in this.to) out[k] = lerp(this.from[k], this.to[k], e);
    return out as T;
  }

  animating(now: number) {
    return this.dur > 0 && now - this.t0 < this.dur;
  }
}
