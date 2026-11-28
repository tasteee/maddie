import { getTrackName } from '../core/tracks';
import {
  canHaveModifier, downloadMidi, FOLD_CHOICES, getGridModifier, getStraightGrid, GRID_DIVISIONS, GRID_FEELS,
  loadScaled, setGridModifier, stepGrid, timeSigAt, visibleLineTicks, type ChordRegion, type Editor,
} from '../core';
import { Engine } from './engine';

export type Action = (editor: Editor) => void;

const zoomBy = (editor: Editor, factor: number) => {
  const v = editor.view;
  const width = Engine.for(editor).viewport.width || 800;
  const center = v.scrollTick + width / 2 / v.pxPerTick;
  const px = v.pxPerTick * factor;
  editor.setView({ pxPerTick: px, scrollTick: center - width / 2 / px }, { animate: true });
};

/** Taller / shorter rows, keeping the row at the center in place. */
export const rowZoomBy = (editor: Editor, factor: number) => {
  const v = editor.view;
  const engine = Engine.for(editor);
  const half = (engine.viewport.height || 400) / 2;
  const anchor = (v.scrollRow ?? 0) + half / v.rowHeight;
  editor.setView({ rowHeight: v.rowHeight * factor });
  const rh = editor.view.rowHeight;
  const max = engine.maxScrollRow(rh);
  editor.setView({ scrollRow: Math.max(0, Math.min(max, anchor - half / rh)) });
};

/** Step the play marker to the previous / next grid line, scrolling to keep it in view. */
const stepMarker = (editor: Editor, dir: -1 | 1, gridOverride?: number) => {
  const { transport } = editor;
  const from = transport.marker;
  const grid = gridOverride ?? editor.commands.gridTicks(from);
  const tick = stepGrid(from, grid, editor.meta.timeSignature, dir);
  Engine.for(editor).pauseFollow();
  editor.setInsertMarker(tick);
  const v = editor.view;
  const span = (Engine.for(editor).viewport.width || 800) / v.pxPerTick;
  const margin = span * 0.1;
  if (tick < v.scrollTick + margin) editor.setView({ scrollTick: tick - margin }, { animate: true });
  else if (tick > v.scrollTick + span - margin) editor.setView({ scrollTick: tick - span + margin }, { animate: true });
};

/** Use a stable source when the performance library still needs to load. */
const editChords = async (editor: Editor, label: string, plan: () => readonly ChordRegion[] | undefined, audition = false) => {
  const source = editor.chordRegions;
  if (!source) return;
  try {
    if (source.some((region) => region.performance)) await loadScaled();
    if (editor.chordRegions !== source) return;
    const regions = plan();
    const edit = regions && editor.chordTrack.prepare(regions);
    if (edit && editor.chordTrack.commit(edit, label) && audition) editor.chordTrack.auditionPitches();
  } catch (error) {
    Engine.for(editor).toast((error as Error).message, 'error');
  }
};

/** The finest a precise nudge goes: 1/64. */
const FINEST_NUDGE_DIVISION = 64;

/**
 * Precise nudge steps, relative to what you see: each level halves the spacing of the
 * finest drawn lines. Level 1 (Ctrl) lands halfway between visible lines, level 2
 * (Ctrl+Shift) a quarter of the way. Never finer than 1/64.
 */
const preciseStep = (editor: Editor, at: number, level: 1 | 2): number => {
  const sig = timeSigAt(Math.max(0, at), editor.meta.timeSignature);
  const visible = visibleLineTicks(editor.view.grid, editor.ppq, editor.view.pxPerTick, sig);
  const finest = (editor.ppq * 4) / FINEST_NUDGE_DIVISION;
  return Math.max(finest, visible / 2 ** level);
};

/**
 * Move the selection so its first note lands on the previous / next grid line. Snap off: one grid step.
 * `level` 1 or 2 steps by finer lines than the zoom shows (see `preciseStep`).
 */
