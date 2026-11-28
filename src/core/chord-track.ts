import type { ScaledT } from '@tasteee/scaled/types';
import { createId, type Editor } from './editor';
import { shapeChordVelocity, withDynamics } from './chord-dynamics';
import { ticksToSeconds } from './music/timeline';
import { pitchClass } from './music/pitch';
import type { ChordRegion, Key, Note, Tick } from './types';

let engine: ScaledT | undefined;
let loading: Promise<ScaledT> | undefined;

export function loadScaled(): Promise<ScaledT> {
  return loading ??= import('@tasteee/scaled').then(({ scaled }) => engine = scaled).catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
}

const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const SCALE_NAMES = {
  harmonic: 'Harmonic Minor scale',
  harmonicMinor: 'Harmonic Minor scale',
  melodic: 'Melodic Minor scale (asc)',
  melodicMinor: 'Melodic Minor scale (asc)',
  'major-pentatonic': 'Major Pentatonic scale',
  majorPentatonic: 'Major Pentatonic scale',
  pentatonic: 'Minor Pentatonic scale',
  minorPentatonic: 'Minor Pentatonic scale',
  blues: 'Minor Blues Hexatonic Scale',
};

export function scaledKey(key: Key | null, fallbackRoot = 0) {
  const scale = key?.scale;
  return {
    key: KEYS[key?.root ?? fallbackRoot],
    scale: scale && scale !== 'chromatic' ? (SCALE_NAMES[scale as keyof typeof SCALE_NAMES] ?? scale) : 'major',
  };
}

const end = (region: ChordRegion) => region.start + region.duration;
const byStart = (a: ChordRegion, b: ChordRegion) => a.start - b.start;
const octaveOf = (pitch: number) => Math.floor(pitch / 12) - 1;

function chordOf(region: ChordRegion): ScaledT.ChordT {
  return { symbol: region.symbol, rootPitch: region.root, chordType: region.symbol, intervals: region.intervals, midiNotes: region.pitches };
}

function voiceRegion(scaled: ScaledT, region: ChordRegion, voicing: ScaledT.VoicingNameT, inversion: number,
  previousMidiNotes?: readonly number[]): ChordRegion {
  const rootMidi = region.rootMidi ?? region.root + 12 * Math.round((Math.min(...region.pitches) - region.root) / 12);
  const chord = { ...chordOf(region), midiNotes: region.intervals.map((interval) => rootMidi + interval) };
  const pitches = scaled.getChordWithVoicing({ chord, voicing, inversion, previousMidiNotes }).midiNotes;
  return { ...region, voicing, inversion, rootMidi, pitches };
}

function isValid(regions: readonly ChordRegion[]): boolean {
  return regions.every((region, i) => Number.isSafeInteger(region.start) && region.start >= 0 &&
    Number.isSafeInteger(region.duration) && Number.isSafeInteger(end(region)) && region.duration > 0 && (!i || end(regions[i - 1]) <= region.start) &&
    region.pitches.length > 0 && region.pitches.every((pitch) => Number.isInteger(pitch) && pitch >= 0 && pitch <= 127));
}

