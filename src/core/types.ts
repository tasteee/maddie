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

export interface Track {
  id: string;
  name?: string;
  /** Any CSS color. Falls back to a palette color by position (see `getTrackColor`). */
  color?: string;
  /** Silent during playback. Its notes still show in the roll. */
  muted?: boolean;
  /** When any track is soloed, only soloed tracks play. */
  solo?: boolean;
  notes: Note[];
}

/** A track without its notes. */
export type TrackMetaT = Omit<Track, 'notes'>;

/** The fields of a track that can change after it is created. */
export type TrackChangesT = Partial<Pick<Track, 'name' | 'color' | 'muted' | 'solo'>>;

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
  | 'chromatic';

export interface Key {
  /** Pitch class, 0 = C … 11 = B. */
  root: number;
  scale: ScaleId;
}
