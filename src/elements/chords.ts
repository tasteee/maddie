import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import type { ScaledT } from '@tasteee/scaled/types';
import {
  analyzeChords, analyzeSelection, CHORD_FAMILIES, CHORD_TYPES, CHORD_VOICINGS, chordsInKey,
  formatBBT, loadScaled, pitchClassName, scaledKey, snapTick,
  type Chord, type ChordDraft, type DetectedChordT, type Editor, type Key, type NoteId,
} from '../core';
import type { ChordDrag, Engine } from '../engine/engine';
import { MaddieElement } from './base';
import { partStyles } from './controls';
import { icons } from './icons';
import { formatPatternCategory, patternRhythm } from './pattern-picker';
import { themeRegion, tokens } from './tokens';
import { confirmPlainChordPlacement } from './zest';
import './pattern-picker';

type ProjectChordT = {
  key: string;
  trackId: string;
  trackName: string;
  trackColor: string;
  start: number;
  position: string;
  chord: Chord;
  regionId?: string;
  noteIds: readonly NoteId[];
};

type AnchorT = {
  eyebrow: string;
  name: string;
  hint: string;
  symbol: string;
  root: number;
};

type SuggestionsT = { inKey: Chord[]; borrowed: Chord[] };

const OCTAVES = [1, 2, 3, 4, 5, 6];
const INVERSIONS = ['Root', '1st', '2nd', '3rd'];
const RAIL_OPEN = 148;
const STRIP = 40;

const toSymbol = (symbol: string) => symbol.replace(/♯/g, '#').replace(/♭/g, 'b').replace(/°/g, 'dim').replace(/ø7/g, 'm7b5');

const noteNames = (chord: Chord) => chord.type.intervals.map((interval) => pitchClassName(chord.root + interval)).join(' ');

/**
 * The chords panel: a Suggestions rail docked on the grid side, then the library and the
 * crafting card. Both parts fold to 40px strips, so the panel never needs a button elsewhere.
 * The panel only makes new chords. A placed chord is changed in the floating chord bar.
 */
