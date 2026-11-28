import { BEATS, PPQ, type PlaybackNote } from './model';

const SECONDS_PER_BEAT = .56;
const voices = new Set<{ oscillator: OscillatorNode; gain: GainNode }>();
let context: AudioContext | undefined;
let compressor: DynamicsCompressorNode | undefined;

function audio() {
  context ??= new AudioContext();
  if (!compressor) {
    compressor = context.createDynamicsCompressor();
    compressor.connect(context.destination);
  }
  void context.resume().catch(() => {});
  return { context, compressor };
}

function voice(pitch: number, velocity: number, delay: number, duration: number | null, gainScale: number) {
  const { context, compressor } = audio();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const time = context.currentTime + delay;
  const volume = Math.max(.005, velocity * gainScale);
  oscillator.type = 'triangle';
  oscillator.frequency.value = 440 * 2 ** ((pitch - 69) / 12);
  oscillator.connect(gain);
  gain.connect(compressor);
  gain.gain.setValueAtTime(.0001, time);
  gain.gain.exponentialRampToValueAtTime(volume, time + .018);
  oscillator.start(time);
  const release = duration === null ? null : time + Math.max(.022, duration);
  if (release !== null) {
    gain.gain.setTargetAtTime(.0001, release, .043);
    oscillator.stop(release + .27);
  }
  const node = { oscillator, gain };
  voices.add(node);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
    voices.delete(node);
  };
}

export function hush() {
  if (!context) return;
  const now = context.currentTime;
  for (const { oscillator, gain } of voices) {
    gain.gain.cancelAndHoldAtTime(now);
    gain.gain.setTargetAtTime(.0001, now, .018);
    oscillator.stop(now + .085);
  }
  voices.clear();
}

export function audition(pitches: readonly number[], held: boolean) {
  hush();
  for (const pitch of pitches) voice(pitch, .8, 0, held ? null : .43, .12 / Math.sqrt(pitches.length));
}

export function playNotes(notes: readonly PlaybackNote[]) {
  hush();
  for (const note of notes) voice(note.pitch, note.velocity, .025 + note.start / PPQ * SECONDS_PER_BEAT, note.duration / PPQ * SECONDS_PER_BEAT, .1);
  return (BEATS * SECONDS_PER_BEAT + .025) * 1000;
}
