import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  downloadMidi,
  formatBBT,
  toMidiFile,
  GRID_OPTIONS,
  pitchClassName,
  SCALE_IDS,
  SCALES,
  type Editor,
  type FoldMode,
  type ScaleId,
  type Tool,
  ZOOM_LIMITS,
} from '../core';
import type { Engine } from '../engine/engine';
import { modKeyLabel, rowZoomBy } from '../engine/keymap';
import { MaddieElement } from './base';
import { icons } from './icons';
import { tokens } from './tokens';

/** Shared look for every toolbar control. */
export const controlStyles = css`
  :host {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    color: var(--_text);
    font-size: 12.5px;
    font-weight: 500;
    letter-spacing: -0.005em;
  }
  button,
  .select {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 30px;
    min-width: 30px;
    padding: 0 7px;
    margin: 0;
    border: 0;
    border-radius: var(--_radius-sm);
    background: transparent;
    color: var(--_text-muted);
    font: inherit;
    cursor: pointer;
    transition:
      background-color var(--_motion-fast) var(--_ease),
      color var(--_motion-fast) var(--_ease),
      transform var(--_motion-fast) var(--_ease);
    -webkit-tap-highlight-color: transparent;
  }
  button:hover,
  .select:hover {
    background: var(--_hover);
    color: var(--_text);
  }
  button:active {
    transform: scale(0.96);
  }
  button[aria-pressed='true'] {
    color: var(--_accent);
    background: color-mix(in oklab, var(--_accent) 12%, transparent);
  }
  button:disabled {
    opacity: 0.35;
    cursor: default;
    background: transparent;
    transform: none;
  }
  button:focus-visible,
  .select:focus-within {
    outline: 2px solid var(--_focus);
    outline-offset: 1px;
  }
  .select {
    color: var(--_text);
    padding: 0 6px 0 8px;
  }
  .select .icon {
    color: var(--_text-muted);
  }
  .select .chev {
    color: var(--_text-faint);
    margin-left: -2px;
  }
  .select select {
    position: absolute;
    inset: 0;
    width: 100%;
    opacity: 0;
    cursor: pointer;
    font: inherit;
    appearance: none;
  }
  .select select:focus {
    outline: none;
  }
  .sep {
    width: 1px;
    height: 16px;
    margin: 0 3px;
    background: var(--_border);
  }
  button.export {
    padding: 0 10px 0 8px;
    color: var(--_text);
  }
  .value {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .segmented {
    display: inline-flex;
    padding: 2px;
    gap: 2px;
    border-radius: calc(var(--_radius-sm) + 2px);
    background: var(--_surface-2);
  }
  .segmented button {
    height: 26px;
    min-width: 28px;
    border-radius: calc(var(--_radius-sm) - 1px);
  }
  .segmented button[aria-pressed='true'] {
    background: var(--_raised);
    color: var(--_text);
    box-shadow: 0 0 0 1px var(--_border);
  }
  /* Tooltips: label + shortcut, after a short delay. */
  [data-tip]::after {
    content: attr(data-tip);
    position: absolute;
    top: calc(100% + 8px);
    left: 50%;
    z-index: 10;
    padding: 5px 8px;
    border-radius: 6px;
    background: var(--_text);
    color: var(--_bg);
    font-size: 11.5px;
    font-weight: 500;
    white-space: pre;
    pointer-events: none;
    opacity: 0;
    transform: translate(-50%, -3px);
    transition:
      opacity var(--_motion-fast) var(--_ease),
      transform var(--_motion-fast) var(--_ease);
  }
  [data-tip]:hover::after {
    opacity: 1;
    transform: translate(-50%, 0);
    transition-delay: 450ms;
  }
  [data-tip]:active::after {
    opacity: 0;
    transition-delay: 0ms;
  }
`;

/** Base for controls: re-render when the editor changes. */
class ControlElement extends MaddieElement {
  static styles = [tokens, controlStyles];
  protected attach(editor: Editor, _engine: Engine) {
    const update = () => this.requestUpdate();
    this.track(editor.on('view', update), editor.on('change', update), editor.on('history', update), editor.on('transport', update));
  }
}

const tip = (label: string, shortcut?: string) => (shortcut ? `${label}   ${shortcut}` : label);

// ── Tool ────────────────────────────────────────────────────────────

