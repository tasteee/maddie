import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { createId, GRID_OPTIONS, gridTicks, pitchName, remapVelocities, toMidiVelocity, type Editor, type Note } from '../core';
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
 * A low–high pair you can drag end by end, or type into.
 * Drag either number on its own · double-click to type `100` or `20-40`.
 *
 * @fires range-start - `detail: { which }`
 * @fires range-input - live, `detail: { lo, hi, which }`
 * @fires range-end
 * @fires range-commit - typed value, `detail: { lo, hi }`
 */
@customElement('maddie-range-scrub')
export class MaddieRangeScrub extends LitElement {
  static styles = [
    tokens,
    css`
      :host {
        display: inline-flex;
      }
      .field {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 28px;
        padding: 0 6px 0 9px;
        border-radius: var(--_radius-sm);
        background: var(--_surface-2);
        color: var(--_text);
        font-size: 12px;
        font-weight: 500;
        user-select: none;
      }
      .label {
        color: var(--_text-muted);
      }
      .num {
        min-width: 2.6ch;
        padding: 2px 4px;
        border-radius: 5px;
        text-align: center;
        font: 500 12px var(--_font-mono);
        font-variant-numeric: tabular-nums;
        cursor: ns-resize;
        touch-action: none;
        transition: background-color var(--_motion-fast) var(--_ease);
      }
      .num:hover,
      .num.active {
        background: color-mix(in oklab, var(--_text) 10%, transparent);
      }
      .num:focus-visible {
        outline: 2px solid var(--_focus);
        outline-offset: 0;
      }
      .dash {
        color: var(--_text-faint);
      }
      input {
        width: 7ch;
        padding: 2px 4px;
        border: 0;
        border-radius: 5px;
        background: var(--_bg);
        color: var(--_text);
        font: 500 12px var(--_font-mono);
        outline: 2px solid var(--_focus);
      }
      :host([disabled]) .field {
        opacity: 0.4;
        pointer-events: none;
      }
    `,
  ];

  @property({ type: Number }) lo = 0;
  @property({ type: Number }) hi = 0;
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max = 127;
  @property() label = '';
  @property({ type: Boolean, reflect: true }) disabled = false;
  @state() private editing = false;
  @state() private active: 'lo' | 'hi' | 'both' | null = null;

  private emit(type: string, detail: unknown) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  private clamp = (v: number) => Math.max(this.min, Math.min(this.max, Math.round(v)));

  private next(which: 'lo' | 'hi' | 'both', value: number) {
    if (which === 'both') return { lo: value, hi: value };
    if (which === 'lo') return { lo: Math.min(value, this.hi), hi: this.hi };
    return { lo: this.lo, hi: Math.max(value, this.lo) };
  }

