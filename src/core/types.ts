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
  color?: string;
  notes: Note[];
}

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