const TOOLS: Array<{ tool: Tool; label: string; key: string }> = [
  { tool: 'select', label: 'Select', key: 'V' },
  { tool: 'draw', label: 'Draw', key: 'B' },
  { tool: 'erase', label: 'Erase', key: 'E' },
  { tool: 'velocity', label: 'Velocity', key: 'G' },
];

@customElement('maddie-tool-select')
export class MaddieToolSelect extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    return html`<div class="segmented" role="radiogroup" aria-label="Tool">
      ${TOOLS.map(
        (t) => html`<button
          role="radio"
          aria-checked=${ed.view.tool === t.tool}
          aria-pressed=${ed.view.tool === t.tool}
          aria-label=${t.label}
          data-tip=${tip(t.label, t.key)}
          @click=${() => ed.setView({ tool: t.tool })}
        >
          ${icons[t.tool]}
        </button>`,
      )}
    </div>`;
  }
}

// ── Grid + snap ─────────────────────────────────────────────────────

@customElement('maddie-grid-select')
export class MaddieGridSelect extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const current = GRID_OPTIONS.find((o) => o.value === ed.view.grid)?.label ?? ed.view.grid;
    return html`<label class="select" data-tip="Grid">
      ${icons.grid}<span class="value">${current}</span><span class="chev">${icons.chevron}</span>
      <select aria-label="Grid" @change=${(e: Event) => ed.setView({ grid: (e.target as HTMLSelectElement).value })}>
        ${GRID_OPTIONS.map((o) => html`<option value=${o.value} ?selected=${o.value === ed.view.grid}>${o.label}</option>`)}
      </select>
    </label>`;
  }
}

@customElement('maddie-snap-toggle')
export class MaddieSnapToggle extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    return html`<button
      aria-pressed=${ed.view.snap}
      aria-label="Snap to grid"
      data-tip=${tip('Snap · hold ⌥ to bypass', 'S')}
      @click=${() => ed.setView({ snap: !ed.view.snap })}
    >
      ${icons.magnet}
    </button>`;
  }
}

// ── Key, scale lock, fold ───────────────────────────────────────────

@customElement('maddie-key-select')
export class MaddieKeySelect extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const key = ed.key;
    const setRoot = (e: Event) => {
      const v = (e.target as HTMLSelectElement).value;
      ed.commands.setKey(v === '' ? null : { root: Number(v), scale: key?.scale ?? 'major' });
    };
    const setScale = (e: Event) => {
      ed.commands.setKey({ root: key?.root ?? 0, scale: (e.target as HTMLSelectElement).value as ScaleId });
    };
    return html`
      <label class="select" data-tip="Key">
        ${icons.music}<span class="value">${key ? pitchClassName(key.root) : 'No key'}</span>
        <span class="chev">${icons.chevron}</span>
        <select aria-label="Key root" @change=${setRoot}>
          <option value="" ?selected=${!key}>No key</option>
          ${Array.from({ length: 12 }, (_, pc) => html`<option value=${pc} ?selected=${key?.root === pc}>${pitchClassName(pc)}</option>`)}
        </select>
      </label>
      ${key
        ? html`<label class="select" data-tip="Scale">
            <span class="value">${SCALES[key.scale].name}</span><span class="chev">${icons.chevron}</span>
            <select aria-label="Scale" @change=${setScale}>
              ${SCALE_IDS.map((id) => html`<option value=${id} ?selected=${key.scale === id}>${SCALES[id].name}</option>`)}
            </select>
          </label>`
        : nothing}
    `;
  }
}

@customElement('maddie-scale-lock')
export class MaddieScaleLock extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    return html`<button
      aria-pressed=${ed.view.scaleLock && !!ed.key}
      ?disabled=${!ed.key}
      aria-label="Lock to scale"
      data-tip="Lock to scale"
      @click=${() => ed.setView({ scaleLock: !ed.view.scaleLock })}
    >
      ${icons.lock}
    </button>`;
  }
}

const FOLDS: Array<{ value: FoldMode; label: string }> = [
  { value: 'none', label: 'Unfolded' },
  { value: 'scale', label: 'Fold to scale' },
  { value: 'used', label: 'Fold to notes' },
];

