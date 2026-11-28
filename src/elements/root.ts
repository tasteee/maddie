import { css, html, LitElement, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { createEditor, fromMidiVelocity, parseKey, pitchRangeChords, type Editor, type MaddieDoc, type Note, type NoteInput, type Output, type Patch, type FoldMode, type NoteColorMode } from '../core';
import { Engine } from '../engine/engine';
import { OutputRouter, type SoundChoice } from '../engine/output-router';
import { defaultKeymap, HeldShortcuts, type Keymap } from '../engine/keymap';
import { ContextRequestEvent, editorContext, ROOT_READY } from './context';
import { computerKeyDown, computerKeyUp, releaseAll } from '../engine/computer-keyboard';
import { pickMidiFile } from './midi-io';
import { tokens } from './tokens';

/** Zest elements that handle their own keyboard input: the editor's shortcuts stay out of the way. */
const OWN_KEYS = new Set(['z-select', 'z-number-input', 'z-input', 'z-slider', 'z-range', 'z-range-handle', 'z-switch', 'z-popover', 'z-badge', 'z-menu', 'z-context-menu', 'z-toggle-button-group']);
const VELOCITY_ENTRY_DELAY = 1100;

const bool = (v: string | null) => v !== null && v !== 'false' && v !== 'off';

export interface MaddieChangeDetail {
  patches: readonly Patch[];
  origin: string;
  label: string;
  readonly doc: MaddieDoc;
}

/**
 * Owns an editor and provides it to every Maddie element inside.
 * No UI of its own: bring your own layout.
 *
 * @fires maddie-change - The doc changed. `detail: { patches, origin, label, doc }`
 * @fires maddie-beforechange - Cancelable. Call `preventDefault()` to veto an edit.
 * @fires maddie-selectionchange - `detail: { ids }`
 * @fires maddie-viewchange - `detail: { view }`
 * @fires maddie-transportchange - `detail: { state, position }`
 * @fires maddie-noteon - A note was scheduled during playback. `detail: { note, time, track }`
 * @fires maddie-trackchange - The track list, track settings, or the active track changed. `detail: { tracks, activeId }`
 */
@customElement('maddie-root')
export class MaddieRoot extends LitElement {
  static styles = [
    tokens,
    css`
      :host {
        display: block;
        outline: none;
        color: var(--_text);
      }
    `,
  ];

  /** The headless editor. Use it for anything the attributes don't cover. */
  readonly editor: Editor = createEditor();

  @property() grid?: string;
  @property({ converter: bool }) snap?: boolean;
  /** Key, e.g. `"C minor"`, `"F# dorian"`. Empty for none. */
  @property() scale?: string;
  @property() fold?: FoldMode;
  @property({ type: Number }) tempo?: number;
  @property({ attribute: 'time-signature' }) timeSignature?: string;
  @property({ attribute: 'scale-lock', converter: bool }) scaleLock?: boolean;
  /** `pitch` (default), `pitch-class`, or `mono`. */
  @property({ attribute: 'note-color' }) noteColor?: NoteColorMode;
  /**
   * A Zest theme for this editor alone: `dark` or `light`. Sets `data-theme` on the element.
   * Leave it unset to follow the page's `data-theme` (Zest's `<z-theme-switcher>` sets that on `<html>`).
   */
  @property() theme?: 'dark' | 'light' | 'console' | 'studio';
  /** Edits fire `maddie-beforechange` and are not applied. Apply them yourself. */
  @property({ type: Boolean }) controlled = false;
  /**
   * Handle shortcuts even when nothing in the editor has focus (focus on <body>).
   * For full-page editors. Off by default so embedded editors don't steal keys.
   */
  @property({ attribute: 'global-shortcuts', type: Boolean }) globalShortcuts = false;
  /** Keyboard shortcuts. Merge with `defaultKeymap` to extend. */
  @property({ attribute: false }) keymap: Keymap = defaultKeymap;

  private engine = Engine.for(this.editor);
  private heldShortcuts = new HeldShortcuts(this.editor, () => this.shortcutKeymap());
  private velocityEntry?: { text: string; timer?: number; trackId: string; selection: Editor['selection'] };

  constructor() {
    super();
    this.addEventListener('context-request', (e: Event) => {
      const req = e as ContextRequestEvent;
      if (req.context !== editorContext) return;
      e.stopPropagation();
      req.callback(this.editor);
    });
    this.addEventListener('keydown', this.onKeyDown);
    this.addEventListener('keyup', this.onKeyUp);
    this.addEventListener('focusout', (e) => {
      // Leaving the editor entirely: don't leave notes stuck on.
      if (!this.contains((e as FocusEvent).relatedTarget as Node) && !this.shadowRoot?.contains((e as FocusEvent).relatedTarget as Node)) {
        if (!this.globalShortcuts) releaseAll(this.editor);
      }
    });
    // Clicking any non-focusable part (ruler, keyboard, lanes) still focuses the editor,
    // so shortcuts like Space keep working.
    // Buttons must not keep focus, or Space would "press" them instead of toggling playback.
    this.addEventListener('mousedown', (event) => {
      const path = event.composedPath();
      const target = path[0] as HTMLElement | undefined;
      const isTextField = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      const isSlider = path.some((el) => el instanceof HTMLElement && el.localName === 'z-slider');
      const isNumberInput = path.some((el) => el instanceof HTMLElement && el.localName === 'z-number-input');
      const isFieldTarget = isTextField || isSlider || isNumberInput;
      if (isFieldTarget) return;
      const isPressable = path.some((el) => el instanceof HTMLElement && (el.localName === 'button' || el.localName.startsWith('z-')));
      if (!isPressable) return;
      event.preventDefault();
      const active = document.activeElement as HTMLElement | null;
      const hasFocusedControl = active && active !== document.body && active !== this;
      if (hasFocusedControl) active.blur();
      this.focus({ preventScroll: true });
    });
    this.addEventListener('pointerdown', () => {
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!active || active === document.body) this.focus({ preventScroll: true });
      });
    });
    this.wireEvents();
  }

  // ── Data ──────────────────────────────────────────────────────────

  get doc(): MaddieDoc {
    return this.editor.doc;
  }
  set doc(doc: Partial<MaddieDoc>) {
    this.editor.setDoc(doc);
  }

  /**
   * Shortcut for the active track's notes, so single-track code keeps working.
   * Reading returns the active track's notes only. Setting replaces only those notes; other tracks,
   * their names and colors stay as they are. The selection and history are cleared, like `doc`.
   * To change every track at once, set `doc`.
   */
  get notes(): readonly Note[] {
    return this.editor.notes();
  }
  set notes(notes: NoteInput[]) {
    const doc = this.editor.doc;
    let i = 0;
    const withIds = notes.map((n) => ({ ...n, id: n.id ?? `n${i++}-${Math.random().toString(36).slice(2, 7)}` }));
    this.editor.setDoc({ ...doc, tracks: doc.tracks.map((t) => (t.id === this.editor.activeTrackId ? { ...t, chordRegions: undefined, notes: withIds } : t)) });
  }

  get output(): Output | null {
    return this.editor.output;
  }
  set output(out: Output | null) {
    this.editor.output = out;
    this.editor.setVolume({});
  }

  /**
   * Sounds the output dropdown can pick (a sampler, a synth). A MIDI output choice is added for you.
   * Setting this makes Maddie choose `output`, so leave `output` alone when you use it.
   */
  get sounds(): SoundChoice[] {
    return OutputRouter.for(this.editor).sounds;
  }
  set sounds(sounds: SoundChoice[]) {
    OutputRouter.for(this.editor).setSounds(sounds);
  }

  get audioContext(): AudioContext | null {
    return this.editor.audioContext;
  }
  set audioContext(ctx: AudioContext | null) {
    this.editor.audioContext = ctx;
    this.editor.transport.setAudioContext(ctx);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  connectedCallback() {
    super.connectedCallback();
    if (!this.hasAttribute('tabindex')) this.tabIndex = -1;
    window.addEventListener('keydown', this.onWindowKeyDown);
    window.addEventListener('keyup', this.onWindowKeyUp);
    window.addEventListener('keyup', this.onShortcutKeyUp, true);
    window.addEventListener('blur', this.onWindowBlur);
    window.addEventListener('focusin', this.clearShortcutState, true);
    document.dispatchEvent(new Event(ROOT_READY));
    this.readMotion();
  }

  protected willUpdate(changed: PropertyValues) {
    if (changed.has('theme')) {
      if (this.theme === 'dark' || this.theme === 'light') this.dataset.theme = this.theme;
      else delete this.dataset.theme;
    }
    const ed = this.editor;
    const view: Parameters<Editor['setView']>[0] = {};
    if (changed.has('grid') && this.grid) view.grid = this.grid;
    if (changed.has('snap') && this.snap !== undefined) view.snap = this.snap;
    if (changed.has('fold') && this.fold) view.fold = this.fold;
    if (changed.has('scaleLock') && this.scaleLock !== undefined) view.scaleLock = this.scaleLock;
    if (changed.has('noteColor') && this.noteColor) view.noteColor = this.noteColor;
    ed.setView(view);

    // Doc-level attributes apply without creating undo steps.
    if (changed.has('tempo') && this.tempo) {
      const bpm = this.tempo;
      ed.transact('Tempo', (tx) => tx.setMeta('tempo', ed.meta.tempo.map((t, i) => (i ? t : { ...t, bpm }))), { origin: 'load' });
    }
    if (changed.has('scale') && this.scale !== undefined) {
      const key = parseKey(this.scale);
      ed.transact('Key', (tx) => tx.setMeta('key', key), { origin: 'load' });
    }
    if (changed.has('timeSignature') && this.timeSignature) {
      const [n, d] = this.timeSignature.split('/').map(Number);
      if (n && d) {
        ed.transact('Time signature', (tx) => tx.setMeta('timeSignature', ed.meta.timeSignature.map((s, i) => (i ? s : { ...s, numerator: n, denominator: d }))), {
          origin: 'load',
        });
      }
    }
  }

  protected render() {
    return html`<slot></slot>`;
  }

  protected shortcutKeymap(): Keymap {
    return this.keymap;
  }

  // ── Internals ─────────────────────────────────────────────────────

  private wireEvents() {
    const ed = this.editor;
    const fire = (type: string, detail: unknown, cancelable = false) =>
      this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true, cancelable }));

    ed.on('beforechange', (e) => {
      const ok = fire('maddie-beforechange', { patches: e.patches, origin: e.origin, label: e.label }, true);
      if (!ok || (this.controlled && e.origin !== 'load' && e.origin !== 'remote')) e.preventDefault();
    });
    ed.on('change', (e) => {
      const detail = { patches: e.patches, origin: e.origin, label: e.label } as MaddieChangeDetail;
      Object.defineProperty(detail, 'doc', { get: () => ed.doc, enumerable: true });
      fire('maddie-change', detail);
    });
    ed.on('selection', (e) => {
      this.clearVelocityEntry();
      fire('maddie-selectionchange', { ids: [...e.ids] });
    });
    ed.on('view', (e) => fire('maddie-viewchange', { view: e.view }));
    ed.on('transport', (e) => fire('maddie-transportchange', e));
    ed.on('noteon', (e) => fire('maddie-noteon', e));
    ed.on('tracks', (e) => {
      if (this.velocityEntry?.trackId !== ed.activeTrackId) this.clearVelocityEntry();
      fire('maddie-trackchange', e);
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this.onWindowKeyDown);
    window.removeEventListener('keyup', this.onWindowKeyUp);
    window.removeEventListener('keyup', this.onShortcutKeyUp, true);
    window.removeEventListener('blur', this.onWindowBlur);
    window.removeEventListener('focusin', this.clearShortcutState, true);
    this.clearShortcutState();
  }

  private onWindowBlur = () => {
    this.clearShortcutState();
    releaseAll(this.editor);
  };

  private clearShortcutState = () => {
    this.clearVelocityEntry();
    this.heldShortcuts.clear();
  };

  private clearVelocityEntry = () => {
    window.clearTimeout(this.velocityEntry?.timer);
    this.velocityEntry = undefined;
  };

  private commitVelocityEntry = () => {
    const entry = this.velocityEntry;
    this.clearVelocityEntry();
    const ed = this.editor;
    if (!entry || entry.trackId !== ed.activeTrackId || entry.selection !== ed.selection) return;
    const values = /^(\d{1,3})(?:-(\d{1,3}))?$/.exec(entry.text);
    if (!values) {
      this.engine.toast('Enter a velocity like 80 or a range like 50–70', 'warning');
      return;
    }
    const first = Number(values[1]);
    const last = Number(values[2] ?? values[1]);
    const lo = Math.min(first, last);
    const hi = Math.max(first, last);
    if (lo < 1 || hi > 127) {
      this.engine.toast('Velocity must be between 1 and 127', 'warning');
      return;
    }
    const from = fromMidiVelocity(lo);
    const to = fromMidiVelocity(hi);
    try {
      if (ed.chordRegions) ed.chordTrack.commitChanged(pitchRangeChords(ed.selectedChordRegions, from, to), 'Change chord velocity');
      else ed.commands.setVelocityRange(undefined, from, to);
      this.engine.toast(lo === hi ? `Velocity ${lo}` : `Velocity ${lo}–${hi}`);
    } catch (error) {
      this.engine.toast((error as Error).message, 'error');
    }
  };

  private handleTrackTab(event: KeyboardEvent, target?: HTMLElement) {
    if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey ||
      target?.closest('button, a[href], [role="button"], [role="tab"]')) return false;
    const ed = this.editor;
    const ids = ed.trackIds;
    if (ids.length < 2) return false;
    this.clearShortcutState();
    if (!event.repeat) {
      const offset = event.shiftKey ? -1 : 1;
      const next = (ids.indexOf(ed.activeTrackId) + offset + ids.length) % ids.length;
      ed.setActiveTrack(ids[next]);
    }
    return true;
  }

  private handleVelocityEntry(event: KeyboardEvent) {
    const ed = this.editor;
    const pending = this.velocityEntry;
    const key = event.key;
    const digit = /^\d$/.test(key);
    const isEditing = pending && ['-', 'Backspace', 'Enter', 'Escape'].includes(key);
    if (!ed.selection.size || event.ctrlKey || event.metaKey || event.altKey ||
      (!digit && !isEditing) || (key === '0' && !pending)) {
      this.clearVelocityEntry();
      return false;
    }
    if (event.repeat) return true;
    if (key === 'Enter') this.commitVelocityEntry();
    else if (key === 'Escape') {
      this.clearVelocityEntry();
      this.engine.toast('Velocity entry cancelled');
    } else {
      const entry = pending ?? { text: '', trackId: ed.activeTrackId, selection: ed.selection };
      window.clearTimeout(entry.timer);
      if (key === 'Backspace') entry.text = entry.text.slice(0, -1);
      else if ((key !== '-' || !entry.text.includes('-')) && entry.text.length < 7) entry.text += key;
      if (entry.text) {
        entry.timer = entry.text.endsWith('-') ? undefined : window.setTimeout(this.commitVelocityEntry, VELOCITY_ENTRY_DELAY);
        this.velocityEntry = entry;
        this.engine.toast(`Velocity ${entry.text.replace('-', '–')} · Enter to apply`);
      } else this.clearVelocityEntry();
    }
    return true;
  }

  private onShortcutKeyUp = (e: KeyboardEvent) => this.heldShortcuts.keyUp(e);

  private onWindowKeyUp = (e: KeyboardEvent) => {
    // Always release, wherever focus went.
    computerKeyUp(this.editor, e);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (computerKeyUp(this.editor, e)) e.stopPropagation();
  };

  private onWindowKeyDown = (e: KeyboardEvent) => {
    if (!this.globalShortcuts || e.defaultPrevented) return;
    if (e.target === document.body || e.target === document.documentElement) this.onKeyDown(e);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const path = e.composedPath();
    const target = path[0] as HTMLElement | undefined;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable || e.isComposing) return;
    const isOctaveKey = !e.metaKey && !e.ctrlKey && !e.altKey && (e.code === 'Equal' || e.code === 'Minus');
    // Zest fields (selects, sliders, switches, number inputs) and open popovers keep their own keys.
    if (!isOctaveKey && !e.metaKey && !e.ctrlKey && path.some((el) => el instanceof HTMLElement && OWN_KEYS.has(el.localName))) return;
    const handledEditorKey = this.handleTrackTab(e, target) || this.handleVelocityEntry(e);
    // Keep native activation for focused buttons.
    const isButtonActivation = !handledEditorKey && tag === 'BUTTON' && (e.key === 'Enter' || e.key === ' ');
    if (isButtonActivation) return;
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      pickMidiFile(this.editor, this);
      return;
    }
    if (handledEditorKey || this.heldShortcuts.keyDown(e, () => computerKeyDown(this.editor, e))) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  /** Pull motion durations from tokens (honours prefers-reduced-motion). */
  private readMotion() {
    const cs = getComputedStyle(this);
    // Zest durations are in seconds (`0.12s`), Maddie's overrides in either unit.
    const ms = (name: string, fallback: number) => {
      const raw = cs.getPropertyValue(name).trim();
      const v = parseFloat(raw);
      if (!Number.isFinite(v)) return fallback;
      return /[\d.]s$/.test(raw) ? v * 1000 : v;
    };
    const fast = ms('--_motion-fast', 90);
    this.engine.setMotion({
      fast,
      medium: ms('--_motion-medium', 150),
      slow: ms('--_motion-slow', 220),
      glide: fast ? 45 : 0,
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'maddie-root': MaddieRoot;
  }
}
