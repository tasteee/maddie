import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import {
  accentChords, CHORD_ACCENTS, chordLevelAt, clearChordDynamics, formatBBT, GRID_OPTIONS, gridTicks, humanizeChords, levelChords,
  pitchName, pitchRangeChords, rampChords, toMidiVelocity, type ChordAccentT, type ChordRegion, type Editor,
} from '../core';
import type { Engine } from '../engine/engine';
import { modKeyLabel } from '../engine/keymap';
import { MaddieElement } from './base';
import { dividerStyles, partStyles } from './controls';
import { icons } from './icons';
import { tokens } from './tokens';
import './zest';

class SelectionControls extends MaddieElement {
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

  protected get notes() {
    return this.ed?.selectedNotes ?? [];
  }

  /** A Zest slider in whole percent. */
  protected percent(label: string, value: number, min: number, max: number, step: number, onValue: (v: number) => void) {
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
  protected settings(title: string, tipText: string, fields: unknown, apply: () => void) {
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
  protected textButton(label: string, text: string, tipText: string, onClick: () => void) {
    return html`<z-tooltip content=${tipText} placement="top"
      ><z-button class="num" kind="outline" size="sm" aria-label=${label} @click=${onClick}>${text}</z-button></z-tooltip
    >`;
  }

}

@customElement('maddie-velocity-controls')
export class MaddieVelocityControls extends SelectionControls {
  static styles = [...SelectionControls.styles, css`
    :host {
      flex: 1;
      min-width: 0;
      height: 100%;
      padding: 0;
      margin-inline-start: var(--space-2);
      border: 0;
      background: transparent;
    }
  `];

  /** Display velocity as MIDI 0–127 (default) or percent. */
  @property({ attribute: 'velocity-display' }) velocityDisplay: 'midi' | 'percent' = 'midi';

  protected attach(editor: Editor) {
    const update = () => this.requestUpdate();
    this.track(editor.on('selection', update), editor.on('change', update), editor.on('tracks', update), editor.on('view', update));
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

  private velocityField(label: string, value: number, onValue: (v: number) => void, isDisabled = this.notes.length === 0) {
    const max = this.velocityDisplay === 'midi' ? 127 : 100;
    return html`<z-number-input
      size="sm"
      label=${label}
      min="0"
      max=${max}
      step="1"
      ?is-disabled=${isDisabled}
      .value=${live(value)}
      @change=${(e: CustomEvent<{ value: number }>) => onValue(e.detail.value)}
      @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && (e.composedPath()[0] as HTMLElement).blur()}
    ></z-number-input>`;
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

  /** Ramp the selected chords as one line from the first to the last, or each on its own. */
  @state() private isRampOneLine = true;
  @state() private chordAccent: ChordAccentT = 'downbeats';

  private shapeChords(label: string, shape: (selected: readonly ChordRegion[]) => ChordRegion[]) {
    const ed = this.ed;
    if (!ed) return;
    const selected = ed.selectedChordRegions;
    if (!selected.length) return;
    try {
      ed.chordTrack.commitChanged(shape(selected), label);
    } catch (error) {
      this.engine?.toast((error as Error).message, 'error');
    }
  }

  /**
   * Chord velocity: level, humanize, ramp and accent. The shaping is stored on each chord,
   * so it survives every later edit (move, resize, inversion, a new pattern).
   */
  private renderChordVelocity(ed: Editor, selected: readonly ChordRegion[]) {
    const levels = selected.map((region) => this.vel(chordLevelAt(region, region.start)));
    const lowest = Math.min(...levels);
    const highest = Math.max(...levels);
    const isShaped = selected.some((region) => !!region.dynamics);
    const range = selected[0].dynamics?.pitchRange;
    const sharesRange = range && selected.every(({ dynamics }) => dynamics?.pitchRange?.min === range.min && dynamics.pitchRange.max === range.max);
    const setRange = (min: number, max: number) => this.shapeChords('Chord velocity', (regions) => pitchRangeChords(regions, this.fromVel(min), this.fromVel(max)));
    const setLevel = (value: number) => {
      if (sharesRange) setRange(value, value);
      else this.shapeChords('Chord velocity', (regions) => levelChords(regions, this.fromVel(value)));
    };
    const humanize = () => {
      const amount = ed.view.humanizeVelocity / 100 / 2;
      const seed = Math.floor(Math.random() * 0x7fffffff);
      this.shapeChords('Humanize chords', (regions) => humanizeChords(regions, amount, seed));
    };
    const ramp = () => {
      const from = ed.view.rampFrom / 100;
      const to = ed.view.rampTo / 100;
      this.shapeChords('Ramp chords', (regions) => rampChords(regions, from, to, this.isRampOneLine));
    };
    const accent = () => this.shapeChords('Accent chords', (regions) => accentChords(regions, this.chordAccent));
    const reset = () => this.shapeChords('Reset chord velocity', (regions) => clearChordDynamics(regions));
    const levelLabel = lowest === highest ? 'Velocity' : 'Velocity (sets every chord)';

    return html`<z-separator is-vertical></z-separator>
      <div class="group" part="group velocity">
        ${sharesRange && range.min !== range.max ? html`
          ${this.velocityField('Lowest velocity', this.vel(range.min), (value) => setRange(value, this.vel(range.max)), false)}
          <span class="dash">–</span>
          ${this.velocityField('Highest velocity', this.vel(range.max), (value) => setRange(this.vel(range.min), value), false)}`
          : this.velocityField(levelLabel, highest, setLevel, false)}
      </div>
      <z-separator is-vertical></z-separator>
      <div class="group" part="group shaping">
        ${this.settings(
          'Humanize',
          'Random velocity spread, the same take until you apply again',
          html`${this.percent('Velocity', ed.view.humanizeVelocity, 0, 50, 1, (v) => ed.setView({ humanizeVelocity: v }))}`,
          humanize,
        )}
        ${this.settings(
          'Ramp',
          'Velocity in a straight line from start to end',
          html`${this.percent('Start', ed.view.rampFrom, 0, 100, 1, (v) => ed.setView({ rampFrom: v }))}
            ${this.percent('End', ed.view.rampTo, 0, 100, 1, (v) => ed.setView({ rampTo: v }))}
            <z-switch label="One line across the chords" ?is-checked=${this.isRampOneLine}
              @change=${(event: CustomEvent<{ checked: boolean }>) => { this.isRampOneLine = event.detail.checked; }}></z-switch>`,
          ramp,
        )}
        ${this.settings(
          'Accent',
          'Louder hits on the chosen beats, softer elsewhere',
          html`<div class="field">
            <z-text class="field-label" size="xs" color="muted">Accent</z-text>
            <z-select size="sm" label="Accent" .options=${CHORD_ACCENTS} .value=${live(this.chordAccent)}
              @change=${(event: CustomEvent<{ value: ChordAccentT }>) => { this.chordAccent = event.detail.value; }}></z-select>
          </div>`,
          accent,
        )}
        ${isShaped ? this.textButton('Reset velocity', 'Reset', 'Back to one velocity: no ramp, humanize or accent', reset) : nothing}
      </div>`;
  }

  private renderNoteVelocity(ed: Editor) {
    const vels = this.notes.map((note) => this.vel(note.velocity));
    const vLo = Math.min(...vels);
    const vHi = Math.max(...vels);
    return html`<z-separator is-vertical></z-separator>
      <div class="group" part="group velocity">
        ${vLo === vHi
          ? this.velocityField('Velocity', vLo, (v) => this.setVelocity(v, v))
          : html`${this.velocityField('Lowest velocity', vLo, (v) => this.setVelocity(v, vHi))}<span class="dash">–</span>${this.velocityField('Highest velocity', vHi, (v) => this.setVelocity(vLo, v))}`}
      </div>
      <z-separator is-vertical></z-separator>
      <div class="group" part="group shaping">
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
      </div>`;
  }

  private renderVelocityControls(ed: Editor) {
    if (!ed.view.velocityLaneOpen) return nothing;
    if (ed.chordRegions) {
      const selected = ed.selectedChordRegions;
      return selected.length ? this.renderChordVelocity(ed, selected) : nothing;
    }
    return this.notes.length ? this.renderNoteVelocity(ed) : nothing;
  }

  render() {
    return this.ed ? this.renderVelocityControls(this.ed) : nothing;
  }
}

/** Selection summary and editing tools below the piano roll. */
@customElement('maddie-inspector')
export class MaddieInspector extends SelectionControls {
  protected attach(editor: Editor, _engine: Engine) {
    const reset = () => { editor.stopChord(); this.requestUpdate(); };
    this.track(editor.on('selection', reset), editor.on('change', reset), editor.on('tracks', reset),
      editor.on('view', () => this.requestUpdate()), () => editor.stopChord());
  }

  private quantize() {
    const ed = this.ed;
    if (!ed) return;
    const { quantizeGrid, quantizeStrength } = ed.view;
    const grid = quantizeGrid === 'current' ? undefined : (gridTicks(quantizeGrid, ed.ppq) ?? undefined);
    ed.commands.quantize(undefined, { grid, strength: quantizeStrength / 100 });
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

  /** Chord tracks: a summary and Render to MIDI. */
  private renderChordInspector(ed: Editor) {
    const selected = ed.selectedChordRegions;
    const hasChords = !!ed.chordRegions?.length;
    const hasSelection = selected.length > 0;
    return html`<div class="summary" role="status">
      ${hasSelection
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
    const lo = Math.min(...pitches);
    const hi = Math.max(...pitches);
    const currentGrid = GRID_OPTIONS.find((o) => o.value === ed.view.grid)?.label ?? ed.view.grid;

    return html`
      <div class="summary" role="status" aria-live="polite">
        <span class="count">${notes.length} ${notes.length === 1 ? 'note' : 'notes'}</span>
        <z-badge class="range" size="sm">${lo === hi ? pitchName(lo) : `${pitchName(lo)}–${pitchName(hi)}`}</z-badge>
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
        ${iconAction('Legato', 'Legato · extend to next note   N + L', icons.legato, () => ed.commands.legato())}
        ${iconAction('Mute selected notes', 'Mute selected notes   0', icons.mute, () => ed.commands.toggleMute())}
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
    'maddie-velocity-controls': MaddieVelocityControls;
  }
}
