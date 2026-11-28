import { createId, type Editor } from './editor';
import { barLength } from './music/timeline';
import { getTrackName } from './tracks';
import type { ChordRegion, Section, Tick, Track } from './types';

export const SECTION_COLORS = [
  { name: 'Violet', color: 'var(--accent-spark-1)' },
  { name: 'Pink', color: 'var(--accent-spark-2)' },
  { name: 'Amber', color: 'var(--accent-spark-3)' },
  { name: 'Green', color: 'var(--accent-spark-4)' },
  { name: 'Blue', color: 'var(--accent-spark-5)' },
];

export interface SectionRange {
  section: Section;
  startBar: number;
  endBar: number;
  start: Tick;
  end: Tick;
}

type Placement = { start: Tick; copy?: boolean };
type PlaceContent = (start: Tick, id: string, track: string) => readonly Placement[];
type ContentSelection = Map<string, ReadonlySet<string>>;
type TrackClip = { trackId: string; source: Track; ids: ReadonlySet<string> };
type Clipboard = { origin: Tick; tracks: TrackClip[] };

const endOf = (item: { start: Tick; duration: Tick }) => item.start + item.duration;
const byStart = <T extends { start: Tick }>(a: T, b: T) => a.start - b.start;

function meterSegments(editor: Editor) {
  const events = [...editor.meta.timeSignature].sort((a, b) => a.tick - b.tick);
  let startBar = 1;
  return events.map((event, i) => {
    const length = barLength(event, editor.ppq);
    const segment = { start: event.tick, startBar, length };
    const next = events[i + 1];
    if (next) startBar += Math.ceil((next.tick - event.tick) / length);
    return segment;
  });
}

function makeSection(durationBars: number): Section {
  const { color } = SECTION_COLORS[Math.floor(Math.random() * SECTION_COLORS.length)];
  return { id: createId(), name: 'Section', color, durationBars };
}

/** Chord regions and their rendered notes share a placement, including across boundaries. */
function placeTrack(track: Track, place: PlaceContent, keepOriginalPatterns = false): Track {
  const regions = track.chordRegions;
  if (!regions) {
    const notes = track.notes.flatMap((note) => place(note.start, note.id, track.id).map(({ start, copy }) =>
      copy || start !== note.start ? { ...note, id: copy ? createId() : note.id, start } : note));
    return { ...track, notes };
  }

  const groups = new Map<string, { origin: Tick; phase: Tick; placements: Map<string, ChordRegion[]> }>();
  const owners = new Map<string, ChordRegion[]>();
  const originals = new Map(regions.map((region) => [region.id, region]));
  const chordRegions = regions.flatMap((region) => {
    const performance = region.performance;
    let group = performance && groups.get(performance.groupId);
    if (performance && !group) {
      group = { origin: region.start, phase: performance.phaseTicks ?? 0, placements: new Map() };
      groups.set(performance.groupId, group);
    }
    const placements = place(region.start, region.id, track.id).map(({ start, copy }) => {
      const result = { ...region, id: copy ? createId() : region.id, start };
      if (group && (!keepOriginalPatterns || copy)) {
        const key = (copy ? 'copy:' : 'move:') + (start - region.start);
        const members = group.placements.get(key) ?? [];
        members.push(result);
        group.placements.set(key, members);
      }
      return result;
    });
    owners.set(region.id, placements);
    return placements;
  }).sort(byStart);

  for (const [groupId, group] of groups) {
    const originalKey = group.placements.has('move:0') ? 'move:0'
      : [...group.placements.keys()].find((key) => key.startsWith('move:'));
    for (const [key, members] of group.placements) {
      const id = key === originalKey ? groupId : createId();
      const first = originals.get(members[0].id);
      const offset = Number(key.slice(key.indexOf(':') + 1));
      const phase = group.phase + (first?.start ?? members[0].start - offset) - group.origin;
      for (const member of members) {
        if (member.performance?.groupId !== id || (member.performance.phaseTicks ?? 0) !== phase) {
          member.performance = { ...member.performance!, groupId: id, phaseTicks: phase };
        }
      }
    }
  }

  const notes = track.notes.flatMap((note) => {
    const owner = note.chordRegionId && originals.get(note.chordRegionId);
    if (!owner) return [];
    return (owners.get(owner.id) ?? []).map((region) => ({
      ...note,
      id: region.id === owner.id ? note.id : createId(),
      chordRegionId: region.id,
      start: note.start + (region.start - owner.start),
    }));
  });
  const sameRegions = chordRegions.length === regions.length && chordRegions.every((region, i) =>
    region.id === regions[i].id && region.start === regions[i].start && region.performance === regions[i].performance);
  return { ...track, chordRegions: sameRegions ? regions : chordRegions, notes };
}

