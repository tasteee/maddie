import { SplendidGrandPiano } from 'smplr';
import { toMidiVelocity, type Output } from '../src/core';
import '../src/elements';
import { DEMO_TEMPO, demoSong } from './demo-song';

const editorEl = document.querySelector('maddie-editor')!;
const editor = editorEl.editor;

// ── Sound: Maddie only dispatches notes. smplr makes the sound. ───────
const audioContext = new AudioContext();
const piano = SplendidGrandPiano(audioContext, { volume: 100 });
editorEl.audioContext = audioContext;

const output: Output = {
  noteOn: (e) => piano.start({ note: e.pitch, velocity: toMidiVelocity(e.velocity), time: e.time, duration: e.duration }),
  noteOff: () => {}, // duration handles release
  allNotesOff: () => piano.stop(),
  audition: (e) => {
    if (audioContext.state !== 'running') audioContext.resume();
    piano.start({ note: e.pitch, velocity: toMidiVelocity(e.velocity), duration: e.duration });
  },
};
editorEl.output = output;

// ── Content ─────────────────────────────────────────────────────────
editorEl.notes = demoSong();
editor.commands.setTempo(DEMO_TEMPO, { origin: 'load' });
editor.transport.setLoop({ start: 0, end: editor.ppq * 16, enabled: true });
editor.setView({ pxPerTick: 0.075 });

// ── Theme ───────────────────────────────────────────────────────────
const themeBtn = document.getElementById('theme')!;
const sun = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.25M8 13.25v1.25M1.5 8h1.25M13.25 8h1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9"/></svg>`;
const moon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M13.5 9.5A5.75 5.75 0 0 1 6.5 2.5a5.75 5.75 0 1 0 7 7Z"/></svg>`;
const stored = (() => {
  try {
    return localStorage.getItem('maddie-theme') as 'light' | 'dark' | null;
  } catch {
    return null;
  }
})();
let theme: 'light' | 'dark' = stored ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const applyTheme = () => {
  document.documentElement.dataset.theme = theme;
  editorEl.theme = theme;
  themeBtn.innerHTML = theme === 'dark' ? sun : moon;
};
themeBtn.addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem('maddie-theme', theme);
  } catch {}
  applyTheme();
});
applyTheme();