function renderRegions(regions: readonly ChordRegion[], source: readonly ChordRegion[], existing: readonly Note[], ppq: number): Note[] {
  const groups = new Map<string, ChordRegion[]>();
  const notes: Note[] = [];
  const oldRegions = new Map(source.map((region) => [region.id, region]));
  const oldGroups = new Map<string, ChordRegion[]>();
  const oldNotes = new Map<string, Note[]>();
  for (const region of source) {
    if (!region.performance) continue;
    const groupId = region.performance.groupId;
    const group = oldGroups.get(groupId);
    if (group) group.push(region);
    else oldGroups.set(groupId, [region]);
  }
  for (const note of existing) {
    if (!note.chordRegionId) continue;
    const group = oldNotes.get(note.chordRegionId);
    if (group) group.push(note);
    else oldNotes.set(note.chordRegionId, [note]);
  }
  for (const region of regions) {
    if (region.performance) {
      const id = region.performance.groupId;
      const group = groups.get(id);
      if (group) group.push(region);
      else groups.set(id, [region]);
      continue;
    }
    if (oldRegions.get(region.id) === region) {
      notes.push(...oldNotes.get(region.id) ?? []);
      continue;
    }
    region.pitches.forEach((pitch, i) => notes.push({
      id: region.id + ':voice:' + i,
      chordRegionId: region.id,
      pitch,
      start: region.start,
      duration: region.duration,
      velocity: shapeChordVelocity(region, { id: region.id + ':voice:' + i, start: region.start, pitch }, ppq),
      ...(region.muted ? { muted: true } : {}),
    }));
  }
  for (const [groupId, group] of groups) {
    const previous = oldGroups.get(groupId);
    if (previous?.length === group.length && group.every((region, i) => region === previous[i])) {
      for (const region of group) notes.push(...oldNotes.get(region.id) ?? []);
      continue;
    }
    if (!engine) throw new Error('Chord performances are still loading.');
    const { templateId, key, scale, phaseTicks = 0 } = group[0].performance!;
    const template = engine.performanceTemplates.find((item) => item.id === templateId);
    if (!template) throw new Error('This performance is unavailable.');
    const origin = group[0].start;
    for (const region of group) {
      const octave = octaveOf(Math.min(...region.pitches));
      const performance = engine.adaptPerformanceTemplate({
        template, midiNotes: region.pitches, chordRootPitch: region.root, key, scale, octave,
      });
      // Render the local window at the phase it has in the group. Whole cycles
      // before this region contain no useful hits, including across silent gaps.
      const elapsed = (region.start - origin + phaseTicks) / ppq;
      // Positive modulo: a start pulled earlier than the pattern's start reads the pattern's previous cycle.
      const phase = ((elapsed % performance.durationBeats) + performance.durationBeats) % performance.durationBeats;
      const startBeat = Math.max(0, phase - 1e-10);
      const progression = [{ id: region.id, chord: chordOf(region), startBeat, durationBeats: region.duration / ppq + phase - startBeat }];
      const clip = engine.applyPerformance({ progression, performance, key, scale, octave });
      for (const hit of clip.notes) {
        const start = Math.max(region.start, region.start + Math.round((hit.startBeat - phase) * ppq));
        if (start >= end(region)) continue;
        const stop = Math.min(end(region), Math.max(start + 1, region.start + Math.round((hit.startBeat + hit.durationBeats - phase) * ppq)));
        const noteId = region.id + ':' + hit.id;
        notes.push({
          id: noteId,
          chordRegionId: region.id,
          pitch: hit.midiNote,
          start,
          duration: stop - start,
          velocity: shapeChordVelocity(region, { id: noteId, start, pitch: hit.midiNote, patternVelocity: hit.velocity / 127 }, ppq),
          ...(region.muted ? { muted: true } : {}),
        });
      }
    }
  }
  return notes;
}

export interface ChordDraft {
  region: Omit<ChordRegion, 'id'>;
  notes: readonly Note[];
}

export interface ChordTrackEdit {
  trackId: string;
  source: readonly ChordRegion[];
  regions: readonly ChordRegion[];
  notes: readonly Note[];
}

export const CHORD_SETTING_LABELS = {
  all: 'All settings',
  pattern: 'Pattern',
  voicing: 'Voicing & inversion',
  dynamics: 'Velocity & dynamics',
} as const;

export type ChordSettingsKind = keyof typeof CHORD_SETTING_LABELS;
type CopiedChordSettings = Pick<ChordRegion, 'velocity' | 'dynamics'> & {
  templateId?: string;
  voicing: ScaledT.VoicingNameT;
  inversion: number;
};

export class ChordTrackCommands {
  private clipboard: ChordRegion[] = [];
  private copiedSettings?: CopiedChordSettings;

  constructor(private editor: Editor) {}

  /** One bar at the start of the song, in ticks. New chords are this long unless they're fitted to a gap. */
  barTicks(): Tick {
    const ed = this.editor;
    const signature = ed.meta.timeSignature[0];
    const beatsPerBar = signature ? signature.numerator * (4 / signature.denominator) : 4;
    return Math.round(ed.ppq * beatsPerBar);
  }

