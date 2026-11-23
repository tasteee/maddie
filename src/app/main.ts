/// <reference types="vite/client" />
import { SplendidGrandPiano, Soundfont, ElectricPiano, type LoadProgress } from 'smplr';
import { toMidiVelocity, type Output } from '../core';
import '@tasteee/zest/ink.css';
import '@tasteee/zest/fonts.css';
import '../elements';
import { OutputRouter } from '../engine/output-router';
import './project-menu';
import type { MaddieProjectMenu } from './project-menu';
import { PROJECT_STORAGE_KEY, Projects } from './projects';

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

type SoundLoad = { label: string; state: 'loading' | 'ready' | 'error'; progress?: LoadProgress };
type SampledPlayer = Player & { ready: Promise<void>; loadProgress: LoadProgress };

const router = OutputRouter.for(editor);
const soundLoads = new Map<string, SoundLoad>();
const loading = document.querySelector<HTMLElement>('#instrument-loading')!;
const loadingLabel = loading.querySelector<HTMLElement>('#instrument-loading-label')!;
const loadingPercent = loading.querySelector<HTMLElement>('#instrument-loading-percent')!;
const progressBar = loading.querySelector<HTMLProgressElement>('progress')!;

// The default sound, then any sound a track uses on its own.
function getWatchedSoundIds(): string[] {
  const trackSoundIds = editor.trackList.flatMap((track) => (track.route?.kind === 'sound' ? [track.route.soundId] : []));
  return [router.source, ...trackSoundIds];
}

function updateSoundIndicator() {
  const watchedLoads = getWatchedSoundIds().map((id) => soundLoads.get(id));
  const sound = watchedLoads.find((load) => load && load.state !== 'ready') ?? watchedLoads[0];
  const visible = !!sound && sound.state !== 'ready';
  loading.hidden = !visible;
  if (!visible || !sound) return;
  const failed = sound.state === 'error';
  const label = failed ? 'Could not load ' + sound.label : 'Loading ' + sound.label;
  if (loadingLabel.textContent !== label) loadingLabel.textContent = label;
  progressBar.hidden = failed;
  if (!failed && sound.progress && sound.progress.total > 0) {
    const { loaded, total } = sound.progress;
    const percent = Math.min(100, Math.floor(100 * loaded / total));
    progressBar.max = 100;
    progressBar.value = percent;
    loadingPercent.textContent = percent + '%';
  } else {
    progressBar.removeAttribute('value');
    loadingPercent.textContent = '';
  }
}

router.onChange(updateSoundIndicator);

// Create each instrument on first use and show progress only for the active sound.
function instrumentSound(id: string, label: string, create: (onLoadProgress: (progress: LoadProgress) => void) => SampledPlayer, playPartial = false) {
  let output: Output | undefined;
  return {
    id,
    label,
    get output() {
      if (output) return output;
      const load: SoundLoad = { label, state: 'loading' };
      soundLoads.set(id, load);
      const player = create((progress) => {
        load.progress = progress;
        updateSoundIndicator();
      });
      load.progress = player.loadProgress;
      void player.ready.then(() => {
        load.state = 'ready';
        updateSoundIndicator();
      }, (error: unknown) => {
        load.state = 'error';
        updateSoundIndicator();
        console.error('Could not load sound', error);
      });
      return output = makeOutput(player, () => load.state === 'ready' ||
        (playPartial && (load.progress?.loaded ?? 0) > 0));
    },
  };
}

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

let storage: Storage | null = null;
try { storage = localStorage; } catch {}
const projects = new Projects(editor, storage);
editorEl.sounds = [
  instrumentSound('piano', 'Grand Piano', (onLoadProgress) => SplendidGrandPiano(audioContext, { volume: 100, onLoadProgress }), true),
  instrumentSound('ep-pianet', 'Pianet T', (onLoadProgress) => ElectricPiano(audioContext, { instrument: 'PianetT', volume: 100, onLoadProgress })),
  instrumentSound('ep-wurlitzer', 'Wurlitzer EP200', (onLoadProgress) => ElectricPiano(audioContext, { instrument: 'WurlitzerEP200', volume: 100, onLoadProgress })),
  ...GM_SOUNDS.map(([id, label, instrument]) => instrumentSound(id, label,
    (onLoadProgress) => Soundfont(audioContext, { instrument, kit: 'MusyngKite', volume: 100, onLoadProgress }))),
];

const projectMenu = document.querySelector<MaddieProjectMenu>('maddie-project-menu')!;
projectMenu.editor = editor;
projectMenu.projects = projects;
window.addEventListener('pagehide', projects.flush);
window.addEventListener('storage', (event) => {
  if (event.key === PROJECT_STORAGE_KEY) projects.refreshLibrary();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') projects.flush();
});