const nudge = (editor: Editor, dir: -1 | 1, level: 0 | 1 | 2 = 0) => {
  if (editor.sections.allTracksSelected) {
    const start = editor.sections.contentStart;
    if (start === undefined) return;
    const grid = level ? preciseStep(editor, start, level) : editor.commands.gridTicks(start);
    const to = editor.view.snap ? stepGrid(start, grid, editor.meta.timeSignature, dir) : start + dir * grid;
    return sectionContent(editor, () => editor.sections.moveContent(Math.round(to - start)));
  }
  const isPrecise = level > 0;
  if (!editor.selection.size) {
    const markerFrom = editor.transport.playing ? editor.transport.position : editor.transport.marker;
    const markerGrid = isPrecise ? preciseStep(editor, markerFrom, level as 1 | 2) : undefined;
    return stepMarker(editor, dir, markerGrid);
  }
  const chords = editor.selectedChordRegions;
  const from = chords[0]?.start ?? Math.min(...editor.selectedNotes.map((n) => n.start));
  const grid = isPrecise ? preciseStep(editor, from, level as 1 | 2) : editor.commands.gridTicks(from);
  const to = editor.view.snap ? stepGrid(from, grid, editor.meta.timeSignature, dir) : from + dir * grid;
  if (chords.length) return void editChords(editor, 'Move chords', () => editor.chordTrack.planNudge(dir, to));
  editor.commands.move(undefined, { ticks: to - from });
};

const pitchNudge = (editor: Editor, steps: number) => {
  if (!editor.selection.size) return;
  const chords = editor.selectedChordRegions;
  if (chords.length) {
    if (Math.abs(steps) === 12) void editChords(editor, 'Transpose chords', () => editor.chordTrack.planMove(chords[0].id, chords[0].start, steps / 12, chords), true);
    return;
  }
  editor.commands.nudgePitch(undefined, steps);
};

/** Move each selected note's end to the previous / next grid line (never past its start). Snap off: one grid step. */
const resizeBy = (editor: Editor, dir: -1 | 1) => {
  if (!editor.selection.size) return;
  if (editor.chordRegions) {
    const [region, other] = editor.selectedChordRegions;
    if (!region || other) return;
    const end = region.start + region.duration;
    const grid = editor.commands.gridTicks(end);
    const tick = editor.view.snap ? stepGrid(end, grid, editor.meta.timeSignature, dir) : end + dir * grid;
    return void editChords(editor, 'Resize chord', () => editor.chordTrack.planResize(region.id, 'end', tick));
  }
  if (!editor.view.snap) return editor.commands.resize(undefined, { edge: 'end', ticks: dir * editor.commands.gridTicks() });
  const sigs = editor.meta.timeSignature;
  const changes = editor.selectedNotes.flatMap((n) => {
    const end = n.start + n.duration;
    const next = stepGrid(end, editor.commands.gridTicks(end), sigs, dir);
    return next > n.start && next !== end ? [{ id: n.id, duration: next - n.start }] : [];
  });
  if (changes.length) editor.commands.update(changes, 'Resize notes');
};

/** Keep what was just played (outside a take) as notes at the marker. */
export const captureMidi = (editor: Editor) => {
  const engine = Engine.for(editor);
  if (editor.chordRegions) return engine.toast('Select a MIDI track to capture notes.');
  const ids = editor.capture.commit(editor.transport.position);
  const hasNotes = ids.length > 0;
  if (!hasNotes) return engine.toast('Nothing to capture yet · play something first');
  const label = ids.length === 1 ? '1 note' : `${ids.length} notes`;
  const index = editor.trackIds.indexOf(editor.activeTrackId);
  const track = editor.trackList[index];
  const name = getTrackName(track, index);
  engine.toast(`Captured ${label} to ${name}`, 'capture');
};

const chordShortcut = (editor: Editor, operation: Promise<unknown> | undefined) => {
  void operation?.catch((error: Error) => Engine.for(editor).toast(error.message, 'error'));
};

const nextChoice = <T extends { value: string }>(choices: readonly T[], current: string): T =>
  choices[(choices.findIndex(({ value }) => value === current) + 1) % choices.length];

function sectionContent(editor: Editor, action: () => void) {
  try {
    action();
  } catch (error) {
    Engine.for(editor).toast((error as Error).message, 'error');
  }
}