@customElement('maddie-chords')
export class MaddieChords extends MaddieElement {
  static styles = [
    tokens, partStyles, ...themeRegion,
    css`
      :host {
        position: relative;
        display: flex;
        flex-direction: row;
        box-sizing: border-box;
        min-height: 0;
        border-left: 1px solid var(--_border);
        color: var(--_text);
        font-size: var(--font-size-sm);
      }
      button { font: inherit; }
      button:focus-visible { outline: 2px solid var(--_focus); outline-offset: 1px; }

      /* Strips and headers */
      .fold {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
        width: 26px;
        height: 26px;
        padding: 0;
        border: 0;
        border-radius: var(--radius-md);
        background: transparent;
        color: var(--_text-muted);
        cursor: pointer;
      }
      .fold:hover { background: var(--_surface-2); color: var(--_text); }
      .fold svg { width: 14px; height: 14px; }
      .vertical { writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; }
      .strip {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-2);
        flex: none;
        width: ${STRIP}px;
        padding: var(--space-2) 0;
        box-sizing: border-box;
        background: var(--_surface);
      }
      .strip-title { font-weight: 600; }
      .strip-sub { color: var(--_text-faint); font-size: var(--font-size-xs); }
      .count-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 20px;
        height: 18px;
        padding: 0 5px;
        box-sizing: border-box;
        border-radius: 999px;
        background: color-mix(in oklch, var(--accent-secondary) 14%, transparent);
        color: var(--accent-secondary);
        font-size: var(--font-size-2xs);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }

      /* Suggestions rail */
      .rail {
        display: flex;
        flex-direction: column;
        flex: none;
        width: ${RAIL_OPEN}px;
        min-height: 0;
        border-right: 1px solid var(--_border);
        background: var(--_surface);
        color: var(--_text);
      }
      .rail.isFolded { width: ${STRIP}px; }
      .rail-head { display: flex; align-items: center; gap: var(--space-1); height: 48px; flex: none; padding: 0 var(--space-2) 0 6px; box-sizing: border-box; border-bottom: 1px solid var(--_border); }
      .rail-title { flex: 1; font-weight: 600; white-space: nowrap; }
      .rail.isFolded .rail-head { flex-direction: column; height: auto; gap: var(--space-2); padding: var(--space-2) 0; border-bottom: 0; }
      .anchor-wrap { padding: var(--space-2) var(--space-2) var(--space-1); }
      .anchor { display: flex; flex-direction: column; gap: 1px; padding: 6px var(--space-2); border: 1px solid var(--_border); border-radius: var(--radius-md); background: var(--_bg); }
      .anchor-eyebrow { color: var(--_text-faint); font-size: var(--font-size-2xs); font-weight: 500; }
      .anchor-name { font-weight: 600; }
      .anchor-hint { color: var(--_text-faint); font-size: var(--font-size-xs); }
      .rail-list { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 var(--space-2) var(--space-3); }
      .rail-list .tile { margin-bottom: var(--space-1); }
      .rail-group { padding: var(--space-3) 2px 6px; color: var(--_text-muted); font-size: var(--font-size-xs); font-weight: 600; }
      .rail-group.isBorrowed { color: var(--accent-tertiary); }
      .rail-group span { color: var(--_text-faint); font-weight: 400; }
      .empty { padding: var(--space-4) var(--space-3); color: var(--_text-faint); line-height: 1.5; }

      /* Main column */
      .main { display: flex; flex-direction: column; flex: none; width: var(--maddie-chords-width, 352px); min-width: 0; background: var(--_bg); color: var(--_text); }
      .main-head { display: flex; align-items: center; gap: var(--space-1); height: 48px; flex: none; padding: 0 var(--space-3) 0 6px; box-sizing: border-box; border-bottom: 1px solid var(--_border); }
      .main-title { font-weight: 600; }
      .key-pill { display: inline-flex; align-items: center; height: 22px; margin-left: var(--space-1); padding: 0 var(--space-2); border-radius: 999px; background: var(--_surface-2); color: var(--_text-muted); font-size: var(--font-size-xs); font-weight: 600; }
      .tabs { display: flex; gap: 2px; margin: var(--space-3) var(--space-3) 0; padding: 2px; border: 1px solid var(--_border); border-radius: var(--radius-md); background: var(--_surface); }
      .tab { flex: 1; height: 26px; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--_text-muted); font-weight: 500; cursor: pointer; }
      .tab:hover { color: var(--_text); }
      .tab[aria-selected='true'] { background: var(--_bg); border-color: var(--border-strong); color: var(--_text); }
      .tab-count { margin-left: var(--space-1); color: var(--_text-faint); font-variant-numeric: tabular-nums; }
      .search { display: block; margin: var(--space-3) var(--space-3) 0; }
      .chips { display: flex; gap: var(--space-1); margin-top: var(--space-3); padding: 0 var(--space-3) var(--space-3); overflow-x: auto; scrollbar-width: none; border-bottom: 1px solid var(--_border); }
      .chip { flex: none; height: 24px; padding: 0 9px; border: 1px solid var(--_border); border-radius: 999px; background: var(--_bg); color: var(--_text-muted); font-size: var(--font-size-xs); font-weight: 500; cursor: pointer; }
      .chip:hover { border-color: var(--border-strong); color: var(--_text); }
      .chip[aria-checked='true'] { border-color: transparent; background: color-mix(in oklch, var(--accent-secondary) 12%, transparent); color: var(--accent-secondary); font-weight: 600; }
      .list { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 var(--space-3) var(--space-3); }
      .group-head { position: sticky; top: 0; z-index: 1; display: flex; align-items: baseline; justify-content: space-between; padding: var(--space-4) 2px var(--space-2); background: var(--_bg); }
      .group-name { font-weight: 600; }
      .group-count { color: var(--_text-faint); font-size: var(--font-size-xs); font-variant-numeric: tabular-nums; }
      .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 6px; }

      /* Tiles */
      .tile {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 1px;
        width: 100%;
        min-height: 46px;
        padding: 6px var(--space-3);
        box-sizing: border-box;
        border: 1px solid var(--_border);
        border-radius: var(--radius-md);
        background: var(--_bg);
        color: var(--_text);
        text-align: left;
        cursor: grab;
        user-select: none;
        touch-action: none;
      }
      .tile:hover { border-color: var(--border-strong); background: var(--_surface); }
      .tile:active { cursor: grabbing; }
      .tile[aria-pressed='true'] { border-color: var(--accent-secondary); background: color-mix(in oklch, var(--accent-secondary) 12%, transparent); }
      .tile.isPlaying { border-color: var(--accent-secondary); background: color-mix(in oklch, var(--accent-secondary) 20%, transparent); }
      .tile:disabled { opacity: var(--control-disabled-opacity); cursor: wait; }
      .tile-name { font-weight: 600; }
      .tile-kind { max-width: 100%; overflow: hidden; color: var(--_text-faint); font-size: var(--font-size-xs); text-overflow: ellipsis; white-space: nowrap; }
      /* Borrowed: rose (tertiary) means "outside the key" and nothing else. */
      .tile.isBorrowed { border: 1px dashed color-mix(in oklch, var(--accent-tertiary) 55%, transparent); background: color-mix(in oklch, var(--accent-tertiary) 6%, transparent); }
      .tile.isBorrowed:hover { background: color-mix(in oklch, var(--accent-tertiary) 11%, transparent); }
      .tile.isBorrowed .tile-kind { color: var(--accent-tertiary); }
      .tile.isBorrowed[aria-pressed='true'], .tile.isBorrowed.isPlaying { border-style: solid; border-color: var(--accent-tertiary); background: color-mix(in oklch, var(--accent-tertiary) 16%, transparent); }
      .borrowed-mark { position: absolute; top: 7px; right: 8px; display: flex; color: var(--accent-tertiary); }
      .wave { position: absolute; top: 8px; right: 8px; display: flex; align-items: flex-end; gap: 2px; height: 10px; }
      .wave span { width: 2px; border-radius: 1px; background: var(--accent-secondary); animation: wave 0.6s ease-in-out infinite alternate; }
      .wave span:nth-child(2) { animation-delay: 0.15s; }
      .wave span:nth-child(3) { animation-delay: 0.3s; }
      @keyframes wave { from { height: 3px; } to { height: 10px; } }
      .project-row { display: grid; grid-template-columns: 56px minmax(0, 1fr) auto; align-items: center; gap: var(--space-2); width: 100%; height: 36px; margin-bottom: var(--space-1); padding: 0 var(--space-3); box-sizing: border-box; border: 1px solid var(--_border); border-radius: var(--radius-md); background: var(--_bg); color: var(--_text); text-align: left; cursor: pointer; }
      .project-row:hover { border-color: var(--border-strong); background: var(--_surface); }
      .project-row[aria-current='true'] { border-color: var(--accent-secondary); background: color-mix(in oklch, var(--accent-secondary) 12%, transparent); }
      .project-row.isPlaying { border-color: var(--accent-secondary); background: color-mix(in oklch, var(--accent-secondary) 20%, transparent); }
      .project-pos { color: var(--_text-faint); font: var(--font-size-xs) var(--_font-mono); }
      .project-name { font-weight: 600; }
      .project-track { display: flex; align-items: center; gap: 6px; color: var(--_text-muted); font-size: var(--font-size-xs); }
      .project-dot { width: 6px; height: 6px; border-radius: 50%; }
      .hint { margin: var(--space-3) 2px var(--space-2); color: var(--_text-muted); line-height: 1.45; }

      /* Crafting area: inverted region, one card */
      .craft { flex: none; padding: var(--space-3); border-top: 1px solid var(--_border); background: var(--_surface); color: var(--_text); }
      .card { display: flex; flex-direction: column; border: 1px solid var(--accent-secondary); border-radius: var(--radius-lg); background: var(--_bg); overflow: hidden; }
      .card.isEmpty { border-style: dashed; border-color: var(--border-strong); background: transparent; }
      .hero {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--space-3);
        width: 100%;
        height: 64px;
        padding: 0 var(--space-3);
        box-sizing: border-box;
        border: 0;
        background: transparent;
        color: var(--_text);
        text-align: left;
        cursor: grab;
        user-select: none;
        touch-action: none;
      }
      .hero:hover { background: color-mix(in oklab, var(--accent-secondary) 6%, var(--_bg)); }
      .hero.isPlaying { background: color-mix(in oklab, var(--accent-secondary) 16%, var(--_bg)); }
      .hero-title { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
      .hero-name { font-size: var(--font-size-xl); font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; }
      .hero-kind { color: var(--_text-muted); font-size: var(--font-size-xs); font-weight: 500; }
      .hero-side { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
      .hero-notes { color: var(--_text-faint); font: var(--font-size-xs) var(--_font-mono); white-space: nowrap; }
      .hero-hint { display: flex; align-items: center; gap: 5px; color: var(--_text-faint); font-size: var(--font-size-2xs); }
      .hero-hint .wave { position: static; }
      .hero-empty { padding: var(--space-4) var(--space-3); color: var(--_text-faint); }
      .props { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--_border); }
      .prop { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: var(--space-2) 6px var(--space-2) var(--space-3); border-left: 1px solid var(--_border); }
      .prop:first-child { border-left: 0; }
      .prop-label { color: var(--_text-faint); font-size: var(--font-size-2xs); font-weight: 500; }
      .stepper { display: grid; grid-template-columns: 20px minmax(0, 1fr) 20px; align-items: center; height: 24px; margin-left: -6px; }
      .stepper button { display: inline-flex; align-items: center; justify-content: center; height: 100%; padding: 0; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--_text-muted); cursor: pointer; }
      .stepper button:hover { background: var(--_surface-2); color: var(--_text); }
      .stepper button:disabled { color: var(--_text-faint); opacity: 0.5; background: transparent; cursor: default; }
      .stepper svg { width: 12px; height: 12px; }
      .stepper-value { font-weight: 500; font-variant-numeric: tabular-nums; text-align: center; white-space: nowrap; }
      .voicing { width: 100%; height: 24px; padding: 0 18px 0 0; border: 0; background: transparent; color: var(--_text); font: inherit; font-weight: 500; cursor: pointer; }
      .voicing:focus-visible { outline: 2px solid var(--_focus); outline-offset: 1px; }
      .pattern-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; border-top: 1px solid var(--_border); background: var(--_surface); }
      .pattern-button { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: var(--space-3); min-width: 0; height: 44px; padding: 0 var(--space-2) 0 var(--space-3); border: 0; background: transparent; color: var(--_text); text-align: left; cursor: pointer; }
      .pattern-button:hover, .pattern-button[aria-expanded='true'] { background: var(--_surface-2); }
      .pattern-copy { display: flex; flex-direction: column; min-width: 0; }
      .pattern-label { color: var(--_text-faint); font-size: var(--font-size-2xs); font-weight: 500; }
      .pattern-name { overflow: hidden; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
      .pattern-name.isEmpty { color: var(--_text-faint); font-weight: 400; }
      .pattern-category { color: var(--_text-faint); font-weight: 400; }
      .rhythm { display: grid; grid-template-columns: repeat(16, 4px); gap: 2px; }
      .step { height: 12px; border-radius: 1px; background: color-mix(in oklch, var(--_text) 10%, transparent); }
      .step.isHit { background: var(--accent-secondary); }
      .chevron { display: flex; color: var(--_text-faint); }
      .clear { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; margin-right: var(--space-1); padding: 0; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--_text-faint); cursor: pointer; }
      .clear:hover { background: var(--_surface-2); color: var(--_text); }
      .clear svg { width: 12px; height: 12px; }

      .ghost {
        position: fixed;
        z-index: 1000;
        top: 0;
        left: 0;
        padding: var(--space-1) var(--space-2);
        border: 1px solid var(--_border);
        border-radius: var(--radius-md);
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

  @state() private projectChords: ProjectChordT[] = [];
  @state() private scaled?: ScaledT;
  @state() private loadError = '';
  /** The chord in the crafting card. Clicking any tile puts it here. */
  @state() private crafting?: { id: string; chord: Chord };
  @state() private playingId = '';
  @state() private pickerPosition = { left: 0, top: 0 };
  private catalog?: { key: Key | null; scaled?: ScaledT; groups: ReturnType<typeof chordsInKey> };
  private analysisTimer?: ReturnType<typeof setTimeout>;
  private loading = false;
  private cancelDrag?: () => void;

  protected attach(ed: Editor, _engine: Engine) {
    this.ensureScaled();
    this.analyzeProject();
    this.track(
      ed.on('view', ({ view, prev }) => {
        const isClosing = !view.chordsPanel && prev.chordsPanel;
        if (isClosing) this.cancelDrag?.();
        this.requestUpdate();
      }),
      ed.on('change', ({ origin }) => {
        const isLoad = origin === 'load';
        if (isLoad) {
          this.cancelDrag?.();
          this.crafting = undefined;
        }
        clearTimeout(this.analysisTimer);
        this.analysisTimer = setTimeout(() => this.analyzeProject(), 250);
        this.requestUpdate();
      }),
      ed.on('tracks', () => this.requestUpdate()),
      ed.on('selection', () => this.requestUpdate()),
      () => {
        clearTimeout(this.analysisTimer);
        this.cancelDrag?.();
      },
    );
  }

  private ensureScaled() {
    const isBusy = this.scaled || this.loading || this.loadError;
    if (isBusy) return;
    this.loading = true;
    const loaded = (scaled: ScaledT) => { this.scaled = scaled; };
    const failed = () => { this.loadError = 'Chord tools could not load.'; };
    void loadScaled().then(loaded, failed).finally(() => { this.loading = false; });
  }

  // ── Data ───────────────────────────────────────────────────────

  private analyzeProject() {
    const ed = this.ed;
    if (!ed) return;
    const rows: ProjectChordT[] = [];
    ed.trackList.forEach((meta, index) => {
      const track = ed.doc.tracks.find((item) => item.id === meta.id);
      if (!track) return;
      const trackName = track.name ?? 'Track ' + (index + 1);
      const trackColor = ed.getTrackColor(track.id);
      const regions = track.chordRegions;
      if (regions) {
        for (const region of regions) {
          const chord = this.catalogChord({ symbol: region.symbol, rootPitch: region.root, chordType: region.symbol,
            intervals: region.intervals, midiNotes: region.pitches });
          rows.push({ key: region.id, trackId: track.id, trackName, trackColor, start: region.start, position: '',
            chord, regionId: region.id, noteIds: [] });
        }
        return;
      }
      const spans = analyzeChords(track.notes, { key: ed.key, minDuration: ed.ppq / 2 });
      for (const span of spans) {
        const chord = this.detectedChord(span.chord);
        rows.push({ key: track.id + ':' + span.start, trackId: track.id, trackName, trackColor, start: span.start, position: '',
          chord, noteIds: span.noteIds });
      }
    });
    rows.sort((a, b) => a.start - b.start);
    for (const row of rows) row.position = formatBBT(row.start, ed.meta.timeSignature, ed.ppq);
    this.projectChords = rows;
  }

  private detectedChord(detected: DetectedChordT): Chord {
    return { root: detected.root, degree: '', name: detected.name, type: detected.type };
  }

  private catalogChord(chord: ScaledT.ChordT): Chord {
    const intervals = chord.intervals;
    const suffix = chord.symbol.replace(/^[A-G][#b]?/, '');
    const existing = CHORD_TYPES.find((type) => type.intervals.join() === intervals.join());
    const highest = Math.max(...intervals);
    const byRange = highest >= 21 ? 'thirteenth' : highest >= 17 ? 'eleventh' : highest >= 13 ? 'ninth' : 'triad';
    const isOmit = /\bno\s*[35]\b/i.test(suffix);
    const isSus = /sus/i.test(suffix);
    const isAdd = /add/i.test(suffix);
    const isSeventh = /7/.test(suffix) && highest < 13;
    const fallbackFamily = isSeventh ? 'seventh' : byRange;
    const family = isOmit ? 'omit' : isSus ? 'sus' : isAdd ? 'add' : existing?.family ?? fallbackFamily;
    const name = pitchClassName(chord.rootPitch) + chord.symbol.replace(/^[A-G][#b]?/, '').replace(/^min/, 'm');
    const typeName = existing?.name ?? chord.chordType;
    return { root: chord.rootPitch, name, degree: '', type: { id: chord.chordType, symbol: suffix, name: typeName, intervals, family } };
  }

  private browseGroups(key: Key | null) {
    const isCached = this.catalog?.key === key && this.catalog.scaled === this.scaled;
    if (isCached) return this.catalog!.groups;
    const groups = chordsInKey(key);
    const hasScaleChords = key && key.scale !== 'chromatic' && this.scaled;
    if (hasScaleChords) {
      const byRoot = new Map(groups.map((group) => {
        group.chords = group.chords.filter((chord) => chord.type.family === 'omit');
        return [group.root, group];
      }));
      for (const chord of this.scaled!.getScaleChords(scaledKey(key))) byRoot.get(chord.rootPitch)?.chords.push(this.catalogChord(chord));
      for (const group of groups) {
        const rank = (chord: Chord) => (chord.type.family === 'triad' ? 0 : chord.type.family === 'omit' ? 2 : 1);
        group.chords.sort((a, b) => rank(a) - rank(b) || a.type.intervals.length - b.type.intervals.length);
        const seen = new Set<string>();
        group.chords = group.chords.filter((chord) => {
          const symbol = toSymbol(chord.name);
          const isDuplicate = seen.has(symbol);
          seen.add(symbol);
          return !isDuplicate;
        });
      }
    }
    this.catalog = { key, scaled: this.scaled, groups };
    return groups;
  }

  /** What the Suggestions rail follows: the chord selected in the editor, never a panel click. */
  private anchor(ed: Editor): AnchorT | undefined {
    const selected = ed.selectedChordRegions;
    const region = selected.at(-1);
    if (region) {
      const bar = formatBBT(region.start, ed.meta.timeSignature, ed.ppq).split('.')[0];
      const trackName = ed.trackList.find((track) => track.id === ed.activeTrackId)?.name ?? 'Chords';
      return { eyebrow: 'After', name: region.symbol, hint: `${trackName} · bar ${bar}`, symbol: region.symbol, root: region.root };
    }
    const isMidiTrack = !ed.chordRegions;
    const hasNotes = ed.selectedNotes.length > 0;
    if (!isMidiTrack || !hasNotes) return;
    const spans = analyzeSelection(ed.selectedNotes, { key: ed.key, minDuration: ed.ppq / 2 });
    const span = spans.at(-1);
    if (!span) return { eyebrow: '', name: '', hint: '', symbol: '', root: -1 };
    const chord = this.detectedChord(span.chord);
    const trackName = ed.trackList.find((track) => track.id === ed.activeTrackId)?.name ?? 'Track';
    return { eyebrow: 'Looks like', name: chord.name, hint: trackName, symbol: chord.name.split('/')[0], root: chord.root };
  }

  private suggestions(ed: Editor, anchor: AnchorT): SuggestionsT {
    const scaled = this.scaled;
    const empty = { inKey: [], borrowed: [] };
    if (!scaled) return empty;
    const context = scaledKey(ed.key, anchor.root);
    const hasKey = !!ed.key && ed.key.scale !== 'chromatic';
    try {
      const raw = scaled.getSuggestions({ chord: toSymbol(anchor.symbol), key: context.key, ...(hasKey ? { scale: context.scale } : {}) });
      const sorted = [...raw].sort((a, b) => b.weight - a.weight);
      const seen = new Set<string>();
      const result: SuggestionsT = { inKey: [], borrowed: [] };
      for (const item of sorted) {
        const symbol = item.symbol;
        const isUsable = !!symbol && !seen.has(symbol);
        if (!isUsable) continue;
        seen.add(symbol!);
        try {
          const chord = this.catalogChord(scaled.getChord({ chord: symbol! }));
          const isBorrowed = hasKey && item.isInScale === false;
          if (isBorrowed) result.borrowed.push(chord);
          if (!isBorrowed) result.inKey.push(chord);
        } catch {
          // A suggestion with no chord entry is skipped.
        }
      }
      return result;
    } catch {
      return empty;
    }
  }

  // ── Crafting ───────────────────────────────────────────────────

  private makeDraft(chord: Chord): ChordDraft {
    const ed = this.ed!;
    const view = ed.view;
    return ed.chordTrack.draft({ symbol: chord.name, root: chord.root, intervals: chord.type.intervals },
      { octave: view.chordOctave, inversion: view.chordInversion, voicing: view.chordVoicing, templateId: view.chordTemplateId });
  }

  private tryDraft(chord: Chord): ChordDraft | undefined {
    try {
      return this.makeDraft(chord);
    } catch (error) {
      this.engine?.toast((error as Error).message, 'error');
    }
  }

  private pickChord(id: string, chord: Chord) {
    this.crafting = { id, chord };
  }

  /** Enter on a tile: place it at the playhead marker on the active track. */
  private async placeAtPlayhead(chord: Chord) {
    const ed = this.ed;
    if (!ed) return;
    const draft = this.tryDraft(chord);
    if (!draft) return;
    const isMidiTrack = !ed.chordRegions;
    const isConfirmed = isMidiTrack ? await confirmPlainChordPlacement(this) : true;
    if (!isConfirmed) return;
    const at = ed.transport.marker ?? ed.view.cursor;
    const snapped = ed.view.snap ? snapTick(at, ed.commands.gridTicks(at), ed.meta.timeSignature, 'floor') : Math.round(at);
    try {
      const isPlaced = ed.chordTrack.placeDraft(draft, Math.max(0, snapped));
      if (isPlaced) ed.chordTrack.auditionPitches([draft.region]);
      if (!isPlaced) this.engine?.toast('There’s already a chord at the playhead.');
    } catch (error) {
      this.engine?.toast((error as Error).message, 'error');
    }
  }

  /** Mouse down: pick the chord and hear it until mouse up. Move 4px: it becomes a drag. */
  private startDrag(event: PointerEvent, id: string, chord: Chord) {
    const engine = this.engine;
    const isPrimary = event.button === 0 && event.isPrimary;
    if (!engine || !isPrimary || this.cancelDrag) return;
    this.pickChord(id, chord);
    const draft = this.tryDraft(chord);
    if (!draft) return;
    const source = event.currentTarget as HTMLElement;
    const ghost = this.renderRoot.querySelector<HTMLElement>('.ghost')!;
    const drag: ChordDrag = { draft, clientX: event.clientX, clientY: event.clientY, overGrid: false };
    let isDragging = false;
    source.setPointerCapture(event.pointerId);
    let stopAudition = this.ed?.chordTrack.auditionDraft(draft, true);
    this.playingId = id;
    const stopPlaying = () => {
      stopAudition?.();
      stopAudition = undefined;
      this.playingId = '';
    };
    const move = (pointer: PointerEvent) => {
      const isOther = pointer.pointerId !== event.pointerId;
      if (isOther) return;
      const distance = Math.hypot(pointer.clientX - event.clientX, pointer.clientY - event.clientY);
      const isStillClick = !isDragging && distance < 4;
      if (isStillClick) return;
      if (!isDragging) stopPlaying();
      isDragging = true;
      drag.clientX = pointer.clientX;
      drag.clientY = pointer.clientY;
      engine.chordDragEvent(drag, 'move');
      ghost.hidden = false;
      ghost.textContent = drag.label ? `${chord.name} · ${drag.label}` : chord.name;
      ghost.style.transform = `translate(${pointer.clientX + 14}px, ${pointer.clientY + 14}px)`;
      ghost.style.opacity = drag.overGrid ? '0.85' : '1';
    };
    const finish = (pointer?: PointerEvent) => {
      const isOther = pointer && pointer.pointerId !== event.pointerId;
      if (isOther) return;
      stopPlaying();
      source.removeEventListener('pointermove', move);
      source.removeEventListener('pointerup', finish);
      source.removeEventListener('pointercancel', cancel);
      source.removeEventListener('lostpointercapture', cancel);
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('blur', cancel);
      const hasCapture = source.hasPointerCapture(event.pointerId);
      if (hasCapture) source.releasePointerCapture(event.pointerId);
      this.cancelDrag = undefined;
      ghost.hidden = true;
      if (pointer) {
        drag.clientX = pointer.clientX;
        drag.clientY = pointer.clientY;
      }
      if (isDragging) engine.chordDragEvent(drag, pointer ? 'drop' : 'cancel');
    };
    const cancel = () => finish();
    const escape = (key: KeyboardEvent) => {
      const isEscape = key.key === 'Escape';
      if (!isEscape) return;
      key.preventDefault();
      key.stopPropagation();
      finish();
    };
    this.cancelDrag = cancel;
    source.addEventListener('pointermove', move);
    source.addEventListener('pointerup', finish);
    source.addEventListener('pointercancel', cancel);
    source.addEventListener('lostpointercapture', cancel);
    window.addEventListener('keydown', escape, true);
    window.addEventListener('blur', cancel);
  }

  private onTileKey(event: KeyboardEvent, id: string, chord: Chord) {
    const isEnter = event.key === 'Enter';
    if (!isEnter) return;
    event.preventDefault();
    event.stopPropagation();
    this.pickChord(id, chord);
    void this.placeAtPlayhead(chord);
  }

  // ── Project tab ────────────────────────────────────────────────

  private selectProjectChord(row: ProjectChordT) {
    const ed = this.ed;
    if (!ed) return;
    const isOtherTrack = ed.activeTrackId !== row.trackId;
    if (isOtherTrack) ed.setActiveTrack(row.trackId);
    const ids = row.regionId ? [row.regionId] : row.noteIds;
    ed.select(ids);
    const view = ed.view;
    const leftEdge = view.scrollTick;
    const isOffscreen = row.start < leftEdge || row.start > leftEdge + (this.engine?.viewport.width ?? 0) / view.pxPerTick;
    if (isOffscreen) ed.setView({ scrollTick: Math.max(0, row.start - 40 / view.pxPerTick) }, { animate: true });
  }

  /** The row's own notes, as they are in the song: its voicing and pattern included. */
  private playProjectChord(row: ProjectChordT): (() => void) | undefined {
    const ed = this.ed;
    if (!ed) return;
    const notes = row.regionId
      ? ed.notes(row.trackId).filter((note) => note.chordRegionId === row.regionId)
      : row.noteIds.flatMap((id) => ed.getNote(id, row.trackId) ?? []);
    const hasNotes = notes.length > 0;
    if (!hasNotes) return;
    return ed.auditionNotes(notes, row.start);
  }

  /** Mouse down: select it in the editor and hear it until mouse up, like a tile. */
  private pressProjectChord(event: PointerEvent, row: ProjectChordT) {
    const isPrimary = event.button === 0 && event.isPrimary;
    if (!isPrimary) return;
    this.selectProjectChord(row);
    const stop = this.playProjectChord(row);
    this.playingId = 'project-' + row.key;
    const source = event.currentTarget as HTMLElement;
    source.setPointerCapture(event.pointerId);
    const release = () => {
      stop?.();
      this.playingId = '';
      source.removeEventListener('pointerup', release);
      source.removeEventListener('pointercancel', release);
      source.removeEventListener('lostpointercapture', release);
    };
    source.addEventListener('pointerup', release);
    source.addEventListener('pointercancel', release);
    source.addEventListener('lostpointercapture', release);
  }

  /** Enter or Space on a focused row: select it and play it once. */
  private onProjectKey(event: KeyboardEvent, row: ProjectChordT) {
    const isActivate = event.key === 'Enter' || event.key === ' ';
    if (!isActivate) return;
    event.preventDefault();
    event.stopPropagation();
    this.selectProjectChord(row);
    this.playProjectChord(row);
  }

  // ── Pattern picker ─────────────────────────────────────────────

  private openPicker(trigger: HTMLElement) {
    const ed = this.ed;
    if (!ed) return;
    const isOpen = ed.view.patternPicker === 'craft';
    if (isOpen) return ed.setView({ patternPicker: null });
    const panel = this.getBoundingClientRect();
    const triggerBox = trigger.getBoundingClientRect();
    const width = Math.min(540, window.innerWidth - 16);
    const height = Math.min(470, window.innerHeight - 16);
    const left = Math.max(8, panel.left - width - 8);
    const top = Math.max(8, Math.min(window.innerHeight - height - 8, triggerBox.bottom - height));
    this.pickerPosition = { left, top };
    ed.setView({ patternPicker: 'craft' });
  }

  private projectTemplateIds(ed: Editor): string[] {
    const ids: string[] = [];
    for (const track of ed.doc.tracks) {
      for (const region of track.chordRegions ?? []) {
        const id = region.performance?.templateId;
        const isNew = !!id && !ids.includes(id);
        if (isNew) ids.push(id!);
      }
    }
    return ids;
  }

  private renderPicker(ed: Editor) {
    const isOpen = ed.view.patternPicker === 'craft';
    if (!isOpen) return nothing;
    const crafting = this.crafting;
    const preview = (templateId: string) => {
      if (!crafting) return;
      try {
        const chord = crafting.chord;
        const draft = ed.chordTrack.draft({ symbol: chord.name, root: chord.root, intervals: chord.type.intervals },
          { octave: ed.view.chordOctave, inversion: ed.view.chordInversion, voicing: ed.view.chordVoicing, templateId });
        return ed.chordTrack.auditionDraft(draft, true) ?? (() => {});
      } catch (error) {
        this.engine?.toast((error as Error).message, 'error');
        return;
      }
    };
    const apply = (templateId: string) => ed.setView({ chordTemplateId: templateId });
    const close = () => ed.setView({ patternPicker: null });
    const style = `left: ${this.pickerPosition.left}px; top: ${this.pickerPosition.top}px`;
    return html`<maddie-pattern-picker style=${style} .scaled=${this.scaled} .appliedId=${ed.view.chordTemplateId}
      .targetPrefix=${'Playing on'} .targetName=${crafting?.chord.name ?? ''} .projectIds=${this.projectTemplateIds(ed)}
      .preview=${preview} .apply=${apply} .close=${close}></maddie-pattern-picker>`;
  }

  // ── Render ─────────────────────────────────────────────────────

  private renderTile(id: string, chord: Chord, isBorrowed = false): TemplateResult {
    const isPicked = this.crafting?.id === id;
    const isPlaying = this.playingId === id;
    const classes = ['tile', isPlaying ? 'isPlaying' : '', isBorrowed ? 'isBorrowed' : ''].join(' ');
    const label = isBorrowed ? `${chord.name}, ${chord.type.name}, borrowed from outside the key` : `${chord.name}, ${chord.type.name}`;
    return html`<button type="button" class=${classes} ?disabled=${!this.scaled} aria-pressed=${isPicked}
      aria-label=${label} title=${noteNames(chord)}
      @pointerdown=${(event: PointerEvent) => this.startDrag(event, id, chord)}
      @keydown=${(event: KeyboardEvent) => this.onTileKey(event, id, chord)}>
      ${isBorrowed ? html`<span class="borrowed-mark" aria-hidden="true">${borrowedIcon}</span>` : nothing}
      ${isPlaying ? waveMark : nothing}
      <span class="tile-name">${chord.name}</span>
      <span class="tile-kind">${chord.type.name}</span>
    </button>`;
  }

  private renderRail(ed: Editor, theme: string | undefined) {
    const isOpen = ed.view.suggestionsOpen;
    const anchor = this.anchor(ed);
    const suggestions = anchor && anchor.symbol ? this.suggestions(ed, anchor) : undefined;
    const total = suggestions ? suggestions.inKey.length + suggestions.borrowed.length : 0;
    const toggle = () => ed.setView({ suggestionsOpen: !isOpen });
    const toggleLabel = isOpen ? 'Fold suggestions' : 'Show suggestions';
    const caret = isOpen ? icons.back : forwardIcon;
    const railClass = isOpen ? 'rail' : 'rail isFolded';
    const hasCount = !isOpen && total > 0;

    const head = html`<div class="rail-head">
      <button type="button" class="fold" aria-expanded=${isOpen} aria-label=${toggleLabel} title=${toggleLabel} @click=${toggle}>${caret}</button>
      <span class=${isOpen ? 'rail-title' : 'rail-title vertical'}>Suggestions</span>
      ${hasCount ? html`<span class="count-badge">${total}</span>` : nothing}
    </div>`;
    if (!isOpen) return html`<aside class=${railClass} data-theme=${theme ?? nothing} aria-label="Suggestions">${head}</aside>`;

    const hasAnchor = !!anchor && anchor.symbol !== '';
    const isUnnamed = !!anchor && anchor.symbol === '';
    const emptyText = isUnnamed ? 'These notes don’t make a chord we know.' : 'Select a chord in the editor to see what fits next.';
    const hasKey = !!ed.key && ed.key.scale !== 'chromatic';
    const inKeyLabel = hasKey ? 'In key' : 'Fits next';

    return html`<aside class=${railClass} data-theme=${theme ?? nothing} aria-label="Suggestions">
      ${head}
      ${hasAnchor ? html`<div class="anchor-wrap"><div class="anchor">
        <span class="anchor-eyebrow">${anchor!.eyebrow}</span><span class="anchor-name">${anchor!.name}</span><span class="anchor-hint">${anchor!.hint}</span>
      </div></div>
      <div class="rail-list">
        ${!this.scaled ? html`<p class="empty" role="status">${this.loadError || 'Loading…'}</p>` : nothing}
        ${suggestions && suggestions.inKey.length ? html`<div class="rail-group">${inKeyLabel} <span>· ${suggestions.inKey.length}</span></div>
          ${suggestions.inKey.map((chord) => this.renderTile('next-' + chord.name, chord))}` : nothing}
        ${suggestions && suggestions.borrowed.length ? html`<div class="rail-group isBorrowed">Borrowed <span>· outside the key</span></div>
          ${suggestions.borrowed.map((chord) => this.renderTile('borrowed-' + chord.name, chord, true))}` : nothing}
        ${this.scaled && total === 0 ? html`<p class="empty">No suggestions for this chord in this key.</p>` : nothing}
      </div>` : html`<p class="empty">${emptyText}</p>`}
    </aside>`;
  }

  private renderLibrary(ed: Editor) {
    const view = ed.view;
    const query = toSymbol(view.chordQuery.trim()).toLowerCase();
    const groups = this.browseGroups(ed.key).map((group) => ({
      ...group,
      chords: group.chords.filter((chord) => {
        const matchesFamily = view.chordFamily === 'all' || chord.type.family === view.chordFamily;
        const matchesQuery = !query || toSymbol(chord.name).toLowerCase().includes(query) || chord.type.name.toLowerCase().includes(query);
        return matchesFamily && matchesQuery;
      }),
    })).filter((group) => group.chords.length > 0);
    const families = [{ id: 'all' as const, label: 'All' }, ...CHORD_FAMILIES];

    return html`<z-input class="search" size="sm" type="search" aria-label="Search chords" placeholder="Search chords"
        .value=${live(view.chordQuery)} @input=${(event: CustomEvent<{ value: string }>) => ed.setView({ chordQuery: event.detail.value })}></z-input>
      <div class="chips" role="radiogroup" aria-label="Chord type">
        ${families.map((family) => html`<button type="button" class="chip" role="radio" aria-checked=${view.chordFamily === family.id}
          @click=${() => ed.setView({ chordFamily: family.id })}>${family.label}</button>`)}
      </div>
      <div class="list" part="list">
        ${!this.scaled ? html`<p class="hint" role="status">${this.loadError || 'Loading chord tools…'}</p>` : nothing}
        ${groups.map((group) => html`<div class="group-head"><span class="group-name">${pitchClassName(group.root)}</span>
            <span class="group-count">${group.chords.length} ${group.chords.length === 1 ? 'chord' : 'chords'}</span></div>
          <div class="tiles">${group.chords.map((chord) => this.renderTile('lib-' + group.root + '-' + chord.name, chord))}</div>`)}
        ${this.scaled && !groups.length ? html`<p class="hint">No chords match.</p>` : nothing}
      </div>`;
  }

  private renderProject(ed: Editor) {
    const rows = this.projectChords;
    const selection = ed.selection;
    return html`<div class="list" part="list">
      <p class="hint">Chords found in this project. Hold one to hear it; it’s selected in the editor too.</p>
      ${rows.length ? rows.map((row) => {
        const isSelected = row.regionId ? selection.has(row.regionId) : row.noteIds.length > 0 && row.noteIds.every((id) => selection.has(id));
        const isPlaying = this.playingId === 'project-' + row.key;
        const rowClass = isPlaying ? 'project-row isPlaying' : 'project-row';
        return html`<button type="button" class=${rowClass} aria-current=${isSelected}
          title="Hold to hear · selects it in the editor"
          @pointerdown=${(event: PointerEvent) => this.pressProjectChord(event, row)}
          @keydown=${(event: KeyboardEvent) => this.onProjectKey(event, row)}>
          <span class="project-pos">${row.position}</span>
          <span class="project-name">${row.chord.name}</span>
          <span class="project-track"><span class="project-dot" style=${'background:' + row.trackColor}></span>${row.trackName}</span>
        </button>`;
      }) : html`<p class="hint">No chords in this project yet.</p>`}
    </div>`;
  }

  private renderStepper(label: string, value: string, canDown: boolean, canUp: boolean, down: () => void, up: () => void) {
    return html`<div class="prop"><span class="prop-label">${label}</span>
      <div class="stepper" role="group" aria-label=${label}>
        <button type="button" aria-label=${label + ' down'} ?disabled=${!canDown} @click=${down}>${icons.back}</button>
        <span class="stepper-value">${value}</span>
        <button type="button" aria-label=${label + ' up'} ?disabled=${!canUp} @click=${up}>${forwardIcon}</button>
      </div>
    </div>`;
  }

  private renderCraft(ed: Editor, theme: string | undefined) {
    const view = ed.view;
    const crafting = this.crafting;
    const scaled = this.scaled;
    const octaveIndex = OCTAVES.indexOf(view.chordOctave);
    const maxInversion = crafting ? Math.min(3, crafting.chord.type.intervals.length - 1) : 3;
    const inversion = Math.min(view.chordInversion, maxInversion);
    const template = view.chordTemplateId ? scaled?.performanceTemplates.find((item) => item.id === view.chordTemplateId) : undefined;
    const hasPattern = !!template;
    const steps = template ? patternRhythm(template) : Array.from({ length: 16 }, () => false);
    const isPickerOpen = view.patternPicker === 'craft';
    const isPlaying = this.playingId === 'craft';
    const voicings = scaled?.voicingNames ?? [view.chordVoicing];
    const setOctave = (octave: number) => ed.setView({ chordOctave: octave });
    const setInversion = (value: number) => ed.setView({ chordInversion: value });

    const hero = crafting ? html`<button type="button" class=${isPlaying ? 'hero isPlaying' : 'hero'}
        aria-label=${`${crafting.chord.name}, ${crafting.chord.type.name}. Hold to hear, drag to place, Enter to place at the playhead.`}
        @pointerdown=${(event: PointerEvent) => this.startDrag(event, 'craft', crafting.chord)}
        @keydown=${(event: KeyboardEvent) => this.onTileKey(event, crafting.id, crafting.chord)}>
        <span class="hero-title"><span class="hero-name">${crafting.chord.name}</span><span class="hero-kind">${crafting.chord.type.name}</span></span>
        <span class="hero-side"><span class="hero-notes">${noteNames(crafting.chord)}</span>
          <span class="hero-hint">${isPlaying ? waveMark : nothing}Hold to hear · drag to place</span></span>
      </button>` : html`<div class="hero-empty">Click any chord to start shaping it here.</div>`;

    return html`<div class="craft" data-theme=${theme ?? nothing} aria-label="Chord you're shaping">
      <div class=${crafting ? 'card' : 'card isEmpty'}>
        ${hero}
        <div class="props">
          ${this.renderStepper('Octave', 'Oct ' + view.chordOctave, octaveIndex > 0, octaveIndex < OCTAVES.length - 1,
            () => setOctave(OCTAVES[octaveIndex - 1]), () => setOctave(OCTAVES[octaveIndex + 1]))}
          ${this.renderStepper('Inversion', INVERSIONS[inversion], inversion > 0, inversion < maxInversion,
            () => setInversion(inversion - 1), () => setInversion(inversion + 1))}
          <div class="prop"><span class="prop-label">Voicing</span>
            <select class="voicing" aria-label="Voicing" .value=${live(view.chordVoicing)}
              @change=${(event: Event) => ed.setView({ chordVoicing: (event.target as HTMLSelectElement).value as ScaledT.VoicingNameT })}>
              ${voicings.map((name) => html`<option value=${name} ?selected=${name === view.chordVoicing}>${CHORD_VOICINGS[name] ?? name}</option>`)}
            </select>
          </div>
        </div>
        <div class="pattern-row">
          <button type="button" class="pattern-button" data-pattern-trigger aria-haspopup="dialog" aria-expanded=${isPickerOpen}
            @click=${(event: MouseEvent) => this.openPicker(event.currentTarget as HTMLElement)}>
            <span class="pattern-copy"><span class="pattern-label">Pattern</span>
              <span class=${hasPattern ? 'pattern-name' : 'pattern-name isEmpty'}>${template ? template.name : 'None. Pick a pattern'}
                ${template ? html`<span class="pattern-category">· ${formatPatternCategory(template.category)}</span>` : nothing}</span></span>
            <span class="rhythm" aria-hidden="true">${steps.map((isHit) => html`<span class=${isHit ? 'step isHit' : 'step'}></span>`)}</span>
            <span class="chevron">${icons.chevron}</span>
          </button>
          ${hasPattern ? html`<button type="button" class="clear" aria-label="Remove pattern" title="Remove pattern"
            @click=${() => ed.setView({ chordTemplateId: '' })}>${icons.close}</button>` : nothing}
        </div>
      </div>
    </div>`;
  }

  private renderMain(ed: Editor, theme: string | undefined, craftTheme: string | undefined) {
    const isOpen = ed.view.chordsPanel;
    const toggle = () => ed.setView({ chordsPanel: !isOpen, patternPicker: null });
    const keyName = ed.key && ed.key.scale !== 'chromatic' ? `${pitchClassName(ed.key.root)} ${ed.key.scale}` : 'No key';
    if (!isOpen) {
      return html`<section class="strip" data-theme=${theme ?? nothing} aria-label="Chords">
        <button type="button" class="fold" aria-expanded="false" aria-label="Open chords" title="Open chords   H" @click=${toggle}>${icons.back}</button>
        <span class="strip-title vertical">Chords</span>
        <span class="strip-sub vertical">${keyName}</span>
      </section>`;
    }
    const tab = ed.view.chordsTab;
    const libraryCount = this.browseGroups(ed.key).reduce((sum, group) => sum + group.chords.length, 0);
    return html`<section class="main" data-theme=${theme ?? nothing} aria-label="Chords">
      <div class="main-head">
        <button type="button" class="fold" aria-expanded="true" aria-label="Fold chords" title="Fold chords   H" @click=${toggle}>${forwardIcon}</button>
        <span class="main-title">Chords</span><span class="key-pill">${keyName}</span>
      </div>
      <div class="tabs" role="tablist" aria-label="Chord lists">
        <button type="button" class="tab" role="tab" aria-selected=${tab === 'all'} @click=${() => ed.setView({ chordsTab: 'all' })}>All<span class="tab-count">${libraryCount}</span></button>
        <button type="button" class="tab" role="tab" aria-selected=${tab === 'project'} @click=${() => ed.setView({ chordsTab: 'project' })}>Project<span class="tab-count">${this.projectChords.length}</span></button>
      </div>
      ${tab === 'project' ? this.renderProject(ed) : this.renderLibrary(ed)}
      ${this.renderCraft(ed, craftTheme)}
    </section>`;
  }

  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const view = ed.view;
    const mainTheme = view.chordsPanelDark ? 'dark' : undefined;
    // The crafting card follows the panel's theme unless the experimental toggle forces it dark.
    const craftTheme = view.chordCraftDark ? 'dark' : undefined;
    const railTheme = view.suggestionsDark ? 'dark' : undefined;
    return html`
      ${this.renderRail(ed, railTheme)}
      ${this.renderMain(ed, mainTheme, craftTheme)}
      ${this.renderPicker(ed)}
      <div class="ghost" hidden aria-hidden="true"></div>
    `;
  }
}

const waveMark = html`<span class="wave" aria-hidden="true"><span></span><span></span><span></span></span>`;
const forwardIcon = html`<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5"/></svg>`;
const borrowedIcon = html`<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 3L6.5 9.5M6.5 4.5v5h5"/><path d="M3 7v6h6" opacity=".55"/></svg>`;

declare global {
  interface HTMLElementTagNameMap {
    'maddie-chords': MaddieChords;
  }
}