  draft(chord: Pick<ChordRegion, 'root' | 'symbol' | 'intervals'>,
    { octave, inversion, voicing, templateId }: { octave: number; inversion: number; voicing: ScaledT.VoicingNameT; templateId: string }): ChordDraft {
    if (!engine) throw new Error('Chord tools are still loading.');
    const ed = this.editor;
    const tonic = ed.key?.root ?? 0;
    const root = (octave + 1) * 12 + tonic + pitchClass(chord.root - tonic);
    const template = templateId ? engine.performanceTemplates.find((item) => item.id === templateId) : undefined;
    if (templateId && !template) throw new Error('This performance is unavailable.');
    const duration = this.barTicks();
    const region: ChordRegion = {
      ...chord, id: createId(), start: 0, duration, velocity: ed.view.noteVelocity, voicing, inversion, rootMidi: root,
      pitches: chord.intervals.map((interval) => root + interval),
      performance: templateId ? { templateId, groupId: createId(), ...scaledKey(ed.key, chord.root) } : undefined,
    };
    const pitches = engine.getChordWithVoicing({ chord: chordOf(region), voicing, inversion }).midiNotes;
    // Scaled's guitar voicing uses a fixed fretboard register.
    region.pitches = voicing === 'guitar' ? pitches.map((pitch) => pitch + 12 * (octave - 3)) : pitches;
    if (!isValid([region])) throw new RangeError('This voicing is outside the MIDI range at the chosen octave.');
    return { region, notes: renderRegions([region], [], [], ed.ppq) };
  }

  /** The same draft at another length, re-rendered so a pattern fills the new window. */
  fitDraft(draft: ChordDraft, duration: Tick): ChordDraft {
    const isSameLength = duration === draft.region.duration;
    if (isSameLength) return draft;
    const region = { ...draft.region, id: 'draft', duration } as ChordRegion;
    const notes = renderRegions([region], [], [], this.editor.ppq);
    return { region: { ...draft.region, duration }, notes };
  }

  placeDraft(draft: ChordDraft, start: Tick): boolean {
    if (this.editor.chordRegions) return this.add({ ...draft.region, start });
    const notes = draft.notes.map(({ id: _id, chordRegionId: _owner, ...note }) => ({ ...note, start: start + note.start }));
    return this.editor.commands.add(notes).length > 0;
  }

  auditionDraft(draft: ChordDraft, held = false) {
    if (draft.region.performance && draft.notes.length) return this.editor.auditionNotes(draft.notes, 0);
    return this.editor.auditionChord(draft.region.pitches, held ? null : 0.5, draft.region.velocity);
  }

  auditionPitches(regions: readonly Pick<ChordRegion, 'pitches' | 'velocity' | 'muted'>[] = this.editor.selectedChordRegions) {
    const audible = regions.filter((region) => !region.muted);
    if (audible.length) this.editor.auditionChord(audible.flatMap((region) => region.pitches), 0.5, audible[0].velocity);
  }

  audition(regions: readonly ChordRegion[] = this.editor.selectedChordRegions) {
    const audible = regions.filter((region) => !region.muted);
    if (!audible.length) return;
    const ed = this.editor;
    const ids = new Set(audible.map((region) => region.id));
    const notes = ed.notes().filter((note) => note.chordRegionId && ids.has(note.chordRegionId));
    if (notes.length) ed.auditionNotes(notes, regions[0].start);
    else ed.auditionChord(audible[0].pitches, 0.5, audible[0].velocity);
  }

  /**
   * Play one chord on a loop, pattern and all, as if the loop region were set to exactly
   * this chord and play were pressed. Returns a stop function. Used while a chord is held.
   */
  auditionLoop(region: ChordRegion): () => void {
    if (region.muted) return () => {};
    const ed = this.editor;
    const notes = ed.notes().filter((note) => note.chordRegionId === region.id);
    const hasNotes = notes.length > 0;
    const { tempo, ppq } = ed.meta;
    const loopSeconds = ticksToSeconds(region.start + region.duration, tempo, ppq) - ticksToSeconds(region.start, tempo, ppq);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let isStopped = false;
    const playOnce = () => {
      if (isStopped) return;
      if (hasNotes) ed.auditionNotes(notes, region.start);
      else ed.auditionChord(region.pitches, loopSeconds, region.velocity);
      timer = setTimeout(playOnce, loopSeconds * 1000);
    };
    playOnce();
    return () => {
      isStopped = true;
      clearTimeout(timer);
      ed.stopChord();
    };
  }

