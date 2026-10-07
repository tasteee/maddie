import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditor } from '../src/core';

// 120 bpm at 960 ppq: 1920 ticks per second.
const TPS = 1920;

function setup() {
  const clock = { currentTime: 0, state: 'running', outputLatency: 0, resume: async () => {} };
  const ed = createEditor({ audioContext: clock as unknown as AudioContext, output: { noteOn: () => {}, noteOff: () => {}, allNotesOff: () => {} } });
  ed.transport.setMetronome({ enabled: false });
  // play() anchors 50ms ahead; `at(s)` sets the clock to `s` seconds after that anchor.
  const at = (s: number) => {
    clock.currentTime = 0.05 + s;
    vi.advanceTimersByTime(30); // let the scheduler catch up (loop wraps)
  };
  return { ed, at };
}

describe('recorder', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('plays from the marker and turns held keys into notes', async () => {
    const { ed, at } = setup();
    ed.transport.seek(TPS);
    await ed.recorder.start();
    expect(ed.transport.playing).toBe(true);
    expect(ed.recorder.recording).toBe(true);

    at(0.5);
    ed.liveNoteOn(60, 0.7);
    at(1);
    expect(ed.recorder.held).toEqual([{ pitch: 60, start: TPS * 1.5, velocity: 0.7 }]);
    ed.liveNoteOff(60);

    expect(ed.notes()).toMatchObject([{ pitch: 60, start: TPS * 1.5, duration: TPS / 2, velocity: 0.7 }]);
  });

  it('closes held notes on stop and makes the take one undo step', async () => {
    const { ed, at } = setup();
    await ed.recorder.start();
    at(0.25);
    ed.liveNoteOn(60);
    at(0.5);
    ed.liveNoteOff(60);
    ed.liveNoteOn(64);
    at(1);
    ed.recorder.stop();

    expect(ed.recorder.recording).toBe(false);
    expect(ed.transport.playing).toBe(false);
    expect(ed.notes().map((n) => [n.pitch, n.start, n.duration])).toEqual([
      [60, TPS / 4, TPS / 4],
      [64, TPS / 2, TPS / 2],
    ]);
    expect(ed.selection.size).toBe(2);
    ed.undo();
    expect(ed.notes()).toHaveLength(0);
  });

  it('ends the take when the transport stops (space bar)', async () => {
    const { ed, at } = setup();
    await ed.recorder.start();
    at(0.5);
    ed.liveNoteOn(62);
    ed.transport.toggle();
    expect(ed.recorder.recording).toBe(false);
    expect(ed.notes()).toHaveLength(1);
  });

  it('ignores live notes when not recording', async () => {
    const { ed, at } = setup();
    await ed.transport.play();
    at(0.5);
    ed.liveNoteOn(60);
    at(1);
    ed.liveNoteOff(60);
    expect(ed.notes()).toHaveLength(0);
  });

  it('ends a note held across the loop wrap at the loop end', async () => {
    const { ed, at } = setup();
    ed.transport.setLoop({ enabled: true, start: 0, end: TPS });
    await ed.recorder.start();
    at(0.75);
    ed.liveNoteOn(60);
    at(1.25); // wrapped: position is 0.25s into the loop
    ed.liveNoteOff(60);
    expect(ed.notes()).toMatchObject([{ start: TPS * 0.75, duration: TPS / 4 }]);
  });
});
