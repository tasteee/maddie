import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { GRID_OPTIONS, gridTicks, pitchName, toMidiVelocity, type Editor } from '../core';
import type { Engine } from '../engine/engine';
import { modKeyLabel } from '../engine/keymap';
import { MaddieElement } from './base';
import { partStyles } from './controls';
import { icons } from './icons';
import { tokens } from './tokens';
import './zest';

/**
 * The selection bar. Always visible, fixed height, never over the notes.
 * Controls dim when nothing is selected, so nothing moves around.
 */
@customElement('maddie-inspector')
export class MaddieInspector extends MaddieElement {
  static styles = [
    tokens,
    partStyles,
    css`
      :host {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        height: var(--maddie-inspector-height, 56px);
        padding: 0 var(--space-md);
        background-color: var(--_surface);
        background-image: var(--material-surface);
        box-shadow: var(--elevation-flush);
        border-top: 1px solid var(--_border);
        box-sizing: border-box;
        overflow-x: auto;
        scrollbar-width: none;
        container-type: inline-size;
        color: var(--_text);
        font-size: var(--control-font-size-sm);
        font-weight: 500;
      }
      .summary {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        min-width: 8.5rem;
        white-space: nowrap;
      }
      .count {
        font-weight: 600;
        color: var(--_text);
      }
      .range {
        font-family: var(--_font-mono);
      }
      .group {
        display: flex;
        align-items: center;
        gap: var(--space-xs);
        white-space: nowrap;
        transition: opacity var(--_motion-fast) var(--_ease);
      }
      .group[part~='actions'] {
        margin-inline-start: auto;
      }
      z-separator[vertical] {
        height: 1.25rem;
      }
      z-separator[vertical] {
        flex: none;
      }
      :host([empty]) .group {
        opacity: var(--control-disabled-opacity);
        pointer-events: none;
      }
      z-number-input {
        width: 4.75rem;
      }
      .dash {
        color: var(--_text-faint);
      }
      z-button.num {
        font-family: var(--_font-mono);
      }
    `,
  ];

  /** Display velocity as MIDI 0–127 (default) or percent. */
  @property({ attribute: 'velocity-display' }) velocityDisplay: 'midi' | 'percent' = 'midi';
  @state() private quantizeGrid = 'current';
  @state() private strength = 100;
  @state() private humanizeTiming = 20;
  @state() private humanizeVelocity = 10;

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

  /** Set the selection's velocity range: one number sets every note, two refit them between low and high. */
  private setVelocity(lo: number, hi: number) {
    this.ed?.commands.setVelocityRange(undefined, this.fromVel(Math.min(lo, hi)), this.fromVel(Math.max(lo, hi)));
  }

  private velocityField(label: string, value: number, onValue: (v: number) => void) {
    const max = this.velocityDisplay === 'midi' ? 127 : 100;
    return html`<z-number-input
      size="sm"
      label=${label}
      min="0"
      max=${max}
      step="1"
      ?is-disabled=${this.notes.length === 0}
      .value=${live(value)}
      @change=${(e: CustomEvent<{ value: number }>) => onValue(e.detail.value)}
      @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && (e.composedPath()[0] as HTMLElement).blur()}
    ></z-number-input>`;
  }

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

  /** A Zest slider in whole percent. */
  private percent(label: string, value: number, min: number, max: number, step: number, onValue: (v: number) => void) {
    return html`<z-slider
      label=${label}
      accent="dom"
      min=${min}
      max=${max}
      step=${step}
      does-show-value
      value-suffix="%"
      .value=${live(value)}
      @input=${(e: CustomEvent<{ value: number }>) => onValue(e.detail.value)}
    ></z-slider>`;
  }

  /** A trigger and a panel of settings. Apply runs the command with them. */
  private settings(title: string, tipText: string, fields: unknown, apply: () => void) {
    return html`<z-popover placement="top-start" label=${`${title} options`}>
      <z-button slot="trigger" kind="ghost" size="sm" aria-label=${title}>${title}${icons.chevron}</z-button>
      <div class="panel">
        <z-text class="panel-title" size="sm" weight="600">${title}</z-text>
        ${fields}
        <z-tooltip content=${tipText} placement="top"><z-button kind="solid" accent="dom" size="sm" is-full-width @click=${apply}>Apply</z-button></z-tooltip>
      </div>
    </z-popover>`;
  }

