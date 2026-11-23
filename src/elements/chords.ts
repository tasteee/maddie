import { css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import type { ScaledT } from '@tasteee/scaled/types';
import {
  analyzeChords, analyzeSelection, CHORD_FAMILIES, CHORD_TYPES, CHORD_VOICINGS, chordsInKey,
  formatBBT, loadScaled, pitchClassName, romanNumeral, scaledKey, snapTick,
  type Chord, type ChordDraft, type Editor, type Key,
} from '../core';
import type { ChordDrag, Engine } from '../engine/engine';
import { MaddieElement } from './base';
import { chordSelect, performanceCategories, performanceOptions } from './chord-controls';
import { partStyles } from './controls';
import { icons } from './icons';
import { tokens } from './tokens';
import { confirmPlainChordPlacement } from './zest';
import '@tasteee/zest/z-collapsible';

const TABS = [
  { id: 'browse', label: 'Browse' },
  { id: 'suggestions', label: 'Suggestions' },
  { id: 'song', label: 'In this song' },
] as const;

type SongChord = { chord: Chord; start: number };
type SongTrack = { id: string; name: string; chords: SongChord[] };

function toSymbol(symbol: string) {
  return symbol.replace(/♯/g, '#').replace(/♭/g, 'b').replace(/°/g, 'dim').replace(/ø7/g, 'm7b5');
}

@customElement('maddie-chords')
export class MaddieChords extends MaddieElement {
  static styles = [
    tokens, partStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        container-type: inline-size;
        width: var(--_chords-size, var(--maddie-chords-width, 420px));
        box-sizing: border-box;
        min-height: 0;
        background: var(--_surface);
        border-left: 1px solid var(--_border);
        color: var(--_text);
        font-size: var(--font-size-sm);
      }
      :host(:not([open])) { display: none; }
      header { padding: var(--space-2) var(--space-3); }
      .heading, .track-heading {
        display: flex;
        align-items: center;
        gap: var(--space-2);
      }
      .heading h2 { margin: 0; font-size: var(--font-size-lg); font-weight: 650; }
      .spacer { flex: 1; }
      .hint { color: var(--_text-muted); margin: var(--space-1) 0 0; line-height: 1.45; }
      .tabs {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        padding: 0 var(--space-3);
        border-bottom: 1px solid var(--_border);
      }
      .tab {
        appearance: none;
        border: 0;
        background: transparent;
        border-bottom: 2px solid transparent;
        color: var(--_text-muted);
        font: inherit;
        font-weight: 600;
        padding: var(--space-2) var(--space-1);
        cursor: pointer;
        white-space: nowrap;
      }
      .tab:hover { color: var(--_text); }
      .tab[aria-current='true'] { color: var(--_text); border-bottom-color: var(--accent-secondary, var(--_focus)); }
      .setup {
        background: var(--_bg);
        border-bottom: 1px solid var(--_border);
      }
      .setup summary {
        padding: var(--space-2) var(--space-3);
        color: var(--_text);
        font-weight: 600;
        cursor: pointer;
      }
      .setup summary:focus-visible { outline: 2px solid var(--_focus); outline-offset: -2px; }
      .setup-fields { display: grid; gap: var(--space-2); padding: 0 var(--space-3) var(--space-3); }
      .placement, .pattern-fields { display: grid; gap: var(--space-2); min-width: 0; }
      .placement { grid-template-columns: .8fr .95fr 1.25fr; }
      .pattern-fields { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); }
      .chord-field { display: grid; gap: var(--space-1); min-width: 0; color: var(--_text-muted); font-size: var(--font-size-xs); }
      .chord-field z-select { display: block; width: 100%; min-width: 0; }
      .list {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: var(--space-2) var(--space-3) var(--space-3);
      }
      .browse-tools { padding-bottom: var(--space-2); }
      .browse-tools z-input { display: block; }
      .families { display: flex; flex-wrap: wrap; gap: var(--space-1); margin-top: var(--space-2); }
      .root { display: flex; align-items: center; gap: var(--space-2); width: 100%; }
      .degree, .position { font: 600 var(--font-size-xs) var(--_font-mono); color: var(--_text-muted); }
      .count { margin-left: auto; font-size: var(--font-size-xs); color: var(--_text-faint); }
      .cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-1); padding: var(--space-1) 0 var(--space-2); }
      @container (max-width: 260px) {
        .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .placement { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .placement > :last-child { grid-column: 1 / -1; }
        .pattern-fields { grid-template-columns: minmax(0, 1fr); }
      }
      .chord-card {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        justify-content: center;
        gap: var(--space-1);
        min-width: 0;
        border: 1px solid var(--_border);
        border-radius: var(--_radius);
        background: var(--_surface);
        color: var(--_text);
        font: inherit;
        text-align: left;
        padding: var(--space-2);
        user-select: none;
        touch-action: none;
        cursor: grab;
        transition: border-color var(--_motion-fast), background-color var(--_motion-fast);
      }
      .chord-card:hover { background: var(--_hover); border-color: var(--_focus); }
      .chord-card[aria-pressed='true'] { border-color: var(--accent-secondary, var(--_focus)); background: var(--_raised); }
      .chord-card:active { cursor: grabbing; }
      .chord-card:disabled { opacity: var(--control-disabled-opacity); cursor: wait; }
      .chord-card strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-size-sm); font-weight: 650; }
      .chord-card small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--_text-muted); font-size: var(--font-size-xs); }
      button:focus-visible { outline: 2px solid var(--_focus); outline-offset: 2px; }
      .song-track + .song-track { margin-top: var(--space-3); }
      .track-heading { margin: 0 0 var(--space-1); font-size: var(--font-size-sm); }
      .song-cards { display: grid; gap: var(--space-1); }
      .song-cards .chord-card { flex-direction: row; align-items: center; justify-content: flex-start; gap: var(--space-3); }
      .song-cards .position { flex: 0 0 4.5em; }
      .song-cards .degree { margin-left: auto; }
      .audition-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
        border-top: 1px solid var(--_border);
      }
      .audition-bar strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ghost {
        position: fixed;
        z-index: 1000;
        top: 0;
        left: 0;
        padding: var(--space-1) var(--space-2);
        border: 1px solid var(--_border);
        border-radius: var(--_radius);
        background: var(--_raised);
        color: var(--_text);
        box-shadow: var(--shadow-overlay);
        font-size: var(--font-size-sm);
        font-weight: 650;
        white-space: nowrap;
        pointer-events: none;
      }
      .ghost[hidden] { display: none; }
    `,
  ];

  @state() private song: SongTrack[] = [];
  @state() private scaled?: ScaledT;
  @state() private loadError = '';
  @state() private auditioned?: { id: string; chord: Chord; duration: number };
  @state() private suggestionSource = '';
  private catalog?: { key: Key | null; scaled?: ScaledT; groups: ReturnType<typeof chordsInKey> };
  private analysisTimer?: ReturnType<typeof setTimeout>;
  private loading = false;
  private cancelDrag?: () => void;
  private stopKeyAudition?: () => void;

  protected attach(ed: Editor, _engine: Engine) {
    const refresh = () => {
      this.toggleAttribute('open', ed.view.chordsPanel);
      if (ed.view.chordsPanel) {
        this.ensureScaled();
        if (ed.view.chordsTab === 'song') this.analyzeSong();
      }
      this.requestUpdate();
    };
    refresh();
    this.track(
      ed.on('view', ({ view, prev }) => {
        if (view.chordsPanel !== prev.chordsPanel || view.chordsTab !== prev.chordsTab) {
          this.cancelDrag?.();
          this.releaseKeyAudition();
          refresh();
        }
        if (view.chordFamily !== prev.chordFamily || view.chordQuery !== prev.chordQuery ||
          view.chordToggledRoots !== prev.chordToggledRoots || view.chordSetupOpen !== prev.chordSetupOpen ||
          view.chordOctave !== prev.chordOctave || view.chordInversion !== prev.chordInversion ||
          view.chordVoicing !== prev.chordVoicing || view.chordCategory !== prev.chordCategory ||
          view.chordTemplateId !== prev.chordTemplateId) this.requestUpdate();
      }),
      ed.on('change', ({ origin }) => {
        if (origin === 'load') {
          this.cancelDrag?.();
          this.releaseKeyAudition();
          this.auditioned = undefined;
          this.suggestionSource = '';
        }
        if (ed.view.chordsPanel && ed.view.chordsTab === 'song') {
          clearTimeout(this.analysisTimer);
          this.analysisTimer = setTimeout(() => this.analyzeSong(), 250);
        }
        this.requestUpdate();
      }),
      ed.on('tracks', () => this.requestUpdate()),
      ed.on('selection', () => this.requestUpdate()),
      () => { clearTimeout(this.analysisTimer); this.cancelDrag?.(); this.releaseKeyAudition(); },
    );
  }

  private ensureScaled() {
    if (this.scaled || this.loading || this.loadError) return;
    this.loading = true;
    void loadScaled().then((scaled) => { this.scaled = scaled; }, () => {
      this.loadError = 'Chord tools could not load.';
    }).finally(() => { this.loading = false; });
  }

  private analyzeSong() {
    const ed = this.ed;
    if (!ed) return;
    this.song = ed.doc.tracks.flatMap((track, index) => {
      const chords = track.chordRegions?.map((region) => ({
        start: region.start,
        chord: this.catalogChord({ symbol: region.symbol, rootPitch: region.root, chordType: region.symbol,
          intervals: region.intervals, midiNotes: region.pitches }, ed.key),
      })) ?? analyzeChords(track.notes, { key: ed.key, minDuration: ed.ppq / 2 }).map(({ chord, start }) => ({
        start, chord: { root: chord.root, degree: chord.degree, name: pitchClassName(chord.root) + chord.type.symbol, type: chord.type },
      }));
      return chords.length ? [{ id: track.id, name: track.name ?? 'Track ' + (index + 1), chords }] : [];
    });
  }

  private makeDraft(chord: Chord): ChordDraft {
    const ed = this.ed!;
    const { chordOctave: octave, chordInversion: inversion, chordVoicing: voicing, chordTemplateId: templateId } = ed.view;
    return ed.chordTrack.draft({ symbol: chord.name, root: chord.root, intervals: chord.type.intervals },
      { octave, inversion, voicing, templateId });
  }

  private selectDraft(id: string, chord: Chord): ChordDraft | undefined {
    if (!this.ed) return;
    try {
      const draft = this.makeDraft(chord);
      this.auditioned = { id, chord, duration: draft.region.duration };
      return draft;
    } catch (error) {
      this.engine?.toast((error as Error).message, 'error');
    }
  }

  private placementChanged(previewPitches = true) {
    if (!this.auditioned) return;
    const draft = this.selectDraft(this.auditioned.id, this.auditioned.chord);
    if (draft && previewPitches) this.ed?.chordTrack.auditionPitches([draft.region]);
  }

  private releaseKeyAudition = () => {
    this.stopKeyAudition?.();
    this.stopKeyAudition = undefined;
  };

  private auditionKeyDown(event: KeyboardEvent, id: string, chord: Chord) {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || this.cancelDrag) return;
    this.releaseKeyAudition();
    const draft = this.selectDraft(id, chord);
    if (draft) this.stopKeyAudition = this.ed?.chordTrack.auditionDraft(draft, true);
  }

  private async placeAtCursor() {
    const ed = this.ed;
    if (!ed || !this.auditioned) return;
    const draft = this.selectDraft(this.auditioned.id, this.auditioned.chord);
    if (!draft) return;
    const shouldConfirm = !ed.chordRegions;
    const isConfirmed = shouldConfirm ? await confirmPlainChordPlacement(this) : true;
    if (!isConfirmed) return;
    const at = ed.view.cursor;
    const start = ed.view.snap ? snapTick(at, ed.commands.gridTicks(at), ed.meta.timeSignature, 'floor') : Math.round(at);
    try {
      if (ed.chordTrack.placeDraft(draft, Math.max(0, start))) ed.chordTrack.auditionPitches([draft.region]);
      else this.engine?.toast('Move the cursor to a free location.');
    } catch (error) {
      this.engine?.toast((error as Error).message, 'error');
    }
  }

  private startDrag(event: PointerEvent, id: string, chord: Chord) {
    const engine = this.engine;
    if (!engine || event.button !== 0 || !event.isPrimary || this.cancelDrag) return;
    this.releaseKeyAudition();
    const draft = this.selectDraft(id, chord);
    if (!draft) return;
    const card = event.currentTarget as HTMLElement;
    const ghost = this.renderRoot.querySelector<HTMLElement>('.ghost')!;
    const drag: ChordDrag = { draft, clientX: event.clientX, clientY: event.clientY, overGrid: false };
    let dragging = false;
    card.setPointerCapture(event.pointerId);
    const stopAudition = this.ed?.chordTrack.auditionDraft(draft, true);
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== event.pointerId) return;
      if (!dragging && Math.hypot(pointer.clientX - event.clientX, pointer.clientY - event.clientY) < 4) return;
      dragging = true;
      drag.clientX = pointer.clientX;
      drag.clientY = pointer.clientY;
      engine.chordDragEvent(drag, 'move');
      ghost.hidden = false;
      ghost.textContent = chord.name;
      ghost.style.transform = `translate(${pointer.clientX + 14}px, ${pointer.clientY + 14}px)`;
      ghost.style.opacity = drag.overGrid ? '0.75' : '1';
    };
    const finish = (pointer?: PointerEvent) => {
      if (pointer && pointer.pointerId !== event.pointerId) return;
      stopAudition?.();
      card.removeEventListener('pointermove', move);
      card.removeEventListener('pointerup', finish);
      card.removeEventListener('pointercancel', cancel);
      card.removeEventListener('lostpointercapture', cancel);
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('blur', cancel);
      if (card.hasPointerCapture(event.pointerId)) card.releasePointerCapture(event.pointerId);
      this.cancelDrag = undefined;
      ghost.hidden = true;
      if (pointer) {
        drag.clientX = pointer.clientX;
        drag.clientY = pointer.clientY;
      }
      if (dragging) engine.chordDragEvent(drag, pointer ? 'drop' : 'cancel');
    };
    const cancel = () => finish();
    const escape = (key: KeyboardEvent) => {
      if (key.key !== 'Escape') return;
      key.preventDefault();
      key.stopPropagation();
      finish();
    };
    this.cancelDrag = cancel;
    card.addEventListener('pointermove', move);
    card.addEventListener('pointerup', finish);
    card.addEventListener('pointercancel', cancel);
    card.addEventListener('lostpointercapture', cancel);
    window.addEventListener('keydown', escape, true);
    window.addEventListener('blur', cancel);
  }

  private renderCard(id: string, chord: Chord, position?: string) {
    return html`<button class="chord-card" type="button" ?disabled=${!this.scaled}
      aria-label=${position ? `${chord.name} at ${position}` : chord.name}
      aria-pressed=${this.auditioned?.id === id}
      title=${chord.type.intervals.map((i) => pitchClassName(chord.root + i)).join(' · ')}
      @pointerdown=${(event: PointerEvent) => this.startDrag(event, id, chord)}
      @click=${(event: MouseEvent) => {
        if (event.detail) return;
        const draft = this.selectDraft(id, chord);
        if (draft) this.ed?.chordTrack.auditionDraft(draft);
      }}
      @keydown=${(event: KeyboardEvent) => this.auditionKeyDown(event, id, chord)}
      @keyup=${(event: KeyboardEvent) => {
        if (event.key === ' ' || event.key === 'Enter') this.releaseKeyAudition();
      }}
      @blur=${this.releaseKeyAudition}>
      ${position ? html`<span class="position">${position}</span>` : nothing}
      <strong>${chord.name}</strong>
      ${position ? html`<span class="degree">${chord.degree}</span>` : html`<small>${chord.type.name}</small>`}
    </button>`;
  }

  private catalogChord(chord: ScaledT.ChordT, key: Key | null): Chord {
    const { intervals } = chord;
    const suffix = chord.symbol.replace(/^[A-G][#b]?/, '');
    const existing = CHORD_TYPES.find((type) => type.intervals.join() === intervals.join());
    const highest = Math.max(...intervals);
    const byRange = highest >= 21 ? 'thirteenth' : highest >= 17 ? 'eleventh' : highest >= 13 ? 'ninth' : 'triad';
    const family = /\bno\s*[35]\b/i.test(suffix) ? 'omit' : /sus/i.test(suffix) ? 'sus' : /add/i.test(suffix) ? 'add' : existing?.family ?? (/7/.test(suffix) && highest < 13 ? 'seventh' : byRange);
    const root = chord.rootPitch;
    return {
      root, name: chord.symbol.replace(/^([A-G][#b]?)min/, '$1m'), degree: key ? romanNumeral(root - key.root, intervals) : '',
      type: { id: chord.chordType, symbol: suffix, name: existing?.name ?? chord.chordType, intervals, family },
    };
  }

  private browseGroups(key: Key | null) {
    if (this.catalog?.key === key && this.catalog.scaled === this.scaled) return this.catalog.groups;
    const groups = chordsInKey(key);
    if (key && key.scale !== 'chromatic' && this.scaled) {
      const byRoot = new Map(groups.map((group) => {
        group.chords = group.chords.filter((chord) => chord.type.family === 'omit');
        return [group.root, group];
      }));
      for (const chord of this.scaled.getScaleChords(scaledKey(key))) byRoot.get(chord.rootPitch)?.chords.push(this.catalogChord(chord, key));
      for (const group of groups) {
        const rank = (chord: Chord) => chord.type.family === 'triad' ? 0 : chord.type.family === 'omit' ? 2 : 1;
        group.chords.sort((a, b) => rank(a) - rank(b) || a.type.intervals.length - b.type.intervals.length);
        const seen = new Set<string>();
        group.chords = group.chords.filter((chord) => {
          const symbol = toSymbol(chord.name);
          if (seen.has(symbol)) return false;
          seen.add(symbol);
          return true;
        });
      }
    }
    this.catalog = { key, scaled: this.scaled, groups };
    return groups;
  }

  private renderSetup(ed: Editor) {
    const scaled = this.scaled;
    if (!scaled) return nothing;
    const categories = performanceCategories(scaled);
    const { chordCategory, chordSetupOpen, chordOctave, chordInversion, chordVoicing, chordTemplateId } = ed.view;
    const category = chordCategory || categories[0]?.value || '';
    return html`<details class="setup" .open=${live(chordSetupOpen)}
      @toggle=${(event: Event) => ed.setView({ chordSetupOpen: (event.currentTarget as HTMLDetailsElement).open })}>
      <summary @keydown=${(event: KeyboardEvent) => { if (event.key === ' ') event.stopPropagation(); }}>Placement settings</summary>
      <div class="setup-fields">
        <div class="placement">
          ${chordSelect('Octave', String(chordOctave), [1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) })),
            (value) => { ed.setView({ chordOctave: Number(value) }); this.placementChanged(); })}
          ${chordSelect('Inversion', String(chordInversion), ['Root', '1st', '2nd', '3rd'].map((label, i) => ({ value: String(i), label })),
            (value) => { ed.setView({ chordInversion: Number(value) }); this.placementChanged(); })}
          ${chordSelect('Voicing', chordVoicing, scaled.voicingNames.map((value) => ({ value, label: CHORD_VOICINGS[value] })),
            (value) => { ed.setView({ chordVoicing: value as ScaledT.VoicingNameT }); this.placementChanged(); })}
        </div>
        <div class="pattern-fields">
          ${chordSelect('Performance category', category, categories, (value) => {
            ed.setView({ chordCategory: value, chordTemplateId: '' }); this.placementChanged(false);
          })}
          ${chordSelect('Performance', chordTemplateId, [{ value: '', label: 'Sustained chord' }, ...performanceOptions(scaled, category)],
            (value) => { ed.setView({ chordTemplateId: value }); this.placementChanged(false); })}
        </div>
      </div>
    </details>`;
  }

  private renderBrowse(ed: Editor) {
    const { chordFamily, chordQuery, chordToggledRoots } = ed.view;
    const q = toSymbol(chordQuery.trim()).toLowerCase();
    const groups = this.browseGroups(ed.key).map((group) => ({
      ...group, chords: group.chords.filter((c) => (chordFamily === 'all' || c.type.family === chordFamily) &&
        (!q || toSymbol(c.name).toLowerCase().includes(q) || c.type.name.toLowerCase().includes(q))),
    })).filter((group) => group.chords.length);
    return html`<div class="browse-tools">
      <z-input size="sm" type="search" label="Search chords" placeholder="Search chords"
        .value=${live(chordQuery)} @input=${(e: CustomEvent<{ value: string }>) => ed.setView({ chordQuery: e.detail.value })}></z-input>
      <div class="families" aria-label="Chord family">
        ${[{ id: 'all' as const, label: 'All' }, ...CHORD_FAMILIES].map((family) => html`<z-badge is-selectable size="sm"
          kind=${chordFamily === family.id ? 'solid' : 'soft'}
          tone=${chordFamily === family.id ? 'secondary' : nothing}
          .isSelected=${live(chordFamily === family.id)}
          @select=${() => ed.setView({ chordFamily: family.id })}>${family.label}</z-badge>`)}
      </div>
    </div>
    ${groups.length ? groups.map(({ root, degree, chords }) => {
      const defaultOpen = !!ed.key || !!q;
      const open = chordToggledRoots.includes(root) ? !defaultOpen : defaultOpen;
      return html`<z-collapsible .isOpen=${live(open)} @toggle=${(e: CustomEvent<{ open: boolean }>) => {
        const roots = ed.view.chordToggledRoots;
        const toggled = e.detail.open !== defaultOpen;
        if (toggled !== roots.includes(root)) {
          ed.setView({ chordToggledRoots: toggled ? [...roots, root] : roots.filter((pitch) => pitch !== root) });
        }
      }}>
        <span slot="trigger" class="root">
          <strong>${pitchClassName(root)}</strong><span class="degree">${degree}</span>
          <span class="count">${chords.length}</span>
        </span>
        <div class="cards">${chords.map((chord, i) => this.renderCard('browse-' + root + '-' + i + '-' + chord.name, chord))}</div>
      </z-collapsible>`;
    }) : html`<p class="hint">No chords match.</p>`}`;
  }

  private renderSuggestions(ed: Editor) {
    const scaled = this.scaled;
    if (!scaled) return nothing;
    const selected = ed.selectedChordRegions;
    const focused = selected.find((region) => region.id === this.suggestionSource) ?? selected.at(-1);
    const detected = ed.chordRegions ? undefined : analyzeSelection(ed.selectedNotes, { key: ed.key, minDuration: ed.ppq / 2 }).at(-1);
    const source = focused?.symbol ?? detected?.chord.name.split('/')[0] ?? this.auditioned?.chord.name;
    if (!source) return html`<p class="hint">Audition a chord or select one in the roll to find what could follow it.</p>`;
    const options = scaledKey(ed.key, focused?.root ?? detected?.chord.root ?? this.auditioned?.chord.root);
    let chords: Chord[] = [];
    try {
      const inScaleOnly = !!ed.key && ed.key.scale !== 'chromatic';
      const seen = new Set<string>();
      chords = scaled.getSuggestions({ chord: toSymbol(source), key: options.key, ...(inScaleOnly ? { scale: options.scale, inScaleOnly } : {}) })
        .flatMap(({ symbol }) => {
          if (!symbol || seen.has(symbol)) return [];
          seen.add(symbol);
          try { return [this.catalogChord(scaled.getChord({ chord: symbol }), ed.key)]; }
          catch { return []; }
        }).slice(0, 30);
    } catch {
      // Chords with omitted tones may have no corpus entry.
    }
    return html`<div class="browse-tools">
      ${selected.length > 1 ? chordSelect('After', focused!.id, selected.map(({ id, symbol, start }) => ({
        value: id, label: symbol + ' · ' + formatBBT(start, ed.meta.timeSignature, ed.ppq),
      })), (value) => { this.suggestionSource = value; }) : html`<strong>After ${source}</strong>`}
    </div>
    ${chords.length ? html`<div class="cards">${chords.map((chord) => this.renderCard('suggest-' + chord.name, chord))}</div>` :
      html`<p class="hint">No suggestions for this chord in the current key.</p>`}`;
  }

  private renderSong(ed: Editor) {
    if (!this.song.length) return html`<p class="hint">No chords found in this song yet.</p>`;
    return this.song.map((track) => html`<section class="song-track">
      <h3 class="track-heading">${track.name}</h3>
      <div class="song-cards">${track.chords.map(({ chord, start }, i) =>
        this.renderCard('song-' + track.id + '-' + i, chord, formatBBT(start, ed.meta.timeSignature, ed.ppq)))}</div>
    </section>`);
  }

  render() {
    const ed = this.ed;
    if (!ed?.view.chordsPanel) return nothing;
    const { chordsTab } = ed.view;
    const beats = this.auditioned ? Number((this.auditioned.duration / ed.ppq).toFixed(2)) : 0;
    return html`
      <header>
        <div class="heading">
          <h2>Chords</h2>
          <span class="spacer"></span>
          <z-button class="icon" kind="ghost" size="sm" aria-label="Close chords" @click=${() => ed.setView({ chordsPanel: false })}>${icons.close}</z-button>
        </div>
      </header>
      <nav class="tabs" aria-label="Chord discovery">
        ${TABS.map(({ id, label }) => html`<button type="button" class="tab" aria-current=${id === chordsTab}
          @click=${() => ed.setView({ chordsTab: id })}>${label}</button>`)}
      </nav>
      ${this.renderSetup(ed)}
      <div class="list" part="list">
        ${!this.scaled ? html`<div role="status">${this.loadError || 'Loading chord tools…'}
          ${this.loadError ? html`<z-button size="sm" @click=${() => { this.loadError = ''; this.ensureScaled(); }}>Retry</z-button>` : nothing}</div>` :
        chordsTab === 'suggestions' ? this.renderSuggestions(ed) : chordsTab === 'song' ? this.renderSong(ed) : this.renderBrowse(ed)}
      </div>
      ${this.auditioned ? html`<footer class="audition-bar">
        <strong>${this.auditioned.chord.name}</strong>
        <span class="position">${beats} ${beats === 1 ? 'beat' : 'beats'}</span>
        <z-button size="sm" tone="primary" @click=${() => this.placeAtCursor()}>Place at cursor</z-button>
      </footer>` : nothing}
      <div class="ghost" hidden aria-hidden="true"></div>
    `;
  }
}

/**
 * A manila-folder tab on the right edge of the editor. Click it to slide the chords panel out.
 * Sits inside a positioned parent (the editor grid). It rides the panel's left edge while open.
 */
@customElement('maddie-chords-tab')
export class MaddieChordsTab extends MaddieElement {
  static styles = [
    tokens,
    css`
      :host {
        position: absolute;
        top: 50%;
        right: 0;
        z-index: 3;
        transform: translateY(-50%);
        transition: right var(--_motion-medium) var(--_ease);
      }
      :host([open]) {
        right: var(--_chords-size, var(--maddie-chords-width, 420px));
      }
      button {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-1);
        margin: 0;
        padding: var(--space-3) var(--space-1);
        font: inherit;
        font-size: var(--font-size-xs);
        font-weight: 600;
        letter-spacing: 0.04em;
        color: var(--_text-muted);
        background-color: var(--_bg);
        border: 1px solid var(--_border);
        border-right: none;
        border-radius: var(--_radius) 0 0 var(--_radius);
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
        translate: 0 0;
        transition:
          translate var(--_motion-fast) var(--_ease),
          color var(--_motion-fast) var(--_ease);
      }
      button:hover,
      button:focus-visible {
        color: var(--_text);
      }
      button:focus-visible {
        outline: 2px solid var(--_focus);
        outline-offset: 2px;
      }
      :host([open]) button {
        translate: 1px 0;
        color: var(--_accent);
        background-color: var(--_surface);
        /* Covers the panel's left border so the tab and panel read as one piece. */
        border-right: none;
      }
      .label {
        writing-mode: vertical-rl;
        transform: rotate(180deg);
      }
      svg {
        width: 16px;
        height: 16px;
        transform: rotate(90deg);
      }
    `,
  ];

  protected attach(editor: Editor, _engine: Engine) {
    const update = () => {
      this.toggleAttribute('open', editor.view.chordsPanel);
      this.requestUpdate();
    };
    update();
    this.track(editor.on('view', update));
  }

  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const open = ed.view.chordsPanel;
    return html`<button
      type="button"
      aria-label="Chords"
      aria-expanded=${open ? 'true' : 'false'}
      title="Chords that fit the key   H"
      @click=${() => ed.setView({ chordsPanel: !open })}
    >
      ${icons.chords}<span class="label">Chords</span>
    </button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'maddie-chords': MaddieChords;
    'maddie-chords-tab': MaddieChordsTab;
  }
}
