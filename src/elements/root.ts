import { css, html, LitElement, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { createEditor, parseKey, type Editor, type MaddieDoc, type Note, type NoteInput, type Output, type Patch, type Tool, type FoldMode, type NoteColorMode } from '../core';
import { Engine } from '../engine/engine';
import { defaultKeymap, handleKey, type Keymap } from '../engine/keymap';
import { ContextRequestEvent, editorContext, ROOT_READY } from './context';
import { pickMidiFile } from './midi-io';
import { tokens } from './tokens';

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
 * @fires maddie-noteon - A note was scheduled during playback. `detail: { note, time }`
 */
@customElement('maddie-root')
export class MaddieRoot extends LitElement {
  static styles = [
    tokens,
    css`
      :host {
        display: block;
        color-scheme: light dark;
        color: var(--_text);
      }
      :host([theme='light']) {
        color-scheme: light;
      }
      :host([theme='dark']) {
        color-scheme: dark;
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
  @property() tool?: Tool;
  @property({ type: Number }) tempo?: number;
  @property({ attribute: 'time-signature' }) timeSignature?: string;
  @property({ attribute: 'scale-lock', converter: bool }) scaleLock?: boolean;
  /** `pitch` (default), `pitch-class`, or `mono`. */
  @property({ attribute: 'note-color' }) noteColor?: NoteColorMode;
  @property({ reflect: true }) theme?: 'light' | 'dark' | 'auto';
  /** Edits fire `maddie-beforechange` and are not applied. Apply them yourself. */
  @property({ type: Boolean }) controlled = false;
  /** Keyboard shortcuts. Merge with `defaultKeymap` to extend. */
  @property({ attribute: false }) keymap: Keymap = defaultKeymap;

  private engine = Engine.for(this.editor);

  constructor() {
    super();
    this.addEventListener('context-request', (e: Event) => {
      const req = e as ContextRequestEvent;
      if (req.context !== editorContext) return;
      e.stopPropagation();
      req.callback(this.editor);
    });
    this.addEventListener('keydown', this.onKeyDown);
    this.wireEvents();
  }

  // ── Data ──────────────────────────────────────────────────────────

  get doc(): MaddieDoc {
    return this.editor.doc;
  }
  set doc(doc: Partial<MaddieDoc>) {
    this.editor.setDoc(doc);
  }

  /** Notes of the active track. Setting replaces them (history is cleared). */
  get notes(): readonly Note[] {
    return this.editor.notes();
  }
  set notes(notes: NoteInput[]) {
    const doc = this.editor.doc;
    let i = 0;
    const withIds = notes.map((n) => ({ ...n, id: n.id ?? `n${i++}-${Math.random().toString(36).slice(2, 7)}` }));
    this.editor.setDoc({ ...doc, tracks: doc.tracks.map((t) => (t.id === this.editor.activeTrackId ? { ...t, notes: withIds } : t)) });
  }

  get output(): Output | null {
    return this.editor.output;
  }
  set output(out: Output | null) {
    this.editor.output = out;
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
    document.dispatchEvent(new Event(ROOT_READY));
    this.readMotion();
  }

  protected willUpdate(changed: PropertyValues) {
    const ed = this.editor;
    const view: Parameters<Editor['setView']>[0] = {};
    if (changed.has('grid') && this.grid) view.grid = this.grid;
    if (changed.has('snap') && this.snap !== undefined) view.snap = this.snap;
    if (changed.has('fold') && this.fold) view.fold = this.fold;
    if (changed.has('tool') && this.tool) view.tool = this.tool;
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
    ed.on('selection', (e) => fire('maddie-selectionchange', { ids: [...e.ids] }));
    ed.on('view', (e) => fire('maddie-viewchange', { view: e.view }));
    ed.on('transport', (e) => fire('maddie-transportchange', e));
    ed.on('noteon', (e) => fire('maddie-noteon', e));
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const target = e.composedPath()[0] as HTMLElement | undefined;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
    // Let buttons keep Enter; Space is play/pause everywhere.
    if (tag === 'BUTTON' && e.key === 'Enter') return;
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      pickMidiFile(this.editor, this);
      return;
    }
    if (handleKey(this.editor, e, this.keymap)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  /** Pull motion durations from tokens (honours prefers-reduced-motion). */
  private readMotion() {
    const cs = getComputedStyle(this);
    const ms = (name: string, fallback: number) => {
      const v = parseFloat(cs.getPropertyValue(name));
      return Number.isFinite(v) ? v : fallback;
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
