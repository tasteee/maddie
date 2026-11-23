import { css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { ScaledT } from '@tasteee/scaled/types';
import { live } from 'lit/directives/live.js';
import { CHORD_VOICINGS, formatBBT, loadScaled, type ChordRegion, type Editor } from '../core';
import type { Engine } from '../engine/engine';
import { MaddieElement } from './base';
import { formatPatternCategory } from './pattern-picker';
import './pattern-picker';
import { icons } from './icons';
import { tokens } from './tokens';
import './zest';

/**
 * The floating chord bar. Shows over the bottom of the piano roll while chords are selected
 * on a chord track: the chord, its pattern, inversion and voicing, and Use in panel.
 * Octave is drag up/down or Shift+↑/↓; duplicate and delete live in the track menu and keys.
 * The docked selection bar keeps only the summary and Render to MIDI.
 */
@customElement('maddie-chord-bar')
export class MaddieChordBar extends MaddieElement {
  static styles = [
    tokens,
    css`
      :host {
        display: none;
        color: var(--_text);
        font-size: var(--font-size-sm);
        font-weight: 500;
      }
      /* The host spans the roll; the bar centers in the room left of the zoom pad. */
      :host([is-open]) {
        display: flex;
        justify-content: center;
        pointer-events: none;
      }
      .bar {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        max-width: 100%;
        padding: var(--space-1);
        box-sizing: border-box;
        overflow-x: auto;
        scrollbar-width: none;
        pointer-events: auto;
        background: var(--_surface);
        border: 1px solid var(--_border);
        border-radius: var(--radius-lg);
        white-space: nowrap;
      }
      .chord-props { display: flex; align-items: center; gap: var(--space-2); white-space: nowrap; }
      .chord-prop { display: flex; align-items: center; gap: var(--space-1); }
      .stepper { display: grid; grid-template-columns: 24px 3.5rem 24px; align-items: center; height: var(--control-height-sm); box-sizing: border-box; border: 1px solid var(--_border); border-radius: var(--radius-md); background: var(--_bg); }
      .stepper button { display: inline-flex; align-items: center; justify-content: center; height: 100%; padding: 0; border: 0; background: transparent; color: var(--_text-muted); cursor: pointer; }
      .stepper button:hover { background: var(--_surface-2); color: var(--_text); }
      .stepper button:disabled { opacity: 0.4; background: transparent; cursor: default; }
      .stepper button:focus-visible, .pattern-trigger:focus-visible, .voicing:focus-visible { outline: 2px solid var(--_focus); outline-offset: 1px; }
      .stepper svg { width: 12px; height: 12px; }
      .stepper-value { font-variant-numeric: tabular-nums; text-align: center; }
      .voicing { width: 7.75rem; height: var(--control-height-sm); padding: 0 var(--space-2); border: 1px solid var(--_border); border-radius: var(--radius-md); background: var(--_bg); color: var(--_text); font: inherit; }
      .pattern-trigger { display: inline-flex; align-items: center; gap: var(--space-2); width: 8.5rem; height: var(--control-height-sm); padding: 0 var(--space-2); box-sizing: border-box; border: 1px solid var(--_border); border-radius: var(--radius-md); background: var(--_bg); color: var(--_text); font: inherit; text-align: left; cursor: pointer; }
      .pattern-trigger:hover, .pattern-trigger[aria-expanded='true'] { border-color: var(--border-strong); }
      .pattern-trigger-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pattern-trigger-text.isEmpty { color: var(--_text-faint); }
      .pattern-trigger svg { flex: none; width: 12px; height: 12px; color: var(--_text-faint); }
      .chord-error { color: var(--status-danger); }
      .title { font-weight: 600; padding-inline: var(--space-2) var(--space-1); }
      .chord-prop-label { color: var(--_text-faint); font-size: var(--font-size-xs); }
    `,
  ];

  @state() private scaled?: ScaledT;
  @state() private chordError = '';
  @state() private pickerPosition = { left: 0, top: 0 };

  protected attach(editor: Editor, _engine: Engine) {
    const update = () => this.requestUpdate();
    const loadChordTools = () => {
      const isChordTrack = !!editor.chordRegions;
      const needsTools = isChordTrack && !this.scaled;
      if (!needsTools) return;
      void loadScaled().then((loaded) => { this.scaled = loaded; }, (error: Error) => { this.chordError = error.message; });
    };
    loadChordTools();
    this.track(editor.on('selection', update), editor.on('change', update), editor.on('tracks', () => { update(); loadChordTools(); }),
      editor.on('view', update));
  }

  protected willUpdate() {
    const ed = this.ed;
    const isChordTrack = !!ed?.chordRegions;
    const hasSelection = (ed?.selectedChordRegions.length ?? 0) > 0;
    this.toggleAttribute('is-open', isChordTrack && hasSelection);
  }

  private applyChordStyle(ed: Editor, style: Parameters<Editor['chordTrack']['previewStyle']>[0]) {
    this.chordError = '';
    try {
      const edit = ed.chordTrack.previewStyle(style);
      if (!edit) return;
      const selectedIds = ed.selectedChordRegions.map((region) => region.id);
      ed.chordTrack.commit(edit, 'Style chords', selectedIds);
      // Hear the new shape for half a second, without the pattern.
      const updatedFirst = ed.selectedChordRegions.slice(0, 1);
      ed.chordTrack.auditionPitches(updatedFirst);
    } catch (error) {
      this.chordError = (error as Error).message;
    }
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

    const bar = formatBBT(first.start, ed.meta.timeSignature, ed.ppq).split('.')[0];
    const title = selected.length === 1 ? `${first.symbol} · bar ${bar}` : `${selected.length} chords`;

    return html`<div class="chord-props">
      <span class="title" role="status">${title}</span>
      <span class="chord-prop"><span class="chord-prop-label">Pattern</span>
        <button type="button" class="pattern-trigger" data-pattern-trigger aria-haspopup="dialog" aria-expanded=${isPickerOpen} ?disabled=${!scaled}
          @click=${(event: MouseEvent) => this.openPicker(ed, event.currentTarget as HTMLElement)}>
          <span class=${hasPattern ? 'pattern-trigger-text' : 'pattern-trigger-text isEmpty'}>${patternText}</span>${icons.chevron}
        </button></span>
      ${stepper('Inversion', inversionLabel, sharesInversion && inversion > 0, sharesInversion && inversion < maxInversion,
        () => this.applyChordStyle(ed, { inversion: inversion - 1 }), () => this.applyChordStyle(ed, { inversion: inversion + 1 }))}
      <span class="chord-prop"><span class="chord-prop-label">Voicing</span>
        <select class="voicing" aria-label="Voicing" ?disabled=${!scaled} .value=${live(voicing)}
          @change=${(event: Event) => this.applyChordStyle(ed, { voicing: (event.target as HTMLSelectElement).value as ScaledT.VoicingNameT })}>
          ${sharesVoicing ? nothing : html`<option value="" selected disabled>Mixed</option>`}
          ${voicings.map((name) => html`<option value=${name} ?selected=${name === voicing}>${CHORD_VOICINGS[name] ?? name}</option>`)}
        </select></span>
      <z-tooltip content="Copy this chord's shape and pattern into the chords panel" placement="top">
        <z-button size="sm" kind="ghost" tone="secondary" @click=${() => this.useInPanel(ed)}>Use in panel</z-button>
      </z-tooltip>
      ${this.chordError ? html`<span class="chord-error" role="alert">${this.chordError}</span>` : nothing}
    </div>
    ${this.renderPicker(ed)}`;
  }

  render() {
    const ed = this.ed;
    if (!ed?.chordRegions) return nothing;
    const selected = ed.selectedChordRegions;
    if (!selected.length) return nothing;
    return html`<div class="bar" role="toolbar" aria-label=${selected.length === 1 ? 'Selected chord' : 'Selected chords'}>
      ${this.renderChordSettings(ed)}
    </div>`;
  }
}

const INVERSION_LABELS = ['Root', '1st', '2nd', '3rd'];
const forwardIcon = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>`;

declare global {
  interface HTMLElementTagNameMap {
    'maddie-chord-bar': MaddieChordBar;
  }
}