@customElement('maddie-fold-select')
export class MaddieFoldSelect extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const folded = ed.view.fold !== 'none';
    return html`<label class="select" data-tip="Fold rows" style=${folded ? 'background: var(--_surface-2)' : ''}>
      ${icons.fold}<span class="value">${folded ? (ed.view.fold === 'scale' ? 'Scale' : 'Notes') : 'Fold'}</span>
      <span class="chev">${icons.chevron}</span>
      <select aria-label="Fold" @change=${(e: Event) => ed.setView({ fold: (e.target as HTMLSelectElement).value as FoldMode }, { animate: true })}>
        ${FOLDS.map((f) => html`<option value=${f.value} ?selected=${ed.view.fold === f.value} ?disabled=${f.value === 'scale' && !ed.key}>${f.label}</option>`)}
      </select>
    </label>`;
  }
}

// ── Transport ───────────────────────────────────────────────────────

@customElement('maddie-transport')
export class MaddieTransport extends ControlElement {
  static styles = [
    tokens,
    controlStyles,
    css`
      .play {
        width: 34px;
        height: 34px;
        border-radius: 999px;
        background: var(--_accent);
        color: var(--_accent-text);
        margin-right: 4px;
      }
      .play:hover {
        background: color-mix(in oklab, var(--_accent) 84%, var(--_bg));
        color: var(--_accent-text);
      }
      .play[aria-pressed='true'] {
        background: var(--_accent);
        color: var(--_accent-text);
      }
      .position {
        display: inline-flex;
        align-items: baseline;
        gap: 1px;
        min-width: 74px;
        height: 30px;
        align-items: center;
        justify-content: center;
        padding: 0 10px;
        margin-left: 4px;
        border-radius: var(--_radius-sm);
        background: var(--_surface-2);
        font-family: var(--_font-mono);
        font-size: 12.5px;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        color: var(--_text);
      }
      .dot {
        color: var(--_text-faint);
      }
    `,
  ];

  @state() private position = '1.1.1';
  private raf = 0;

  protected attach(editor: Editor, engine: Engine) {
    super.attach(editor, engine);
    this.track(
      editor.on('transport', () => this.tick()),
      () => cancelAnimationFrame(this.raf),
    );
    this.tick();
  }

  private tick = () => {
    const ed = this.ed;
    if (!ed) return;
    this.position = formatBBT(ed.transport.position, ed.meta.timeSignature, ed.ppq);
    cancelAnimationFrame(this.raf);
    if (ed.transport.playing) this.raf = requestAnimationFrame(this.tick);
  };

  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const t = ed.transport;
    const [bar, beat, six] = this.position.split('.');
    return html`
      <button class="play" aria-pressed=${t.playing} aria-label=${t.playing ? 'Pause' : 'Play'} data-tip=${tip(t.playing ? 'Pause' : 'Play', 'Space')} @click=${() => t.toggle()}>
        ${t.playing ? icons.pause : icons.play}
      </button>
      <button aria-label="Stop" data-tip=${tip('Stop · twice to rewind', '↵')} @click=${() => t.stop()}>${icons.stop}</button>
      <button
        aria-pressed=${t.loop.enabled}
        aria-label="Loop"
        data-tip=${tip('Loop · drag the ruler to set', `${modKeyLabel} L`)}
        @click=${() => {
          if (t.loop.end <= t.loop.start) t.setLoop({ start: 0, end: ed.ppq * 4 * 4 });
          t.setLoop({ enabled: !t.loop.enabled });
        }}
      >
        ${icons.loop}
      </button>
      <span class="position" aria-label="Position" role="timer">
        ${bar}<span class="dot">.</span>${beat}<span class="dot">.</span>${six}
      </span>
    `;
  }
}

// ── Tempo ───────────────────────────────────────────────────────────

/** Drag up/down to scrub. Double-click to type. Arrow keys nudge. */
@customElement('maddie-tempo')
export class MaddieTempo extends ControlElement {
  static styles = [
    tokens,
    controlStyles,
    css`
      .tempo {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 30px;
        padding: 0 10px;
        border-radius: var(--_radius-sm);
        background: var(--_surface-2);
        cursor: ns-resize;
        font-variant-numeric: tabular-nums;
        touch-action: none;
        transition: background-color var(--_motion-fast) var(--_ease);
      }
      .tempo:hover,
      .tempo.active {
        background: color-mix(in oklab, var(--_surface-2) 70%, var(--_hover));
      }
      .tempo:focus-visible {
        outline: 2px solid var(--_focus);
        outline-offset: 1px;
      }
      .bpm {
        font-family: var(--_font-mono);
        color: var(--_text);
        min-width: 3ch;
        text-align: right;
      }
      .unit {
        color: var(--_text-faint);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
      }
      input {
        width: 5ch;
        border: 0;
        padding: 0;
        background: transparent;
        color: var(--_text);
        font: 500 12.5px var(--_font-mono);
        text-align: right;
        outline: none;
      }
    `,
  ];

