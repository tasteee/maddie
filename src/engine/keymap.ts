import { getTrackName } from '../core/tracks';
import { downloadMidi, loadScaled, stepGrid, type ChordRegion, type Editor } from '../core';
import { Engine } from './engine';

export type Action = (editor: Editor) => void;

const zoomBy = (editor: Editor, factor: number) => {
  const v = editor.view;
  const width = Engine.for(editor).viewport.width || 800;
  const center = v.scrollTick + width / 2 / v.pxPerTick;
  const px = v.pxPerTick * factor;
  editor.setView({ pxPerTick: px, scrollTick: Math.max(0, center - width / 2 / px) }, { animate: true });
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
  const from = transport.playing ? transport.position : transport.marker;
  const grid = gridOverride ?? editor.commands.gridTicks(from);
  const tick = stepGrid(from, grid, editor.meta.timeSignature, dir);
  transport.seek(tick);
  editor.setView({ cursor: tick });
  const v = editor.view;
  const span = (Engine.for(editor).viewport.width || 800) / v.pxPerTick;
  const margin = span * 0.1;
  if (tick < v.scrollTick + margin) editor.setView({ scrollTick: Math.max(0, tick - margin) }, { animate: true });
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

/** The fixed step for Ctrl+←/→: a 16th, whatever the zoom or the grid shows. */
const FINE_NUDGE_DIVISION = 16;

/**
 * Move the selection so its first note lands on the previous / next grid line. Snap off: one grid step.
 * `fine` uses 1/16 lines instead of the visible grid, so a zoomed-out view can still make small, aligned moves.
 */
const nudge = (editor: Editor, dir: -1 | 1, { fine = false }: { fine?: boolean } = {}) => {
  const fineGrid = (editor.ppq * 4) / FINE_NUDGE_DIVISION;
  if (!editor.selection.size) return stepMarker(editor, dir, fine ? fineGrid : undefined);
  const chords = editor.selectedChordRegions;
  const from = chords[0]?.start ?? Math.min(...editor.selectedNotes.map((n) => n.start));
  const grid = fine ? fineGrid : editor.commands.gridTicks(from);
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

/** Built-in actions, by name. Keymaps point at these (or at functions). */
export const actions: Record<string, Action> = {
  undo: (e) => e.undo(),
  redo: (e) => e.redo(),
  delete: (e) => {
    if (!e.selection.size) return;
    if (!e.chordRegions) return e.commands.delete();
    void e.chordTrack.delete(e.selection).catch((error: Error) => Engine.for(e).toast(error.message, 'error'));
  },
  selectAll: (e) => e.commands.selectAll(),
  deselect: (e) => e.clearSelection(),
  duplicate: (e) => e.chordRegions ? chordShortcut(e, e.chordTrack.duplicate()) : e.selection.size && e.commands.duplicate(),
  copy: (e) => e.commands.copy(),
  cut: (e) => {
    if (!e.chordRegions) return e.selection.size && e.commands.cut();
    e.chordTrack.copy();
    chordShortcut(e, e.chordTrack.delete(e.selection));
  },
  paste: (e) => e.chordRegions ? chordShortcut(e, e.chordTrack.paste()) : e.commands.paste(),
  quantize: (e) => e.selection.size && e.commands.quantize(),
  mute: (e) => e.selection.size && e.commands.toggleMute(),
  legato: (e) => e.selection.size && e.commands.legato(),
  nudgeLeft: (e) => nudge(e, -1),
  nudgeRight: (e) => nudge(e, 1),
  nudgeFineLeft: (e) => nudge(e, -1, { fine: true }),
  nudgeFineRight: (e) => nudge(e, 1, { fine: true }),
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
  // Like Ableton: stopping returns to the marker, so the next play starts from it.
  playPause: (e) => e.transport.toggle(),
  playSelection: (e) => {
    const notes = e.selectedNotes;
    const first = e.selectedChordRegions[0]?.start ?? (notes.length ? Math.min(...notes.map((n) => n.start)) : undefined);
    if (first === undefined) return e.transport.toggle();
    e.transport.seek(first);
    if (!e.transport.playing) e.transport.play();
  },
  stop: (e) => {
    e.transport.stop();
    if (e.transport.position !== 0) e.transport.stop();
  },
  toggleSnap: (e) => e.setView({ snap: !e.view.snap }),
  toggleMetronome: (e) => e.transport.setMetronome({ enabled: !e.transport.metronome.enabled }),
  toggleMasterMute: (e) => e.setVolume({ muted: !e.volume.muted }),
  toggleFollow: (e) => e.setView({ follow: !e.view.follow }),
  toggleChords: (e) => e.setView({ chordsPanel: !e.view.chordsPanel }),
  record: (e) => e.recorder.toggle(),
  captureMidi: (e) => captureMidi(e),
  toggleLoop: (e) => {
    const selectedNotes = e.selectedNotes;
    const selectedChords = e.selectedChordRegions;
    const selectedSpans = [...selectedNotes, ...selectedChords];
    const hasSelection = selectedSpans.length > 0;
    if (!hasSelection) return e.transport.setLoop({ enabled: !e.transport.loop.enabled });
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
  m: 'mute',
  '0': 'mute',
  l: 'legato',
  arrowleft: 'nudgeLeft',
  arrowright: 'nudgeRight',
  'mod+arrowleft': 'nudgeFineLeft',
  'mod+arrowright': 'nudgeFineRight',
  'ctrl+arrowleft': 'nudgeFineLeft',
  'ctrl+arrowright': 'nudgeFineRight',
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
  'mod+space': 'playSelection',
  'ctrl+space': 'playSelection',
  enter: 'stop',
  s: 'toggleSnap',
  'mod+l': 'toggleLoop',
  r: 'record',
  'shift+r': 'captureMidi',
  c: 'toggleMetronome',
  f: 'toggleFollow',
  h: 'toggleChords',
  'shift+m': 'toggleMasterMute',
  'mod+shift+e': 'exportMidi',
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function comboOf(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('mod');
  if (isMac && e.ctrlKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  const key = e.key === ' ' ? 'space' : e.key.toLowerCase();
  if (e.shiftKey && key.length > 1) parts.push('shift');
  else if (e.shiftKey && /^[a-z]$/.test(key)) parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

/** Runs the matching action. Returns true if handled. */
export function handleKey(editor: Editor, e: KeyboardEvent, keymap: Keymap = defaultKeymap): boolean {
  // Use the physical key for letters when Alt changes e.key (macOS: ⌥A = å).
  let combo = comboOf(e);
  if (!keymap[combo]) {
    const physical = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.code === 'Equal' ? '=' : e.code === 'Minus' ? '-' : null;
    if (physical) combo = combo.replace(/[^+]+$/, physical);
  }
  const entry = keymap[combo];
  if (!entry) return false;
  const action = typeof entry === 'function' ? entry : actions[entry];
  if (!action) return false;
  action(editor);
  return true;
}

export const modKeyLabel = isMac ? '⌘' : 'Ctrl';
