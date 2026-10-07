import { css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import {
  CHORD_FAMILIES,
  chordsInKey,
  formatKey,
  invert,
  pitchClassName,
  voiceChord,
  type Chord,
  type ChordFamily,
  type Editor,
} from '../core';
import type { ChordDrag, Engine } from '../engine/engine';
import { MaddieElement } from './base';
import { icons } from './icons';
import { partStyles } from './controls';
import { tokens } from './tokens';
import './zest';
import '@tasteee/zest/z-collapsible';

const INVERSIONS = ['Root', '1st', '2nd', '3rd'];
const DRAG_THRESHOLD = 4;
/** Where a clicked chord is auditioned: bass near G3. */
const AUDITION_NEAR = 55;

/**
 * Chords that fit the key. Drag one onto the piano roll to place it.
 * Shown while `view.chordsPanel` is on (toggle with H or the toolbar).
 */
@customElement('maddie-chords')
export class MaddieChords extends MaddieElement {
  static styles = [
    tokens,
    partStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        width: var(--maddie-chords-width, 280px);
        min-height: 0;
        background-color: var(--_surface);
        background-image: var(--material-surface);
        border-left: 1px solid var(--_border);
        color: var(--_text);
        font-size: var(--font-size-small);
        user-select: none;
        -webkit-user-select: none;
        opacity: 1;
        transform: none;
        transition:
          opacity var(--_motion-medium) var(--_ease),
          transform var(--_motion-medium) var(--_ease);
      }
      @starting-style {
        :host([open]) {
          opacity: 0;
          transform: translateX(8px);
        }
      }
      :host(:not([open])) {
        display: none;
      }
      header {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        padding: var(--space-sm) var(--space-sm) var(--space-sm) var(--space-md);
      }
      .spacer {
        flex: 1;
      }
      .controls {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        padding: 0 var(--space-md) var(--space-md);
        border-bottom: 1px solid var(--_border);
      }
      .families {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-xs);
      }
      .list {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: var(--space-xs) 0 var(--space-md);
        overscroll-behavior: contain;
      }
      .hint {
        margin: var(--space-md) var(--space-md) var(--space-xs);
      }
      z-collapsible {
        display: block;
        padding-inline: var(--space-md);
      }
      .root {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        width: 100%;
      }
      .degree {
        min-width: 2.4em;
        color: var(--_text);
        font: 600 var(--font-size-caption) var(--_font-mono);
      }
      .root-name {
        color: var(--_text-muted);
        font-weight: 600;
      }
      .count {
        margin-left: auto;
        color: var(--_text-faint);
        font-size: var(--font-size-caption);
        font-variant-numeric: tabular-nums;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-xs);
        padding-block: var(--space-xs) var(--space-sm);
      }
      .chip {
        cursor: grab;
        touch-action: none;
        border-radius: 999px;
        transition: transform var(--_motion-fast) var(--_ease);
      }
      .chip:focus-visible {
        outline: 3px solid var(--_focus);
        outline-offset: 2px;
      }
      .chip:active {
        transform: scale(0.96);
      }
      .chip.dragging {
        cursor: grabbing;
      }
      .empty {
        margin: var(--space-lg) var(--space-md);
      }
      .ghost {
        position: fixed;
        z-index: 1000;
        top: 0;
        left: 0;
        display: none;
        padding: var(--space-xs) var(--space-sm);
        border: 1px solid var(--_border);
        border-radius: 999px;
        background: var(--_raised);
        color: var(--_text);
        box-shadow: var(--elevation-overlay);
        font-size: var(--font-size-small);
        font-weight: 600;
        white-space: nowrap;
        pointer-events: none;
      }
      .ghost.show {
        display: block;
      }
      .ghost small {
        margin-left: var(--space-sm);
        color: var(--_text-muted);
        font-weight: 500;
      }
    `,
  ];

  @state() private family: ChordFamily | 'all' = 'all';
  @state() private inversion = 0;
  @state() private query = '';
  /** Roots whose section differs from the default (open with a key, closed without). */
  @state() private toggled = new Set<number>();
  private keyId = '';

  protected attach(editor: Editor, _engine: Engine) {
    const update = () => {
      this.toggleAttribute('open', editor.view.chordsPanel);
      const key = editor.key;
      const id = key ? `${key.root}:${key.scale}` : '';
      if (id !== this.keyId) {
        this.keyId = id;
        this.toggled = new Set();
      }
      this.requestUpdate();
    };
    update();
    this.track(editor.on('view', update), editor.on('change', update));
  }

  // ── Drag ──────────────────────────────────────────────────────────

  private onChipDown(e: PointerEvent, chord: Chord) {
    const ed = this.ed;
    const engine = this.engine;
    if (!ed || !engine || e.button !== 0) return;
    e.preventDefault();
    const chip = e.currentTarget as HTMLElement;
    chip.setPointerCapture(e.pointerId);
    const intervals = invert(chord.type.intervals, this.inversion);
    const label = this.inversion ? `${chord.name}/${pitchClassName(chord.root + intervals[0])}` : chord.name;
    const drag: ChordDrag = { root: chord.root, intervals, name: label, clientX: e.clientX, clientY: e.clientY, overGrid: false };
    const ghost = this.renderRoot.querySelector<HTMLElement>('.ghost')!;
    let dragging = false;
    ed.auditionChord(voiceChord(chord.root, intervals, AUDITION_NEAR), 0.5, undefined, { humanize: true });

    const move = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < DRAG_THRESHOLD) return;
      if (!dragging) {
        dragging = true;
        chip.classList.add('dragging');
        chip.setAttribute('kind', 'solid');
        chip.setAttribute('accent', 'dom');
        ghost.innerHTML = '';
        ghost.append(label);
        const notes = document.createElement('small');
        notes.textContent = intervals.map((i) => pitchClassName(chord.root + i)).join(' ');
        ghost.append(notes);
        ghost.classList.add('show');
      }
      drag.clientX = ev.clientX;
      drag.clientY = ev.clientY;
      engine.chordDragEvent(drag, 'move');
      ghost.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 14}px)`;
      ghost.style.opacity = drag.overGrid ? '0.75' : '1';
    };
    const end = (ev: PointerEvent | null, phase: 'drop' | 'cancel') => {
      chip.removeEventListener('pointermove', move);
      chip.removeEventListener('pointerup', up);
      chip.removeEventListener('pointercancel', cancelled);
      window.removeEventListener('keydown', esc, true);
      if (ev && chip.hasPointerCapture(ev.pointerId)) chip.releasePointerCapture(ev.pointerId);
      chip.classList.remove('dragging');
      chip.setAttribute('kind', 'soft');
      chip.removeAttribute('accent');
      ghost.classList.remove('show');
      if (!dragging) return;
      if (ev) {
        drag.clientX = ev.clientX;
        drag.clientY = ev.clientY;
      }
      engine.chordDragEvent(drag, phase);
    };
    const up = (ev: PointerEvent) => end(ev, 'drop');
    const cancelled = (ev: PointerEvent) => end(ev, 'cancel');
    const esc = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      ev.preventDefault();
      end(null, 'cancel');
    };
    chip.addEventListener('pointermove', move);
    chip.addEventListener('pointerup', up);
    chip.addEventListener('pointercancel', cancelled);
    window.addEventListener('keydown', esc, true);
  }

  /** Enter or Space on a focused chord plays it (dragging is for the pointer). */
  private onChipKey(e: KeyboardEvent, chord: Chord) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const intervals = invert(chord.type.intervals, this.inversion);
    this.ed?.auditionChord(voiceChord(chord.root, intervals, AUDITION_NEAR), 0.5, undefined, { humanize: true });
  }

  // ── Render ────────────────────────────────────────────────────────

  private isOpen(root: number) {
    const byDefault = !!this.ed?.key;
    return this.toggled.has(root) ? !byDefault : byDefault;
  }

  private toggleRoot(root: number) {
    const next = new Set(this.toggled);
    if (next.has(root)) next.delete(root);
    else next.add(root);
    this.toggled = next;
  }

  render() {
    const ed = this.ed;
    if (!ed || !ed.view.chordsPanel) return nothing;
    const key = ed.key;
    const q = this.query.trim().toLowerCase().replace(/#/g, '♯').replace(/(?<=[a-g])b|b(?=\d)/g, '♭');
    const groups = chordsInKey(key)
      .map((g) => ({
        ...g,
        chords: g.chords.filter(
          (c) =>
            (this.family === 'all' || c.type.family === this.family) &&
            (!q || c.name.toLowerCase().includes(q) || c.type.name.toLowerCase().includes(q)),
        ),
      }))
      .filter((g) => g.chords.length);

    return html`
      <header>
        <z-text tag="h2" size="sm" weight="600">Chords</z-text>
        <z-badge size="sm">${key ? formatKey(key) : 'No key'}</z-badge>
        <span class="spacer"></span>
        <z-tooltip content="Close   H" placement="bottom"
          ><z-button class="icon" kind="ghost" size="sm" aria-label="Close chords" @click=${() => ed.setView({ chordsPanel: false })}>${icons.close}</z-button></z-tooltip
        >
      </header>
      <div class="controls">
        <z-input
          size="sm"
          type="search"
          label="Search chords"
          placeholder="Search: m7, sus4, add9, 13…"
          .value=${live(this.query)}
          @input=${(e: CustomEvent<{ value: string }>) => (this.query = e.detail.value)}
        ></z-input>
        <z-toggle-button-group
          size="sm"
          kind="outline"
          accent="dom"
          aria-label="Inversion"
          @change=${(e: CustomEvent<{ value?: string }>) => {
            if (e.detail.value !== undefined) this.inversion = Number(e.detail.value);
            else this.requestUpdate(); // The inversion is always one of the four.
          }}
        >
          ${INVERSIONS.map((label, i) => html`<z-toggle-button-group-item value=${i} .isPressed=${live(this.inversion === i)}>${label}</z-toggle-button-group-item>`)}
        </z-toggle-button-group>
        <div class="families" role="group" aria-label="Chord type">
          ${[{ id: 'all' as const, label: 'All' }, ...CHORD_FAMILIES].map(
            (f) =>
              html`<z-badge
                selectable
                size="sm"
                kind=${this.family === f.id ? 'solid' : 'soft'}
                accent=${this.family === f.id ? 'dom' : 'neutral'}
                ?is-selected=${this.family === f.id}
                @select=${() => (this.family = f.id)}
                >${f.label}</z-badge
              >`,
          )}
        </div>
      </div>
      <div class="list" part="list">
        ${key ? nothing : html`<z-text class="hint" size="xs" color="muted">No key set, so every chord shows. Pick a key to see only chords that fit it.</z-text>`}
        ${groups.length
          ? groups.map((g) => {
              const open = this.isOpen(g.root);
              return html`<z-collapsible
                .isOpen=${live(open)}
                @toggle=${(e: CustomEvent<{ open: boolean }>) => e.detail.open !== this.isOpen(g.root) && this.toggleRoot(g.root)}
              >
                <span slot="trigger" class="root">
                  ${g.degree ? html`<span class="degree">${g.degree}</span>` : nothing}
                  <span class="root-name">${pitchClassName(g.root)}</span>
                  <span class="count">${g.chords.length}</span>
                </span>
                <div class="chips">
                  ${g.chords.map(
                    (c) =>
                      html`<z-badge
                        class="chip"
                        kind="soft"
                        tabindex="0"
                        role="button"
                        title=${`${pitchClassName(c.root)} ${c.type.name}${c.degree ? ` (${c.degree})` : ''}\n${c.type.intervals.map((i) => pitchClassName(c.root + i)).join(' · ')}\nDrag onto the grid · click to hear`}
                        @pointerdown=${(e: PointerEvent) => this.onChipDown(e, c)}
                        @keydown=${(e: KeyboardEvent) => this.onChipKey(e, c)}
                        >${c.name}</z-badge
                      >`,
                  )}
                </div>
              </z-collapsible>`;
            })
          : html`<z-text class="empty" size="sm" color="muted">No chords match.</z-text>`}
      </div>
      <div class="ghost" aria-hidden="true"></div>
    `;
  }
}

