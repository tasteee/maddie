import { MidiParseError, type Editor } from '../core';
import { Engine } from '../engine/engine';

const isMidi = (f: File) => /\.(mid|midi|smf)$/i.test(f.name) || f.type === 'audio/midi' || f.type === 'audio/x-midi';

export const MIDI_ACCEPT = '.mid,.midi,audio/midi,audio/x-midi';

/**
 * Import a .mid file into the editor (replaces notes; undoable).
 * Fires a cancelable `maddie-import` event from `source` first.
 */
export async function importMidiFile(editor: Editor, file: File, source: HTMLElement): Promise<boolean> {
  const engine = Engine.for(editor);
  if (!isMidi(file)) {
    engine.toast(`${file.name} isn't a MIDI file`, 'error');
    return false;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const go = source.dispatchEvent(
    new CustomEvent('maddie-import', { detail: { file, bytes }, bubbles: true, composed: true, cancelable: true }),
  );
  if (!go) return false;
  try {
    const midi = editor.commands.importMidi(bytes);
    engine.centerOnNotes({ resetTime: true, animate: true });
    const n = midi.notes.length;
    engine.toast(`Imported ${file.name} · ${n} ${n === 1 ? 'note' : 'notes'} · undo with ⌘Z`);
    return true;
  } catch (err) {
    engine.toast(err instanceof MidiParseError ? `Couldn't read ${file.name}: ${err.message}` : `Couldn't read ${file.name}`, 'error');
    return false;
  }
}

/** Open the file picker and import the chosen file. Call from a user gesture. */
export function pickMidiFile(editor: Editor, source: HTMLElement) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = MIDI_ACCEPT;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) importMidiFile(editor, file, source);
  });
  input.click();
}