  @state() private editing = false;
  @state() private active = false;

  private get bpm() {
    return this.ed?.meta.tempo[0]?.bpm ?? 120;
  }

  private onDown = (e: PointerEvent) => {
    const ed = this.ed;
    if (!ed || this.editing || e.button !== 0) return;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const y0 = e.clientY;
    const start = this.bpm;
    const gestureId = `tempo-${Date.now()}`;
    this.active = true;
    const move = (ev: PointerEvent) => {
      const fine = ev.shiftKey ? 0.1 : 1;
      const next = Math.round((start + ((y0 - ev.clientY) / 3) * fine) * (ev.shiftKey ? 10 : 1)) / (ev.shiftKey ? 10 : 1);
      ed.commands.setTempo(next, { gestureId });
    };
    const up = () => {
      this.active = false;
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  private onKey = (e: KeyboardEvent) => {
    const ed = this.ed;
    if (!ed) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      ed.commands.setTempo(this.bpm + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      this.startEditing();
    }
  };

  private async startEditing() {
    this.editing = true;
    await this.updateComplete;
    const input = this.renderRoot.querySelector('input');
    input?.focus();
    input?.select();
  }

  private commit = (e: Event) => {
    const value = parseFloat((e.target as HTMLInputElement).value);
    if (Number.isFinite(value)) this.ed?.commands.setTempo(value);
    this.editing = false;
  };

  render() {
    if (!this.ed) return nothing;
    const bpm = this.bpm;
    const label = Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(1);
    return html`<span
      class="tempo ${this.active ? 'active' : ''}"
      tabindex="0"
      role="spinbutton"
      aria-label="Tempo"
      aria-valuenow=${bpm}
      aria-valuemin="20"
      aria-valuemax="400"
      data-tip=${this.active || this.editing ? nothing : 'Drag to change · double-click to type'}
      @pointerdown=${this.onDown}
      @dblclick=${() => this.startEditing()}
      @keydown=${this.onKey}
    >
      ${this.editing
        ? html`<input
            .value=${label}
            inputmode="decimal"
            @keydown=${(e: KeyboardEvent) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') this.editing = false;
            }}
            @blur=${this.commit}
          />`
        : html`<span class="bpm">${label}</span>`}
      <span class="unit">BPM</span>
    </span>`;
  }
}

// ── History + zoom ──────────────────────────────────────────────────

@customElement('maddie-history')
export class MaddieHistory extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const h = ed.history;
    return html`
      <button ?disabled=${!h.canUndo} aria-label="Undo" data-tip=${tip(h.undoLabel ? `Undo ${h.undoLabel.toLowerCase()}` : 'Undo', `${modKeyLabel} Z`)} @click=${() => ed.undo()}>
        ${icons.undo}
      </button>
      <button ?disabled=${!h.canRedo} aria-label="Redo" data-tip=${tip(h.redoLabel ? `Redo ${h.redoLabel.toLowerCase()}` : 'Redo', `${modKeyLabel} ⇧ Z`)} @click=${() => ed.redo()}>
        ${icons.redo}
      </button>
    `;
  }
}

@customElement('maddie-zoom')
export class MaddieZoom extends ControlElement {
  private zoom(factor: number) {
    const ed = this.ed;
    if (!ed || !this.engine) return;
    const v = ed.view;
    const width = this.engine.viewport.width || 800;
    const center = v.scrollTick + width / 2 / v.pxPerTick;
    const px = v.pxPerTick * factor;
    ed.setView({ pxPerTick: px, scrollTick: Math.max(0, center - width / 2 / px) }, { animate: true });
  }

  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const [minRh, maxRh] = ZOOM_LIMITS.rowHeight;
    return html`
      <button aria-label="Shorter rows" ?disabled=${ed.view.rowHeight <= minRh} data-tip=${tip('Shorter rows · ⌥ scroll', '⌥ −')} @click=${() => rowZoomBy(ed, 1 / 1.25)}>
        ${icons.rowsShorter}
      </button>
      <button aria-label="Taller rows" ?disabled=${ed.view.rowHeight >= maxRh} data-tip=${tip('Taller rows · ⌥ scroll', '⌥ +')} @click=${() => rowZoomBy(ed, 1.25)}>
        ${icons.rowsTaller}
      </button>
      <span class="sep"></span>
      <button aria-label="Zoom out" data-tip=${tip('Zoom out · ⌘ scroll', '−')} @click=${() => this.zoom(1 / 1.5)}>${icons.zoomOut}</button>
      <button aria-label="Zoom in" data-tip=${tip('Zoom in · ⌘ scroll', '+')} @click=${() => this.zoom(1.5)}>${icons.zoomIn}</button>
    `;
  }
}

