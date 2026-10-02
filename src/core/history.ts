import type { Patch } from './patches';
import type { NoteId } from './types';

export interface HistoryEntry {
  label: string;
  gestureId?: string;
  patches: Patch[];
  selectionBefore: NoteId[];
  selectionAfter: NoteId[];
}

export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  constructor(public limit = 500) {}

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  get undoLabel() {
    return this.undoStack.at(-1)?.label ?? null;
  }
  get redoLabel() {
    return this.redoStack.at(-1)?.label ?? null;
  }

  /** Adds an entry. Entries with the same `gestureId` as the last one merge into it. */
  push(entry: HistoryEntry) {
    const last = this.undoStack.at(-1);
    if (entry.gestureId && last?.gestureId === entry.gestureId) {
      last.patches.push(...entry.patches);
      last.selectionAfter = entry.selectionAfter;
    } else {
      this.undoStack.push(entry);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.redoStack = [];
  }

  popUndo() {
    const e = this.undoStack.pop();
    if (e) this.redoStack.push(e);
    return e;
  }

  popRedo() {
    const e = this.redoStack.pop();
    if (e) this.undoStack.push(e);
    return e;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}
