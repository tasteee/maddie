/// <reference types="vite/client" />
import { SplendidGrandPiano, Soundfont2 } from 'smplr';
import { SoundFont2 } from 'soundfont2';
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

// .sf2 files in playground/public/sounds. Add a file there and a line here.
const SOUNDFONTS: [id: string, label: string, file: string][] = [
  ['sf-harpsichord', 'Harpsichord (Campbell)', 'Campbells_Harpischord_tuned_1.SF2'],
  ['sf-massive-strings', 'Massive Strings', '336_Massive_strings.sf2'],
  ['sf-legato-strings', 'Legato Strings', '198_Legato_strings.sf2'],
  ['sf-ensemble-violin', 'Ensemble Violin', 'ensemble violin.sf2'],
  ['sf-dark-violins', 'Dark Violins', 'Dark Violins.sf2'],
  ['sf-pizz-violins', 'Pizzicato Violins', 'Pizz Violins.sf2'],
  ['sf-violin-langtons', 'Violin (Langtons)', '1115_Violin_Langtons_(617KB).sf2'],
  ['sf-cello-legato', 'Cello Legato', 'Cello Legato.sf2'],
  ['sf-cello-deep', 'Cello (Deep)', '1115_Cello_Deep.sf2'],
  ['sf-cello-fitch', 'Cello (Fitch)', 'Fitch_MedCello.sf2'],
];

const soundfontOutput = (file: string): Output => {
  const sampler = Soundfont2(audioContext, {
    url: `${import.meta.env.BASE_URL}sounds/${encodeURIComponent(file)}`,
    createSoundfont: (data) => new SoundFont2(data) as never,
    volume: 100,
  });
  let ready = false;
  sampler.ready
    .then(() => sampler.loadInstrument(sampler.instrumentNames[0]))
    .then(() => (ready = true))
    .catch((err) => console.error(`Could not load ${file}`, err));
  return makeOutput(sampler, () => ready);
};

editorEl.sounds = [
  { id: 'piano', label: 'Piano (built-in)', output: makeOutput(piano) },
  ...SOUNDFONTS.map(([id, label, file]) => lazySound(id, label, () => soundfontOutput(file))),
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
