import { describe, expect, it } from 'vitest';
import { createCapture, createEditor } from '../src/core';

const setup = () => {
  const editor = createEditor({ doc: { tempo: [{ tick: 0, bpm: 120 }] } });
  let nowMs = 1000;
  const capture = createCapture(editor, () => nowMs);
  const advance = (ms: number) => (nowMs += ms);
  return { editor, capture, advance };
};

describe('capture', () => {
  it('turns played notes into notes at the marker, keeping timing', () => {
    const { editor, capture, advance } = setup();
    capture.noteOn(60, 0.8);
    advance(500);
    capture.noteOff(60);
    advance(500);
    capture.noteOn(64, 0.5);
    advance(250);
    capture.noteOff(64);

    const ids = capture.commit();
    const notes = ids.map((id) => editor.getNote(id)!);
    const ticksPerSecond = editor.ppq * 2; // 120 bpm
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ pitch: 60, start: 0, duration: ticksPerSecond * 0.5 });
    expect(notes[1]).toMatchObject({ pitch: 64, start: ticksPerSecond, duration: ticksPerSecond * 0.25 });
    expect(capture.count).toBe(0);
  });

  it('ends still-held notes at the capture moment', () => {
    const { editor, capture, advance } = setup();
    capture.noteOn(60, 0.8);
    advance(1000);
    const [id] = capture.commit();
    expect(editor.getNote(id)!.duration).toBe(editor.ppq * 2);
  });

  it('is one undo step', () => {
    const { editor, capture, advance } = setup();
    capture.noteOn(60, 0.8);
    advance(100);
    capture.noteOff(60);
    capture.noteOn(62, 0.8);
    advance(100);
    capture.noteOff(62);
    capture.commit();
    expect(editor.notes()).toHaveLength(2);
    editor.undo();
    expect(editor.notes()).toHaveLength(0);
  });

  it('returns nothing when nothing was played', () => {
    const { capture } = setup();
    expect(capture.commit()).toEqual([]);
  });

  it('ignores notes played during a take and clears when a take starts', async () => {
    const editor = createEditor();
    editor.liveNoteOn(60);
    editor.liveNoteOff(60);
    expect(editor.capture.count).toBe(1);
    editor.recorder.recording = true;
    editor.liveNoteOn(62);
    editor.liveNoteOff(62);
    expect(editor.capture.count).toBe(1);
    editor.recorder.recording = false;
    editor.capture.clear();
    expect(editor.capture.count).toBe(0);
  });

  it('forgets notes older than ten minutes', () => {
    const { capture, advance } = setup();
    capture.noteOn(60, 0.8);
    advance(100);
    capture.noteOff(60);
    advance(11 * 60 * 1000);
    capture.noteOn(62, 0.8);
    expect(capture.count).toBe(1);
  });
});
