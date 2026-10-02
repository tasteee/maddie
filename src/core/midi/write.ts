import { toMidiVelocity } from '../music/velocity';
import type { Key, MaddieDoc } from '../types';

export interface MidiExportOptions {
  /** Skip muted notes (default true). */
  skipMuted?: boolean;
  /** Only these tracks (default: all). */
  tracks?: string[];
}

/** Major-key accidentals by pitch class (C=0 … B=11), as sharps (+) / flats (−). */
const MAJOR_SF = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

/** Key signature meta values, or null for modes MIDI can't express. */
function keySignature(key: Key): [number, number] | null {
  if (key.scale === 'major') return [MAJOR_SF[key.root], 0];
  if (key.scale === 'minor') return [MAJOR_SF[(key.root + 3) % 12], 1];
  return null;
}

/** Variable-length quantity. */
function vlq(n: number): number[] {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
}

const text = (s: string) => [...new TextEncoder().encode(s)];
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

interface Ev {
  tick: number;
  /** Lower sorts first at the same tick: meta, note-off, note-on. */
  order: number;
  bytes: number[];
}

function chunk(events: Ev[]): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let last = 0;
  for (const e of events) {
    body.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  body.push(0, 0xff, 0x2f, 0); // end of track
  return [...text('MTrk'), ...u32(body.length), ...body];
}

/**
 * Standard MIDI File (type 1). Track 0 holds tempo, time signature and key;
 * one track per Maddie track holds the notes.
 */
export function toMidiFile(doc: MaddieDoc, { skipMuted = true, tracks }: MidiExportOptions = {}): Uint8Array {
  const meta: Ev[] = [];
  for (const t of doc.tempo) {
    const us = Math.round(60_000_000 / t.bpm);
    meta.push({ tick: Math.round(t.tick), order: 0, bytes: [0xff, 0x51, 3, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff] });
  }
  for (const s of doc.timeSignature) {
    meta.push({ tick: Math.round(s.tick), order: 0, bytes: [0xff, 0x58, 4, s.numerator, Math.log2(s.denominator), 24, 8] });
  }
  const ks = doc.key && keySignature(doc.key);
  if (ks) meta.push({ tick: 0, order: 0, bytes: [0xff, 0x59, 2, ks[0] & 0xff, ks[1]] });

  const chunks = [chunk(meta)];
  for (const track of doc.tracks) {
    if (tracks && !tracks.includes(track.id)) continue;
    const evs: Ev[] = [];
    if (track.name) {
      const name = text(track.name);
      evs.push({ tick: 0, order: 0, bytes: [0xff, 0x03, ...vlq(name.length), ...name] });
    }
    for (const n of track.notes) {
      if (skipMuted && n.muted) continue;
      const ch = (n.channel ?? 0) & 0x0f;
      const start = Math.round(n.start);
      const end = Math.max(start + 1, Math.round(n.start + n.duration));
      evs.push({ tick: start, order: 2, bytes: [0x90 | ch, n.pitch & 0x7f, toMidiVelocity(n.velocity)] });
      evs.push({ tick: end, order: 1, bytes: [0x80 | ch, n.pitch & 0x7f, 0] });
    }
    chunks.push(chunk(evs));
  }

  const header = [...text('MThd'), ...u32(6), 0, 1, 0, chunks.length, (doc.ppq >> 8) & 0x7f, doc.ppq & 0xff];
  return new Uint8Array([...header, ...chunks.flat()]);
}

/** Browser helper: download the doc as a .mid file. */
export function downloadMidi(doc: MaddieDoc, filename = 'maddie.mid', options?: MidiExportOptions) {
  const blob = new Blob([toMidiFile(doc, options) as BlobPart], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.mid') ? filename : `${filename}.mid`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