/**
 * A manila-folder tab on the right edge of the editor. Click it to slide the chords panel out.
 * Sits inside a positioned parent (the editor grid). It rides the panel's left edge while open.
 */
@customElement('maddie-chords-tab')
export class MaddieChordsTab extends MaddieElement {
  static styles = [
    tokens,
    css`
      :host {
        position: absolute;
        top: 50%;
        right: 0;
        z-index: 3;
        transform: translateY(-50%);
        transition: right var(--_motion-medium) var(--_ease);
      }
      :host([open]) {
        right: var(--maddie-chords-width, 280px);
      }
      button {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-xs);
        margin: 0;
        padding: var(--space-md) var(--space-xs);
        font: inherit;
        font-size: var(--font-size-caption);
        font-weight: 600;
        letter-spacing: 0.04em;
        color: var(--_text-muted);
        background-color: var(--_surface);
        background-image: var(--material-surface);
        border: 1px solid var(--_border);
        border-right: none;
        border-radius: var(--_radius) 0 0 var(--_radius);
        box-shadow: -2px 0 6px rgb(0 0 0 / 0.12);
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
        /* Tucked in so only part of the tab peeks over the edge. */
        translate: 4px 0;
        transition:
          translate var(--_motion-fast) var(--_ease),
          color var(--_motion-fast) var(--_ease);
      }
      button:hover,
      button:focus-visible {
        translate: 0 0;
        color: var(--_text);
      }
      button:focus-visible {
        outline: 2px solid var(--_accent);
        outline-offset: -2px;
      }
      :host([open]) button {
        translate: 1px 0;
        color: var(--_accent);
        /* Covers the panel's left border so the tab and panel read as one piece. */
        border-right: none;
      }
      .label {
        writing-mode: vertical-rl;
        transform: rotate(180deg);
      }
      svg {
        width: 16px;
        height: 16px;
        transform: rotate(90deg);
      }
    `,
  ];

  protected attach(editor: Editor, _engine: Engine) {
    const update = () => {
      this.toggleAttribute('open', editor.view.chordsPanel);
      this.requestUpdate();
    };
    update();
    this.track(editor.on('view', update));
  }

  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const open = ed.view.chordsPanel;
    return html`<button
      type="button"
      aria-label="Chords"
      aria-expanded=${open ? 'true' : 'false'}
      title="Chords that fit the key   H"
      @click=${() => ed.setView({ chordsPanel: !open })}
    >
      ${icons.chords}<span class="label">Chords</span>
    </button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'maddie-chords': MaddieChords;
    'maddie-chords-tab': MaddieChordsTab;
  }
}
