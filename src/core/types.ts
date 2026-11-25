import type { ScaledT } from '@tasteee/scaled/types';
import type { ChordDynamicsT } from './chord-dynamics';

/** Time in ticks. Integer. `ppq` ticks per quarter note. */
export type Tick = number;
export type NoteId = string;

export interface Note {
  id: NoteId;
  /** MIDI pitch, 0–127. C4 = 60. */
  pitch: number;
  start: Tick;
  duration: Tick;
  /** 0–1. Use `toMidiVelocity` to convert at the edges. */
  velocity: number;
  channel?: number;
  chordRegionId?: string;
  muted?: boolean;
  /** Consumer payload. Round-tripped untouched. */
  data?: Record<string, unknown>;
}

/** A note without an id. Used when creating notes. */
export type NoteInput = Omit<Note, 'id'> & { id?: NoteId };

export interface TempoEvent {
  tick: Tick;
  bpm: number;
}

export interface TimeSigEvent {
  tick: Tick;
  numerator: number;
  denominator: number;
}

export interface ChordRegion {
  id: string;
  symbol: string;
  root: number;
  intervals: readonly number[];
  pitches: readonly number[];
  start: Tick;
  duration: Tick;
  velocity: number;
  voicing?: ScaledT.VoicingNameT;
  inversion?: number;
  rootMidi?: number;
  performance?: { templateId: string; groupId: string; key: string; scale: string; phaseTicks?: Tick };
  /** Velocity shaping: ramp, humanize, accent. Applied every time the chord's notes are built. */
  dynamics?: ChordDynamicsT;
}

/**
 * Where a track's notes sound, when it is not using the project's default output.
 * A sound is one of the host's instruments. A MIDI route sends to an output port.
 */
export type TrackRouteT =
  | { kind: 'sound'; soundId: string }
  /** `portId: null` means the first port that is connected. `channel` is 0–15 (default 0). */
  | { kind: 'midi'; portId: string | null; channel?: number };

export interface Track {
  id: string;
  name?: string;
  /** Any CSS color. Falls back to a palette color by position (see `getTrackColor`). */
  color?: string;
  /** Playback level from 0 to 1. Defaults to 1. */
  gain?: number;
  /** Where this track sounds. Absent: it follows the project's default output. */
  route?: TrackRouteT;
  /** Silent during playback. Its notes still show in the roll. */
  muted?: boolean;
  /** When any track is soloed, only soloed tracks play. */
  solo?: boolean;
  /** Present on Chord Tracks. Notes are the rendered MIDI for these regions. */
  chordRegions?: readonly ChordRegion[];
  notes: Note[];
}

/** A track without its notes. */
export type TrackMetaT = Omit<Track, 'notes'>;

/** The fields of a track that can change after it is created. */
export type TrackChangesT = Partial<Pick<Track, 'name' | 'color' | 'gain' | 'route' | 'muted' | 'solo' | 'chordRegions'>>;

/** A note and the track it belongs to. */
export type TrackNoteT = { trackId: string; note: Note };

export interface MaddieDoc {
  version: 1;
  ppq: number;
  tempo: TempoEvent[];
  timeSignature: TimeSigEvent[];
  key: Key | null;
  tracks: Track[];
}

export type ScaleId =
  | 'major'
  | 'minor'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'locrian'
  | 'harmonicMinor'
  | 'melodicMinor'
  | 'majorPentatonic'
  | 'minorPentatonic'
  | 'blues'
  | 'chromatic'
  | 'harmonic'
  | 'melodic'
  | 'major-pentatonic'
  | 'pentatonic'
  | 'major-blues'
  | 'whole-tone'
  | 'diminished'
  | 'augmented'
  | 'hungarian-minor'
  | 'gypsy'
  | 'phrygian-dominant'
  | 'double-harmonic'
  | 'persian'
  | 'arabic'
  | 'egyptian'
  | 'hirajoshi'
  | 'in-sen'
  | 'iwato'
  | 'pelog'
  | 'balinese'
  | 'chinese'
  | 'lydian-dominant'
  | 'super-locrian'
  | 'dorian-sharp-four'
  | 'neapolitan-minor'
  | 'neapolitan-major'
  | 'enigmatic'
  | 'prometheus'
  | 'bebop-major'
  | 'bebop-dominant';

export interface Key {
  /** Pitch class, 0 = C … 11 = B. */
  root: number;
  scale: ScaleId;
}
