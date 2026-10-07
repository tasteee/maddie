import { SplendidGrandPiano } from 'smplr';
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
const piano = SplendidGrandPiano(audioContext, { volume: 100 });
editorEl.audioContext = audioContext;

// Live notes (computer keyboard) have no duration: keep their stop functions for note-off.
const held = new Map<number, (time?: number) => void>();
const pianoOutput: Output = {
  noteOn: (e) => {
    const stop = piano.start({ note: e.pitch, velocity: toMidiVelocity(e.velocity), time: e.time || undefined, duration: e.duration });
    if (e.duration === undefined) {
      if (audioContext.state !== 'running') audioContext.resume();
      held.get(e.pitch)?.();
      held.set(e.pitch, stop);
    }
  },
  noteOff: (e) => {
    if (e.duration !== undefined) return; // scheduled notes release on their own
    held.get(e.pitch)?.();
    held.delete(e.pitch);
  },
  allNotesOff: () => piano.stop(),
  setVolume: (v) => (piano.output.volume = Math.round(v * 127)),
  audition: (e) => {
    if (audioContext.state !== 'running') audioContext.resume();
    piano.start({ note: e.pitch, velocity: toMidiVelocity(e.velocity), duration: e.duration });
  },
};
editorEl.sounds = [{ id: 'piano', label: 'Piano (built-in)', output: pianoOutput }];

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