  /** Text on an outlined button, with a tooltip. */
  private textButton(label: string, text: string, tipText: string, onClick: () => void) {
    return html`<z-tooltip content=${tipText} placement="top"
      ><z-button class="num" kind="outline" size="sm" aria-label=${label} @click=${onClick}>${text}</z-button></z-tooltip
    >`;
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

    return html`
      <div class="summary" role="status" aria-live="polite">
        ${empty
          ? html`<z-text size="sm" color="muted">Select notes to edit</z-text>`
          : html`<span class="count">${notes.length} ${notes.length === 1 ? 'note' : 'notes'}</span>
              <z-badge class="range" size="sm">${lo === hi ? pitchName(lo) : `${pitchName(lo)}–${pitchName(hi)}`}</z-badge>`}
      </div>

      <z-separator vertical></z-separator>
      <div class="group" part="group velocity">
        <span class="label">Velocity</span>
        ${vLo === vHi
          ? this.velocityField('Velocity', vLo, (v) => this.setVelocity(v, v))
          : html`${this.velocityField('Lowest velocity', vLo, (v) => this.setVelocity(v, vHi))}<span class="dash">–</span>${this.velocityField('Highest velocity', vHi, (v) => this.setVelocity(vLo, v))}`}
      </div>

      <z-separator vertical></z-separator>
      <div class="group" part="group quantize">
        ${this.settings(
          'Quantize',
          'Quantize   Q',
          html`<div class="field">
              <z-text class="field-label" size="xs" color="muted">Snap to</z-text>
              <z-select
                size="sm"
                label="Quantize grid"
                .options=${[
                  { value: 'current', label: `Grid (${currentGrid})` },
                  ...GRID_OPTIONS.filter((o) => o.value !== 'auto').map((o) => ({ value: o.value, label: o.label })),
                ]}
                .value=${live(this.quantizeGrid)}
                @change=${(e: CustomEvent<{ value: string }>) => (this.quantizeGrid = e.detail.value)}
              ></z-select>
            </div>
            ${this.percent('Strength', this.strength, 0, 100, 5, (v) => (this.strength = v))}`,
          () => this.quantize(),
        )}
        ${this.settings(
          'Humanize',
          'Random nudges to timing and velocity',
          html`${this.percent('Timing', this.humanizeTiming, 0, 100, 5, (v) => (this.humanizeTiming = v))}
            ${this.percent('Velocity', this.humanizeVelocity, 0, 50, 1, (v) => (this.humanizeVelocity = v))}`,
          () => this.humanize(),
        )}
      </div>

      <z-separator vertical></z-separator>
      <div class="group" part="group transpose">
        <span class="label">Transpose</span>
        <z-button-group>
          ${this.textButton('Octave down', '−12', 'Octave down   ⇧ ↓', () => this.transpose(-12))}
          ${this.textButton('Down', '−1', `Down ${step}   ↓`, () => this.transpose(-1))}
          ${this.textButton('Up', '+1', `Up ${step}   ↑`, () => this.transpose(1))}
          ${this.textButton('Octave up', '+12', 'Octave up   ⇧ ↑', () => this.transpose(12))}
        </z-button-group>
      </div>

      <z-separator vertical></z-separator>
      <div class="group" part="group length">
        <span class="label">Length</span>
        <z-button-group>
          ${this.textButton('Half length', '×½', 'Half length · keeps spacing   ⌥ ⇧ ←', () => ed.commands.stretch(undefined, 0.5))}
          ${this.textButton('Double length', '×2', 'Double length · keeps spacing   ⌥ ⇧ →', () => ed.commands.stretch(undefined, 2))}
        </z-button-group>
      </div>

      <div class="group" part="group actions">
        ${iconAction('Legato', 'Legato · extend to next note   L', icons.legato, () => ed.commands.legato())}
        ${iconAction('Mute', 'Mute   M', icons.mute, () => ed.commands.toggleMute())}
        ${iconAction('Duplicate', `Duplicate   ${modKeyLabel} D`, icons.duplicate, () => ed.commands.duplicate())}
        ${iconAction('Delete', 'Delete   ⌫', icons.trash, () => ed.commands.delete(), 'error')}
      </div>
    `;
  }
}

/** Icon-only action with a tooltip above it (the bar sits at the bottom). */
function iconAction(label: string, tipText: string, icon: unknown, onClick: () => void, accent: 'neutral' | 'error' = 'neutral') {
  return html`<z-tooltip content=${tipText} placement="top"
    ><z-button class="icon" kind="ghost" size="sm" accent=${accent} aria-label=${label} @click=${onClick}>${icon}</z-button></z-tooltip
  >`;
}

declare global {
  interface HTMLElementTagNameMap {
    'maddie-inspector': MaddieInspector;
  }
}
