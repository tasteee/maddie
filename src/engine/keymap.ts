import type { Editor } from '../core';
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

const nudge = (editor: Editor, dir: -1 | 1) => {
  if (!editor.selection.size) return;
  editor.commands.move(undefined, { ticks: dir * editor.commands.gridTicks() });
};

const pitchNudge = (editor: Editor, steps: number) => {
  if (!editor.selection.size) return;
  if (editor.view.scaleLock && editor.key && Math.abs(steps) === 1) editor.commands.transpose(undefined, { degrees: steps });
  else editor.commands.transpose(undefined, { semitones: steps });
};

const resizeBy = (editor: Editor, dir: -1 | 1) => {
  if (!editor.selection.size) return;
  editor.commands.resize(undefined, { edge: 'end', ticks: dir * editor.commands.gridTicks() });
};

/** Built-in actions, by name. Keymaps point at these (or at functions). */
export const actions: Record<string, Action> = {
  undo: (e) => e.undo(),
  redo: (e) => e.redo(),
  delete: (e) => e.selection.size && e.commands.delete(),
  selectAll: (e) => e.commands.selectAll(),
  deselect: (e) => e.clearSelection(),
  duplicate: (e) => e.selection.size && e.commands.duplicate(),
  copy: (e) => e.commands.copy(),
  cut: (e) => e.selection.size && e.commands.cut(),
  paste: (e) => e.commands.paste(),
  quantize: (e) => e.selection.size && e.commands.quantize(),
  mute: (e) => e.selection.size && e.commands.toggleMute(),
  legato: (e) => e.selection.size && e.commands.legato(),
  nudgeLeft: (e) => nudge(e, -1),
  nudgeRight: (e) => nudge(e, 1),
  pitchUp: (e) => pitchNudge(e, 1),
  pitchDown: (e) => pitchNudge(e, -1),
  octaveUp: (e) => pitchNudge(e, 12),
  octaveDown: (e) => pitchNudge(e, -12),
  shorten: (e) => resizeBy(e, -1),
  lengthen: (e) => resizeBy(e, 1),
  velocityUp: (e) => e.selection.size && e.commands.setVelocity(undefined, { mode: 'relative', value: 0.05 }),
  velocityDown: (e) => e.selection.size && e.commands.setVelocity(undefined, { mode: 'relative', value: -0.05 }),
  zoomIn: (e) => zoomBy(e, 1.5),
  zoomOut: (e) => zoomBy(e, 1 / 1.5),
  rowsTaller: (e) => rowZoomBy(e, 1.25),
  rowsShorter: (e) => rowZoomBy(e, 1 / 1.25),
  playPause: (e) => e.transport.toggle(),
  stop: (e) => e.transport.stop(),
  toolSelect: (e) => e.setView({ tool: 'select' }),
  toolDraw: (e) => e.setView({ tool: 'draw' }),
  toolErase: (e) => e.setView({ tool: 'erase' }),
  toolVelocity: (e) => e.setView({ tool: 'velocity' }),
  toggleSnap: (e) => e.setView({ snap: !e.view.snap }),
  toggleLoop: (e) => e.transport.setLoop({ enabled: !e.transport.loop.enabled }),
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
  l: 'legato',
  arrowleft: 'nudgeLeft',
  arrowright: 'nudgeRight',
  arrowup: 'pitchUp',
  arrowdown: 'pitchDown',
  'shift+arrowup': 'octaveUp',
  'shift+arrowdown': 'octaveDown',
  'shift+arrowleft': 'shorten',
  'shift+arrowright': 'lengthen',
  'alt+arrowup': 'velocityUp',
  'alt+arrowdown': 'velocityDown',
  '=': 'zoomIn',
  '+': 'zoomIn',
  '-': 'zoomOut',
  'alt+=': 'rowsTaller',
  'alt+-': 'rowsShorter',
  space: 'playPause',
  enter: 'stop',
  v: 'toolSelect',
  b: 'toolDraw',
  d: 'toolDraw',
  e: 'toolErase',
  g: 'toolVelocity',
  s: 'toggleSnap',
  'mod+l': 'toggleLoop',
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function comboOf(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('mod');
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
