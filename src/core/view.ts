import type { FoldMode } from './music/rowmap';
import type { GridValue } from './music/grid';
import type { Tick } from './types';

export type Tool = 'select' | 'draw' | 'erase' | 'velocity';

/** How notes are colored. `pitch`: low → high gradient. `pitch-class`: every C the same. `mono`: one color. */
export type NoteColorMode = 'pitch' | 'pitch-class' | 'mono';

/** Everything about how the doc is looked at. Never undoable. */
export interface ViewState {
  /** Horizontal zoom. */
  pxPerTick: number;
  /** Vertical zoom. */
  rowHeight: number;
  /** Tick at the left edge. */
  scrollTick: number;
  /** Row at the top edge (fractional). `null` = center on content when first shown. */
  scrollRow: number | null;
  grid: GridValue;
  snap: boolean;
  tool: Tool;
  fold: FoldMode;
  /** Constrain placing and pitch moves to the key's scale. */
  scaleLock: boolean;
  /** Dim rows outside the key's scale. */
  scaleHighlight: boolean;
  /** Keep the playhead in view while playing. */
  follow: boolean;
  /** Length and velocity for new notes. Updated as the user works. */
  noteLength: Tick | null;
  noteVelocity: number;
  /** Insert / paste position. */
  cursor: Tick;
  noteColor: NoteColorMode;
  /** Play notes from the computer keyboard (Z row = `keyboardBase`). */
  computerKeyboard: boolean;
  /** Pitch on the Z key. C0 (12) … C6 (84). */
  keyboardBase: number;
  /** Play only the key's scale notes. Computer keys step through the scale (Z = tonic); MIDI notes snap to the nearest scale note. */
  keyboardScale: boolean;
  /** Play notes from a MIDI controller. Can be on together with `computerKeyboard`. */
  midiInput: boolean;
  /** MIDI input device id to listen to. `null` = every device. */
  midiDevice: string | null;
  /** Show the chords panel (drag chords that fit the key onto the grid). */
  chordsPanel: boolean;
}

export const DEFAULT_VIEW: ViewState = {
  pxPerTick: 0.1,
  rowHeight: 16,
  scrollTick: 0,
  scrollRow: null,
  grid: '1/16',
  snap: true,
  tool: 'select',
  fold: 'none',
  scaleLock: false,
  scaleHighlight: true,
  follow: false,
  noteLength: null,
  noteVelocity: 0.8,
  cursor: 0,
  noteColor: 'pitch',
  computerKeyboard: false,
  keyboardBase: 36,
  keyboardScale: false,
  midiInput: false,
  midiDevice: null,
  chordsPanel: false,
};

export const ZOOM_LIMITS = {
  pxPerTick: [0.004, 2] as const,
  rowHeight: [8, 40] as const,
};