/** Loaded MIDI may already contain overlaps. Only reject overlaps created by this edit. */
function firstCollision(before: Track, after: Track): Tick | undefined {
  if (after.chordRegions) {
    const regions = after.chordRegions;
    return regions.find((region, i) => i > 0 && endOf(regions[i - 1]) > region.start)?.start;
  }
  const original = new Map(before.notes.map((note) => [note.id, note.start]));
  const byPitch = new Map<number, Map<number, Tick>>();
  for (const note of [...after.notes].sort(byStart)) {
    let ends = byPitch.get(note.pitch);
    if (!ends) byPitch.set(note.pitch, ends = new Map());
    const start = original.get(note.id);
    const offset = start === undefined ? NaN : note.start - start;
    for (const [otherOffset, end] of ends) {
      if (end <= note.start) ends.delete(otherOffset);
      else if (Number.isNaN(offset) || otherOffset !== offset) return note.start;
    }
    ends.set(offset, Math.max(ends.get(offset) ?? 0, endOf(note)));
  }
}

export class SectionCommands {
  selected: ReadonlySet<string> = new Set();
  private content: ContentSelection | undefined;
  private allTracks = false;
  private clipboard?: Clipboard;

  constructor(private readonly editor: Editor) {}

  get items() { return this.editor.meta.sections; }
  get end() { return this.barToTick(1 + this.items.reduce((sum, item) => sum + item.durationBars, 0)); }
  get allTracksSelected() { return this.allTracks; }
  get contentSelection(): ReadonlyMap<string, ReadonlySet<string>> | undefined { return this.content; }

  get timingUnavailable() {
    const { timeSignature } = this.editor.meta;
    const first = timeSignature[0];
    const length = barLength(first, this.editor.ppq);
    return timeSignature.some((event) => event.numerator !== first.numerator || event.denominator !== first.denominator ||
      (event.tick - first.tick) % length !== 0)
      ? 'Section edits that move music require a single time signature.' : '';
  }

  barToTick(bar: number) {
    const segment = meterSegments(this.editor).reverse().find((entry) => entry.startBar <= bar);
    return segment ? segment.start + (bar - segment.startBar) * segment.length : 0;
  }

  barAt(tick: Tick, nearest = false) {
    const segments = meterSegments(this.editor);
    const segment = segments.find((_, i) => tick < (segments[i + 1]?.start ?? Infinity)) ?? segments[0];
    const index = segment.startBar + Math.max(0, Math.floor((tick - segment.start) / segment.length));
    if (!nearest) return index;
    const left = this.barToTick(index);
    const right = this.barToTick(index + 1);
    return tick - left < right - tick ? index : index + 1;
  }

  ranges(items = this.items): SectionRange[] {
    let bar = 1;
    return items.map((section) => {
      const startBar = bar;
      bar += section.durationBars;
      return { section, startBar, endBar: bar, start: this.barToTick(startBar), end: this.barToTick(bar) };
    });
  }

  select(ids: Iterable<string>) {
    const requested = new Set(ids);
    const next = new Set(this.items.filter(({ id }) => requested.has(id)).map(({ id }) => id));
    if (next.size === this.selected.size && [...next].every((id) => this.selected.has(id))) return;
    this.selected = next;
    this.editor.emit('sectionselection', undefined);
  }

