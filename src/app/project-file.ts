import { saveEditorFile } from '../elements/save-file';
import { CHORD_ACCENTS, CHORD_FAMILIES, CHORD_VOICINGS, DEFAULT_VIEW, SCALE_IDS, ZOOM_LIMITS, type ChordFamily, type Editor, type MaddieDoc, type LoopRegion, type Section, type ViewState, type AppViewKeyT } from '../core';

export interface MaddieProject {
  format: 'maddie';
  version: 1;
  name: string;
  updatedAt?: number;
  doc: MaddieDoc;
  settings?: {
    activeTrackId?: string;
    soundId?: string;
    midiPortId?: string | null;
    loop?: LoopRegion;
    marker?: number;
    volume?: Editor['volume'];
    metronomeEnabled?: boolean;
    metronomeVolume?: number;
    fold?: ViewState['fold'];
    view?: Partial<ViewState> & { chordFamily?: ChordFamily | 'all' };
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function int(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

const text = (value: unknown): value is string => typeof value === 'string';
const id = (value: unknown): value is string => text(value) && value.trim().length > 0;
const numberIn = (min: number, max = Number.MAX_SAFE_INTEGER) =>
  (value: unknown) => typeof value === 'number' && value >= min && value <= max;
const velocity = numberIn(0, 1);
const list = (value: unknown, test: (item: unknown) => boolean): value is unknown[] => Array.isArray(value) && value.every(test);
const optional = (value: unknown, test: (value: unknown) => boolean) => value === undefined || test(value);
const boolean = (value: unknown) => typeof value === 'boolean';
const nullable = (test: (value: unknown) => boolean) => (value: unknown) => value === null || test(value);
const oneOf = (...values: string[]) => (value: unknown) => text(value) && values.includes(value);
const grid = (value: unknown) => text(value) && /^(auto|bar|1\/[1-9]\d{0,14}[T.]?)$/.test(value);
const chordFamilyIds = CHORD_FAMILIES.map(({ id }) => id);
const isChordFamily = oneOf(...chordFamilyIds);
const isLegacyChordFamily = oneOf('all', ...chordFamilyIds);
const viewValidators = {
  pxPerTick: numberIn(...ZOOM_LIMITS.pxPerTick),
  rowHeight: numberIn(...ZOOM_LIMITS.rowHeight),
  scrollTick: numberIn(-1e9),
  scrollRow: nullable(numberIn(0)),
  grid,
  snap: boolean,
  fold: oneOf('none', 'scale', 'used'),
  scaleLock: boolean,
  scaleHighlight: boolean,
  follow: boolean,
  noteLength: nullable(numberIn(0)),
  noteVelocity: velocity,
  cursor: numberIn(0),
  noteColor: oneOf('pitch', 'pitch-class', 'mono'),
  computerKeyboard: boolean,
  keyboardBase: (value: unknown) => int(value, 12, 96) && value % 12 === 0,
  keyboardScale: boolean,
  midiInput: boolean,
  midiDevice: nullable(id),
  chordsPanel: boolean,
  // Older projects saved browse / suggestions / song.
  chordsTab: oneOf('all', 'project', 'browse', 'suggestions', 'song'),
  suggestionsOpen: boolean,
  velocityLaneOpen: boolean,
  hiddenChordFamilies: (value: unknown) => list(value, isChordFamily),
  chordQuery: text,
  chordOctave: (value: unknown) => int(value, 1, 6),
  chordInversion: (value: unknown) => int(value, 0, 3),
  chordVoicing: oneOf(...Object.keys(CHORD_VOICINGS)),
  chordTemplateId: text,
  quantizeGrid: (value: unknown) => value === 'current' || grid(value),
  quantizeStrength: numberIn(0, 100),
  humanizeTiming: numberIn(0, 100),
  humanizeVelocity: numberIn(0, 50),
  rampFrom: numberIn(0, 100),
  rampTo: numberIn(0, 100),
  strumDirection: oneOf('down', 'up'),
  strumAmount: numberIn(0, 100),
} satisfies Record<Exclude<keyof ViewState, AppViewKeyT>, (value: unknown) => boolean>;

export const PROJECT_VIEW_KEYS = Object.keys(viewValidators) as Exclude<keyof ViewState, AppViewKeyT>[];

export function restoreProjectView(settings: MaddieProject['settings']): ViewState {
  const view = settings?.view ?? {};
  const saved = PROJECT_VIEW_KEYS.filter((key) => view[key] !== undefined).map((key) => [key, view[key]]);
  const restored: ViewState = { ...DEFAULT_VIEW, fold: settings?.fold ?? DEFAULT_VIEW.fold, ...Object.fromEntries(saved) };
  const legacyTab = restored.chordsTab as string;
  const isLegacySongTab = legacyTab === 'song';
  const isLegacyTab = legacyTab === 'browse' || legacyTab === 'suggestions';
  if (isLegacySongTab) restored.chordsTab = 'project';
  if (isLegacyTab) restored.chordsTab = 'all';
  if (view.hiddenChordFamilies === undefined && view.chordFamily && view.chordFamily !== 'all') {
    restored.hiddenChordFamilies = chordFamilyIds.filter((family) => family !== view.chordFamily);
  }
  return restored;
}

function hasTime(value: Record<string, unknown>) {
  return int(value.start) && int(value.duration, 1) && Number.isSafeInteger(value.start + value.duration);
}

function validNote(value: unknown): value is Record<string, unknown> {
  return record(value) && id(value.id) && hasTime(value) && int(value.pitch, 0, 127) && velocity(value.velocity) &&
    optional(value.channel, (channel) => int(channel, 0, 15)) && optional(value.chordRegionId, id) &&
    optional(value.muted, boolean) && optional(value.data, record);
}

function validRegion(value: unknown): value is Record<string, unknown> & { start: number; duration: number } {
  if (!record(value) || !id(value.id) || !id(value.symbol) || !hasTime(value) || !velocity(value.velocity) || !int(value.root, 0, 11)) return false;
  const { performance } = value;
  return list(value.intervals, (n) => int(n)) && value.intervals.length > 0 &&
    list(value.pitches, (n) => int(n, 0, 127)) && value.pitches.length > 0 &&
    optional(value.muted, boolean) && optional(value.voicing, id) && optional(value.inversion, (n) => int(n)) &&
    optional(value.rootMidi, (n) => typeof n === 'number' && Number.isSafeInteger(n)) &&
    (performance === undefined || (record(performance) && id(performance.templateId) && id(performance.groupId) &&
      id(performance.key) && id(performance.scale) && optional(performance.phaseTicks, (n) => int(n)))) &&
    optional(value.dynamics, validDynamics);
}

function validDynamics(value: unknown): boolean {
  if (!record(value)) return false;
  const { ramp, pitchRange, humanize, accent } = value;
  const isRampValid = ramp === undefined || (record(ramp) && velocity(ramp.from) && velocity(ramp.to));
  const isPitchRangeValid = pitchRange === undefined || (record(pitchRange) && typeof pitchRange.min === 'number' &&
    typeof pitchRange.max === 'number' && pitchRange.min >= 1 / 127 && pitchRange.max <= 1 && pitchRange.min <= pitchRange.max);
  const isHumanizeValid = humanize === undefined || (record(humanize) && numberIn(0, 1)(humanize.amount) && typeof humanize.seed === 'number');
  const isAccentValid = accent === undefined || oneOf(...CHORD_ACCENTS.map((item) => item.value))(accent);
  return isRampValid && isPitchRangeValid && isHumanizeValid && isAccentValid;
}

function validRoute(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.kind === 'sound') return id(value.soundId);
  if (value.kind !== 'midi') return false;
  const hasValidPort = value.portId === null || id(value.portId);
  return hasValidPort && optional(value.channel, (channel) => int(channel, 0, 15));
}

function validTrack(value: unknown): value is Record<string, unknown> {
  if (!record(value) || !id(value.id) || !optional(value.name, text) || !optional(value.color, text) ||
    !optional(value.route, validRoute) ||
    !optional(value.gain, velocity) || !optional(value.muted, boolean) || !optional(value.solo, boolean) || !Array.isArray(value.notes)) return false;
  const noteIds = new Set<unknown>();
  const owners = new Map<unknown, { start: number; duration: number }>();
  if (value.chordRegions !== undefined) {
    if (!Array.isArray(value.chordRegions)) return false;
    let end = 0;
    for (const region of value.chordRegions) {
      if (!validRegion(region) || owners.has(region.id) || region.start < end) return false;
      owners.set(region.id, region);
      end = region.start + region.duration;
    }
  }
  for (const note of value.notes as unknown[]) {
    if (!validNote(note) || noteIds.has(note.id)) return false;
    noteIds.add(note.id);
    if (value.chordRegions !== undefined) {
      const owner = owners.get(note.chordRegionId);
      if (!owner || !int(note.start) || !int(note.duration) || note.start < owner.start ||
        note.start + note.duration > owner.start + owner.duration) return false;
    }
  }
  return true;
}

function validDoc(doc: unknown): doc is MaddieDoc {
  if (!record(doc) || doc.version !== 1 || !int(doc.ppq, 1)) return false;
  if (!list(doc.tempo, (e) => record(e) && int(e.tick) && typeof e.bpm === 'number' && Number.isFinite(e.bpm) && e.bpm > 0) ||
    !doc.tempo.length) return false;
  if (!list(doc.timeSignature, (e) => record(e) && int(e.tick) && int(e.numerator, 1) && int(e.denominator, 1)) ||
    !doc.timeSignature.length) return false;
  if (doc.sections !== undefined) {
    const validSection = (s: unknown): s is Section => record(s) && id(s.id) && id(s.name) && id(s.color) && int(s.durationBars, 1);
    if (!Array.isArray(doc.sections) || !doc.sections.every(validSection)) return false;
    if (new Set(doc.sections.map((s) => s.id)).size !== doc.sections.length ||
      !Number.isSafeInteger(1 + doc.sections.reduce((sum, s) => sum + s.durationBars, 0))) return false;
  }
  const { key } = doc;
  if (key !== null && (!record(key) || !int(key.root, 0, 11) || !SCALE_IDS.some((scale) => scale === key.scale))) return false;
  return Array.isArray(doc.tracks) && doc.tracks.length > 0 && doc.tracks.every(validTrack) &&
    new Set(doc.tracks.map((track) => track.id)).size === doc.tracks.length;
}

function validSettings(value: unknown) {
  if (!record(value) || !optional(value.activeTrackId, id) || !optional(value.soundId, id) ||
    !optional(value.midiPortId, nullable(id)) || !optional(value.marker, numberIn(0)) ||
    !optional(value.volume, (v) => record(v) && velocity(v.level) && boolean(v.muted)) ||
    !optional(value.metronomeVolume, velocity) || !optional(value.metronomeEnabled, boolean) ||
    !optional(value.fold, viewValidators.fold) ||
    !optional(value.view, (view) => record(view) &&
      optional(view.chordFamily, isLegacyChordFamily) &&
      PROJECT_VIEW_KEYS.every((key) => optional(view[key], viewValidators[key])))) return false;
  const loop = value.loop;
  return loop === undefined || (record(loop) && boolean(loop.enabled) && int(loop.start) && int(loop.end) &&
    (!loop.enabled || loop.end > loop.start));
}

export function readProject(value: unknown): MaddieProject {
  if (!record(value) || value.format !== 'maddie') throw new Error('This file is not a Maddie project.');
  if (value.version !== 1) throw new Error('This Maddie project uses an unsupported version.');
  if (!id(value.name) || !optional(value.updatedAt, (stamp) => int(stamp)) || !validDoc(value.doc) || !optional(value.settings, validSettings)) {
    throw new Error('This Maddie project contains invalid data.');
  }
  return value as unknown as MaddieProject;
}

export function parseProject(json: string): MaddieProject {
  let value: unknown;
  try { value = JSON.parse(json); }
  catch { throw new Error('This Maddie project is not valid JSON.'); }
  return readProject(value);
}

export const projectFilename = (name: string) => {
  const stem = name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\.maddie$/i, '') || 'Untitled Project';
  const reserved = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem);
  return `${reserved ? '_' : ''}${stem}.maddie`;
};

export const downloadProject = (project: MaddieProject) => {
  const blob = new Blob([JSON.stringify(project)], { type: 'application/json' });
  return saveEditorFile(blob, projectFilename(project.name), 'Maddie project', '.maddie');
};
