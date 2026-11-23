import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { formatBBT, GRID_OPTIONS, gridTicks, pitchName, toMidiVelocity, type Editor } from '../core';
import type { Engine } from '../engine/engine';
import { modKeyLabel } from '../engine/keymap';
import { MaddieElement } from './base';
import { dividerStyles, partStyles } from './controls';
import { icons } from './icons';
import { tokens } from './tokens';
import './zest';

/**
 * The selection bar. Always visible, fixed height, never over the notes.
 * The empty state reserves the bar's height and shows a selection hint.
 */
@customElement('maddie-inspector')
export class MaddieInspector extends MaddieElement {
  static styles = [
    tokens,
    partStyles,
    dividerStyles,
    css`
      :host {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        height: var(--maddie-inspector-height, 56px);
        padding: 0 var(--space-3);
        background-color: var(--_surface);
        border-top: 1px solid var(--_border);
        box-sizing: border-box;
        overflow-x: auto;
        scrollbar-width: none;
        container-type: inline-size;
        color: var(--_text);
        font-size: var(--font-size-sm);
        font-weight: 500;
      }
      .summary {
        display: flex;
        align-items: center;
        gap: var(--space-2);
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
        gap: var(--space-1);
        white-space: nowrap;
        transition: opacity var(--_motion-fast) var(--_ease);
      }
      .group[part~='actions'] {
        margin-inline-start: auto;
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

  protected attach(editor: Editor, _engine: Engine) {
    const update = () => this.requestUpdate();
    const reset = () => { editor.stopChord(); update(); };
    this.track(editor.on('selection', reset), editor.on('change', reset), editor.on('tracks', reset),
      editor.on('view', update), () => editor.stopChord());
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
    const { quantizeGrid, quantizeStrength } = ed.view;
    const grid = quantizeGrid === 'current' ? undefined : (gridTicks(quantizeGrid, ed.ppq) ?? undefined);
    ed.commands.quantize(undefined, { grid, strength: quantizeStrength / 100 });
  }

  private humanize() {
    const ed = this.ed;
    if (!ed) return;
    const grid = ed.commands.gridTicks();
    ed.commands.humanize(undefined, {
      timing: Math.round((grid * ed.view.humanizeTiming) / 100 / 2),
      velocity: ed.view.humanizeVelocity / 100 / 2,
    });
  }

  private rampVelocity() {
    const ed = this.ed;
    if (!ed) return;
    ed.commands.rampVelocity(undefined, ed.view.rampFrom / 100, ed.view.rampTo / 100);
  }

  private strum() {
    const ed = this.ed;
    if (!ed) return;
    ed.commands.strum(undefined, ed.view.strumDirection, ed.view.strumAmount / 100);
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
      tone="primary"
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
        <z-tooltip content=${tipText} placement="top"><z-button kind="solid" tone="primary" size="sm" is-full-width @click=${apply}>Apply</z-button></z-tooltip>
      </div>
    </z-popover>`;
  }

  /** Text on an outlined button, with a tooltip. */
  private textButton(label: string, text: string, tipText: string, onClick: () => void) {
    return html`<z-tooltip content=${tipText} placement="top"
      ><z-button class="num" kind="outline" size="sm" aria-label=${label} @click=${onClick}>${text}</z-button></z-tooltip
    >`;
  }

  /** Chord tracks: a summary and Render to MIDI. Editing lives in the floating chord bar. */
  private renderChordInspector(ed: Editor) {
    const selected = ed.selectedChordRegions;
    const hasChords = !!ed.chordRegions?.length;
    return html`<div class="summary" role="status">
      ${selected.length
        ? html`<z-text size="sm" weight="600">${selected.length === 1 ? `${selected[0].symbol} · bar ${formatBBT(selected[0].start, ed.meta.timeSignature, ed.ppq).split('.')[0]}` : selected.length + ' chords selected'}</z-text>`
        : html`<z-text size="sm" color="muted">${hasChords ? 'Select chords to edit' : 'Add chords from the Chords panel'}</z-text>`}
    </div>
    ${hasChords ? html`<div class="group" part="actions">
      <z-button size="sm" kind="outline"
        title="Convert this track to editable MIDI notes" @click=${() => ed.chordTrack.renderToMidi()}>Render to MIDI</z-button>
    </div>` : nothing}`;
  }

  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    if (ed.chordRegions) {
      return this.renderChordInspector(ed);
    }
    const notes = this.notes;
    if (!notes.length) return html`<div class="summary" role="status">
      <z-text size="sm" color="muted">${ed.notes().length ? 'Select notes to edit' : 'Double-click the grid to add a note'}</z-text>
    </div>`;

    const pitches = notes.map((n) => n.pitch);
    const folded = ed.view.fold === 'scale' || ed.view.fold === 'used';
    const step = folded ? 'a row' : ed.view.scaleLock && ed.key ? 'a scale step' : 'a semitone';
    const vels = notes.map((n) => this.vel(n.velocity));
    const lo = Math.min(...pitches);
    const hi = Math.max(...pitches);
    const vLo = Math.min(...vels);
    const vHi = Math.max(...vels);
    const currentGrid = GRID_OPTIONS.find((o) => o.value === ed.view.grid)?.label ?? ed.view.grid;