  prune() {
    this.select(this.selected);
    if (!this.content) return;
    const kept: ContentSelection = new Map();
    let size = 0;
    for (const track of this.editor.doc.tracks) {
      const ids = this.content.get(track.id);
      if (!ids) continue;
      const items = (track.chordRegions ?? track.notes).filter(({ id }) => ids.has(id));
      if (items.length) kept.set(track.id, new Set(items.map(({ id }) => id)));
      size += items.length;
    }
    const previousSize = [...this.content.values()].reduce((sum, ids) => sum + ids.size, 0);
    this.editor.select(kept.get(this.editor.activeTrackId) ?? [], 'replace', true);
    if (size === previousSize) return;
    if (size) this.setContentSelection(kept);
    else this.clearContentSelection();
  }

  isContentSelected(track: string, id: string) { return this.content?.get(track)?.has(id) ?? false; }

  reset() {
    this.select([]);
    this.clearContentSelection();
    this.clipboard = undefined;
  }

  clearContentSelection() {
    if (!this.content) return;
    this.content = undefined;
    this.allTracks = false;
    this.editor.emit('sectionselection', undefined);
  }

  selectContent(ids: ReadonlySet<string>, allTracks: boolean) {
    const ranges = this.ranges().filter(({ section }) => ids.has(section.id));
    const content: ContentSelection = new Map();
    const ed = this.editor;
    for (const track of ed.doc.tracks) {
      if (!allTracks && track.id !== ed.activeTrackId) continue;
      const items = (track.chordRegions ?? track.notes).filter(({ start }) =>
        ranges.some((range) => start >= range.start && start < range.end));
      if (items.length) content.set(track.id, new Set(items.map(({ id }) => id)));
    }
    ed.select(content.get(ed.activeTrackId) ?? []);
    this.allTracks = allTracks && content.size > 0;
    if (content.size) this.setContentSelection(content);
  }

  private setContentSelection(content: ContentSelection) {
    this.content = content;
    this.editor.emit('sectionselection', undefined);
  }

  private labelFor(ids: ReadonlySet<string>, transform: (item: Section) => Section, label: string) {
    this.commit(label, this.items.map((item) => ids.has(item.id) ? transform(item) : item));
  }

  rename(id: string, value: string) {
    const name = value.trim();
    if (name) this.labelFor(new Set([id]), (item) => ({ ...item, name }), 'Rename section');
  }

  color(ids: ReadonlySet<string>, color: string) {
    this.labelFor(ids, (item) => ({ ...item, color }), 'Change section color');
  }

  append() {
    const added = makeSection(4);
    this.commit('Add section label', [...this.items, added]);
    return added.id;
  }

  split(id: string, bar: number) {
    const range = this.ranges().find(({ section }) => section.id === id);
    if (!range || !Number.isSafeInteger(bar) || bar <= range.startBar || bar >= range.endBar) return;
    const added = makeSection(range.endBar - bar);
    this.commit('Split section', this.items.flatMap((item) => item.id === id
      ? [{ ...item, durationBars: bar - range.startBar }, added] : [item]));
    return added.id;
  }

