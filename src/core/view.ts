import type { ScaledT } from '@tasteee/scaled/types';
import type { ChordFamily } from './music/chords';
import type { FoldMode } from './music/rowmap';
import type { GridValue } from './music/grid';
import type { Tick } from './types';


/** How notes are colored. `pitch`: low → high gradient. `pitch-class`: every C the same. `mono`: one color. */
export type NoteColorMode = 'pitch' | 'pitch-class' | 'mono';

export const CHORD_VOICINGS: Record<ScaledT.VoicingNameT, string> = {
  rootPosition: 'Root position', closed: 'Closed', open: 'Open', dynamic: 'Dynamic',
  dynamicBass: 'Dynamic with bass', guitar: 'Guitar', drop2: 'Drop 2', drop3: 'Drop 3',
  drop4: 'Drop 4', drop2and3: 'Drop 2 and 3', drop2and4: 'Drop 2 and 4', spread: 'Spread', shell: 'Shell',
};

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
  /** Pitch on the Z key. C0 (12) … C7 (96). */
  keyboardBase: number;
  /** Play only the key's scale notes. Computer keys step through the scale (Z = tonic); MIDI notes snap to the nearest scale note. */
  keyboardScale: boolean;
  /** Play notes from a MIDI controller. Can be on together with `computerKeyboard`. */
  midiInput: boolean;
  /** MIDI input device id to listen to. `null` = every device. */
  midiDevice: string | null;
  /** Show the chords panel (drag chords that fit the key onto the grid). */
  chordsPanel: boolean;
  chordsTab: 'browse' | 'suggestions' | 'song';
  chordFamily: ChordFamily | 'all';
  chordQuery: string;
  chordToggledRoots: readonly number[];
  chordSetupOpen: boolean;
  chordOctave: number;
  chordInversion: number;
  chordVoicing: ScaledT.VoicingNameT;
  chordCategory: string;
  chordTemplateId: string;
  quantizeGrid: GridValue;
  quantizeStrength: number;
  humanizeTiming: number;
  humanizeVelocity: number;
  /** Velocity ramp across the selection: first and last note, 0–100. */
  rampFrom: number;
  rampTo: number;
  /** Strum direction (`down`: low pitch first) and how much of the chord's length it spreads over, 0–100. */
  strumDirection: 'down' | 'up';
  strumAmount: number;
  /** An app setting, not part of a project. Draw other tracks' notes faintly behind the active track. */
  ghostNotes: boolean;
}

export const DEFAULT_VIEW: ViewState = {
  pxPerTick: 0.09,
  rowHeight: 20,
  scrollTick: 0,
  scrollRow: null,
  grid: '1/16',
  snap: true,
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
  chordsTab: 'browse',
  chordFamily: 'all',
  chordQuery: '',
  chordToggledRoots: [],
  chordSetupOpen: false,
  chordOctave: 3,
  chordInversion: 0,
  chordVoicing: 'rootPosition',
  chordCategory: '',
  chordTemplateId: '',
  quantizeGrid: 'current',
  quantizeStrength: 100,
  humanizeTiming: 20,
  humanizeVelocity: 10,
  rampFrom: 30,
  rampTo: 100,
  strumDirection: 'down',
  strumAmount: 50,
  ghostNotes: true,
};

/** View keys that belong to the app, not to a project. Projects neither save nor restore them. */
export type AppViewKeyT = 'ghostNotes';

export const ZOOM_LIMITS = {
  pxPerTick: [0.0001, DEFAULT_VIEW.pxPerTick * 4] as const,
  rowHeight: [1, 32] as const,
};
