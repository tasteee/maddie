import type { Editor } from '../core';
import { releaseAll } from './computer-keyboard';
import { Engine } from './engine';

export interface MidiDevice {
  id: string;
  name: string;
}

type Status = 'idle' | 'pending' | 'ready' | 'unsupported' | 'denied';

const inputs = new WeakMap<Editor, MidiInput>();

/**
 * Play the editor from a hardware MIDI controller (Web MIDI).
 * On while `view.midiInput` is set. Listens to `view.midiDevice`, or every device when null.
 * Note on/off go through `editor.liveNoteOn/Off`, so they sound and record like computer keys.
 */
export class MidiInput {
  static for(editor: Editor): MidiInput {
    let m = inputs.get(editor);
    if (!m) inputs.set(editor, (m = new MidiInput(editor)));
    return m;
  }

  status: Status = 'idle';
  private access: MIDIAccess | null = null;
  private listening = new Set<MIDIInput>();
  private held = new Set<number>();
  private listeners = new Set<() => void>();

  private constructor(private editor: Editor) {
    editor.on('view', ({ view, prev }) => {
      if (view.midiInput !== prev.midiInput || view.midiDevice !== prev.midiDevice) this.sync();
    });
  }

  get supported() {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  /** Connected input devices. Empty until access is granted. */
  get devices(): MidiDevice[] {
    if (!this.access) return [];
    return [...this.access.inputs.values()].map((i) => ({ id: i.id, name: i.name || 'MIDI device' }));
  }

  /** Called when devices or status change. Returns an unsubscribe function. */
  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Ask the browser for MIDI access. Safe to call more than once. */
  async request(): Promise<boolean> {
    if (this.access) return true;
    if (!this.supported) {
      this.setStatus('unsupported');
      return false;
    }
    this.setStatus('pending');
    try {
      this.access = await navigator.requestMIDIAccess();
      this.access.onstatechange = () => {
        this.sync();
        this.notify();
      };
      this.setStatus('ready');
      this.sync();
      return true;
    } catch {
      this.setStatus('denied');
      return false;
    }
  }

  /** Attach to the chosen device(s), or detach when MIDI input is off. */
  private sync() {
    const { midiInput, midiDevice } = this.editor.view;
    const want = new Set<MIDIInput>();
    if (midiInput && this.access) {
      for (const input of this.access.inputs.values()) {
        if (midiDevice === null || input.id === midiDevice) want.add(input);
      }
    }
    for (const input of this.listening) {
      if (want.has(input)) continue;
      input.removeEventListener('midimessage', this.onMessage as EventListener);
      this.listening.delete(input);
    }
    for (const input of want) {
      if (this.listening.has(input)) continue;
      input.addEventListener('midimessage', this.onMessage as EventListener);
      this.listening.add(input);
    }
    if (!midiInput) this.releaseAll();
  }

  private onMessage = (e: MIDIMessageEvent) => {
    const data = e.data;
    if (!data || data.length < 2) return;
    const type = data[0] & 0xf0;
    const pitch = data[1];
    const velocity = data[2] ?? 0;
    if (type === 0x90 && velocity > 0) this.press(pitch, velocity / 127);
    else if (type === 0x80 || type === 0x90) this.release(pitch);
    // CC 123: all notes off.
    else if (type === 0xb0 && pitch === 123) this.releaseAll();
  };

  private press(pitch: number, velocity: number) {
    this.held.add(pitch);
    this.editor.liveNoteOn(pitch, velocity);
    this.redraw();
  }

  private release(pitch: number) {
    if (!this.held.delete(pitch)) return;
    this.editor.liveNoteOff(pitch);
    this.redraw();
  }

  private releaseAll() {
    for (const pitch of this.held) this.editor.liveNoteOff(pitch);
    this.held.clear();
    this.redraw();
  }

  private redraw() {
    const engine = Engine.for(this.editor);
    engine.held = new Set(this.held);
    engine.invalidate();
  }

  private setStatus(status: Status) {
    this.status = status;
    this.notify();
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }
}

/**
 * Turn MIDI input on or off. Asks for access the first time.
 * MIDI and computer keyboard are separate modes: turning one on turns the other off.
 */
export async function setMidiInput(editor: Editor, on: boolean) {
  const midi = MidiInput.for(editor);
  if (!on) return editor.setView({ midiInput: false });
  if (!(await midi.request())) {
    const engine = Engine.for(editor);
    engine.toast(midi.status === 'unsupported' ? "This browser can't read MIDI devices" : 'MIDI access was blocked', 'error');
    return;
  }
  releaseAll(editor);
  editor.setView({ midiInput: true, computerKeyboard: false });
  if (!midi.devices.length) Engine.for(editor).toast('No MIDI devices found · plug one in');
}

/** Listen to one device, or every device (`null`). */
export function setMidiDevice(editor: Editor, id: string | null) {
  editor.setView({ midiDevice: id });
}