  resizePlan(id: string, bars: number) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0 || !Number.isSafeInteger(bars)) return this.items;
    const current = this.items[index];
    const next = this.items[index + 1];
    const delta = Math.max(1 - current.durationBars, Math.min(bars, next ? next.durationBars - 1 : Infinity));
    if (!delta) return this.items;
    return this.items.map((item, i) => i === index ? { ...item, durationBars: item.durationBars + delta }
      : i === index + 1 ? { ...item, durationBars: item.durationBars - delta } : item);
  }

  resize(id: string, bars: number) {
    this.commit('Move section boundary', this.resizePlan(id, bars));
  }

  insert(id: string, after: boolean, duplicate = false) {
    if (duplicate) return this.duplicate(new Set([id]))[0];
    this.requireTiming();
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return;
    const added = makeSection(this.items[index].durationBars);
    const items = [...this.items];
    items.splice(index + Number(after), 0, added);
    this.arrange('Insert empty section', items);
    return added.id;
  }

  duplicate(ids: ReadonlySet<string>) {
    this.requireTiming();
    const sections: Section[] = [];
    const copies = new Map<string, Section>();
    const block: Section[] = [];
    for (const section of this.items) {
      if (!ids.has(section.id)) {
        sections.push(...block.splice(0), section);
        continue;
      }
      const copy = { ...section, id: createId(), name: section.name + ' copy' };
      copies.set(section.id, copy);
      sections.push(section);
      block.push(copy);
    }
    sections.push(...block);
    if (!copies.size) return [];
    this.arrange(copies.size === 1 ? 'Duplicate section with music' : 'Duplicate sections with music', sections, copies);
    return this.items === sections ? Array.from(copies.values(), ({ id }) => id) : [];
  }

  move(ids: ReadonlySet<string>, insertion: number) {
    this.requireTiming();
    const first = this.items.findIndex(({ id }) => ids.has(id));
    const moving = this.items.slice(first, first + ids.size);
    if (first < 0 || moving.length !== ids.size || !moving.every(({ id }) => ids.has(id))) return;
    const remaining = this.items.filter(({ id }) => !ids.has(id));
    if (!Number.isInteger(insertion) || insertion < 0 || insertion > remaining.length) return;
    remaining.splice(insertion, 0, ...moving);
    if (remaining.every((item, i) => item === this.items[i])) return;
    this.arrange('Move sections with music', remaining);
  }

  remove(ids: ReadonlySet<string>, withMusic: boolean) {
    if (withMusic) {
      this.requireTiming();
      this.arrange('Delete sections and music', this.items.filter(({ id }) => !ids.has(id)));
    } else {
      const retained: Section[] = [];
      let leading = 0;
      for (const item of this.items) {
        const previous = retained.at(-1);
        if (ids.has(item.id)) {
          if (previous) previous.durationBars += item.durationBars;
          else leading += item.durationBars;
        } else {
          retained.push({ ...item, durationBars: item.durationBars + leading });
          leading = 0;
        }
      }
      this.commit('Remove section labels', retained);
    }
    this.select(this.selected);
  }

  private requireTiming() {
    if (this.timingUnavailable) throw new Error(this.timingUnavailable);
  }

  private arrange(label: string, sections: readonly Section[], copies?: ReadonlyMap<string, Section>) {
    const original = this.ranges();
    const placed = this.ranges(sections);
    const byId = new Map(placed.map((range) => [range.section.id, range]));
    const tail = (placed.at(-1)?.end ?? 0) - (original.at(-1)?.end ?? 0);
    const place: PlaceContent = (start) => {
      const old = original.find(({ end }) => start < end);
      if (!old) return [{ start: start + tail }];
      const next = byId.get(old.section.id);
      if (!next) return [];
      const result: Placement[] = [{ start: start + (next.start - old.start) }];
      const copy = copies?.get(old.section.id);
      if (copy) {
        result.push({ start: start + (byId.get(copy.id)!.start - old.start), copy: true });
      }
      return result;
    };
    this.applyContent(label, this.editor.doc.tracks, place, sections);
  }

  get contentStart() {
    if (!this.content) return undefined;
    let start = Infinity;
    for (const track of this.editor.doc.tracks) {
      const ids = this.content.get(track.id);
      for (const item of track.chordRegions ?? track.notes) {
        if (ids?.has(item.id)) start = Math.min(start, item.start);
      }
    }
    return start === Infinity ? undefined : start;
  }

  contentBarOffset(anchor: Tick, bars: number) {
    const start = this.contentStart;
    if (start === undefined || !bars) return 0;
    const anchorBar = this.barAt(anchor);
    const anchorTick = this.barToTick(anchorBar);
    const minTick = anchorTick - start;
    const minBar = this.barAt(minTick);
    const first = minBar + Number(this.barToTick(minBar) < minTick);
    return this.barToTick(Math.max(first, anchorBar + bars)) - anchorTick;
  }

  moveContent(delta: Tick) {
    const start = this.contentStart;
    if (start === undefined) return;
    const offset = Math.max(-start, delta);
    if (offset) this.editContent('Move selected music', (start) => [{ start: start + offset }]);
  }

  deleteContent() {
    this.editContent('Delete selected music', () => []);
  }

  private editContent(label: string, selected: (start: Tick) => readonly Placement[]) {
    const content = this.content;
    if (!content) return;
    const tracks = this.editor.doc.tracks.filter(({ id }) => content.has(id));
    this.applyContent(label, tracks, (start, id, track) =>
      content.get(track)?.has(id) ? selected(start) : [{ start }]);
  }

  copyContent() {
    const origin = this.contentStart;
    if (origin === undefined) return;
    const tracks = this.editor.doc.tracks.flatMap((source) => {
      const ids = this.content?.get(source.id);
      return ids ? [{ trackId: source.id, source, ids }] : [];
    });
    this.editor.clipboard = [];
    this.editor.chordTrack.clearClipboard();
    this.clipboard = { origin, tracks };
  }

  get hasContentClipboard() { return !!this.clipboard; }
  clearContentClipboard() { this.clipboard = undefined; }

  pasteContent(at: Tick) {
    const clip = this.clipboard;
    if (!clip) return false;
    const before = this.editor.doc;
    const tracks = new Map(before.tracks.map((track) => [track.id, track]));
    const edits = clip.tracks.map(({ trackId, source, ids }) => {
      const track = tracks.get(trackId);
      if (!track || !!track.chordRegions !== !!source.chordRegions) {
        throw new Error('The original tracks must be available to paste this selection.');
      }
      const copy = placeTrack(source, (start, id) =>
        ids.has(id) ? [{ start: at + (start - clip.origin), copy: true }] : [], true);
      const combined = {
        ...track,
        notes: [...track.notes, ...copy.notes],
        chordRegions: track.chordRegions && [...track.chordRegions, ...copy.chordRegions!].sort(byStart),
      };
      this.validate(track, combined);
      return combined;
    });
    this.commit('Paste selected music', this.items, edits);
    if (this.editor.doc === before) return true;
    const selected = new Map(edits.map((track) => {
      const previous = tracks.get(track.id)!;
      const old = new Set((previous.chordRegions ?? previous.notes).map(({ id }) => id));
      return [track.id, new Set((track.chordRegions ?? track.notes).map(({ id }) => id).filter((id) => !old.has(id)))];
    }));
    this.editor.select(selected.get(this.editor.activeTrackId) ?? []);
    this.allTracks = true;
    this.setContentSelection(selected);
    return true;
  }

  private validate(before: Track, after: Track) {
    const invalid = (item: { start: Tick; duration: Tick }) =>
      item.start < 0 || !Number.isSafeInteger(item.start) || !Number.isSafeInteger(endOf(item));
    if (after.notes.some(invalid) || after.chordRegions?.some(invalid)) throw new Error('The edit exceeds the timeline.');
    const collision = firstCollision(before, after);
    if (collision === undefined) return;
    const name = getTrackName(before, this.editor.trackIds.indexOf(before.id));
    throw new Error(`Music would overlap on ${name} at bar ${this.barAt(collision)}.`);
  }

  private applyContent(label: string, tracks: readonly Track[], place: PlaceContent, sections = this.items) {
    const edits = tracks.map((track) => {
      const next = placeTrack(track, place);
      this.validate(track, next);
      return next;
    });
    this.commit(label, sections, edits);
  }

  private commit(label: string, sections: readonly Section[], tracks: readonly Track[] = []) {
    const pastLast = 1 + sections.reduce((bars, section) => bars + section.durationBars, 0);
    if (!Number.isSafeInteger(pastLast) || !Number.isSafeInteger(this.barToTick(pastLast))) {
      throw new Error('The sections exceed the timeline.');
    }
    this.editor.transact(label, (tx) => {
      tx.setMeta('sections', sections);
      for (const track of tracks) tx.setTrackContent(track.id, track.notes, track.chordRegions);
    });
  }
}
