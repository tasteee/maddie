import { createId, type Editor } from './editor';
import type { Tick } from './types';

export interface PendingNote {
  pitch: number;
  start: Tick;
  velocity: number;
}

/**
 * Records live notes (computer keyboard, MIDI input) onto the active track.
 * `start()` plays from the marker; each released key becomes a note.
 * The whole take is one undo step. Stopping the transport ends the take.
 */
export class Recorder {
  recording = false;
  private pending = new Map<number, PendingNote>();
  private takeId: string | null = null;
  private takeNotes: string[] = [];
  private takes = 0;

  constructor(private editor: Editor) {}

  /** Keys held right now, with where they started. For drawing notes as they grow. */
  get held(): readonly PendingNote[] {
    return [...this.pending.values()];
  }

  /** Start a take: play from the marker and record live notes until stop. */
  async start() {
    if (this.recording) return;
    this.recording = true;
    this.takeId = `record-${++this.takes}-${Date.now()}`;
    this.takeNotes = [];
    this.pending.clear();
    this.emit();
    if (!this.editor.transport.playing) await this.editor.transport.play();
  }

  /** End the take and stop the transport (back to the marker). */
  stop() {
    if (!this.recording) return;
    if (this.editor.transport.playing) this.editor.transport.stop();
    else this.finish(this.editor.transport.position);
  }

  toggle() {
    if (this.recording) this.stop();
    else this.start();
  }

  /** @internal From `editor.liveNoteOn`. */
  noteOn(pitch: number, velocity: number) {
    if (!this.canCapture) return;
    this.close(pitch, this.editor.transport.position);
    this.pending.set(pitch, { pitch, start: Math.round(this.editor.transport.position), velocity });
  }

  /** @internal From `editor.liveNoteOff`. */
  noteOff(pitch: number) {
    if (!this.recording) return;
    this.close(pitch, this.editor.transport.position);
  }

  /** @internal The transport is halting at `at`. Close held notes and end the take. */
  finish(at: Tick) {
    if (!this.recording) return;
    for (const pitch of [...this.pending.keys()]) this.close(pitch, at);
    this.recording = false;
    if (this.takeNotes.length) this.editor.select(this.takeNotes);
    this.takeId = null;
    this.takeNotes = [];
    this.emit();
  }

  private get canCapture() {
    return this.recording && this.editor.transport.playing;
  }

  private close(pitch: number, at: Tick) {
    const p = this.pending.get(pitch);
    if (!p) return;
    this.pending.delete(pitch);
    const { loop } = this.editor.transport;
    // Wrapped past the loop end while held: end the note at the loop end.
    let end = Math.round(at);
    if (end < p.start) end = loop.enabled && loop.end > p.start ? loop.end : p.start;
    const duration = Math.max(1, end - p.start);
    const id = createId();
    this.editor.transact('Record notes', (tx) => tx.add({ id, pitch: p.pitch, start: p.start, duration, velocity: p.velocity }), {
      gestureId: this.takeId ?? undefined,
    });
    this.takeNotes.push(id);
  }

  private emit() {
    this.editor.emitTransport();
  }
}
