import { fromMidiVelocity } from '../music/velocity';
import type { Key, NoteInput, TempoEvent, TimeSigEvent } from '../types';

export interface MidiImport {
  /** Ticks per quarter in the file (notes are already rescaled to `ppq`). */
  sourcePpq: number;
  format: number;
  tempo: TempoEvent[];
  timeSignature: TimeSigEvent[];
  key: Key | null;
  /** All notes from every track, rescaled to `ppq`, sorted by start. */
  notes: NoteInput[];
  trackNames: string[];
}

export interface MidiImportOptions {
  /** Target ticks per quarter (default 960). */
  ppq?: number;
}

/** Major key root (pitch class) by sharps/flats count, −7 … +7. */
const SF_TO_MAJOR: Record<number, number> = { [-7]: 11, [-6]: 6, [-5]: 1, [-4]: 8, [-3]: 3, [-2]: 10, [-1]: 5, 0: 0, 1: 7, 2: 2, 3: 9, 4: 4, 5: 11, 6: 6, 7: 1 };

export class MidiParseError extends Error {}

/** Parse a Standard MIDI File (type 0 or 1). */
export function fromMidiFile(input: ArrayBuffer | Uint8Array, { ppq = 960 }: MidiImportOptions = {}): MidiImport {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (bytes.length < 14 || tag(0) !== 'MThd') throw new MidiParseError('Not a MIDI file');

  const headerLen = dv.getUint32(4);
  const format = dv.getUint16(8);
  const ntracks = dv.getUint16(10);
  const division = dv.getUint16(12);
  if (division & 0x8000) throw new MidiParseError('SMPTE time division is not supported');
  const sourcePpq = division || 480;
  const scale = (t: number) => Math.round((t * ppq) / sourcePpq);

  const tempo: TempoEvent[] = [];
  const timeSignature: TimeSigEvent[] = [];
  let key: Key | null = null;
  const notes: NoteInput[] = [];
  const trackNames: string[] = [];

  let o = 8 + headerLen;
  for (let t = 0; t < ntracks && o + 8 <= bytes.length; t++) {
    const len = dv.getUint32(o + 4);
    const isTrack = tag(o) === 'MTrk';
    o += 8;
    const end = Math.min(bytes.length, o + len);
    if (!isTrack) {
      o = end;
      continue;
    }
    let tick = 0;
    let status = 0;
    // Open notes per channel+pitch (a stack, so overlapping same-pitch notes pair FIFO).
    const open = new Map<number, Array<{ tick: number; velocity: number }>>();

    const vlq = () => {
      let n = 0;
      for (let i = 0; i < 4 && o < end; i++) {
        const b = bytes[o++];
        n = (n << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      return n;
    };

    const close = (ch: number, pitch: number, at: number) => {
      const stack = open.get((ch << 7) | pitch);
      const on = stack?.shift();
      if (!on) return;
      notes.push({
        pitch,
        start: scale(on.tick),
        duration: Math.max(1, scale(at) - scale(on.tick)),
        velocity: fromMidiVelocity(on.velocity),
        channel: ch,
      });
    };

    while (o < end) {
      tick += vlq();
      let b = bytes[o];
      if (b & 0x80) {
        o++;
        if (b < 0xf0) status = b; // running status applies to channel messages only
      } else {
        b = status; // running status: reuse the previous status byte
      }

      if (b === 0xff) {
        const type = bytes[o++];
        const l = vlq();
        const d = bytes.subarray(o, o + l);
        o += l;
        if (type === 0x51 && l === 3) tempo.push({ tick: scale(tick), bpm: Math.round((60_000_000 / ((d[0] << 16) | (d[1] << 8) | d[2])) * 100) / 100 });
        else if (type === 0x58 && l >= 2) timeSignature.push({ tick: scale(tick), numerator: d[0], denominator: Math.pow(2, d[1]) });
        else if (type === 0x59 && l === 2 && !key) {
          const sf = (d[0] << 24) >> 24;
          const major = SF_TO_MAJOR[sf] ?? 0;
          key = d[1] ? { root: (major + 9) % 12, scale: 'minor' } : { root: major, scale: 'major' };
        } else if (type === 0x03 && l) trackNames.push(new TextDecoder().decode(d));
        else if (type === 0x2f) break;
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        o += vlq(); // sysex
        continue;
      }

      const kind = b & 0xf0;
      const ch = b & 0x0f;
      if (kind === 0xc0 || kind === 0xd0) {
        o += 1;
        continue;
      }
      const d1 = bytes[o++];
      const d2 = bytes[o++];
      if (kind === 0x90 && d2 > 0) {
        const k = (ch << 7) | d1;
        if (!open.has(k)) open.set(k, []);
        open.get(k)!.push({ tick, velocity: d2 });
      } else if (kind === 0x80 || kind === 0x90) {
        close(ch, d1, tick);
      }
    }
    // Close anything left hanging at the end of the track.
    for (const [k, stack] of open) while (stack.length) close(k >> 7, k & 0x7f, tick);
    o = end;
  }

  const dedupe = <T extends { tick: number }>(evs: T[]) =>
    evs.sort((a, b) => a.tick - b.tick).filter((e, i, arr) => i === arr.length - 1 || arr[i + 1].tick !== e.tick);

  notes.sort((a, b) => a.start - b.start || b.pitch - a.pitch);
  return {
    sourcePpq,
    format,
    tempo: tempo.length ? dedupe(tempo) : [{ tick: 0, bpm: 120 }],
    timeSignature: timeSignature.length ? dedupe(timeSignature) : [{ tick: 0, numerator: 4, denominator: 4 }],
    key,
    notes,
    trackNames,
  };
}