// ── Export ──────────────────────────────────────────────────────────

/**
 * Downloads the doc as a Standard MIDI File.
 * @fires maddie-export - Cancelable. `detail: { bytes, filename }`. Call `preventDefault()` to handle the file yourself.
 */
@customElement('maddie-export')
export class MaddieExport extends ControlElement {
  /** Download name. `.mid` is added if missing. */
  @property() filename = 'maddie.mid';

  private export() {
    const ed = this.ed;
    if (!ed) return;
    const bytes = toMidiFile(ed.doc);
    const go = this.dispatchEvent(
      new CustomEvent('maddie-export', { detail: { bytes, filename: this.filename }, bubbles: true, composed: true, cancelable: true }),
    );
    if (go) downloadMidi(ed.doc, this.filename);
  }

  render() {
    if (!this.ed) return nothing;
    const empty = this.ed.notes().length === 0;
    return html`<button class="export" ?disabled=${empty} aria-label="Export MIDI" data-tip=${tip('Export .mid', `${modKeyLabel} ⇧ E`)} @click=${() => this.export()}>
      ${icons.download}<span>Export</span>
    </button>`;
  }
}

// ── Toolbar ─────────────────────────────────────────────────────────

/** The default toolbar. Every piece is also usable on its own. */
@customElement('maddie-toolbar')
export class MaddieToolbar extends MaddieElement {
  static styles = [
    tokens,
    css`
      :host {
        display: flex;
        align-items: center;
        gap: 6px;
        height: var(--_toolbar-height);
        padding: 0 10px;
        background: var(--_surface);
        border-bottom: 1px solid var(--_border);
        box-sizing: border-box;
        min-width: 0;
      }
      .group {
        display: flex;
        align-items: center;
        gap: 2px;
        min-width: 0;
      }
      .divider {
        width: 1px;
        height: 18px;
        margin: 0 4px;
        background: var(--_border);
        flex: none;
      }
      .spacer {
        flex: 1;
        min-width: 8px;
      }
      .center {
        gap: 6px;
      }
      @container (max-width: 860px) {
        .hide-narrow {
          display: none;
        }
      }
    `,
  ];

  render() {
    return html`
      <div class="group" part="group tools">
        <slot name="start"></slot>
        <maddie-tool-select exportparts="button"></maddie-tool-select>
      </div>
      <div class="divider"></div>
      <div class="group" part="group grid">
        <maddie-grid-select></maddie-grid-select>
        <maddie-snap-toggle></maddie-snap-toggle>
      </div>
      <div class="divider"></div>
      <div class="group" part="group key">
        <maddie-key-select></maddie-key-select>
        <maddie-scale-lock></maddie-scale-lock>
        <maddie-fold-select></maddie-fold-select>
      </div>
      <div class="spacer"></div>
      <div class="group center" part="group transport">
        <maddie-transport></maddie-transport>
        <maddie-tempo></maddie-tempo>
      </div>
      <div class="spacer"></div>
      <div class="group" part="group history">
        <maddie-history></maddie-history>
      </div>
      <div class="divider"></div>
      <div class="group" part="group export">
        <maddie-export></maddie-export>
      </div>
      <div class="divider"></div>
      <div class="group" part="group zoom">
        <maddie-zoom></maddie-zoom>
        <slot name="end"></slot>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'maddie-tool-select': MaddieToolSelect;
    'maddie-grid-select': MaddieGridSelect;
    'maddie-snap-toggle': MaddieSnapToggle;
    'maddie-key-select': MaddieKeySelect;
    'maddie-scale-lock': MaddieScaleLock;
    'maddie-fold-select': MaddieFoldSelect;
    'maddie-transport': MaddieTransport;
    'maddie-tempo': MaddieTempo;
    'maddie-history': MaddieHistory;
    'maddie-zoom': MaddieZoom;
    'maddie-toolbar': MaddieToolbar;
    'maddie-export': MaddieExport;
  }
}
