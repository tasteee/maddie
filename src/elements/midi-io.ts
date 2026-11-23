import { downloadMidi, fromMidiFile, MidiParseError, toMidiFile, type Editor, type MaddieDoc, type MidiExportOptions, type MidiImport } from '../core';
import { showEditorToast } from './zest';
import { saveEditorFile } from './save-file';
import { Engine } from '../engine/engine';

const isMidi = (f: File) => /\.(mid|midi|smf)$/i.test(f.name) || f.type === 'audio/midi' || f.type === 'audio/x-midi';

export const MIDI_ACCEPT = '.mid,.midi,.smf,audio/midi,audio/x-midi';

/** Let the host handle the export, or download it in the browser. */
export const requestMidiExport = (doc: MaddieDoc, filename: string, source: HTMLElement, options?: MidiExportOptions, usePicker = false) => {
  const bytes = toMidiFile(doc, options);
  const go = source.dispatchEvent(
    new CustomEvent('maddie-export', { detail: { bytes, filename }, bubbles: true, composed: true, cancelable: true }),
  );
  if (!go) return;
  if (usePicker) {
    const blob = new Blob([Uint8Array.from(bytes)], { type: 'audio/midi' });
    void saveEditorFile(blob, filename, 'MIDI file', '.mid').catch(() => {
      showEditorToast("Couldn't export MIDI.");
    });
    return;
  }
  downloadMidi(doc, filename, options);
};

/**
 * Append a MIDI file as new tracks in one undoable edit.
 * Fires a cancelable `maddie-import` event from `source` first.
 */
export function importMidiFile(editor: Editor, file: File, source: HTMLElement): Promise<boolean> {
  return importMidiFiles(editor, [file], source);
}

/** Append the readable, accepted files as a single undoable batch. */
export async function importMidiFiles(editor: Editor, files: readonly File[], source: HTMLElement): Promise<boolean> {
  if (!files.length) return false;
  const engine = Engine.for(editor);
  const imported: { name: string; midi: MidiImport }[] = [];
  const errors: string[] = [];
  let projectChanged = false;
  const unwatch = editor.on('change', ({ patches, origin }) => {
    if (origin === 'load' && !patches.length) projectChanged = true;
  });
  try {
    for (const file of files) {
      if (!isMidi(file)) {
        errors.push(`${file.name} isn't a MIDI file`);
        continue;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (projectChanged) break;
        const go = source.dispatchEvent(
          new CustomEvent('maddie-import', { detail: { file, bytes }, bubbles: true, composed: true, cancelable: true }),
        );
        if (projectChanged) break;
        if (go) imported.push({ name: file.name, midi: fromMidiFile(bytes, { ppq: editor.ppq }) });
      } catch (err) {
        errors.push(err instanceof MidiParseError ? `Couldn't read ${file.name}: ${err.message}` : `Couldn't read ${file.name}`);
      }
    }
    if (projectChanged) {
      engine.toast('MIDI import cancelled because the project changed.');
      return false;
    }
    const tracks = editor.commands.appendMidiFiles(imported);
    if (errors.length) {
      const more = errors.length - 1;
      engine.toast(more ? `${errors[0]} · ${more} more files skipped` : errors[0], 'error');
    }
    if (!tracks.length) return false;
    if (tracks[0].notes.length) engine.centerOnNotes({ resetTime: true, animate: true });
    const label = imported.length === 1 ? imported[0].name : `${imported.length} MIDI files`;
    engine.toast(`Imported ${label} · ${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}`);
    return true;
  } catch {
    engine.toast('Could not import MIDI files', 'error');
    return false;
  } finally {
    unwatch();
  }
}

/** Open the file picker and import the chosen files. Call from a user gesture. */
export function pickMidiFile(editor: Editor, source: HTMLElement) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = MIDI_ACCEPT;
  input.multiple = true;
  input.addEventListener('change', () => {
    if (input.files) void importMidiFiles(editor, [...input.files], source);
  });
  input.click();
}
