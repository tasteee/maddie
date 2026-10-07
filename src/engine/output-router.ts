import { toMidiVelocity, type Editor, type Output } from '../core';
import { Engine } from './engine';

/** A built-in sound the host provides (a sampler, a synth). */
export interface SoundChoice {
  id: string;
  label: string;
  output: Output;
}

export interface MidiPort {
  id: string;
  name: string;
}

type Status = 'idle' | 'pending' | 'ready' | 'unsupported' | 'denied';

export const MIDI_SOURCE = 'midi';

/**
 * Send Maddie's notes to a MIDI port.
 * Event times are AudioContext seconds. MIDI timestamps use the performance.now() clock, so convert.
 */
export function createMidiOutput(port: MIDIOutput, getContext: () => AudioContext | null, channel = 0): Output {
  const on = 0x90 | channel;
  const off = 0x80 | channel;
  const cc = 0xb0 | channel;
  const stamp = (time: number) => {
    const ctx = getContext();
    return time && ctx ? performance.now() + (time - ctx.currentTime) * 1000 : undefined;
  };
  const send = (bytes: number[], time = 0) => {
    try {
      port.send(bytes, stamp(time));
    } catch {
      // Port was unplugged. The router drops it on the next state change.
    }
  };
  const noteOn = (pitch: number, velocity: number, time: number, duration?: number) => {
    send([on, pitch, Math.max(1, toMidiVelocity(velocity))], time);
    if (duration !== undefined) send([off, pitch, 0], (time || getContext()?.currentTime || 0) + duration);
  };
  return {
    noteOn: (e) => noteOn(e.pitch, e.velocity, e.time, e.duration),
    noteOff: (e) => {
      if (e.duration === undefined) send([off, e.pitch, 0], e.time);
    },
    // Also drop notes already queued with a timestamp, then CC 123 (all notes off) and CC 120 (all sound off).
    allNotesOff: () => {
      (port as MIDIOutput & { clear?(): void }).clear?.();
      send([cc, 123, 0]);
      send([cc, 120, 0]);
    },
    setVolume: (v) => send([cc, 7, Math.round(v * 127)]),
    audition: (e) => noteOn(e.pitch, e.velocity, 0, e.duration ?? 0.4),
  };
}

const routers = new WeakMap<Editor, OutputRouter>();

/**
 * Chooses where notes go: one of the host's sounds, or a MIDI output port.
 * Sets `editor.output` whenever the choice changes. Does nothing until the host provides sounds.
 */
export class OutputRouter {
  static for(editor: Editor): OutputRouter {
    let r = routers.get(editor);
    if (!r) routers.set(editor, (r = new OutputRouter(editor)));
    return r;
  }

  sounds: SoundChoice[] = [];
  /** A sound id, or `MIDI_SOURCE`. */
  source = '';
  portId: string | null = null;
  status: Status = 'idle';
  private access: MIDIAccess | null = null;
  private listeners = new Set<() => void>();

  private constructor(private editor: Editor) {}

  get supported() {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  /** Connected output ports. Empty until access is granted. */
  get ports(): MidiPort[] {
    if (!this.access) return [];
    return [...this.access.outputs.values()].map((o) => ({ id: o.id, name: o.name || 'MIDI device' }));
  }

  /** Called when sounds, ports or the choice change. Returns an unsubscribe function. */
  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setSounds(sounds: SoundChoice[]) {
    this.sounds = sounds;
    if (this.source !== MIDI_SOURCE && !sounds.some((s) => s.id === this.source)) this.source = sounds[0]?.id ?? '';
    this.apply();
  }

  selectSound(id: string) {
    this.source = id;
    this.apply();
  }

  async selectMidi() {
    if (!(await this.request())) {
      const message = this.status === 'unsupported' ? "This browser can't send MIDI" : 'MIDI access was blocked';
      Engine.for(this.editor).toast(message, 'error');
      return;
    }
    this.source = MIDI_SOURCE;
    if (!this.ports.some((p) => p.id === this.portId)) this.portId = this.ports[0]?.id ?? null;
    this.apply();
  }

  selectPort(id: string) {
    this.portId = id;
    this.apply();
  }

  private async request(): Promise<boolean> {
    if (this.access) return true;
    if (!this.supported) {
      this.setStatus('unsupported');
      return false;
    }
    this.setStatus('pending');
    try {
      this.access = await navigator.requestMIDIAccess();
      this.access.onstatechange = () => this.onPorts();
      this.setStatus('ready');
      return true;
    } catch {
      this.setStatus('denied');
      return false;
    }
  }

  private onPorts() {
    if (this.source === MIDI_SOURCE && !this.ports.some((p) => p.id === this.portId)) {
      this.portId = this.ports[0]?.id ?? null;
    }
    this.apply();
  }

  private apply() {
    if (this.sounds.length || this.source === MIDI_SOURCE) {
      const out = this.resolve();
      if (out !== this.editor.output) {
        this.editor.output?.allNotesOff();
        this.editor.output = out;
        this.editor.setVolume({});
      }
    }
    this.notify();
  }

  private resolve(): Output | null {
    if (this.source === MIDI_SOURCE) {
      const port = this.portId ? this.access?.outputs.get(this.portId) : undefined;
      if (!port) return null;
      return (this.midiOutputs.get(port) ?? this.cache(port));
    }
    return this.sounds.find((s) => s.id === this.source)?.output ?? null;
  }

  private midiOutputs = new WeakMap<MIDIOutput, Output>();
  private cache(port: MIDIOutput) {
    const out = createMidiOutput(port, () => this.editor.audioContext);
    this.midiOutputs.set(port, out);
    return out;
  }

  private setStatus(status: Status) {
    this.status = status;
    this.notify();
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }
}
