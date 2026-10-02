import type { Editor } from './editor';
import { secondsToTicks, ticksToSeconds } from './music/timeline';
import type { Tick } from './types';

export type TransportState = 'stopped' | 'playing' | 'paused';

export interface LoopRegion {
  enabled: boolean;
  start: Tick;
  end: Tick;
}

interface Anchor {
  /** AudioContext time. */
  time: number;
  tick: Tick;
}

const LOOKAHEAD_MS = 25;
const HORIZON_S = 0.12;

/**
 * The clock. Lookahead scheduler on the AudioContext clock:
 * a timer wakes every 25ms and schedules notes for the next ~120ms.
 */
export class Transport {
  state: TransportState = 'stopped';
  loop: LoopRegion = { enabled: false, start: 0, end: 0 };
  private stoppedAt: Tick = 0;
  private returnTo: Tick = 0;
  private anchors: Anchor[] = [];
  private scheduledUntil = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ctx: AudioContext | null = null;

  constructor(private editor: Editor) {}

  get audioContext(): AudioContext {
    if (!this.ctx) this.ctx = this.editor.audioContext ?? new AudioContext();
    return this.ctx;
  }

  /** Use a specific AudioContext (share the clock with your instrument). */
  setAudioContext(ctx: AudioContext | null) {
    this.ctx = ctx;
  }

  /** Current tick. Accurate per frame while playing. */
  get position(): Tick {
    if (this.state !== 'playing' || !this.ctx) return this.stoppedAt;
    return this.tickAt(this.ctx.currentTime - (this.ctx.outputLatency || 0));
  }

  get playing() {
    return this.state === 'playing';
  }

  async play(from?: Tick) {
    if (this.state === 'playing') return;
    const ctx = this.audioContext;
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    const start = from ?? this.stoppedAt;
    if (this.state === 'stopped') this.returnTo = start;
    const time = ctx.currentTime + 0.05;
    this.anchors = [{ time, tick: start }];
    this.scheduledUntil = time;
    this.state = 'playing';
    this.schedule();
    this.timer = setInterval(() => this.schedule(), LOOKAHEAD_MS);
    this.emit();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.stoppedAt = this.position;
    this.halt('paused');
  }

  /** Stop. A second stop returns to the start. */
  stop() {
    if (this.state === 'stopped') {
      this.stoppedAt = 0;
      this.returnTo = 0;
    } else {
      this.stoppedAt = this.returnTo;
      this.halt('stopped');
      return;
    }
    this.emit();
  }

  toggle() {
    if (this.state === 'playing') this.pause();
    else this.play();
  }

  seek(tick: Tick) {
    tick = Math.max(0, tick);
    if (this.state === 'playing') {
      this.editor.output?.allNotesOff();
      const time = this.audioContext.currentTime + 0.02;
      this.anchors = [{ time, tick }];
      this.scheduledUntil = time;
      this.returnTo = tick;
    } else {
      this.stoppedAt = tick;
      this.returnTo = tick;
    }
    this.emit();
  }

  setLoop(loop: Partial<LoopRegion>) {
    this.loop = { ...this.loop, ...loop };
    if (this.loop.end <= this.loop.start) this.loop.enabled = false;
    this.emit();
  }

  /** Tick at an AudioContext time. */
  tickAt(time: number): Tick {
    let anchor = this.anchors[0];
    for (const a of this.anchors) if (a.time <= time) anchor = a;
    if (!anchor) return this.stoppedAt;
    const { tempo, ppq } = this.editor.meta;
    const base = ticksToSeconds(anchor.tick, tempo, ppq);
    return Math.max(anchor.tick, secondsToTicks(base + (time - anchor.time), tempo, ppq));
  }

  private halt(state: TransportState) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.anchors = [];
    this.state = state;
    this.editor.output?.allNotesOff();
    this.emit();
  }

  private emit() {
    this.editor.emitTransport();
  }

  private schedule() {
    const ctx = this.audioContext;
    const until = ctx.currentTime + HORIZON_S;
    const { tempo, ppq } = this.editor.meta;
    const secs = (t: Tick) => ticksToSeconds(t, tempo, ppq);

    while (this.scheduledUntil < until) {
      const anchor = this.anchors[this.anchors.length - 1];
      const fromTick = this.tickAtAnchor(anchor, this.scheduledUntil);
      let toTick = this.tickAtAnchor(anchor, until);
      let wrapped = false;
      const { loop } = this;
      if (loop.enabled && fromTick < loop.end && toTick >= loop.end) {
        toTick = loop.end;
        wrapped = true;
      }

      for (const note of this.editor.notesStarting(fromTick, toTick)) {
        if (note.muted) continue;
        const time = anchor.time + secs(note.start) - secs(anchor.tick);
        const end = loop.enabled ? Math.min(note.start + note.duration, loop.end) : note.start + note.duration;
        const duration = secs(end) - secs(note.start);
        this.editor.dispatchNote(note, time, duration);
      }

      if (!wrapped) {
        this.scheduledUntil = until;
        break;
      }
      const wrapTime = anchor.time + secs(loop.end) - secs(anchor.tick);
      this.anchors.push({ time: wrapTime, tick: loop.start });
      if (this.anchors.length > 8) this.anchors.splice(0, this.anchors.length - 8);
      this.scheduledUntil = wrapTime;
    }

    // Auto-stop well past the end when not looping.
    if (!this.loop.enabled && this.position > this.editor.contentEnd() + ppq * 8) this.stop();
  }

  private tickAtAnchor(anchor: Anchor, time: number): Tick {
    const { tempo, ppq } = this.editor.meta;
    return secondsToTicks(ticksToSeconds(anchor.tick, tempo, ppq) + (time - anchor.time), tempo, ppq);
  }
}
