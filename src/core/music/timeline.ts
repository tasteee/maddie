import type { TempoEvent, Tick, TimeSigEvent } from '../types';

// ── Tempo ────────────────────────────────────────────────────────────

const sortedTempo = (tempo: readonly TempoEvent[]) =>
  tempo.length ? [...tempo].sort((a, b) => a.tick - b.tick) : [{ tick: 0, bpm: 120 }];

export function bpmAt(tick: Tick, tempo: readonly TempoEvent[]): number {
  let bpm = tempo[0]?.bpm ?? 120;
  for (const e of sortedTempo(tempo)) if (e.tick <= tick) bpm = e.bpm;
  return bpm;
}

export function ticksToSeconds(tick: Tick, tempo: readonly TempoEvent[], ppq: number): number {
  const events = sortedTempo(tempo);
  let seconds = 0;
  let lastTick = 0;
  let bpm = events[0].bpm;
  for (const e of events) {
    if (e.tick >= tick) break;
    seconds += ((e.tick - lastTick) / ppq) * (60 / bpm);
    lastTick = e.tick;
    bpm = e.bpm;
  }
  return seconds + ((tick - lastTick) / ppq) * (60 / bpm);
}

export function secondsToTicks(seconds: number, tempo: readonly TempoEvent[], ppq: number): Tick {
  const events = sortedTempo(tempo);
  let elapsed = 0;
  let lastTick = 0;
  let bpm = events[0].bpm;
  for (const e of events) {
    const segment = ((e.tick - lastTick) / ppq) * (60 / bpm);
    if (elapsed + segment > seconds) break;
    elapsed += segment;
    lastTick = e.tick;
    bpm = e.bpm;
  }
  return lastTick + ((seconds - elapsed) * ppq * bpm) / 60;
}

// ── Time signature ───────────────────────────────────────────────────

const DEFAULT_SIG: TimeSigEvent = { tick: 0, numerator: 4, denominator: 4 };

const sortedSigs = (sigs: readonly TimeSigEvent[]) =>
  sigs.length ? [...sigs].sort((a, b) => a.tick - b.tick) : [DEFAULT_SIG];

export const barLength = (sig: TimeSigEvent, ppq: number) => (ppq * 4 * sig.numerator) / sig.denominator;
export const beatLength = (sig: TimeSigEvent, ppq: number) => (ppq * 4) / sig.denominator;

export function timeSigAt(tick: Tick, sigs: readonly TimeSigEvent[]): TimeSigEvent {
  let found = sortedSigs(sigs)[0];
  for (const s of sortedSigs(sigs)) if (s.tick <= tick) found = s;
  return found;
}

export interface Bar {
  tick: Tick;
  /** 1-based bar number. */
  index: number;
  sig: TimeSigEvent;
}

/** Bars starting in [from, to). Time sig changes are assumed to land on bar lines. */
export function barsInRange(from: Tick, to: Tick, sigs: readonly TimeSigEvent[], ppq: number): Bar[] {
  const events = sortedSigs(sigs);
  const bars: Bar[] = [];
  let barIndex = 1;
  for (let i = 0; i < events.length; i++) {
    const sig = events[i];
    const len = barLength(sig, ppq);
    const end = events[i + 1]?.tick ?? Infinity;
    const first = Math.max(0, Math.floor((from - sig.tick) / len));
    const segmentBars = Math.ceil((Math.min(end, to) - sig.tick) / len);
    for (let b = first; b < segmentBars; b++) {
      const tick = sig.tick + b * len;
      if (tick >= end || tick >= to) break;
      if (tick + len > from) bars.push({ tick, index: barIndex + b, sig });
    }
    if (end === Infinity) break;
    barIndex += Math.ceil((end - sig.tick) / len);
  }
  return bars;
}

/** Bar / beat / sixteenth, all 1-based. */
export function tickToBBT(tick: Tick, sigs: readonly TimeSigEvent[], ppq: number) {
  const [bar] = barsInRange(tick, tick + 1, sigs, ppq);
  const b = bar ?? { tick: 0, index: 1, sig: DEFAULT_SIG };
  const beatLen = beatLength(b.sig, ppq);
  const inBar = tick - b.tick;
  const beat = Math.floor(inBar / beatLen);
  const sixteenth = Math.floor((inBar - beat * beatLen) / (ppq / 4));
  return { bar: b.index, beat: beat + 1, sixteenth: sixteenth + 1 };
}

export function formatBBT(tick: Tick, sigs: readonly TimeSigEvent[], ppq: number): string {
  const { bar, beat, sixteenth } = tickToBBT(tick, sigs, ppq);
  return `${bar}.${beat}.${sixteenth}`;
}