  /** Mark both the chord and its current notes so muting never restarts its pattern. */
  toggleMute(ids: Iterable<string>) {
    const ed = this.editor;
    const source = ed.chordRegions;
    if (!source) return false;
    const owners = new Set(Array.from(ids, (id) => ed.getNote(id)?.chordRegionId ?? id));
    const targets = source.filter((region) => owners.has(region.id));
    if (!targets.length) return false;
    const mute = targets.some((region) => !region.muted);
    const setMuted = <T extends { muted?: boolean }>(value: T): T => {
      const updated = { ...value };
      if (mute) updated.muted = true;
      else delete updated.muted;
      return updated;
    };
    const regions = source.map((region) => owners.has(region.id) ? setMuted(region) : region);
    const notes = ed.notes().map((note) => note.chordRegionId && owners.has(note.chordRegionId) ? setMuted(note) : note);
    return this.commit({ trackId: ed.activeTrackId, source, regions, notes }, mute ? 'Mute chords' : 'Unmute chords');
  }

  /**
   * Replace some chords with changed copies (same ids) and commit, as one undo step.
   * Used for velocity: level, ramp, humanize and accent all live on the chord.
   */
  commitChanged(changed: readonly ChordRegion[], label: string): boolean {
    const regions = this.editor.chordRegions;
    if (!regions || !changed.length) return false;
    const byId = new Map(changed.map((region) => [region.id, region]));
    const updated = regions.map((region) => byId.get(region.id) ?? region);
    const edit = this.prepare(updated);
    if (!edit) return false;
    const selectedIds = this.editor.selectedChordRegions.map((region) => region.id);
    return this.commit(edit, label, selectedIds);
  }

  /** A preview can only commit against the exact region list it was made from. */
  prepare(regions: readonly ChordRegion[]): ChordTrackEdit | undefined {
    const source = this.editor.chordRegions;
    const sorted = [...regions].sort(byStart);
    if (!source || !isValid(sorted)) return;
    return { trackId: this.editor.activeTrackId, source, regions: sorted, notes: renderRegions(sorted, source, this.editor.notes(), this.editor.ppq) };
  }

  commit(edit: ChordTrackEdit, label: string, select?: readonly string[]): boolean {
    const ed = this.editor;
    if (ed.activeTrackId !== edit.trackId || ed.chordRegions !== edit.source) return false;
    if (edit.regions.length === edit.source.length && edit.regions.every((region, i) => region === edit.source[i])) return false;
    ed.transact(label, (tx) => tx.setChordRegions(edit.regions, edit.notes), { selectionAfter: select });
    return ed.chordRegions === edit.regions;
  }

  add(input: Omit<ChordRegion, 'id'>): boolean {
    const regions = this.editor.chordRegions;
    if (!regions) return false;
    const region = { ...input, id: createId() };
    const edit = this.prepare([...regions, region]);
    return !!edit && this.commit(edit, 'Add chord', [region.id]);
  }

  clearClipboard() {
    this.clipboard = [];
  }

  get hasCopiedSettings(): boolean {
    return this.copiedSettings !== undefined;
  }

  copySettings(id: string): boolean {
    const region = this.editor.chordRegions?.find((chord) => chord.id === id);
    if (!region) return false;
    this.copiedSettings = {
      templateId: region.performance?.templateId,
      voicing: region.voicing ?? 'rootPosition',
      inversion: region.inversion ?? 0,
      velocity: region.velocity,
      dynamics: region.dynamics && structuredClone(region.dynamics),
    };
    return true;
  }

