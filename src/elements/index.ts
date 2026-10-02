// Importing this module defines every Maddie element.
// Root first, so children find their editor on upgrade.
export { MaddieRoot, type MaddieChangeDetail } from './root';
export { MaddieEditor } from './editor';
export { MaddiePianoRoll } from './piano-roll';
export { MaddieKeyboard } from './keyboard';
export { MaddieRuler } from './ruler';
export { MaddieVelocityLane } from './velocity-lane';
export { MaddieInspector, MaddieScrub } from './inspector';
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
} from './controls';
export { importMidiFile, pickMidiFile } from './midi-io';
export { MaddieElement } from './base';
export { tokens } from './tokens';
export { actions, defaultKeymap, type Keymap, type Action } from '../engine/keymap';
export type { NoteState, NoteStyle } from './paint';
