/// <reference types="vite/client" />
import { SplendidGrandPiano, Soundfont, ElectricPiano } from 'smplr';
import { toMidiVelocity, type Output } from '../src/core';
import '@tasteee/zest/ink.css';
import '@tasteee/zest/fonts.css';
import { ZThemeSwitcher } from '@tasteee/zest/z-theme-switcher';
import '../src/elements';
import { DEMO_TEMPO, demoSong } from './demo-song';

const editorEl = document.querySelector('maddie-editor')!;
const editor = editorEl.editor;

// ── Sound: Maddie only dispatches notes. smplr makes the sound. ───────
const audioContext = new AudioContext();
editorEl.audioContext = audioContext;

type Player = {
  start(o: { note: number; velocity: number; time?: number; duration?: number }): (time?: number) => void;
  stop(): void;
  output: { volume: number };
};

// Wraps any smplr instrument as an Output. Notes before `isReady()` are dropped (samples still loading).
const makeOutput = (player: Player, isReady: () => boolean = () => true): Output => {
  // Live notes (computer keyboard) have no duration: keep their stop functions for note-off.
  const held = new Map<number, (time?: number) => void>();
  const resume = () => audioContext.state !== 'running' && audioContext.resume();
  return {
    noteOn: (e) => {
      if (!isReady()) return;
      const stop = player.start({ note: e.pitch, velocity: toMidiVelocity(e.velocity), time: e.time || undefined, duration: e.duration });
      if (e.duration === undefined) {
        resume();
        held.get(e.pitch)?.();
        held.set(e.pitch, stop);
      }
    },
    noteOff: (e) => {
      if (e.duration !== undefined) return; // scheduled notes release on their own
      held.get(e.pitch)?.();
      held.delete(e.pitch);
    },
    allNotesOff: () => {
      held.clear();
      player.stop();
    },
    setVolume: (v) => (player.output.volume = Math.round(v * 127)),
    audition: (e) => {
      if (!isReady()) return;
      resume();
      player.start({ note: e.pitch, velocity: toMidiVelocity(e.velocity), duration: e.duration });
    },
  };
};

// Builds the instrument (and fetches its samples) on first use, so unused sounds cost nothing.
const lazySound = (id: string, label: string, create: () => Output) => {
  let output: Output | undefined;
  return {
    id,
    label,
    get output() {
      return (output ??= create());
    },
  };
};

const piano = SplendidGrandPiano(audioContext, { volume: 100 });

// General MIDI sounds from smplr's Soundfont (MusyngKite kit). Each is fetched on first use.
const GM_SOUNDS: [id: string, label: string, instrument: string][] = [
  ['gm-nylon-guitar', 'Nylon Guitar', 'acoustic_guitar_nylon'],
  ['gm-steel-guitar', 'Steel Guitar', 'acoustic_guitar_steel'],
  ['gm-clean-guitar', 'Electric Guitar (Clean)', 'electric_guitar_clean'],
  ['gm-bass', 'Acoustic Bass', 'acoustic_bass'],
  ['gm-violin', 'Violin', 'violin'],
  ['gm-cello', 'Cello', 'cello'],
  ['gm-strings', 'String Ensemble', 'string_ensemble_1'],
  ['gm-harp', 'Harp', 'orchestral_harp'],
  ['gm-flute', 'Flute', 'flute'],
  ['gm-trumpet', 'Trumpet', 'trumpet'],
  ['gm-sax', 'Alto Sax', 'alto_sax'],
  ['gm-organ', 'Church Organ', 'church_organ'],
  ['gm-harpsichord', 'Harpsichord', 'harpsichord'],
  ['gm-marimba', 'Marimba', 'marimba'],
];

const loaded = (player: { ready: Promise<void> }) => {
  let ready = false;
  player.ready.then(() => (ready = true)).catch((err) => console.error('Could not load sound', err));
  return () => ready;
};

const gmOutput = (instrument: string): Output => {
  const player = Soundfont(audioContext, { instrument, kit: 'MusyngKite', volume: 100 });
  return makeOutput(player, loaded(player));
};

const electricPianoOutput = (instrument: string): Output => {
  const player = ElectricPiano(audioContext, { instrument, volume: 100 });
  return makeOutput(player, loaded(player));
};

editorEl.sounds = [
  { id: 'piano', label: 'Grand Piano', output: makeOutput(piano) },
  lazySound('ep-pianet', 'Pianet T', () => electricPianoOutput('PianetT')),
  lazySound('ep-wurlitzer', 'Wurlitzer', () => electricPianoOutput('WurlitzerEP200')),
  ...GM_SOUNDS.map(([id, label, instrument]) => lazySound(id, label, () => gmOutput(instrument))),
];

// ── Content ─────────────────────────────────────────────────────────
editorEl.notes = demoSong();
editor.commands.setTempo(DEMO_TEMPO, { origin: 'load' });
editor.transport.setLoop({ start: 0, end: editor.ppq * 16, enabled: true });
editor.setView({ pxPerTick: 0.075 });

// ── Theme ───────────────────────────────────────────────────────────
// Zest 0.8.1 defines <z-theme-switcher> in a shared chunk that bundlers drop as side-effect free, so define it from the export.
if (!customElements.get('z-theme-switcher')) customElements.define('z-theme-switcher', ZThemeSwitcher);
// Zest owns this: <z-theme-switcher> writes data-theme on <html>, and every token (and the canvas) follows it.
const themes = document.querySelector<HTMLElement & { themes: string[] }>('z-theme-switcher')!;
themes.themes = ['dark', 'light', 'console', 'studio'];
