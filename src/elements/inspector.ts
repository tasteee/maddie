import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ScaledT } from '@tasteee/scaled/types';
import { live } from 'lit/directives/live.js';
import { CHORD_VOICINGS, formatBBT, GRID_OPTIONS, gridTicks, loadScaled, pitchName, toMidiVelocity, type ChordRegion, type Editor } from '../core';
import type { Engine } from '../engine/engine';
import { modKeyLabel } from '../engine/keymap';
import { MaddieElement } from './base';
import { formatPatternCategory } from './pattern-picker';
import './pattern-picker';
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
      .chord-props { display: flex; align-items: center; gap: var(--space-2); white-space: nowrap; }
      .chord-prop { display: flex; align-items: center; gap: var(--space-1); }
      .chord-prop-label { color: var(--_text-faint); font-size: var(--font-size-xs); }
      .stepper { display: grid; grid-template-columns: 24px 3.5rem 24px; align-items: center; height: var(--control-height-sm); box-sizing: border-box; border: 1px solid var(--_border); border-radius: var(--radius-md); background: var(--_bg); }
      .stepper button { display: inline-flex; align-items: center; justify-content: center; height: 100%; padding: 0; border: 0; background: transparent; color: var(--_text-muted); cursor: pointer; }
      .stepper button:hover { background: var(--_surface-2); color: var(--_text); }
      .stepper button:disabled { opacity: 0.4; background: transparent; cursor: default; }
      .stepper button:focus-visible, .pattern-trigger:focus-visible, .voicing:focus-visible { outline: 2px solid var(--_focus); outline-offset: 1px; }
      .stepper svg { width: 12px; height: 12px; }
      .stepper-value { font-variant-numeric: tabular-nums; text-align: center; }
      .voicing { width: 9rem; height: var(--control-height-sm); padding: 0 var(--space-2); border: 1px solid var(--_border); border-radius: var(--radius-md); background: var(--_bg); color: var(--_text); font: inherit; }
      .pattern-trigger { display: inline-flex; align-items: center; gap: var(--space-2); width: 11rem; height: var(--control-height-sm); padding: 0 var(--space-2); box-sizing: border-box; border: 1px solid var(--_border); border-radius: var(--radius-md); background: var(--_bg); color: var(--_text); font: inherit; text-align: left; cursor: pointer; }
      .pattern-trigger:hover, .pattern-trigger[aria-expanded='true'] { border-color: var(--border-strong); }
      .pattern-trigger-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pattern-trigger-text.isEmpty { color: var(--_text-faint); }
      .pattern-trigger svg { flex: none; width: 12px; height: 12px; color: var(--_text-faint); }
      .chord-error { color: var(--status-danger); }
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
  @state() private scaled?: ScaledT;
  @state() private chordError = '';
  @state() private pickerPosition = { left: 0, top: 0 };

  protected attach(editor: Editor, _engine: Engine) {
    const update = () => this.requestUpdate();
    const reset = () => { editor.stopChord(); update(); };
    const loadChordTools = () => {
      const isChordTrack = !!editor.chordRegions;
      const needsTools = isChordTrack && !this.scaled;
      if (!needsTools) return;
      void loadScaled().then((loaded) => { this.scaled = loaded; }, (error: Error) => { this.chordError = error.message; });
    };
    loadChordTools();
    this.track(editor.on('selection', reset), editor.on('change', reset), editor.on('tracks', () => { reset(); loadChordTools(); }),
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

  private applyChordStyle(ed: Editor, style: Parameters<Editor['chordTrack']['previewStyle']>[0]) {
    this.chordError = '';
    try {
      const edit = ed.chordTrack.previewStyle(style);
      if (!edit) return;
      const selectedIds = ed.selectedChordRegions.map((region) => region.id);
      ed.chordTrack.commit(edit, 'Style chords', selectedIds);
      ed.chordTrack.audition();
    } catch (error) {
      this.chordError = (error as Error).message;
    }
  }

  /** Move the selected chords up or down an octave. One undo step. */
  private shiftOctave(ed: Editor, direction: -1 | 1) {
    const selected = ed.selectedChordRegions;
    const first = selected[0];
    if (!first) return;
    const regions = ed.chordTrack.planMove(first.id, first.start, direction, selected);
    if (!regions) return this.engine?.toast('That octave is outside the MIDI range.');
    const edit = ed.chordTrack.prepare(regions);
    if (!edit) return;
    ed.chordTrack.commit(edit, 'Change octave', selected.map((region) => region.id));
    ed.chordTrack.audition();
  }

  /** "Use in panel": copy this chord's shape and pattern into the chords panel's crafting card. */
  private useInPanel(ed: Editor) {
    const region = ed.selectedChordRegions[0];
    if (!region) return;
    const rootMidi = region.rootMidi ?? Math.min(...region.pitches);
    const octave = Math.max(1, Math.min(6, Math.floor(rootMidi / 12) - 1));
    ed.setView({
      chordsPanel: true,
      chordOctave: octave,
      chordInversion: region.inversion ?? 0,
      chordVoicing: region.voicing ?? 'rootPosition',
      chordTemplateId: region.performance?.templateId ?? '',
    });
    this.engine?.toast(`The panel now uses ${region.symbol}’s shape and pattern`);
  }

  private openPicker(ed: Editor, trigger: HTMLElement) {
    const isOpen = ed.view.patternPicker === 'selection';
    if (isOpen) return ed.setView({ patternPicker: null });
    const bar = this.getBoundingClientRect();
    const box = trigger.getBoundingClientRect();
    const width = Math.min(540, window.innerWidth - 16);
    const height = Math.min(470, window.innerHeight - 16);
    const centered = box.left + box.width / 2 - width / 2;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, centered));
    const top = Math.max(8, bar.top - height - 8);
    this.pickerPosition = { left, top };
    ed.setView({ patternPicker: 'selection' });
  }

  private renderPicker(ed: Editor) {
    const isOpen = ed.view.patternPicker === 'selection';
    const region = ed.selectedChordRegions[0];
    if (!isOpen || !region) return nothing;
    const bar = formatBBT(region.start, ed.meta.timeSignature, ed.ppq).split('.')[0];
    const preview = (templateId: string) => {
      try {
        const rootMidi = region.rootMidi ?? Math.min(...region.pitches);
        const octave = Math.max(1, Math.min(6, Math.floor(rootMidi / 12) - 1));
        const draft = ed.chordTrack.draft({ symbol: region.symbol, root: region.root, intervals: region.intervals },
          { octave, inversion: region.inversion ?? 0, voicing: region.voicing ?? 'rootPosition', templateId });
        return ed.chordTrack.auditionDraft(draft, true) ?? (() => {});
      } catch (error) {
        this.engine?.toast((error as Error).message, 'error');
        return;
      }
    };
    const apply = (templateId: string) => this.applyChordStyle(ed, { templateId: templateId || null });
    const close = () => ed.setView({ patternPicker: null });
    const projectIds = ed.doc.tracks.flatMap((track) => track.chordRegions ?? []).flatMap((item) => item.performance?.templateId ?? []);
    const uniqueIds = [...new Set(projectIds)];
    const style = `left: ${this.pickerPosition.left}px; top: ${this.pickerPosition.top}px`;
    return html`<maddie-pattern-picker style=${style} .scaled=${this.scaled} .appliedId=${region.performance?.templateId ?? ''}
      .targetPrefix=${'Changing'} .targetName=${`${region.symbol} · bar ${bar}`} .projectIds=${uniqueIds}
      .preview=${preview} .apply=${apply} .close=${close}></maddie-pattern-picker>`;
  }

  private renderChordSettings(ed: Editor) {
    const scaled = this.scaled;
    const selected = ed.selectedChordRegions;
    const first = selected[0];
    const inversionOf = (region: ChordRegion) => region.inversion ?? 0;
    const voicingOf = (region: ChordRegion) => region.voicing ?? 'rootPosition';
    const templateOf = (region: ChordRegion) => region.performance?.templateId ?? '';
    const sharesInversion = selected.every((region) => inversionOf(region) === inversionOf(first));
    const sharesVoicing = selected.every((region) => voicingOf(region) === voicingOf(first));
    const sharesTemplate = selected.every((region) => templateOf(region) === templateOf(first));
    const inversion = inversionOf(first);
    const octaveOf = (region: ChordRegion) => Math.floor((region.rootMidi ?? Math.min(...region.pitches)) / 12) - 1;
    const sharesOctave = selected.every((region) => octaveOf(region) === octaveOf(first));
    const octaveLabel = sharesOctave ? 'Oct ' + octaveOf(first) : 'Mixed';
    const maxInversion = Math.min(3, Math.min(...selected.map((region) => region.intervals.length)) - 1);
    const inversionLabel = sharesInversion ? INVERSION_LABELS[inversion] : 'Mixed';
    const voicing = sharesVoicing ? voicingOf(first) : '';
    const template = sharesTemplate && templateOf(first) ? scaled?.performanceTemplates.find((item) => item.id === templateOf(first)) : undefined;
    const patternText = !sharesTemplate ? 'Mixed patterns' : template ? `${template.name} · ${formatPatternCategory(template.category)}` : 'No pattern';
    const hasPattern = sharesTemplate && !!template;
    const isPickerOpen = ed.view.patternPicker === 'selection';
    const voicings = scaled?.voicingNames ?? [];
    const stepper = (label: string, value: string, canDown: boolean, canUp: boolean, down: () => void, up: () => void) => html`
      <span class="chord-prop"><span class="chord-prop-label">${label}</span>
        <span class="stepper" role="group" aria-label=${label}>
          <button type="button" aria-label=${label + ' down'} ?disabled=${!canDown} @click=${down}>${icons.back}</button>
          <span class="stepper-value">${value}</span>
          <button type="button" aria-label=${label + ' up'} ?disabled=${!canUp} @click=${up}>${forwardIcon}</button>
        </span></span>`;

    return html`<div class="chord-props">
      ${stepper('Octave', octaveLabel, true, true, () => this.shiftOctave(ed, -1), () => this.shiftOctave(ed, 1))}
      ${stepper('Inversion', inversionLabel, sharesInversion && inversion > 0, sharesInversion && inversion < maxInversion,
        () => this.applyChordStyle(ed, { inversion: inversion - 1 }), () => this.applyChordStyle(ed, { inversion: inversion + 1 }))}
      <span class="chord-prop"><span class="chord-prop-label">Voicing</span>
        <select class="voicing" aria-label="Voicing" ?disabled=${!scaled} .value=${live(voicing)}
          @change=${(event: Event) => this.applyChordStyle(ed, { voicing: (event.target as HTMLSelectElement).value as ScaledT.VoicingNameT })}>
          ${sharesVoicing ? nothing : html`<option value="" selected disabled>Mixed</option>`}
          ${voicings.map((name) => html`<option value=${name} ?selected=${name === voicing}>${CHORD_VOICINGS[name] ?? name}</option>`)}
        </select></span>
      <span class="chord-prop"><span class="chord-prop-label">Pattern</span>
        <button type="button" class="pattern-trigger" data-pattern-trigger aria-haspopup="dialog" aria-expanded=${isPickerOpen} ?disabled=${!scaled}
          @click=${(event: MouseEvent) => this.openPicker(ed, event.currentTarget as HTMLElement)}>
          <span class=${hasPattern ? 'pattern-trigger-text' : 'pattern-trigger-text isEmpty'}>${patternText}</span>${icons.chevron}
        </button></span>
      <z-tooltip content="Copy this chord's shape and pattern into the chords panel" placement="top">
        <z-button size="sm" kind="ghost" tone="secondary" @click=${() => this.useInPanel(ed)}>Use in panel</z-button>
      </z-tooltip>
      ${this.chordError ? html`<span class="chord-error" role="alert">${this.chordError}</span>` : nothing}
    </div>
    ${this.renderPicker(ed)}`;
  }

  private renderChordInspector(ed: Editor) {
    const selected = ed.selectedChordRegions;
    const hasChords = !!ed.chordRegions?.length;
    const run = (operation: Promise<unknown> | undefined) => {
      void operation?.catch((error: Error) => this.engine?.toast(error.message, 'error'));
    };
    return html`<div class="summary" role="status">
      ${selected.length
        ? html`<z-text size="sm" weight="600">${selected.length === 1 ? `${selected[0].symbol} · bar ${formatBBT(selected[0].start, ed.meta.timeSignature, ed.ppq).split('.')[0]}` : selected.length + ' chords selected'}</z-text>`
        : html`<z-text size="sm" color="muted">${hasChords ? 'Select chords to edit' : 'Add chords from the Chords panel'}</z-text>`}
    </div>
    ${selected.length ? html`<div class="group">
      ${this.renderChordSettings(ed)}
      <z-separator is-vertical></z-separator>
      <z-button size="sm" kind="ghost" @click=${() => ed.chordTrack.audition()}>Audition</z-button>
      <z-button size="sm" kind="ghost" @click=${() => run(ed.chordTrack.duplicate())}>Duplicate</z-button>
      <z-button size="sm" kind="ghost" @click=${() => run(ed.chordTrack.delete(ed.selection))}>Delete</z-button>
    </div>` : nothing}
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

const INVERSION_LABELS = ['Root', '1st', '2nd', '3rd'];
const forwardIcon = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>`;

declare global {
  interface HTMLElementTagNameMap {
    'maddie-inspector': MaddieInspector;
  }
}
