import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { createId, GRID_OPTIONS, gridTicks, pitchName, toMidiVelocity, type Editor, type Note } from '../core';
import type { Engine } from '../engine/engine';
import { modKeyLabel } from '../engine/keymap';
import { MaddieElement } from './base';
import { controlStyles } from './controls';
import { icons } from './icons';
import { tokens } from './tokens';

/**
 * A number you drag to change (like a DAW knob, but flat).
 * Drag left/right or up/down · ⇧ for fine · double-click to type · arrows to nudge.
 *
 * @fires scrub-start
 * @fires scrub-input - live, `detail: { value }`
 * @fires scrub-end
 */
@customElement('maddie-scrub')
export class MaddieScrub extends LitElement {
  static styles = [
    tokens,
    css`
      :host {
        display: inline-flex;
      }
      .scrub {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 28px;
        padding: 0 9px;
        border-radius: var(--_radius-sm);
        background: var(--_surface-2);
        color: var(--_text);
        font-size: 12px;
        font-weight: 500;
        cursor: ew-resize;
        touch-action: none;
        user-select: none;
        transition: background-color var(--_motion-fast) var(--_ease);
      }
      .scrub:hover,
      .scrub.active {
        background: color-mix(in oklab, var(--_surface-2) 70%, var(--_hover));
      }
      .scrub:focus-visible {
        outline: 2px solid var(--_focus);
        outline-offset: 1px;
      }
      .label {
        color: var(--_text-muted);
      }
      .value,
      input {
        min-width: 3.5ch;
        text-align: right;
        font: 500 12px var(--_font-mono);
        font-variant-numeric: tabular-nums;
        color: var(--_text);
      }
      input {
        width: 5ch;
        padding: 0;
        border: 0;
        background: transparent;
        outline: none;
      }
      :host([disabled]) .scrub {
        opacity: 0.4;
        pointer-events: none;
      }
    `,
  ];

  @property({ type: Number }) value = 0;
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max = 100;
  @property({ type: Number }) step = 1;
  @property() label = '';
  @property() unit = '';
  /** Text shown instead of the value (e.g. "—" for mixed). */
  @property() placeholder?: string;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @state() private editing = false;
  @state() private active = false;

  private emit(type: string, value = this.value) {
    this.dispatchEvent(new CustomEvent(type, { detail: { value }, bubbles: true, composed: true }));
  }

  private set(v: number) {
    const clamped = Math.max(this.min, Math.min(this.max, Math.round(v / this.step) * this.step));
    if (clamped === this.value) return;
    this.value = clamped;
    this.emit('scrub-input');
  }

