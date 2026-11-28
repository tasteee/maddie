import { css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { ref } from 'lit/directives/ref.js';
import type { ScaledT } from '@tasteee/scaled/types';
import { live } from 'lit/directives/live.js';
import { CHORD_INVERSION_LABELS, CHORD_VOICINGS, chordCraftSettings, formatBBT, loadScaled, offeredVoicings, type ChordRegion, type Editor } from '../core';
import type { Engine } from '../engine/engine';
import type { ChordTrackEdit } from '../core/chord-track';
import { MaddieElement } from './base';
import type { PatternChoice } from './pattern-picker';
import './pattern-picker';
import { icons } from './icons';
import { themeRegion, tokens } from './tokens';
import { onFocusedSelectClose } from './zest';

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
    ...themeRegion,
    css`
      :host {
        display: none;
        container-type: inline-size;
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
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-1-5);
        max-width: 100%;
        padding: var(--space-1);
        box-sizing: border-box;
        pointer-events: auto;
        background: var(--_surface);
        border: 1px solid var(--_border);
        border-radius: var(--radius-lg);
      }
      .stepper { display: grid; grid-template-columns: 1.5rem minmax(0, 7.75rem) 1.5rem; align-items: center; max-width: 100%; height: var(--control-height-sm); box-sizing: border-box; border: 1px solid var(--_border); border-radius: var(--radius-md); background: var(--_bg); }
      .stepper button { display: inline-flex; align-items: center; justify-content: center; height: 100%; padding: 0; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--_text-muted); cursor: pointer; }
      .stepper button:hover { background: var(--_surface-2); color: var(--_text); }
      .stepper button:disabled { opacity: 0.4; background: transparent; cursor: default; }
      .stepper button:focus-visible, .pattern-trigger:focus-visible { outline: 2px solid var(--_focus); outline-offset: -2px; }
      .stepper svg { width: 12px; height: 12px; }
      .stepper button:last-child svg { rotate: 180deg; }
      .stepper-value { text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .voicing { width: 12rem; max-width: 100%; border-radius: var(--radius-md); background: var(--_bg); }
      .pattern-trigger { display: inline-flex; align-items: center; gap: var(--space-2); width: 11rem; max-width: 100%; height: var(--control-height-sm); padding: 0 var(--space-2); box-sizing: border-box; border: 1px solid var(--_border); border-radius: var(--radius-md); background: var(--_bg); color: var(--_text); font: inherit; text-align: start; cursor: pointer; }
      .pattern-trigger:hover, .pattern-trigger[aria-expanded='true'] { border-color: var(--border-strong); }
      .pattern-trigger-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pattern-prefix { color: var(--_text-muted); }
      .pattern-trigger svg { flex: none; width: 1rem; height: 1rem; color: var(--_text-muted); }
      .chord-error { flex-basis: 100%; color: var(--status-danger); }
      .title { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 600; padding-inline: var(--space-2); white-space: nowrap; }

      @container (width < 43rem) {
        .bar {
          display: grid;
          width: min(100%, 27rem);
          grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr) max-content;
          grid-template-areas: 'title pattern action' 'inversion voicing voicing';
        }
        .title { grid-area: title; }
        .pattern-trigger { grid-area: pattern; width: 100%; }
        .stepper { grid-area: inversion; }
        .voicing { grid-area: voicing; width: 100%; }
        z-tooltip { grid-area: action; justify-self: end; }
        .chord-error { grid-column: 1 / -1; }
      }
    `,
  ];

  @state() private scaled?: ScaledT;
  @state() private chordError = '';
  @state() private pickerPosition = { left: 0, top: 0, height: 0 };
  private patternSession?: {
    editor: Editor;
    trackId: string;
    source: readonly ChordRegion[];
    selection: Editor['selection'];
    pending?: { edit: ChordTrackEdit; label: string };
  };

  protected attach(editor: Editor, _engine: Engine) {
    const update = () => this.requestUpdate();
    const loadChordTools = () => {
      const isChordTrack = !!editor.chordRegions;
      const needsTools = isChordTrack && !this.scaled;
      if (!needsTools) return;
      void loadScaled().then((loaded) => { this.scaled = loaded; }, (error: Error) => { this.chordError = error.message; });
    };
    loadChordTools();
    const updateSelection = () => {
      if (this.patternSession && !this.hasPatternSession(editor)) {
        this.closePicker(editor);
      }
      update();
    };
    this.track(editor.on('selection', updateSelection), editor.on('change', updateSelection),
      editor.on('tracks', () => { updateSelection(); loadChordTools(); }),
      editor.on('view', ({ view }) => {
        if (view.patternPicker !== 'selection') this.discardPatternPreview();
        update();
      }));
  }

  protected detached() {
    this.discardPatternPreview();
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
      // A new shape plays for half a second.
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
    ed.setView({ chordsPanel: true, ...chordCraftSettings(region, ed.key?.root) });
    this.engine?.toast(`The panel now uses ${region.symbol}’s shape and pattern`);
  }

  private openPicker(ed: Editor, trigger: HTMLElement) {
    const isOpen = ed.view.patternPicker === 'selection';
    if (isOpen) {
      const picker = this.renderRoot.querySelector('maddie-pattern-picker');
      if (picker) picker.dismiss(true);
      else this.closePicker(ed, true);
      return;
    }
    const source = ed.chordRegions;
    if (!source || !ed.selectedChordRegions.length) return;
    // Center on the visible bar, not the host (which spans the whole roll).
    const barElement = this.renderRoot.querySelector('.bar') ?? trigger;
    const barBox = barElement.getBoundingClientRect();
    const width = Math.min(540, window.innerWidth - 16);
    const centered = barBox.left + barBox.width / 2 - width / 2;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, centered));
    const roomAbove = barBox.top - 16;
    const roomBelow = window.innerHeight - barBox.bottom - 16;
    const isAbove = roomAbove >= 470 || roomAbove >= roomBelow;
    const height = Math.min(470, isAbove ? roomAbove : roomBelow);
    const top = isAbove ? barBox.top - height - 8 : barBox.bottom + 8;
    this.pickerPosition = { left, top, height };
    this.patternSession = { editor: ed, trackId: ed.activeTrackId, source, selection: ed.selection };
    ed.setView({ patternPicker: 'selection' });
  }

  private hasPatternSession(ed: Editor) {
    const session = this.patternSession;
    return session?.editor === ed && session.trackId === ed.activeTrackId &&
      session.source === ed.chordRegions && session.selection === ed.selection;
  }

  private discardPatternPreview() {
    const session = this.patternSession;
    this.patternSession = undefined;
    if (session?.pending) session.editor.setChordPreview();
  }

  private focusRoll = () => {
    const scope = this.getRootNode();
    const target = scope instanceof ShadowRoot
      ? scope.querySelector('maddie-piano-roll') ?? scope.host
      : this.closest('maddie-root, maddie-editor');
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
  };

  private observeVoicingMenu = (element?: Element) => onFocusedSelectClose(element, this.focusRoll);

  private closePicker(ed: Editor, restoreFocus = false) {
    this.discardPatternPreview();
    if (ed.view.patternPicker === 'selection') ed.setView({ patternPicker: null });
    if (restoreFocus) this.focusRoll();
  }

  private stagePattern(ed: Editor, { templateId, patternSpeed }: PatternChoice) {
    const session = this.patternSession;
    if (!session || !this.hasPatternSession(ed)) return false;
    try {
      const changed = templateId !== undefined || patternSpeed !== undefined;
      const edit = changed ? ed.chordTrack.previewStyle({ templateId: templateId === '' ? null : templateId, patternSpeed }) : undefined;
      if (changed && !edit) return false;
      const label = templateId === undefined ? 'Change chord pattern speed' : templateId ? 'Apply chord pattern' : 'Remove chord pattern';
      session.pending = edit && { edit, label };
      ed.setChordPreview(edit);
      return true;
    } catch (error) {
      this.engine?.toast((error as Error).message, 'error');
      return false;
    }
  }

  private commitPattern(ed: Editor) {
    const pending = this.patternSession?.pending;
    if (!pending || !this.hasPatternSession(ed)) return false;
    try {
      return ed.chordTrack.commit(pending.edit, pending.label, [...ed.selection]);
    } catch (error) {
      this.engine?.toast((error as Error).message, 'error');
      return false;
    }
  }

  private renderPicker(ed: Editor) {
    const isOpen = ed.view.patternPicker === 'selection';
    const selected = ed.selectedChordRegions;
    const region = selected[0];
    if (!isOpen || !region || !this.hasPatternSession(ed)) return nothing;
    const appliedId = region.performance?.templateId ?? '';
    const sharesPattern = selected.every((item) => (item.performance?.templateId ?? '') === appliedId);
    const speed = region.patternSpeed ?? 1;
    const sharesSpeed = selected.every((item) => (item.patternSpeed ?? 1) === speed);
    const preview = () => {
      if (!this.hasPatternSession(ed)) return;
      if (ed.transport.playing) ed.transport.stop();
      const notes = (this.patternSession?.pending?.edit.notes ?? ed.notes()).filter((note) =>
        note.chordRegionId && ed.selection.has(note.chordRegionId));
      return (ed.isTrackAudible(ed.activeTrackId) && ed.auditionNotes(notes, region.start)) || (() => {});
    };
    const togglePlayback = () => {
      const { transport } = ed;
      if (transport.playing) return transport.stop();
      const start = selected.some((item) => item.start <= transport.marker && transport.marker < item.start + item.duration)
        ? transport.marker : region.start;
      void transport.jump(start);
    };
    const projectIds = ed.doc.tracks.flatMap((track) => track.chordRegions ?? []).flatMap((item) => item.performance?.templateId ?? []);
    const uniqueIds = [...new Set(projectIds)];
    const { left, top, height } = this.pickerPosition;
    const style = `left: ${left}px; top: ${top}px; height: ${height}px`;
    return html`<maddie-pattern-picker style=${style} .scaled=${this.scaled} .appliedId=${sharesPattern ? appliedId : undefined}
      .projectIds=${uniqueIds} .appliedSpeed=${sharesSpeed ? speed : undefined}
      .preview=${preview} .stage=${(choice: PatternChoice) => this.stagePattern(ed, choice)}
      .togglePlayback=${togglePlayback} .commit=${() => this.commitPattern(ed)}
      .close=${(restoreFocus?: boolean) => this.closePicker(ed, restoreFocus)}></maddie-pattern-picker>`;
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
    const inversionLabel = sharesInversion ? CHORD_INVERSION_LABELS[inversion] : 'Mixed inversions';
    const voicing = sharesVoicing ? voicingOf(first) : '';
    const templateId = templateOf(first);
    const template = sharesTemplate && templateId ? scaled?.performanceTemplates.find((item) => item.id === templateId) : undefined;
    const patternName = template?.name ?? (templateId ? 'Unavailable' : 'None');
    const patternValue = sharesTemplate ? patternName : 'Mixed';
    const isPickerOpen = ed.view.patternPicker === 'selection';
    const voicings = offeredVoicings(scaled?.voicingNames ?? []).map((value) => ({ value, label: CHORD_VOICINGS[value] ?? value }));
    const voicingLabel = voicing ? CHORD_VOICINGS[voicing] ?? voicing : 'Mixed';
    const canLower = sharesInversion && inversion > 0;
    const canRaise = sharesInversion && inversion < maxInversion;

    const bar = formatBBT(first.start, ed.meta.timeSignature, ed.ppq).split('.')[0];
    const title = selected.length === 1 ? `${first.symbol} · bar ${bar}` : `${selected.length} chords`;

    return html`
      <span class="title" role="status">${title}</span>
      <button type="button" class="pattern-trigger" data-pattern-trigger aria-haspopup="dialog" aria-expanded=${isPickerOpen} ?disabled=${!scaled}
        @click=${(event: MouseEvent) => this.openPicker(ed, event.currentTarget as HTMLElement)}>
        <span class="pattern-trigger-text" title=${template ? `Pattern: ${patternValue}` : nothing}><span class="pattern-prefix">Pattern:</span> ${patternValue}</span>${icons.chevron}
      </button>
      <span class="stepper" role="group" aria-label="Inversion">
        <button type="button" aria-label="Lower inversion" ?disabled=${!canLower}
          @click=${() => this.applyChordStyle(ed, { inversion: inversion - 1 })}>${icons.back}</button>
        <span class="stepper-value" aria-live="polite">${inversionLabel}</span>
        <button type="button" aria-label="Raise inversion" ?disabled=${!canRaise}
          @click=${() => this.applyChordStyle(ed, { inversion: inversion + 1 })}>${icons.back}</button>
      </span>
      <z-select ${ref(this.observeVoicingMenu)} class="voicing" size="sm" aria-label="Voicing" value-prefix="Voicing: "
        placeholder=${`Voicing: ${voicingLabel}`} ?is-disabled=${!scaled} .options=${voicings} .value=${live(voicing)}
        @change=${(event: CustomEvent<{ value: ScaledT.VoicingNameT }>) => this.applyChordStyle(ed, { voicing: event.detail.value })}></z-select>
      <z-tooltip content="Copy shape and pattern to Chords panel" placement="top-end">
        <z-button type="button" size="sm" kind="soft" tone="secondary" is-icon aria-label="Use in Chords panel"
          @click=${() => this.useInPanel(ed)}>${icons.sendToPanel}</z-button>
      </z-tooltip>
      ${this.chordError ? html`<span class="chord-error" role="alert">${this.chordError}</span>` : nothing}`;
  }

  render() {
    const ed = this.ed;
    if (!ed?.chordRegions) return nothing;
    const selected = ed.selectedChordRegions;
    if (!selected.length) return nothing;
    // The bar is always dark, so it reads clearly over the light grid. The pattern
    // picker sits outside it and themes itself dark too.
    return html`<div class="bar" data-theme="dark" role="toolbar" aria-label=${selected.length === 1 ? 'Selected chord' : 'Selected chords'}>
      ${this.renderChordSettings(ed)}
    </div>
    ${this.renderPicker(ed)}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'maddie-chord-bar': MaddieChordBar;
  }
}
