import type { Key, Note, TempoEvent, TimeSigEvent } from './types';

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
  | { op: 'meta'; key: MetaKey; from: unknown; to: unknown };

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
  }
}

export const invertPatches = (patches: readonly Patch[]) => patches.map(invertPatch).reverse();