  private onDown = (e: PointerEvent) => {
    if (this.editing || e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const y0 = e.clientY;
    const start = this.value;
    let moved = false;
    this.active = true;
    this.emit('scrub-start');
    const move = (ev: PointerEvent) => {
      const d = ev.clientX - x0 - (ev.clientY - y0);
      if (!moved && Math.abs(d) < 2) return;
      moved = true;
      const perPx = ((this.max - this.min) / 200) * (ev.shiftKey ? 0.2 : 1);
      this.set(start + d * perPx);
    };
    const up = () => {
      this.active = false;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      this.emit('scrub-end');
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  private onKey = (e: KeyboardEvent) => {
    const dir = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
    if (dir) {
      e.preventDefault();
      e.stopPropagation();
      this.emit('scrub-start');
      this.set(this.value + dir * this.step * (e.shiftKey ? 10 : 1));
      this.emit('scrub-end');
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
    const v = parseFloat((e.target as HTMLInputElement).value);
    this.editing = false;
    if (!Number.isFinite(v)) return;
    this.emit('scrub-start');
    this.set(v);
    this.emit('scrub-end');
  };

  render() {
    const text = this.placeholder ?? `${this.value}`;
    return html`<span
      class="scrub ${this.active ? 'active' : ''}"
      tabindex=${this.disabled ? -1 : 0}
      role="spinbutton"
      aria-label=${this.label}
      aria-valuenow=${this.value}
      aria-valuemin=${this.min}
      aria-valuemax=${this.max}
      @pointerdown=${this.onDown}
      @dblclick=${() => this.startEditing()}
      @keydown=${this.onKey}
    >
      ${this.label ? html`<span class="label">${this.label}</span>` : nothing}
      ${this.editing
        ? html`<input
            .value=${String(this.value)}
            inputmode="decimal"
            @keydown=${(e: KeyboardEvent) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') this.editing = false;
            }}
            @blur=${this.commit}
          />`
        : html`<span class="value">${text}${this.unit}</span>`}
    </span>`;
  }
}

/**
 * The selection bar. Always visible, fixed height, never over the notes.
 * Controls dim when nothing is selected, so nothing moves around.
 */
@customElement('maddie-inspector')
export class MaddieInspector extends MaddieElement {
  static styles = [
    tokens,
    controlStyles,
    css`
      :host {
        display: flex;
        align-items: center;
        gap: 4px;
        height: var(--maddie-inspector-height, 48px);
        padding: 0 10px;
        background: var(--_surface);
        border-top: 1px solid var(--_border);
        box-sizing: border-box;
        overflow-x: auto;
        scrollbar-width: none;
        container-type: inline-size;
        font-size: 12px;
      }
      .summary {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 128px;
        padding-right: 6px;
        white-space: nowrap;
      }
      .count {
        font-weight: 600;
        color: var(--_text);
      }
      .range {
        color: var(--_text-muted);
        font-family: var(--_font-mono);
        font-size: 11.5px;
      }
      .hint {
        color: var(--_text-faint);
      }
      .group[part~='actions'] {
        margin-left: auto;
      }
      .group {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 0 6px;
        border-left: 1px solid var(--_border);
        white-space: nowrap;
        transition: opacity var(--_motion-medium) var(--_ease);
      }
      .title {
        margin-right: 2px;
        color: var(--_text-faint);
        font-size: 11px;
        font-weight: 600;
      }
      @container (max-width: 1180px) {
        .title {
          display: none;
        }
      }
      :host([empty]) .group {
        opacity: 0.38;
        pointer-events: none;
      }
      button {
        height: 28px;
        min-width: 28px;
      }
      button.apply {
        padding: 0 10px;
        background: var(--_surface-2);
        color: var(--_text);
      }
      button.apply:hover {
        background: color-mix(in oklab, var(--_surface-2) 70%, var(--_hover));
      }
      .num {
        font: 500 11.5px var(--_font-mono);
        padding: 0 6px;
      }
      .select {
        height: 28px;
        background: var(--_surface-2);
      }
      [data-tip]::after {
        top: auto;
        bottom: calc(100% + 8px);
      }
    `,
  ];

  /** Display velocity as MIDI 0–127 (default) or percent. */
  @property({ attribute: 'velocity-display' }) velocityDisplay: 'midi' | 'percent' = 'midi';
  @state() private quantizeGrid = 'current';
  @state() private strength = 100;
  @state() private humanizeTiming = 20;
  @state() private humanizeVelocity = 10;
  private velocityGesture: { id: string; notes: Note[]; start: number } | null = null;

  protected attach(editor: Editor, _engine: Engine) {
    const update = () => this.requestUpdate();
    this.track(editor.on('selection', update), editor.on('change', update), editor.on('view', update));
  }

  private get notes() {
    return this.ed?.selectedNotes ?? [];
  }

  private vel(v: number) {
    return this.velocityDisplay === 'midi' ? toMidiVelocity(v) : Math.round(v * 100);
  }

  private fromVel(v: number) {
    return this.velocityDisplay === 'midi' ? v / 127 : v / 100;
  }

  private onVelocityStart = () => {
    const notes = this.notes;
    const avg = notes.reduce((s, n) => s + n.velocity, 0) / Math.max(1, notes.length);
    this.velocityGesture = { id: createId(), notes, start: avg };
  };

  private onVelocityInput = (e: CustomEvent<{ value: number }>) => {
    const ed = this.ed;
    const g = this.velocityGesture;
    if (!ed || !g) return;
    const delta = this.fromVel(e.detail.value) - g.start;
    ed.commands.update(
      g.notes.map((n) => ({ id: n.id, velocity: Math.max(0, Math.min(1, n.velocity + delta)) })),
      'Change velocity',
      { gestureId: g.id },
    );
  };

  private quantize() {
    const ed = this.ed;
    if (!ed) return;
    const grid = this.quantizeGrid === 'current' ? undefined : (gridTicks(this.quantizeGrid, ed.ppq) ?? undefined);
    ed.commands.quantize(undefined, { grid, strength: this.strength / 100 });
  }

  private humanize() {
    const ed = this.ed;
    if (!ed) return;
    const grid = ed.commands.gridTicks();
    ed.commands.humanize(undefined, {
      timing: Math.round((grid * this.humanizeTiming) / 100 / 2),
      velocity: this.humanizeVelocity / 100 / 2,
    });
  }

  private transpose(semitones: number) {
    const ed = this.ed;
    if (!ed) return;
    if (ed.view.scaleLock && ed.key && Math.abs(semitones) === 1) ed.commands.transpose(undefined, { degrees: semitones });
    else ed.commands.transpose(undefined, { semitones });
  }

  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const notes = this.notes;
    const empty = notes.length === 0;
    this.toggleAttribute('empty', empty);

    const pitches = notes.map((n) => n.pitch);
    const vels = notes.map((n) => this.vel(n.velocity));
    const lo = Math.min(...pitches);
    const hi = Math.max(...pitches);
    const vLo = Math.min(...vels);
    const vHi = Math.max(...vels);
    const avg = empty ? 0 : Math.round(vels.reduce((a, b) => a + b, 0) / vels.length);
    const currentGrid = GRID_OPTIONS.find((o) => o.value === ed.view.grid)?.label ?? ed.view.grid;
    const qLabel = this.quantizeGrid === 'current' ? currentGrid : (GRID_OPTIONS.find((o) => o.value === this.quantizeGrid)?.label ?? this.quantizeGrid);

    return html`
      <div class="summary" role="status" aria-live="polite">
        ${empty
          ? html`<span class="hint">Select notes to edit</span>`
          : html`<span class="count">${notes.length} ${notes.length === 1 ? 'note' : 'notes'}</span>
              <span class="range">${lo === hi ? pitchName(lo) : `${pitchName(lo)}–${pitchName(hi)}`}</span>`}
      </div>

      <div class="group" part="group velocity">
        <maddie-scrub
          label="Velocity"
          .value=${avg}
          .min=${0}
          .max=${this.velocityDisplay === 'midi' ? 127 : 100}
          .placeholder=${empty ? '—' : vLo === vHi ? undefined : `${vLo}–${vHi}`}
          ?disabled=${empty}
          @scrub-start=${this.onVelocityStart}
          @scrub-input=${this.onVelocityInput}
          @scrub-end=${() => (this.velocityGesture = null)}
        ></maddie-scrub>
      </div>

      <div class="group" part="group quantize">
        <span class="title">Quantize</span>
        <label class="select" data-tip="Quantize grid">
          <span class="value">${qLabel}</span><span class="chev">${icons.chevron}</span>
          <select aria-label="Quantize grid" @change=${(e: Event) => (this.quantizeGrid = (e.target as HTMLSelectElement).value)}>
            <option value="current" ?selected=${this.quantizeGrid === 'current'}>Grid (${currentGrid})</option>
            ${GRID_OPTIONS.filter((o) => o.value !== 'auto').map(
              (o) => html`<option value=${o.value} ?selected=${o.value === this.quantizeGrid}>${o.label}</option>`,
            )}
          </select>
        </label>
        <maddie-scrub label="Strength" unit="%" .value=${this.strength} .min=${0} .max=${100} .step=${5} @scrub-input=${(e: CustomEvent) => (this.strength = e.detail.value)}></maddie-scrub>
        <button class="apply" data-tip="Quantize   Q" @click=${() => this.quantize()}>Apply</button>
      </div>

      <div class="group" part="group humanize">
        <span class="title">Humanize</span>
        <maddie-scrub label="Timing" unit="%" .value=${this.humanizeTiming} .min=${0} .max=${100} .step=${5} @scrub-input=${(e: CustomEvent) => (this.humanizeTiming = e.detail.value)}></maddie-scrub>
        <maddie-scrub label="Vel" unit="%" .value=${this.humanizeVelocity} .min=${0} .max=${50} .step=${1} @scrub-input=${(e: CustomEvent) => (this.humanizeVelocity = e.detail.value)}></maddie-scrub>
        <button class="apply" data-tip="Random nudges to timing and velocity" @click=${() => this.humanize()}>Apply</button>
      </div>

      <div class="group" part="group transpose">
        <span class="title">Transpose</span>
        <button class="num" aria-label="Octave down" data-tip="Octave down   ⇧ ↓" @click=${() => this.transpose(-12)}>−12</button>
        <button class="num" aria-label="Down" data-tip=${ed.view.scaleLock && ed.key ? 'Down a scale step   ↓' : 'Down a semitone   ↓'} @click=${() => this.transpose(-1)}>−1</button>
        <button class="num" aria-label="Up" data-tip=${ed.view.scaleLock && ed.key ? 'Up a scale step   ↑' : 'Up a semitone   ↑'} @click=${() => this.transpose(1)}>+1</button>
        <button class="num" aria-label="Octave up" data-tip="Octave up   ⇧ ↑" @click=${() => this.transpose(12)}>+12</button>
      </div>

      <div class="group" part="group actions">
        <button aria-label="Legato" data-tip="Legato · extend to next note   L" @click=${() => ed.commands.legato()}>${icons.legato}</button>
        <button aria-label="Mute" data-tip="Mute   M" @click=${() => ed.commands.toggleMute()}>${icons.mute}</button>
        <button aria-label="Duplicate" data-tip=${`Duplicate   ${modKeyLabel} D`} @click=${() => ed.commands.duplicate()}>${icons.duplicate}</button>
        <button aria-label="Delete" data-tip="Delete   ⌫" @click=${() => ed.commands.delete()}>${icons.trash}</button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'maddie-scrub': MaddieScrub;
    'maddie-inspector': MaddieInspector;
  }
}
