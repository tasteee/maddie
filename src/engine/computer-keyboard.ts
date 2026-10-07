import { degreeOf, MAX_PITCH, pitchClass, pitchOfDegree, type Editor } from '../core';
import { Engine } from './engine';

/**
 * Play the grid from the computer keyboard.
 * Bottom row starts at `view.keyboardBase`; each key to the right is a semitone up,
 * and each row continues where the one below it ended.
 * With `view.keyboardScale` and a key set, each key is a scale step instead, and Z is the tonic.
 * By physical key (`e.code`), so it works on any layout.
 */
const ROWS = [
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight'],
  ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'],
];

/** Semitone offset from the base, by key code. */
export const KEY_OFFSETS: ReadonlyMap<string, number> = new Map(ROWS.flat().map((code, i) => [code, i]));

const LABELS: Record<string, string> = { Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']' };
export const keyLabel = (code: string) => LABELS[code] ?? code.replace(/^Key|^Digit/, '');

export const BASE_MIN = 12; // C0
export const BASE_MAX = 84; // C6

/** Z-key pitch after one octave step, wrapping C6 → C0 and C0 → C6. */
export function stepOctave(base: number, dir: 1 | -1): number {
  const next = base + dir * 12;
  if (next > BASE_MAX) return BASE_MIN;
  if (next < BASE_MIN) return BASE_MAX;
  return next;
}

/** True when keys map to scale steps (the switch is on and there is a key to follow). */
export const scaleMapped = (editor: Editor) => editor.view.keyboardScale && !!editor.key;

/** Pitch for the key at `offset`, or null if it falls off the top. */
export function pitchForOffset(editor: Editor, offset: number): number | null {
  const base = editor.view.keyboardBase;
  const key = editor.key;
  let pitch = base + offset;
  if (editor.view.keyboardScale && key) {
    const tonic = base + pitchClass(key.root - base);
    pitch = pitchOfDegree(degreeOf(tonic, key) + offset, key);
  }
  return pitch <= MAX_PITCH ? pitch : null;
}

/** Pitch → key label for the current mapping (for drawing hints on the piano keys). */
export function keyLabelsByPitch(editor: Editor): Map<number, string> {
  const out = new Map<number, string>();
  for (const [code, off] of KEY_OFFSETS) {
    const pitch = pitchForOffset(editor, off);
    if (pitch !== null) out.set(pitch, keyLabel(code));
  }
  return out;
}

const held = new WeakMap<Editor, Map<string, number>>();

/**
 * Handle a keydown. Returns true if consumed.
 * ` toggles the mode. While on: mapped keys play notes, + / − change octave.
 */
export function computerKeyDown(editor: Editor, e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (e.code === 'Backquote') {
    setComputerKeyboard(editor, !editor.view.computerKeyboard);
    return true;
  }
  if (!editor.view.computerKeyboard) return false;
  if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.code === 'Minus' || e.code === 'NumpadSubtract') {
    releaseAll(editor);
    const dir = e.code === 'Equal' || e.code === 'NumpadAdd' ? 1 : -1;
    editor.setView({ keyboardBase: stepOctave(editor.view.keyboardBase, dir) });
    return true;
  }
  const off = KEY_OFFSETS.get(e.code);
  if (off === undefined) return false;
  if (e.repeat) return true;
  const pitch = pitchForOffset(editor, off);
  if (pitch === null) return true;
  let map = held.get(editor);
  if (!map) held.set(editor, (map = new Map()));
  map.set(e.code, pitch);
  editor.liveNoteOn(pitch);
  const engine = Engine.for(editor);
  engine.held = new Set(map.values());
  engine.invalidate();
  return true;
}

export function computerKeyUp(editor: Editor, e: KeyboardEvent): boolean {
  const map = held.get(editor);
  const pitch = map?.get(e.code);
  if (pitch === undefined || !map) return false;
  map.delete(e.code);
  if (![...map.values()].includes(pitch)) editor.liveNoteOff(pitch);
  const engine = Engine.for(editor);
  engine.held = new Set(map.values());
  engine.invalidate();
  return true;
}

export function releaseAll(editor: Editor) {
  held.get(editor)?.clear();
  editor.liveAllOff();
  const engine = Engine.for(editor);
  engine.held = new Set();
  engine.invalidate();
}

/** Turn computer-keyboard input on or off. Independent of MIDI input. */
export function setComputerKeyboard(editor: Editor, on: boolean) {
  if (!on) releaseAll(editor);
  editor.setView({ computerKeyboard: on });
}

export function setKeyboardScale(editor: Editor, on: boolean) {
  releaseAll(editor);
  editor.setView({ keyboardScale: on });
}