  async pasteSettings(kind: ChordSettingsKind): Promise<boolean> {
    const ed = this.editor;
    const settings = this.copiedSettings;
    const source = ed.chordRegions;
    const trackId = ed.activeTrackId;
    const selected = new Set(ed.selectedChordRegions.map(({ id }) => id));
    if (!settings || !source || !selected.size) return false;

    const pastePattern = kind === 'pattern' || kind === 'all';
    const pasteVoicing = kind === 'voicing' || kind === 'all';
    const pasteDynamics = kind === 'dynamics' || kind === 'all';
    if (!engine && (pasteVoicing || (pastePattern && settings.templateId) || source.some((region) => region.performance))) await loadScaled();
    if (ed.activeTrackId !== trackId || ed.chordRegions !== source) return false;

    const groupOrigins = new Map<string, ChordRegion>();
    const survivingGroups = new Set<string>();
    const changed: ChordRegion[] = [];
    for (const region of source) {
      const performance = region.performance;
      const groupId = performance?.groupId;
      if (pastePattern && groupId && !groupOrigins.has(groupId)) groupOrigins.set(groupId, region);

      if (!selected.has(region.id)) {
        // When the first chord of a pattern group is replaced, keep the remaining hits in phase.
        if (pastePattern && performance && !survivingGroups.has(performance.groupId)) {
          survivingGroups.add(performance.groupId);
          const origin = groupOrigins.get(performance.groupId)!;
          if (origin !== region) {
            const phaseTicks = (origin.performance?.phaseTicks ?? 0) + region.start - origin.start;
            changed.push({ ...region, performance: { ...performance, phaseTicks } });
          }
        }
        continue;
      }

      let updated = region;
      if (pasteVoicing && engine) {
        const inversion = Math.max(0, Math.min(settings.inversion, 3, region.intervals.length - 1));
        updated = voiceRegion(engine, region, settings.voicing, inversion);
        if (settings.voicing === 'guitar') {
          const octave = octaveOf(updated.rootMidi! - (ed.key?.root ?? 0));
          updated.pitches = updated.pitches.map((pitch) => pitch + 12 * (octave - 3));
        }
        if (updated.pitches.some((pitch) => !Number.isInteger(pitch) || pitch < 0 || pitch > 127)) {
          throw new RangeError('This voicing is outside the MIDI range for a selected chord.');
        }
      }
      if (pastePattern && (settings.templateId || performance)) {
        const templateId = settings.templateId;
        updated = { ...updated, performance: templateId ? { templateId, groupId: createId(), ...scaledKey(ed.key, region.root) } : undefined };
      }
      if (pasteDynamics) updated = withDynamics({ ...updated, velocity: settings.velocity }, settings.dynamics ?? {});
      if (updated !== region) changed.push(updated);
    }

    const label = kind === 'all' ? 'Paste chord settings' : `Paste ${CHORD_SETTING_LABELS[kind].toLowerCase()}`;
    return this.commitChanged(changed, label);
  }

  copy() {
    const ed = this.editor;
    const selected = ed.selectedChordRegions;
    if (!selected.length) return;
    this.clipboard = this.copyRegions(selected);
    const start = selected[0].start;
    ed.sections.clearContentClipboard();
    ed.clipboard = ed.selectedNotes.map(({ chordRegionId: _owner, ...note }) => ({ ...note, start: note.start - start }));
  }

  private copyRegions(selected: readonly ChordRegion[]): ChordRegion[] {
    const first = selected[0].start;
    const sourceGroups = new Map<string, ChordRegion>();
    for (const item of this.editor.chordRegions ?? []) {
      const group = item.performance?.groupId;
      if (group && !sourceGroups.has(group)) sourceGroups.set(group, item);
    }
    const selectedStarts = new Map<string, Tick>();
    return selected.map((region) => {
      const performance = region.performance;
      if (!performance) return { ...region, start: region.start - first };
      const group = performance.groupId;
      if (!selectedStarts.has(group)) selectedStarts.set(group, region.start);
      const source = sourceGroups.get(group)!;
      const phaseTicks = (source.performance?.phaseTicks ?? 0) + selectedStarts.get(group)! - source.start;
      return { ...region, start: region.start - first, performance: { ...performance, phaseTicks } };
    });
  }

  paste(at = this.editor.view.cursor) {
    return this.insertCopies(this.clipboard, at, 'Paste chords');
  }

  duplicate() {
    const selected = this.editor.selectedChordRegions;
    if (!selected.length) return;
    return this.insertCopies(this.copyRegions(selected), end(selected[selected.length - 1]), 'Duplicate chords');
  }

