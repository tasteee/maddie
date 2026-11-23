import { describe, expect, it } from 'vitest';
import { createEditor } from '../src/core';

const notesAt = (pitch: number, editor: ReturnType<typeof createEditor>) =>
  editor.notes().filter((note) => note.pitch === pitch).map((note) => [note.start, note.duration]);

describe('notes never overlap: the newest edit wins', () => {
  it('removes a note the new note fully covers', () => {
    const editor = createEditor();
    editor.commands.add([{ pitch: 60, start: 240, duration: 240, velocity: 0.8 }]);
    editor.commands.add([{ pitch: 60, start: 0, duration: 960, velocity: 0.8 }]);
    expect(notesAt(60, editor)).toEqual([[0, 960]]);
  });

  it('trims the end of a note the new one starts inside', () => {
    const editor = createEditor();
    editor.commands.add([{ pitch: 60, start: 0, duration: 960, velocity: 0.8 }]);
    editor.commands.add([{ pitch: 60, start: 480, duration: 960, velocity: 0.8 }]);
    expect(notesAt(60, editor)).toEqual([[0, 480], [480, 960]]);
  });

  it('pushes the start of a note the new one ends inside', () => {
    const editor = createEditor();
    editor.commands.add([{ pitch: 60, start: 480, duration: 960, velocity: 0.8 }]);
    editor.commands.add([{ pitch: 60, start: 0, duration: 960, velocity: 0.8 }]);
    expect(notesAt(60, editor)).toEqual([[0, 960], [960, 480]]);
  });

  it('ends a surrounding note where the new one starts and drops its tail', () => {
    const editor = createEditor();
    editor.commands.add([{ pitch: 60, start: 0, duration: 1920, velocity: 0.8 }]);
    editor.commands.add([{ pitch: 60, start: 480, duration: 240, velocity: 0.8 }]);
    expect(notesAt(60, editor)).toEqual([[0, 480], [480, 240]]);
  });

  it('leaves other pitches alone', () => {
    const editor = createEditor();
    editor.commands.add([{ pitch: 60, start: 0, duration: 960, velocity: 0.8 }]);
    editor.commands.add([{ pitch: 64, start: 0, duration: 960, velocity: 0.8 }]);
    expect(editor.notes()).toHaveLength(2);
  });

  it('makes room for a moved note, and one undo puts everything back', () => {
    const editor = createEditor();
    const [first] = editor.commands.add([{ pitch: 60, start: 0, duration: 480, velocity: 0.8 }]);
    editor.commands.add([{ pitch: 60, start: 960, duration: 480, velocity: 0.8 }]);
    editor.commands.move([first.id], { ticks: 720 });
    expect(notesAt(60, editor)).toEqual([[720, 480], [1200, 240]]);
    editor.undo();
    expect(notesAt(60, editor)).toEqual([[0, 480], [960, 480]]);
  });

  it('resolves overlaps between notes edited together', () => {
    const editor = createEditor();
    editor.commands.add([
      { pitch: 60, start: 0, duration: 960, velocity: 0.8 },
      { pitch: 60, start: 480, duration: 480, velocity: 0.8 },
    ]);
    expect(notesAt(60, editor)).toEqual([[0, 480], [480, 480]]);
  });
});
