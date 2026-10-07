// Importing this module defines every Maddie element.
// Root first, so children find their editor on upgrade.
export { MaddieRoot, type MaddieChangeDetail } from './root';
export { MaddieEditor } from './editor';
export { MaddiePianoRoll } from './piano-roll';
export { MaddieKeyboard } from './keyboard';
export { MaddieRuler } from './ruler';
export { MaddieVelocityLane } from './velocity-lane';
export { MaddieChords } from './chords';
export { MaddieInspector, MaddieScrub, MaddieRangeScrub } from './inspector';
export {
  MaddieToolbar,
  MaddieToolSelect,
  MaddieGridSelect,
  MaddieSnapToggle,
  MaddieKeySelect,
  MaddieScaleLock,
  MaddieFoldSelect,
  MaddieTransport,
  MaddieTempo,
  MaddieHistory,
  MaddieZoom,
  MaddieExport,
  MaddieImport,
  MaddieMetronome,
  MaddieVolume,
  MaddieLoopToggle,
  MaddieFollowToggle,
  MaddieInput,
  MaddieOutput,
  MaddieChordsToggle,
  MaddieTopbar,
  MaddieEditbar,
} from './controls';
export { importMidiFile, pickMidiFile } from './midi-io';
export { OutputRouter, createMidiOutput, MIDI_SOURCE, type SoundChoice, type MidiPort } from '../engine/output-router';
export { MidiInput, setMidiInput, setMidiDevice, type MidiDevice } from '../engine/midi-input';
export { MaddieElement } from './base';
export { tokens } from './tokens';
export { actions, defaultKeymap, type Keymap, type Action } from '../engine/keymap';
export type { NoteState, NoteStyle } from './paint';
