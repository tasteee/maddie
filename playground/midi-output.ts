import { toMidiVelocity, type Output } from '../src/core';

export interface MidiPort {
  id: string;
  name: string;
}

/** Web MIDI access, requested on first use. Null if unsupported or denied. */
let access: Promise<MIDIAccess | null> | null = null;
export const requestMidi = () => {
  if (!navigator.requestMIDIAccess) return Promise.resolve(null);
  return (access ??= navigator.requestMIDIAccess().catch(() => null));
};

export const midiPorts = (a: MIDIAccess): MidiPort[] =>
  [...a.outputs.values()].map((o) => ({ id: o.id, name: o.name || 'MIDI device' }));

/**
 * Send Maddie's notes to a hardware or virtual MIDI port.
 * Event times are AudioContext seconds. MIDI timestamps use the performance.now() clock, so convert.
 */
export const createMidiOutput = (port: MIDIOutput, ctx: AudioContext, channel = 0): Output => {
  const on = 0x90 | channel;
  const off = 0x80 | channel;
  const stamp = (time: number) => (time ? performance.now() + (time - ctx.currentTime) * 1000 : undefined);
  const send = (bytes: number[], time = 0) => port.send(bytes, stamp(time));
  const noteOn = (pitch: number, velocity: number, time: number, duration?: number) => {
    send([on, pitch, Math.max(1, toMidiVelocity(velocity))], time);
    if (duration !== undefined) send([off, pitch, 0], (time || ctx.currentTime) + duration);
  };
  return {
    noteOn: (e) => noteOn(e.pitch, e.velocity, e.time, e.duration),
    noteOff: (e) => {
      if (e.duration === undefined) send([off, e.pitch, 0], e.time);
    },
    // CC 123 = all notes off. CC 120 = all sound off. Also clears notes already queued with a timestamp.
    allNotesOff: () => {
      (port as MIDIOutput & { clear?(): void }).clear?.();
      send([0xb0 | channel, 123, 0]);
      send([0xb0 | channel, 120, 0]);
    },
    setVolume: (v) => send([0xb0 | channel, 7, Math.round(v * 127)]),
    audition: (e) => noteOn(e.pitch, e.velocity, 0, e.duration ?? 0.4),
  };
};