  private onDown(e: PointerEvent, which: 'lo' | 'hi' | 'both') {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const y0 = e.clientY;
    const start = which === 'hi' ? this.hi : this.lo;
    let moved = false;
    this.active = which;
    this.emit('range-start', { which });
    const move = (ev: PointerEvent) => {
      const d = ev.clientX - x0 - (ev.clientY - y0);
      if (!moved && Math.abs(d) < 2) return;
      moved = true;
      const v = this.clamp(start + d * ((this.max - this.min) / 220) * (ev.shiftKey ? 0.2 : 1));
      const r = this.next(which, v);
      this.emit('range-input', { ...r, which });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      this.active = null;
      this.emit('range-end', { which });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  private onKey(e: KeyboardEvent, which: 'lo' | 'hi' | 'both') {
    const dir = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
    if (dir) {
      e.preventDefault();
      e.stopPropagation();
      const v = this.clamp((which === 'hi' ? this.hi : this.lo) + dir * (e.shiftKey ? 10 : 1));
      this.emit('range-start', { which });
      this.emit('range-input', { ...this.next(which, v), which });
      this.emit('range-end', { which });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      this.startEditing();
    }
  }

  private async startEditing() {
    this.editing = true;
    await this.updateComplete;
    const input = this.renderRoot.querySelector('input');
    input?.focus();
    input?.select();
  }

  /** "100" → 100–100 · "20-40", "20 40", "20–40", "40,20" → 20–40. */
  static parse(text: string): [number, number] | null {
    const nums = text.match(/\d+(\.\d+)?/g)?.map(Number);
    if (!nums?.length || nums.length > 2) return null;
    const [a, b = a] = nums;
    return [Math.min(a, b), Math.max(a, b)];
  }

  private commit = (e: Event) => {
    if (!this.editing) return;
    this.editing = false;
    const r = MaddieRangeScrub.parse((e.target as HTMLInputElement).value);
    if (r) this.emit('range-commit', { lo: this.clamp(r[0]), hi: this.clamp(r[1]) });
  };

  render() {
    const single = this.lo === this.hi;
    const num = (which: 'lo' | 'hi' | 'both', value: number, label: string) =>
      html`<span
        class="num ${this.active === which ? 'active' : ''}"
        tabindex=${this.disabled ? -1 : 0}
        role="spinbutton"
        aria-label=${label}
        aria-valuenow=${value}
        aria-valuemin=${this.min}
        aria-valuemax=${this.max}
        @pointerdown=${(e: PointerEvent) => this.onDown(e, which)}
        @keydown=${(e: KeyboardEvent) => this.onKey(e, which)}
        >${this.disabled ? '—' : value}</span
      >`;
    return html`<span
      class="field"
      title="Drag either number · double-click to type 100 or 20-40"
      @dblclick=${() => this.startEditing()}
    >
      ${this.label ? html`<span class="label">${this.label}</span>` : nothing}
      ${this.editing
        ? html`<input
            .value=${single ? String(this.lo) : `${this.lo}-${this.hi}`}
            aria-label=${`${this.label}: a number or a range like 20-40`}
            @keydown=${(e: KeyboardEvent) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') this.editing = false;
            }}
            @blur=${this.commit}
          />`
        : single
          ? num('both', this.lo, this.label)
          : html`${num('lo', this.lo, `${this.label} low`)}<span class="dash">–</span>${num('hi', this.hi, `${this.label} high`)}`}
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
  private velocityGesture: { id: string; notes: Note[] } | null = null;

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
    this.velocityGesture = { id: createId(), notes: this.notes };
  };

  /** Live drag: refit the notes captured at drag start into the new range. */
  private onVelocityInput = (e: CustomEvent<{ lo: number; hi: number }>) => {
    const ed = this.ed;
    const g = this.velocityGesture;
    if (!ed || !g) return;
    ed.commands.update(remapVelocities(g.notes, this.fromVel(e.detail.lo), this.fromVel(e.detail.hi)), 'Change velocity', { gestureId: g.id });
  };

  private onVelocityCommit = (e: CustomEvent<{ lo: number; hi: number }>) => {
    this.ed?.commands.setVelocityRange(undefined, this.fromVel(e.detail.lo), this.fromVel(e.detail.hi));
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
    ed.commands.nudgePitch(undefined, semitones);
  }

  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const notes = this.notes;
    const empty = notes.length === 0;
    this.toggleAttribute('empty', empty);

    const pitches = notes.map((n) => n.pitch);
    const folded = ed.view.fold === 'scale' || ed.view.fold === 'used';
    const step = folded ? 'a row' : ed.view.scaleLock && ed.key ? 'a scale step' : 'a semitone';
    const vels = notes.map((n) => this.vel(n.velocity));
    const lo = Math.min(...pitches);
    const hi = Math.max(...pitches);
    const vLo = empty ? 0 : Math.min(...vels);
    const vHi = empty ? 0 : Math.max(...vels);
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
        <maddie-range-scrub
          label="Velocity"
          .lo=${vLo}
          .hi=${vHi}
          .min=${0}
          .max=${this.velocityDisplay === 'midi' ? 127 : 100}
          ?disabled=${empty}
          @range-start=${this.onVelocityStart}
          @range-input=${this.onVelocityInput}
          @range-end=${() => (this.velocityGesture = null)}
          @range-commit=${this.onVelocityCommit}
        ></maddie-range-scrub>
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
        <button class="num" aria-label="Down" data-tip=${`Down ${step}   ↓`} @click=${() => this.transpose(-1)}>−1</button>
        <button class="num" aria-label="Up" data-tip=${`Up ${step}   ↑`} @click=${() => this.transpose(1)}>+1</button>
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
    'maddie-range-scrub': MaddieRangeScrub;
    'maddie-inspector': MaddieInspector;
  }
}
