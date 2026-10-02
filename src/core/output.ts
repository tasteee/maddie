import type { Note } from './types';

export interface NoteEvent {
  note: Note;
  /** 0–127. */
  pitch: number;
  /** 0–1. */
  velocity: number;
  /** AudioContext time in seconds. `0` = now. */
  time: number;
  /** Seconds. Set on note-on, so sample players can skip note-off. */
  duration?: number;
}

/**
 * Where notes go. Maddie makes no sound itself: it schedules note events
 * ahead of time with exact AudioContext times. Plug in any instrument.
 */
export interface Output {
  noteOn(e: NoteEvent): void;
  noteOff(e: NoteEvent): void;
  /** Stop, seek, loop wrap. */
  allNotesOff(): void;
  /** Preview while editing (placing, dragging pitch, clicking a key). */
  audition?(e: NoteEvent): void;
  /** Metronome click. Optional: a built-in click plays if omitted. */
  click?(e: { time: number; accent: boolean; volume: number }): void;
}
