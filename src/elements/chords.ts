import { css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
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
import { tokens } from './tokens';

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
    css`
      :host {
        display: flex;
        flex-direction: column;
        width: var(--maddie-chords-width, 280px);
        min-height: 0;
        background: var(--_surface);
        border-left: 1px solid var(--_border);
        color: var(--_text);
        font-size: 12.5px;
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
        gap: 8px;
        padding: 10px 10px 8px 12px;
      }
      h2 {
        margin: 0;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: -0.01em;
      }
      .key {
        padding: 2px 7px;
        border-radius: 999px;
        background: var(--_surface-2);
        color: var(--_text-muted);
        font-size: 11.5px;
        font-weight: 500;
        white-space: nowrap;
      }
      .spacer {
        flex: 1;
      }
      button {
        font: inherit;
        color: inherit;
        border: 0;
        margin: 0;
        background: transparent;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      button:focus-visible,
      input:focus-visible {
        outline: 2px solid var(--_focus);
        outline-offset: 1px;
      }
      .close {
        display: inline-grid;
        place-items: center;
        width: 26px;
        height: 26px;
        border-radius: var(--_radius-sm);
        color: var(--_text-muted);
      }
      .close:hover {
        background: var(--_hover);
        color: var(--_text);
      }
      .controls {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 0 10px 10px 12px;
        border-bottom: 1px solid var(--_border);
      }
      input[type='search'] {
        height: 28px;
        padding: 0 9px;
        border: 0;
        border-radius: var(--_radius-sm);
        background: var(--_surface-2);
        color: var(--_text);
        font: inherit;
        outline: none;
      }
      input::placeholder {
        color: var(--_text-faint);
      }
      .segmented {
        display: flex;
        padding: 2px;
        gap: 2px;
        border-radius: calc(var(--_radius-sm) + 2px);
        background: var(--_surface-2);
      }
      .segmented button {
        flex: 1;
        height: 24px;
        border-radius: calc(var(--_radius-sm) - 1px);
        color: var(--_text-muted);
        font-size: 11.5px;
        font-weight: 500;
      }
      .segmented button[aria-pressed='true'] {
        background: var(--_raised);
        color: var(--_text);
        box-shadow: 0 0 0 1px var(--_border);
      }
      .families {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .families button {
        height: 22px;
        padding: 0 8px;
        border-radius: 999px;
        color: var(--_text-muted);
        font-size: 11px;
        font-weight: 500;
        box-shadow: inset 0 0 0 1px var(--_border);
      }
      .families button:hover {
        color: var(--_text);
        background: var(--_hover);
      }
      .families button[aria-pressed='true'] {
        background: var(--_accent);
        color: var(--_accent-text);
        box-shadow: none;
      }
      .list {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 4px 0 12px;
        overscroll-behavior: contain;
      }
      .hint {
        margin: 10px 12px 2px;
        color: var(--_text-muted);
        font-size: 11.5px;
        line-height: 1.4;
      }
      .root {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 8px 12px 6px;
        text-align: left;
      }
      .root:hover .root-name {
        color: var(--_text);
      }
      .root .chev {
        display: inline-flex;
        color: var(--_text-faint);
        transition: transform var(--_motion-fast) var(--_ease);
      }
      .root[aria-expanded='false'] .chev {
        transform: rotate(-90deg);
      }
      .degree {
        min-width: 2.4em;
        color: var(--_text);
        font: 600 11.5px var(--_font-mono);
      }
      .root-name {
        color: var(--_text-muted);
        font-weight: 600;
      }
      .count {
        margin-left: auto;
        color: var(--_text-faint);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        padding: 0 12px 6px;
      }
      .chip {
        height: 26px;
        padding: 0 8px;
        border-radius: 7px;
        background: var(--_surface-2);
        color: var(--_text);
        font-size: 12px;
        font-weight: 500;
        white-space: nowrap;
        cursor: grab;
        touch-action: none;
        transition:
          background-color var(--_motion-fast) var(--_ease),
          transform var(--_motion-fast) var(--_ease);
      }
      .chip:hover {
        background: var(--_hover);
        box-shadow: inset 0 0 0 1px var(--_border);
      }
      .chip:active {
        transform: scale(0.96);
      }
      .chip.dragging {
        cursor: grabbing;
        background: var(--_accent);
        color: var(--_accent-text);
      }
      .empty {
        margin: 16px 12px;
        color: var(--_text-faint);
        font-size: 12px;
      }
      .ghost {
        position: fixed;
        z-index: 1000;
        top: 0;
        left: 0;
        display: none;
        padding: 4px 9px;
        border-radius: 999px;
        background: var(--_text);
        color: var(--_bg);
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
        pointer-events: none;
        box-shadow: 0 6px 20px -6px rgb(0 0 0 / 0.35);
      }
      .ghost.show {
        display: block;
      }
      .ghost small {
        margin-left: 6px;
        font-weight: 500;
        opacity: 0.7;
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
        <h2>Chords</h2>
        <span class="key">${key ? formatKey(key) : 'No key'}</span>
        <span class="spacer"></span>
        <button class="close" aria-label="Close chords" title="Close   H" @click=${() => ed.setView({ chordsPanel: false })}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </header>
      <div class="controls">
        <input
          type="search"
          placeholder="Search: m7, sus4, add9, 13…"
          aria-label="Search chords"
          .value=${this.query}
          @input=${(e: Event) => (this.query = (e.target as HTMLInputElement).value)}
        />
        <div class="segmented" role="radiogroup" aria-label="Inversion">
          ${INVERSIONS.map(
            (label, i) =>
              html`<button role="radio" aria-checked=${this.inversion === i} aria-pressed=${this.inversion === i} @click=${() => (this.inversion = i)}>
                ${label}
              </button>`,
          )}
        </div>
        <div class="families" role="radiogroup" aria-label="Chord type">
          ${[{ id: 'all' as const, label: 'All' }, ...CHORD_FAMILIES].map(
            (f) =>
              html`<button role="radio" aria-checked=${this.family === f.id} aria-pressed=${this.family === f.id} @click=${() => (this.family = f.id)}>
                ${f.label}
              </button>`,
          )}
        </div>
      </div>
      <div class="list" part="list">
        ${key ? nothing : html`<p class="hint">No key set, so every chord shows. Pick a key to see only chords that fit it.</p>`}
        ${groups.length
          ? groups.map((g) => {
              const open = this.isOpen(g.root);
              return html`
                <button class="root" aria-expanded=${open} @click=${() => this.toggleRoot(g.root)}>
                  <span class="chev">${icons.chevron}</span>
                  ${g.degree ? html`<span class="degree">${g.degree}</span>` : nothing}
                  <span class="root-name">${pitchClassName(g.root)}</span>
                  <span class="count">${g.chords.length}</span>
                </button>
                ${open
                  ? html`<div class="chips">
                      ${g.chords.map(
                        (c) =>
                          html`<button
                            class="chip"
                            title=${`${pitchClassName(c.root)} ${c.type.name}${c.degree ? ` (${c.degree})` : ''}\n${c.type.intervals.map((i) => pitchClassName(c.root + i)).join(' · ')}\nDrag onto the grid · click to hear`}
                            @pointerdown=${(e: PointerEvent) => this.onChipDown(e, c)}
                          >
                            ${c.name}
                          </button>`,
                      )}
                    </div>`
                  : nothing}
              `;
            })
          : html`<p class="empty">No chords match.</p>`}
      </div>
      <div class="ghost" aria-hidden="true"></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'maddie-chords': MaddieChords;
  }
}
