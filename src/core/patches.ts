import type { Key, Note, TempoEvent, TimeSigEvent, Track, TrackChangesT } from './types';

export type MetaKey = 'tempo' | 'timeSignature' | 'key';
export interface MetaValues {
  tempo: TempoEvent[];
  timeSignature: TimeSigEvent[];
  key: Key | null;
}

/** The atoms of every change. History stores them; sync adapters ship them. */
export type Patch =
  | { op: 'add'; track: string; note: Note }
  | { op: 'remove'; track: string; note: Note }
  | { op: 'replace'; track: string; from: Note; to: Note }
  | { op: 'meta'; key: MetaKey; from: unknown; to: unknown }
  // A whole track, notes included, so undo can bring it back.
  | { op: 'track-add'; track: Track; index: number }
  | { op: 'track-remove'; track: Track; index: number }
  | { op: 'track-update'; id: string; from: TrackChangesT; to: TrackChangesT };

export function invertPatch(p: Patch): Patch {
  switch (p.op) {
    case 'add':
      return { op: 'remove', track: p.track, note: p.note };
    case 'remove':
      return { op: 'add', track: p.track, note: p.note };
    case 'replace':
      return { op: 'replace', track: p.track, from: p.to, to: p.from };
    case 'meta':
      return { op: 'meta', key: p.key, from: p.to, to: p.from };
    case 'track-add':
      return { op: 'track-remove', track: p.track, index: p.index };
    case 'track-remove':
      return { op: 'track-add', track: p.track, index: p.index };
    case 'track-update':
      return { op: 'track-update', id: p.id, from: p.to, to: p.from };
  }
}

export const invertPatches = (patches: readonly Patch[]) => patches.map(invertPatch).reverse();