    return html`
      <div class="summary" role="status" aria-live="polite">
        <span class="count">${notes.length} ${notes.length === 1 ? 'note' : 'notes'}</span>
        <z-badge class="range" size="sm">${lo === hi ? pitchName(lo) : `${pitchName(lo)}–${pitchName(hi)}`}</z-badge>
      </div>

      <z-separator is-vertical></z-separator>
      <div class="group" part="group velocity">
        <span class="label">Velocity</span>
        ${vLo === vHi
          ? this.velocityField('Velocity', vLo, (v) => this.setVelocity(v, v))
          : html`${this.velocityField('Lowest velocity', vLo, (v) => this.setVelocity(v, vHi))}<span class="dash">–</span>${this.velocityField('Highest velocity', vHi, (v) => this.setVelocity(vLo, v))}`}
      </div>

      <z-separator is-vertical></z-separator>
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
                .value=${live(ed.view.quantizeGrid)}
                @change=${(e: CustomEvent<{ value: string }>) => ed.setView({ quantizeGrid: e.detail.value })}
              ></z-select>
            </div>
            ${this.percent('Strength', ed.view.quantizeStrength, 0, 100, 5, (v) => ed.setView({ quantizeStrength: v }))}`,
          () => this.quantize(),
        )}
        ${this.settings(
          'Humanize',
          'Random nudges to timing and velocity',
          html`${this.percent('Timing', ed.view.humanizeTiming, 0, 100, 5, (v) => ed.setView({ humanizeTiming: v }))}
            ${this.percent('Velocity', ed.view.humanizeVelocity, 0, 50, 1, (v) => ed.setView({ humanizeVelocity: v }))}`,
          () => this.humanize(),
        )}
        ${this.settings(
          'Ramp',
          'Velocity steps evenly from the first note to the last',
          html`${this.percent('First note', ed.view.rampFrom, 0, 100, 1, (v) => ed.setView({ rampFrom: v }))}
            ${this.percent('Last note', ed.view.rampTo, 0, 100, 1, (v) => ed.setView({ rampTo: v }))}`,
          () => this.rampVelocity(),
        )}
        ${this.settings(
          'Strum',
          'Spread chords so the notes sound one after another',
          html`<div class="field">
              <z-text class="field-label" size="xs" color="muted">Direction</z-text>
              <z-select
                size="sm"
                label="Strum direction"
                .options=${[
                  { value: 'down', label: 'Down (low to high)' },
                  { value: 'up', label: 'Up (high to low)' },
                ]}
                .value=${live(ed.view.strumDirection)}
                @change=${(e: CustomEvent<{ value: 'down' | 'up' }>) => ed.setView({ strumDirection: e.detail.value })}
              ></z-select>
            </div>
            ${this.percent('Amount', ed.view.strumAmount, 0, 100, 5, (v) => ed.setView({ strumAmount: v }))}`,
          () => this.strum(),
        )}
      </div>

      <z-separator is-vertical></z-separator>
      <div class="group" part="group transpose">
        <span class="label">Transpose</span>
        <z-button-group>
          ${this.textButton('Octave down', '−12', 'Octave down   ⇧ ↓', () => this.transpose(-12))}
          ${this.textButton('Down', '−1', `Down ${step}   ↓`, () => this.transpose(-1))}
          ${this.textButton('Up', '+1', `Up ${step}   ↑`, () => this.transpose(1))}
          ${this.textButton('Octave up', '+12', 'Octave up   ⇧ ↑', () => this.transpose(12))}
        </z-button-group>
      </div>

      <z-separator is-vertical></z-separator>
      <div class="group" part="group length">
        <span class="label">Length</span>
        <z-button-group>
          ${this.textButton('Half length', '×½', 'Half length · keeps spacing   ⌥ ⇧ ←', () => ed.commands.stretch(undefined, 0.5))}
          ${this.textButton('Double length', '×2', 'Double length · keeps spacing   ⌥ ⇧ →', () => ed.commands.stretch(undefined, 2))}
        </z-button-group>
      </div>

      <div class="group" part="group actions">
        ${iconAction('Legato', 'Legato · extend to next note   L', icons.legato, () => ed.commands.legato())}
        ${iconAction('Mute', 'Mute   M / 0', icons.mute, () => ed.commands.toggleMute())}
        ${iconAction('Duplicate', `Duplicate   ${modKeyLabel} D`, icons.duplicate, () => ed.commands.duplicate())}
        ${iconAction('Delete', 'Delete   ⌫', icons.trash, () => ed.commands.delete(), 'danger')}
      </div>
    `;
  }
}

/** Icon-only action with a tooltip above it (the bar sits at the bottom). */
function iconAction(label: string, tipText: string, icon: unknown, onClick: () => void, tone: 'neutral' | 'danger' = 'neutral') {
  return html`<z-tooltip content=${tipText} placement="top"
    ><z-button class="icon" kind="ghost" size="sm" tone=${tone} aria-label=${label} @click=${onClick}>${icon}</z-button></z-tooltip
  >`;
}


declare global {
  interface HTMLElementTagNameMap {
    'maddie-inspector': MaddieInspector;
  }
}