/** Built-in actions, by name. Keymaps point at these (or at functions). */
export const actions: Record<string, Action> = {
  undo: (e) => e.undo(),
  redo: (e) => e.redo(),
  delete: (e) => {
    if (e.sections.allTracksSelected) return sectionContent(e, () => e.sections.deleteContent());
    if (!e.selection.size) return;
    if (!e.chordRegions) return e.commands.delete();
    void e.chordTrack.delete(e.selection).catch((error: Error) => Engine.for(e).toast(error.message, 'error'));
  },
  selectAll: (e) => e.commands.selectAll(),
  deselect: (e) => e.clearSelection(),
  duplicate: (e) => {
    if (e.sections.selected.size) return sectionContent(e, () => {
      const copies = e.sections.duplicate(e.sections.selected);
      if (copies.length) e.sections.select(copies);
    });
    if (e.chordRegions) return chordShortcut(e, e.chordTrack.duplicate());
    if (e.selection.size) e.commands.duplicate();
  },
  copy: (e) => e.sections.allTracksSelected ? e.sections.copyContent() : e.commands.copy(),
  cut: (e) => {
    if (e.sections.allTracksSelected) {
      e.sections.copyContent();
      return sectionContent(e, () => e.sections.deleteContent());
    }
    if (!e.chordRegions) return e.selection.size && e.commands.cut();
    e.chordTrack.copy();
    chordShortcut(e, e.chordTrack.delete(e.selection));
  },
  paste: (e) => {
    if (e.sections.hasContentClipboard) return sectionContent(e, () => { e.sections.pasteContent(e.view.cursor); });
    return e.chordRegions ? chordShortcut(e, e.chordTrack.paste()) : e.commands.paste();
  },
  quantize: (e) => e.selection.size && e.commands.quantize(),
  mute: (e) => e.selection.size && e.commands.toggleMute(),
  toggleTrackMute: (e) => {
    const track = e.trackList.find((track) => track.id === e.activeTrackId);
    if (track) e.commands.setTrackMuted(track.id, !track.muted);
  },
  toggleTrackSolo: (e) => e.commands.soloTrack(e.activeTrackId, false),
  legato: (e) => e.selection.size && e.commands.legato(),
  nudgeLeft: (e) => nudge(e, -1),
  nudgeRight: (e) => nudge(e, 1),
  nudgeFinerLeft: (e) => nudge(e, -1, 1),
  nudgeFinerRight: (e) => nudge(e, 1, 1),
  nudgeFinestLeft: (e) => nudge(e, -1, 2),
  nudgeFinestRight: (e) => nudge(e, 1, 2),
  pitchUp: (e) => pitchNudge(e, 1),
  pitchDown: (e) => pitchNudge(e, -1),
  octaveUp: (e) => pitchNudge(e, 12),
  octaveDown: (e) => pitchNudge(e, -12),
  shorten: (e) => resizeBy(e, -1),
  lengthen: (e) => resizeBy(e, 1),
  halveLength: (e) => e.selection.size && e.commands.stretch(undefined, 0.5),
  doubleLength: (e) => e.selection.size && e.commands.stretch(undefined, 2),
  velocityUp: (e) => e.selection.size && e.commands.setVelocity(undefined, { mode: 'relative', value: 0.05 }),
  velocityDown: (e) => e.selection.size && e.commands.setVelocity(undefined, { mode: 'relative', value: -0.05 }),
  zoomIn: (e) => zoomBy(e, 1.5),
  zoomOut: (e) => zoomBy(e, 1 / 1.5),
  rowsTaller: (e) => rowZoomBy(e, 1.25),
  rowsShorter: (e) => rowZoomBy(e, 1 / 1.25),
  // The selected section can start playback without moving the insert marker.
  playPause: (e) => e.transport.toggle(),
  resumePlayback: (e) => e.transport.resume(),
  playSelection: (e) => {
    const notes = e.selectedNotes;
    const first = e.selectedChordRegions[0]?.start ?? (notes.length ? Math.min(...notes.map((n) => n.start)) : undefined);
    if (first === undefined) return e.transport.toggle();
    e.setView({ cursor: first });
    e.transport.seek(first);
    if (!e.transport.playing) e.transport.play();
  },
  stop: (e) => {
    e.transport.stop();
    if (e.transport.position !== 0) e.transport.stop();
    e.setView({ cursor: e.transport.marker });
  },
  toggleSnap: (e) => e.setView({ snap: !e.view.snap }),
  cycleGridDivision: (e) => {
    const grid = e.view.grid;
    const division = nextChoice(GRID_DIVISIONS, getStraightGrid(grid));
    e.setView({ grid: setGridModifier(division.value, getGridModifier(grid)) });
    Engine.for(e).toast(`Grid Division · ${division.label}`);
  },
  cycleGridFeel: (e) => {
    const grid = e.view.grid;
    if (!canHaveModifier(grid)) {
      Engine.for(e).toast('Grid Feel · Select a note division to change the feel');
      return;
    }
    const feel = nextChoice(GRID_FEELS, getGridModifier(grid));
    e.setView({ grid: setGridModifier(grid, feel.value) });
    Engine.for(e).toast(`Grid Feel · ${feel.label}`);
  },
  cycleFold: (e) => {
    const choices = e.key ? FOLD_CHOICES : FOLD_CHOICES.filter(({ value }) => value !== 'scale');
    const fold = nextChoice(choices, e.view.fold);
    e.setView({ fold: fold.value }, { animate: true });
    Engine.for(e).toast(`Fold · ${fold.label}`);
  },
  toggleMetronome: (e) => e.transport.setMetronome({ enabled: !e.transport.metronome.enabled }),
  toggleMasterMute: (e) => e.setVolume({ muted: !e.volume.muted }),
  toggleFollow: (e) => e.setView({ follow: !e.view.follow }),
  toggleChords: (e) => e.setView({ chordsPanel: !e.view.chordsPanel, patternPicker: null }),
  toggleSuggestions: (e) => e.setView({ suggestionsOpen: !e.view.suggestionsOpen }),
  toggleVelocityLane: (e) => e.setView({ velocityLaneOpen: !e.view.velocityLaneOpen }),
  record: (e) => e.recorder.toggle(),
  captureMidi: (e) => captureMidi(e),
  toggleLoop: (e) => {
    const { loop } = e.transport;
    if (loop.end > loop.start) return e.transport.setLoop({ enabled: !loop.enabled });
    const { numerator, denominator } = e.meta.timeSignature[0];
    e.transport.setLoop({ start: 0, end: e.ppq * 8 * numerator / denominator, enabled: true });
  },
  loopSelection: (e) => {
    const selectedNotes = e.selectedNotes;
    const selectedChords = e.selectedChordRegions;
    const selectedSpans = [...selectedNotes, ...selectedChords];
    const hasSelection = selectedSpans.length > 0;
    if (!hasSelection) return actions.toggleLoop(e);
    const starts = selectedSpans.map((span) => span.start);
    const ends = selectedSpans.map((span) => span.start + span.duration);
    const start = Math.min(...starts);
    const end = Math.max(...ends);
    e.transport.setLoop({ start, end, enabled: true });
  },
  exportMidi: (e) => e.hasAnyNotes && downloadMidi(e.doc),
};

