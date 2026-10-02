import { describe, expect, it } from 'vitest';
import { createEditor, fromMidiFile, parseKey, toMidiFile } from '../src/core';

/** Minimal SMF reader, just enough to check what we wrote. */
function readMidi(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (o: number) => String.fromCharCode(...bytes.slice(o, o + 4));
  expect(str(0)).toBe('MThd');
  const format = dv.getUint16(8);
  const ntracks = dv.getUint16(10);
  const ppq = dv.getUint16(12);
  let o = 14;
  const tracks: Array<Array<{ tick: number; status: number; data: number[] }>> = [];
  for (let t = 0; t < ntracks; t++) {
    expect(str(o)).toBe('MTrk');
    const len = dv.getUint32(o + 4);
    const end = o + 8 + len;
    o += 8;
    let tick = 0;
    const evs: Array<{ tick: number; status: number; data: number[] }> = [];
    const vlq = () => {
      let n = 0;
      let b: number;
      do {
        b = bytes[o++];
        n = (n << 7) | (b & 0x7f);
      } while (b & 0x80);
      return n;
    };
    while (o < end) {
      tick += vlq();
      const status = bytes[o++];
      if (status === 0xff) {
        const type = bytes[o++];
        const l = vlq();
        evs.push({ tick, status: 0xff00 | type, data: [...bytes.slice(o, o + l)] });
        o += l;
      } else {
        evs.push({ tick, status, data: [bytes[o], bytes[o + 1]] });
        o += 2;
      }
    }
    tracks.push(evs);
  }
  return { format, ppq, tracks };
}

describe('midi export', () => {
  it('writes a type 1 file with tempo, time sig, key and notes', () => {
    const ed = createEditor({ doc: { key: parseKey('C minor'), tempo: [{ tick: 0, bpm: 124 }] } });
    ed.commands.add([
      { pitch: 60, start: 0, duration: 480, velocity: 1 },
      { pitch: 63, start: 480, duration: 240, velocity: 0.5 },
      { pitch: 67, start: 480, duration: 240, velocity: 0.5, muted: true },
    ]);
    const { format, ppq, tracks } = readMidi(toMidiFile(ed.doc));
    expect(format).toBe(1);
    expect(ppq).toBe(960);
    expect(tracks).toHaveLength(2);

    const tempo = tracks[0].find((e) => e.status === 0xff51)!;
    const us = (tempo.data[0] << 16) | (tempo.data[1] << 8) | tempo.data[2];
    expect(Math.round(60_000_000 / us)).toBe(124);
    expect(tracks[0].find((e) => e.status === 0xff58)!.data.slice(0, 2)).toEqual([4, 2]);
    expect(tracks[0].find((e) => e.status === 0xff59)!.data).toEqual([0xfd, 1]); // 3 flats, minor

    const notes = tracks[1].filter((e) => (e.status & 0xf0) === 0x90 || (e.status & 0xf0) === 0x80);
    expect(notes).toEqual([
      { tick: 0, status: 0x90, data: [60, 127] },
      { tick: 480, status: 0x80, data: [60, 0] }, // off before on at the same tick
      { tick: 480, status: 0x90, data: [63, 64] },
      { tick: 720, status: 0x80, data: [63, 0] },
    ]);
  });

  it('encodes long delta times as variable-length quantities', () => {
    const ed = createEditor();
    ed.commands.add([{ pitch: 60, start: 200_000, duration: 100, velocity: 0.8 }]);
    const { tracks } = readMidi(toMidiFile(ed.doc));
    expect(tracks[1].find((e) => e.status === 0x90)!.tick).toBe(200_000);
  });
});

describe('midi import', () => {
  const vlq = (n: number) => {
    const out = [n & 0x7f];
    while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
    return out;
  };
  const file = (ppq: number, ...tracks: number[][]) => {
    const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
    const chunks = tracks.flatMap((t) => [0x4d, 0x54, 0x72, 0x6b, ...u32(t.length), ...t]);
    return new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, tracks.length > 1 ? 1 : 0, 0, tracks.length, ppq >> 8, ppq & 0xff, ...chunks]);
  };

  it('round-trips an exported doc', () => {
    const ed = createEditor({ doc: { key: parseKey('A minor'), tempo: [{ tick: 0, bpm: 124 }] } });
    ed.commands.add([
      { pitch: 60, start: 0, duration: 480, velocity: 1 },
      { pitch: 64, start: 480, duration: 240, velocity: 0.5 },
    ]);
    const m = fromMidiFile(toMidiFile(ed.doc));
    expect(m.tempo).toEqual([{ tick: 0, bpm: 124 }]);
    expect(m.timeSignature).toEqual([{ tick: 0, numerator: 4, denominator: 4 }]);
    expect(m.key).toEqual({ root: 9, scale: 'minor' });
    expect(m.notes.map(({ pitch, start, duration }) => [pitch, start, duration])).toEqual([
      [60, 0, 480],
      [64, 480, 240],
    ]);
    expect(m.notes[1].velocity).toBeCloseTo(64 / 127);
  });

  it('handles running status, note-on velocity 0, and rescales ppq', () => {
    // ppq 96: C4 on, then running-status E4 on, both ended by note-on vel 0.
    const track = [
      ...vlq(0), 0x90, 60, 100,
      ...vlq(0), 64, 80, // running status
      ...vlq(48), 60, 0, // = note off
      ...vlq(48), 0x80, 64, 0,
      ...vlq(0), 0xff, 0x2f, 0,
    ];
    const m = fromMidiFile(file(96, track));
    expect(m.notes.map(({ pitch, start, duration }) => [pitch, start, duration])).toEqual([
      [64, 0, 960],
      [60, 0, 480],
    ]);
  });

  it('replaces notes in one undoable step', () => {
    const ed = createEditor();
    ed.commands.add([{ pitch: 72, start: 0, duration: 240, velocity: 0.5 }]);
    const src = createEditor({ doc: { tempo: [{ tick: 0, bpm: 90 }] } });
    src.commands.add([
      { pitch: 48, start: 0, duration: 960, velocity: 0.8 },
      { pitch: 50, start: 960, duration: 960, velocity: 0.8 },
    ]);
    ed.commands.importMidi(toMidiFile(src.doc));
    expect(ed.notes().map((n) => n.pitch)).toEqual([48, 50]);
    expect(ed.meta.tempo[0].bpm).toBe(90);
    ed.undo();
    expect(ed.notes().map((n) => n.pitch)).toEqual([72]);
    expect(ed.meta.tempo[0].bpm).toBe(120);
  });

  it('rejects non-MIDI input', () => {
    expect(() => fromMidiFile(new Uint8Array([1, 2, 3]))).toThrow('Not a MIDI file');
  });
});
