import type { ScaledT } from '@tasteee/scaled/types';
import type { ChordFamily } from './music/chords';
import type { FoldMode } from './music/rowmap';
import type { GridValue } from './music/grid';
import type { ChordRegion, Tick } from './types';


/** How notes are colored. `pitch`: low → high gradient. `pitch-class`: every C the same. `mono`: one color. */
export type NoteColorMode = 'pitch' | 'pitch-class' | 'mono';

export const CHORD_VOICINGS: Record<ScaledT.VoicingNameT, string> = {
  rootPosition: 'Standard', closed: 'Closed', open: 'Open', dynamic: 'Dynamic',
  dynamicBass: 'Dynamic with bass', guitar: 'Guitar', drop2: 'Drop 2', drop3: 'Drop 3',
  drop4: 'Drop 4', drop2and3: 'Drop 2 and 3', drop2and4: 'Drop 2 and 4', spread: 'Spread', shell: 'Shell',
};

export const CHORD_INVERSION_LABELS = ['No inversion', '1st inversion', '2nd inversion', '3rd inversion'] as const;

/**
 * Voicings hidden for now. Dynamic voicings depend on the chord before them, so editing one
 * chord would re-voice the chords after it and change sounds the user already chose.
 */
export const DISABLED_VOICINGS: readonly ScaledT.VoicingNameT[] = ['dynamic', 'dynamicBass'];

/** The voicings the pickers offer. */
export const offeredVoicings = (names: readonly ScaledT.VoicingNameT[]): ScaledT.VoicingNameT[] =>
  names.filter((name) => !DISABLED_VOICINGS.includes(name));

export function chordCraftSettings(region: ChordRegion, tonic = 0): Pick<ViewState, 'chordOctave' | 'chordInversion' | 'chordVoicing' | 'chordTemplateId'> {
  const rootMidi = region.rootMidi ?? Math.min(...region.pitches);
  return {
    chordOctave: Math.max(1, Math.min(6, Math.floor((rootMidi - tonic) / 12) - 1)),
    chordInversion: region.inversion ?? 0,
    chordVoicing: region.voicing ?? 'rootPosition',
    chordTemplateId: region.performance?.templateId ?? '',
  };
}

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
  /** Chords panel open. Closed, it folds to a strip at the right edge. */
  chordsPanel: boolean;
  /** `all`: every chord that fits the key. `project`: chords found in this project. */
  chordsTab: 'all' | 'project';
  /** The Suggestions rail beside the chords panel, open or folded. It shows either way. */
  suggestionsOpen: boolean;
  /** The velocity lane under the grid, open or folded to its label strip. */
  velocityLaneOpen: boolean;
  /** Which pattern picker is open: for the chord being crafted, or for the selected chords. */
  patternPicker: 'craft' | 'selection' | null;
  /** Experimental app settings: force parts of the chords panel to the dark theme. */
  chordsPanelDark: boolean;
  chordCraftDark: boolean;
  suggestionsDark: boolean;
  hiddenChordFamilies: readonly ChordFamily[];
  chordQuery: string;
  chordOctave: number;
  chordInversion: number;
  chordVoicing: ScaledT.VoicingNameT;
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

/**
 * Pixels of empty grid before tick 0, so a note at the very start isn't flush against the
 * keyboard: its velocity handle and edges stay whole and grabbable. Scrolled fully left,
 * `scrollTick` is `minScrollTick(pxPerTick)`, a little below 0.
 */
export const TIME_LEAD_IN_PX = 12;

/** The furthest left the view scrolls at this zoom: tick 0 sits `TIME_LEAD_IN_PX` in. */
export const minScrollTick = (pxPerTick: number): number => -TIME_LEAD_IN_PX / pxPerTick;

export const DEFAULT_VIEW: ViewState = {
  pxPerTick: 0.09,
  rowHeight: 20,
  scrollTick: -TIME_LEAD_IN_PX / 0.09,
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
  chordsTab: 'all',
  suggestionsOpen: true,
  velocityLaneOpen: true,
  patternPicker: null,
  chordsPanelDark: false,
  chordCraftDark: false,
  suggestionsDark: false,
  hiddenChordFamilies: [],
  chordQuery: '',
  chordOctave: 3,
  chordInversion: 0,
  chordVoicing: 'rootPosition',
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
export type AppViewKeyT = 'ghostNotes' | 'patternPicker' | 'chordsPanelDark' | 'chordCraftDark' | 'suggestionsDark';

export const ZOOM_LIMITS = {
  pxPerTick: [0.0001, DEFAULT_VIEW.pxPerTick * 4] as const,
  rowHeight: [1, 32] as const,
};
