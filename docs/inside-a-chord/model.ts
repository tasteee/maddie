import type { ScaledT } from '@tasteee/scaled/types';
import { createEditor } from '../../src/core/editor';
import { loadScaled, scaledKey } from '../../src/core/chord-track';
import type { Key, Note } from '../../src/core/types';
import type { ChordType } from '../../src/core/music/chords';

export const PPQ = 960;
export const BEATS = 4;
export const CASTRATO = '35b44227-b89d-4e3d-83ee-ceefd673053f';
export const BASIC_BASS = '1c66211c-eb7d-4745-b270-272f3a9d50fe';
export const BUTTON_PATTERNS = [CASTRATO, BASIC_BASS];

export type Shape = { octave: number; inversion: number; voicing: ScaledT.VoicingNameT };
export type Harmony = { root: number; type: ChordType; symbol: string; key: Key };
export type PlaybackNote = Pick<Note, 'id' | 'pitch' | 'start' | 'duration' | 'velocity'>;

export const ROOT_SHAPE: Shape = { octave: 4, inversion: 0, voicing: 'rootPosition' };
export const pitchInstructions = {
  voice1: { label: 'Chord voice 1', pitch: { type: 'chordTone', index: 0 } },
  voice2: { label: 'Chord voice 2', pitch: { type: 'chordTone', index: 1 } },
  voice3: { label: 'Chord voice 3', pitch: { type: 'chordTone', index: 2 } },
  degree3: { label: 'Scale degree 3', pitch: { type: 'scaleDegree', index: 2 } },
  root: { label: 'Chord root', pitch: { type: 'rootOffset', semitones: 0 } },
  fifth: { label: 'Root + 7 semitones', pitch: { type: 'rootOffset', semitones: 7 } },
  fixed: { label: 'Fixed MIDI 60', pitch: { type: 'midi', midiNote: 60 } },
} as const satisfies Record<string, { label: string; pitch: ScaledT.PatternPitchSelectorT }>;
export type Rule = keyof typeof pitchInstructions;
export type CustomHit = { rule: Rule; enabled: boolean; startBeat: number; durationBeats: number };
export const initialHits: CustomHit[] = [
  { rule: 'voice1', enabled: true, startBeat: 0, durationBeats: .5 },
  { rule: 'voice2', enabled: true, startBeat: 1, durationBeats: .5 },
  { rule: 'fifth', enabled: true, startBeat: 2, durationBeats: .5 },
  { rule: 'fixed', enabled: true, startBeat: 3, durationBeats: .5 },
];

export type Result = {
  region: ReturnType<ReturnType<typeof createEditor>['chordTrack']['draft']>['region'];
  notes: readonly PlaybackNote[];
  template?: ScaledT.PerformanceTemplateT;
  pattern?: ScaledT.PerformancePatternT;
};

export async function makeEngine() {
  const scaled = await loadScaled();
  const editor = createEditor({ doc: { ppq: PPQ } });
  const templates = new Map(scaled.performanceTemplates.map((template) => [template.id, template]));
  let activeKey = '';

  const render = (harmony: Harmony, shape: Shape, templateId = '', hits?: readonly CustomHit[]): Result => {
    const { root, type, symbol, key } = harmony;
    const keyId = JSON.stringify(key);
    if (keyId !== activeKey) {
      editor.commands.setKey(key);
      activeKey = keyId;
    }
    const { region, notes } = editor.chordTrack.draft({ root, symbol, intervals: type.intervals }, { ...shape, templateId });
    const template = templates.get(templateId);
    if (!template && !hits) return { region, notes };

    const context = region.performance ?? scaledKey(key, root);
    const octave = Math.floor(Math.min(...region.pitches) / 12) - 1;
    if (template) {
      const pattern = scaled.adaptPerformanceTemplate({ template, midiNotes: region.pitches, chordRootPitch: root, ...context, octave });
      return { region, notes, template, pattern };
    }
    const pattern: ScaledT.PerformancePatternT = {
      id: 'custom-loop',
      name: 'Your pattern',
      durationBeats: BEATS,
      events: (hits ?? []).flatMap((hit, index) => hit.enabled ? [{
        id: 'hit-' + (index + 1), pitch: pitchInstructions[hit.rule].pitch, startBeat: hit.startBeat,
        durationBeats: hit.durationBeats, velocity: 96,
      }] : []),
    };
    const chord = { symbol, rootPitch: root, chordType: symbol, intervals: type.intervals, midiNotes: region.pitches };
    const clip = scaled.applyPerformance({ progression: [{ chord, startBeat: 0, durationBeats: BEATS }], performance: pattern, ...context, octave });
    return {
      region, pattern,
      notes: clip.notes.map((note) => ({
        id: note.id,
        pitch: note.midiNote,
        start: Math.round(note.startBeat * PPQ),
        duration: Math.min(BEATS * PPQ, Math.max(Math.round((note.startBeat + note.durationBeats) * PPQ), Math.round(note.startBeat * PPQ) + 1)) - Math.round(note.startBeat * PPQ),
        velocity: note.velocity / 127,
      })),
    };
  };
  return { scaled, templates, render };
}

export function getTrace(result: Result, note: PlaybackNote | undefined) {
  if (!note || !result.pattern) return {};
  // Scaled clip IDs end with the repeat index and index in the adapted event array.
  const eventIndex = Number(note.id.split(':').at(-1));
  const event = result.pattern.events[eventIndex];
  if (!event) return {};
  const rhythmVoice = /^voice-(\d+):event-(\d+)$/.exec(event.id ?? '');
  const sourceId = rhythmVoice?.[2] ?? (/^\d+$/.test(event.id ?? '') ? event.id : undefined);
  // Minor variants can substitute a different source template in these groups.
  const template = result.template;
  const canSubstitute = (template?.category === 'Phrases' && template.subcategory === 'Avant Garde') ||
    (template?.category === 'Bass' && ['Melodic Bass', 'Sidechain Bass', 'Triplet Bass'].includes(template.subcategory));
  const minorChord = result.region.pitches.some((note) => (note - result.region.root + 12) % 12 === 3) &&
    !result.region.pitches.some((note) => (note - result.region.root + 12) % 12 === 4);
  const source = canSubstitute && minorChord ? undefined : template?.events.find((candidate) => String(candidate.id) === sourceId);
  return { event, source, rhythmVoice: rhythmVoice ? Number(rhythmVoice[1]) + 1 : undefined };
}

export const noteSignature = (note: PlaybackNote) => [note.pitch, note.start, note.duration, note.velocity].join('/');