  private async insertCopies(copies: readonly ChordRegion[], at: Tick, label: string) {
    const ed = this.editor;
    const source = ed.chordRegions;
    if (!source || !copies.length) return;
    if (!engine && copies.some((region) => region.performance)) await loadScaled();
    if (ed.chordRegions !== source) return;
    const span = end(copies[copies.length - 1]);
    let start = Math.max(0, Math.round(at));
    for (const region of source) {
      if (start + span <= region.start) break;
      if (start < end(region)) start = end(region);
    }
    const groupIds = new Map<string, string>();
    const added = copies.map((region) => {
      const copy = { ...region, id: createId(), start: start + region.start };
      if (copy.performance) {
        const original = copy.performance.groupId;
        if (!groupIds.has(original)) groupIds.set(original, createId());
        copy.performance = { ...copy.performance, groupId: groupIds.get(original)! };
      }
      return copy;
    });
    const edit = this.prepare([...source, ...added]);
    if (edit) this.commit(edit, label, added.map((region) => region.id));
  }

  async delete(ids: Iterable<string>) {
    const ed = this.editor;
    const source = ed.chordRegions;
    const deleting = new Set(Array.from(ids, (id) => ed.getNote(id)?.chordRegionId ?? id));
    if (!source?.some((region) => deleting.has(region.id))) return;
    const remaining = source.filter((region) => !deleting.has(region.id));
    if (!engine && remaining.some((region) => region.performance)) await loadScaled();
    if (ed.chordRegions !== source) return;
    const edit = this.prepare(remaining);
    if (edit) this.commit(edit, 'Delete chords');
  }

  /** Move a single region into free space or reorder the affected span, retaining its gaps. */
  planMove(id: string, start: Tick, octaveShift = 0, selected: readonly ChordRegion[] = []): readonly ChordRegion[] | undefined {
    const regions = this.editor.chordRegions;
    const anchor = regions?.find((region) => region.id === id);
    if (!regions || !anchor) return;
    const moving = selected.length > 1 ? selected : [anchor];
    const ids = new Set(moving.map((region) => region.id));
    const delta = Math.max(-Math.min(...moving.map((region) => region.start)), Math.round(start) - anchor.start);
    const shift = (region: ChordRegion, to: Tick) => to === region.start && octaveShift === 0 ? region : {
      ...region, start: to, pitches: octaveShift ? region.pitches.map((pitch) => pitch + octaveShift * 12) : region.pitches,
      rootMidi: region.rootMidi === undefined ? undefined : region.rootMidi + octaveShift * 12,
    };
    const placed = regions.map((region) => ids.has(region.id) ? shift(region, region.start + delta) : region).sort(byStart);
    if (isValid(placed)) return placed;
    if (moving.length > 1 || !delta) return;
    const wanted = anchor.start + delta;
    const target = regions.find((region) => region !== anchor && (delta > 0
      ? wanted >= region.start + region.duration / 2 && wanted < end(region)
      : wanted < region.start + region.duration / 2 && wanted + anchor.duration > region.start));
    if (!target) return;

    const from = regions.indexOf(anchor);
    const to = regions.indexOf(target);
    const first = Math.min(from, to);
    const last = Math.max(from, to);
    const order = [...regions];
    order.splice(from, 1);
    order.splice(to, 0, anchor);
    order[to] = shift(anchor, anchor.start);
    const reordered = this.placeOrder(regions, order, first, last);
    return isValid(reordered) ? reordered : undefined;
  }

  planNudge(direction: -1 | 1, freeStart: Tick): readonly ChordRegion[] | undefined {
    const regions = this.editor.chordRegions;
    const selected = this.editor.selectedChordRegions;
    const selection = this.editor.selection;
    if (!regions || !selected.length) return;
    const from = selected[0].start;
    let distance = Math.max(0, (Math.round(freeStart) - from) * direction);
    if (direction < 0) distance = Math.min(distance, from);
    const order = [...regions];
    let swapped = false;
    // Visit from the movement side so a contiguous, touching block can cross one neighbor.
    for (let i = direction < 0 ? 1 : order.length - 2; i >= 0 && i < order.length; i -= direction) {
      const next = i + direction;
      const neighbor = order[next];
      if (!neighbor || !selection.has(order[i].id) || selection.has(neighbor.id)) continue;
      // The swap keeps gaps at their original boundaries.
      const left = Math.min(i, next);
      const gap = regions[left + 1].start - end(regions[left]);
      if (gap > 0) {
        distance = Math.min(distance, gap);
        continue;
      }
      [order[next], order[i]] = [order[i], neighbor];
      swapped = true;
    }
    if (swapped) return this.placeOrder(regions, order, 0, order.length - 1);
    if (!distance) return;
    return this.planMove(selected[0].id, from + direction * distance, 0, selected);
  }

