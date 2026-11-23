import { toMidiVelocity, type Editor, type Output, type TrackRouteT } from '../core';
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

/** Can a route sound right now? `needs-access` means the browser has not granted MIDI yet. */
export type RouteStatusT = 'ready' | 'missing' | 'needs-access' | 'unsupported' | 'denied';

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
  private choice = 0;

  private constructor(private editor: Editor) {
    editor.outputResolver = (route) => this.resolveRoute(route);
    editor.on('tracks', () => this.onTracks());
  }

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
    this.primeTrackSounds();
  }

  selectSound(id: string) {
    this.restoreRoute(id, this.portId);
  }

  restoreRoute(id: string, portId: string | null) {
    this.choice++;
    this.source = id;
    this.portId = portId;
    this.apply();
  }

  async selectMidi() {
    const choice = ++this.choice;
    const allowed = await this.request();
    if (choice !== this.choice) return;
    if (!allowed) {
      this.toastMidiBlocked();
      return;
    }
    this.source = MIDI_SOURCE;
    if (this.portId === null) this.portId = this.ports[0]?.id ?? null;
    this.apply();
  }

  /** Send one track to a MIDI port. Asks the browser for MIDI access first. Keeps the port and channel it already had. */
  async routeTrackToMidi(trackId: string) {
    const isAllowed = await this.request();
    if (!isAllowed) {
      this.toastMidiBlocked();
      return;
    }
    const currentRoute = this.editor.trackList.find((track) => track.id === trackId)?.route;
    const wasMidi = currentRoute?.kind === 'midi';
    const portId = wasMidi ? currentRoute.portId : this.ports[0]?.id ?? null;
    const channel = wasMidi ? currentRoute.channel ?? 0 : 0;
    this.editor.commands.setTrackRoute(trackId, { kind: 'midi', portId, channel });
  }

  private toastMidiBlocked() {
    const message = this.status === 'unsupported' ? "This browser can't send MIDI" : 'MIDI access was blocked';
    Engine.for(this.editor).toast(message, 'error');
  }

  selectPort(id: string) {
    this.portId = id;
    this.apply();
  }

  async request(): Promise<boolean> {
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
      this.apply();
      return true;
    } catch {
      this.setStatus('denied');
      return false;
    }
  }

  /** Can this route sound right now? Use it to explain a silent track. */
  getRouteStatus(route: TrackRouteT): RouteStatusT {
    if (route.kind === 'sound') return this.sounds.some((sound) => sound.id === route.soundId) ? 'ready' : 'missing';
    if (!this.access) {
      if (this.status === 'unsupported' || !this.supported) return 'unsupported';
      if (this.status === 'denied') return 'denied';
      return 'needs-access';
    }
    return this.findPort(route) ? 'ready' : 'missing';
  }

  /** The output a track route sounds through, or null when it cannot sound right now. */
  resolveRoute(route: TrackRouteT): Output | null {
    if (route.kind === 'sound') return this.sounds.find((sound) => sound.id === route.soundId)?.output ?? null;
    const port = this.findPort(route);
    if (!port) return null;
    return this.getMidiOutput(port, route.channel ?? 0);
  }

  private findPort(route: Extract<TrackRouteT, { kind: 'midi' }>): MIDIOutput | undefined {
    if (!this.access) return undefined;
    const portId = route.portId ?? this.ports[0]?.id;
    if (!portId) return undefined;
    return this.access.outputs.get(portId);
  }

  // Sounds load on first use. Touch each track's sound now, so it is ready by the time it plays.
  private primeTrackSounds() {
    for (const track of this.editor.trackList) {
      const route = track.route;
      if (route?.kind === 'sound') this.resolveRoute(route);
    }
  }

  private onTracks() {
    this.primeTrackSounds();
    this.notify();
  }

  private onPorts() {
    if (this.source === MIDI_SOURCE && this.portId === null) {
      this.portId = this.ports[0]?.id ?? null;
    }
    this.apply();
  }

  private apply() {
    if (this.sounds.length || this.source === MIDI_SOURCE) {
      const out = this.resolve();
      if (out !== this.editor.output) {
        this.editor.stopChord();
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
      return this.getMidiOutput(port, 0);
    }
    return this.sounds.find((s) => s.id === this.source)?.output ?? null;
  }

  // One output per port and channel, so the default and any track on the same port and channel share it.
  private midiOutputs = new WeakMap<MIDIOutput, Map<number, Output>>();
  private getMidiOutput(port: MIDIOutput, channel: number): Output {
    const safeChannel = Math.max(0, Math.min(15, Math.round(channel)));
    const channels = this.midiOutputs.get(port) ?? new Map<number, Output>();
    this.midiOutputs.set(port, channels);
    const existing = channels.get(safeChannel);
    if (existing) return existing;
    const created = createMidiOutput(port, () => this.editor.audioContext, safeChannel);
    channels.set(safeChannel, created);
    return created;
  }

  private setStatus(status: Status) {
    this.status = status;
    this.notify();
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }
}