export type Keymap = Record<string, string | Action>;

export const defaultKeymap: Keymap = {
  'mod+z': 'undo',
  'mod+shift+z': 'redo',
  'mod+y': 'redo',
  backspace: 'delete',
  delete: 'delete',
  'mod+a': 'selectAll',
  escape: 'deselect',
  'mod+d': 'duplicate',
  'mod+c': 'copy',
  'mod+x': 'cut',
  'mod+v': 'paste',
  q: 'quantize',
  m: 'toggleTrackMute',
  '0': 'mute',
  'n+l': 'legato',
  arrowleft: 'nudgeLeft',
  arrowright: 'nudgeRight',
  'mod+arrowleft': 'nudgeFinerLeft',
  'mod+arrowright': 'nudgeFinerRight',
  'ctrl+arrowleft': 'nudgeFinerLeft',
  'ctrl+arrowright': 'nudgeFinerRight',
  'mod+shift+arrowleft': 'nudgeFinestLeft',
  'mod+shift+arrowright': 'nudgeFinestRight',
  'ctrl+shift+arrowleft': 'nudgeFinestLeft',
  'ctrl+shift+arrowright': 'nudgeFinestRight',
  arrowup: 'pitchUp',
  arrowdown: 'pitchDown',
  'shift+arrowup': 'octaveUp',
  'shift+arrowdown': 'octaveDown',
  'shift+arrowleft': 'shorten',
  'shift+arrowright': 'lengthen',
  'alt+shift+arrowleft': 'halveLength',
  'alt+shift+arrowright': 'doubleLength',
  'alt+arrowup': 'velocityUp',
  'alt+arrowdown': 'velocityDown',
  '=': 'zoomIn',
  '+': 'zoomIn',
  '-': 'zoomOut',
  'alt+=': 'rowsTaller',
  'alt+-': 'rowsShorter',
  space: 'playPause',
  'shift+space': 'resumePlayback',
  'mod+space': 'playSelection',
  'ctrl+space': 'playSelection',
  enter: 'stop',
  s: 'toggleTrackSolo',
  's+t+g': 'toggleSnap',
  '/+c': 'toggleChords',
  '/+s': 'toggleSuggestions',
  '/+v': 'toggleVelocityLane',
  'mod+l': 'loopSelection',
  r: 'record',
  'shift+r': 'captureMidi',
  'shift+m': 'toggleMasterMute',
  'mod+shift+e': 'exportMidi',
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function comboOf(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('mod');
  if (isMac && e.ctrlKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  const key = keyName(e);
  if (e.shiftKey && key.length > 1) parts.push('shift');
  else if (e.shiftKey && /^[a-z]$/.test(key)) parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

const keyName = (e: KeyboardEvent) => e.key === ' ' ? 'space' : e.key.toLowerCase();

function resolveCombo(e: KeyboardEvent, keymap: Keymap): string {
  const combo = comboOf(e);
  if (keymap[combo]) return combo;
  // Alt can change e.key (macOS: ⌥A = å).
  const physical = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.code === 'Equal' ? '=' : e.code === 'Minus' ? '-' : null;
  return physical ? combo.replace(/[^+]+$/, physical) : combo;
}

function getAction(keymap: Keymap, combo: string): Action | undefined {
  const entry = keymap[combo];
  return typeof entry === 'function' ? entry : actions[entry];
}

/** Dispatches a binding directly. The editor uses HeldShortcuts for event timing. */
export function handleKey(editor: Editor, e: KeyboardEvent, keymap: Keymap = defaultKeymap): boolean {
  const action = getAction(keymap, resolveCombo(e, keymap));
  if (!action) return false;
  action(editor);
  return true;
}

const modifiers = new Set(['mod', 'ctrl', 'alt', 'shift', 'meta']);
type PressedKey = { name: string; onRelease?: Action };

/** Dispatch singles on release and held combinations when their final key goes down. */
export class HeldShortcuts {
  private readonly pressed = new Map<string, PressedKey>();

  constructor(private readonly editor: Editor, private readonly getKeymap: () => Keymap) {}

  keyDown(e: KeyboardEvent, fallback?: () => boolean): boolean {
    const name = keyName(e);
    const code = e.code || name;
    if (this.pressed.has(code)) return true;
    const keymap = this.getKeymap();
    const isUnmodified = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    const chords = isUnmodified ? Object.keys(keymap)
      .map((binding) => ({ binding, keys: binding.split('+') }))
      .filter(({ keys }) => keys.length > 1 && keys.includes(name) && keys.every((key) => key && !modifiers.has(key)) &&
        (!this.editor.view.computerKeyboard || !keys.every(isLetter))) : [];

    if (!e.repeat && chords.length) {
      const held = [...this.pressed.values()];
      const match = chords
        .filter(({ keys }) => keys.every((key) => key === name || held.some((press) => press.name === key)))
        .sort((a, b) => b.keys.length - a.keys.length)
        .find(({ binding }) => getAction(keymap, binding));
      if (match) {
        for (const press of held) {
          if (match.keys.includes(press.name)) press.onRelease = undefined;
        }
        this.pressed.set(code, { name });
        getAction(keymap, match.binding)?.(this.editor);
        return true;
      }
    }

    // MIDI note input and its mode controls keep their existing keydown behavior.
    if (fallback?.()) return true;
    if (isUnmodified && this.editor.view.computerKeyboard && isLetter(name)) return false;
    const combo = resolveCombo(e, keymap);
    const action = getAction(keymap, combo);
    if (action && combo !== '+' && combo.includes('+')) {
      if (!e.repeat) action(this.editor);
      return true;
    }
    if (!action && !chords.length) return false;
    if (!e.repeat) this.pressed.set(code, { name, onRelease: action });
    return true;
  }

  keyUp(e: KeyboardEvent) {
    const code = e.code || keyName(e);
    const press = this.pressed.get(code);
    this.pressed.delete(code);
    if (!e.defaultPrevented && press && !(this.editor.view.computerKeyboard && isLetter(press.name))) press.onRelease?.(this.editor);
  }

  clear() {
    this.pressed.clear();
  }
}

const isLetter = (key: string) => /^\p{L}$/u.test(key);

export const modKeyLabel = isMac ? '⌘' : 'Ctrl';