  private placeOrder(source: readonly ChordRegion[], order: ChordRegion[], first: number, last: number) {
    let position = source[first].start;
    for (let i = first; i <= last; i++) {
      const region = order[i];
      if (region.start !== position) order[i] = { ...region, start: position };
      position += region.duration + (i < last ? source[i + 1].start - end(source[i]) : 0);
    }
    return order;
  }

  planResize(id: string, edge: 'start' | 'end', tick: Tick): readonly ChordRegion[] | undefined {
    const regions = this.editor.chordRegions;
    const i = regions?.findIndex((region) => region.id === id) ?? -1;
    if (!regions || i < 0) return;
    const region = regions[i];
    const start = edge === 'start' ? Math.max(i ? end(regions[i - 1]) : 0, Math.min(end(region) - 1, tick)) : region.start;
    const stop = edge === 'end' ? Math.min(regions[i + 1]?.start ?? Infinity, Math.max(start + 1, tick)) : end(region);
    const isUnchanged = start === region.start && stop === end(region);
    if (isUnchanged) return regions;
    const resized = { ...region, start, duration: stop - start };
    const resizedList = regions.map((item) => item === region ? resized : item);
    // Moving a patterned chord's start keeps the pattern where it was in time: trimming
    // the front cuts off its first hits, so the chord starts mid-pattern. The group's
    // phase shifts by the same amount when this chord is where the group's pattern starts.
    const groupId = region.performance?.groupId;
    const groupOrigin = groupId ? regions.find((item) => item.performance?.groupId === groupId) : undefined;
    const isGroupOrigin = groupOrigin === region;
    if (!isGroupOrigin) return resizedList;
    const shift = start - region.start;
    return resizedList.map((item) => {
      const isInGroup = item.performance?.groupId === groupId;
      if (!isInGroup) return item;
      const phaseTicks = (item.performance!.phaseTicks ?? 0) + shift;
      return { ...item, performance: { ...item.performance!, phaseTicks } };
    });
  }

  previewStyle({ voicing, templateId, inversion }: { voicing?: ScaledT.VoicingNameT; templateId?: string | null; inversion?: number }): ChordTrackEdit | undefined {
    const ed = this.editor;
    const regions = ed.chordRegions;
    const selected = ed.selectedChordRegions;
    if (!regions || !selected.length || !engine || (!voicing && templateId === undefined && inversion === undefined)) return;
    const styled = new Map<string, ChordRegion>();
    const groupId = createId();
    const context = scaledKey(ed.key, selected[0].root);
    let previous: readonly number[] | undefined;
    for (const region of selected) {
      const styledRegion = voicing || inversion !== undefined
        ? voiceRegion(engine, region, voicing ?? region.voicing ?? 'rootPosition', inversion ?? region.inversion ?? 0, previous)
        : { ...region };
      previous = styledRegion.pitches;
      if (templateId !== undefined) styledRegion.performance = templateId ? { templateId, groupId, ...context } : undefined;
      styled.set(region.id, styledRegion);
    }
    return this.prepare(regions.map((region) => styled.get(region.id) ?? region));
  }

  renderToMidi(): boolean {
    const ed = this.editor;
    if (!ed.chordRegions?.length) return false;
    const notes = ed.notes().map(({ chordRegionId: _owner, ...note }) => note);
    ed.transact('Render chord track to MIDI', (tx) => tx.setChordRegions(undefined, notes), { selectionAfter: notes.map((note) => note.id) });
    return !ed.chordRegions;
  }

  enable(): boolean {
    const ed = this.editor;
    if (ed.chordRegions || ed.notes().length) return false;
    ed.transact('Enable Chord Track', (tx) => tx.setChordRegions([], []));
    return !!ed.chordRegions;
  }
}
