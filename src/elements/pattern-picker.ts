import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ScaledT } from '@tasteee/scaled/types';
import { icons } from './icons';
import { tokens } from './tokens';

type TemplateT = ScaledT.PerformanceTemplateT;

const FAVORITES_KEY = 'maddie.patternFavorites.v1';
const ALL = 'all';
const PROJECT = 'project';
const FAVORITES = 'favorites';
// Rendering every one of ~1,000 rows at once is slow. Past this, ask for a search.
const ROW_LIMIT = 160;
const STEPS = 16;

export const formatPatternCategory = (category: string) => {
  const isStrummed = category === 'StrummedSequences';
  if (isStrummed) return 'Strummed sequences';
  return category;
};

/** Favorite patterns belong to the person, not a project, so they live in this browser. */
export const readPatternFavorites = (): string[] => {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    const saved: unknown = raw ? JSON.parse(raw) : [];
    const isList = Array.isArray(saved);
    if (!isList) return [];
    return saved.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
};

const writePatternFavorites = (ids: readonly string[]) => {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
  } catch {
    // Storage is unavailable. Favorites last until the page closes.
  }
};

const rhythmCache = new Map<string, boolean[]>();

/** Which of 16 steps in the pattern's first bar start a note. */
export const patternRhythm = (template: TemplateT): boolean[] => {
  const cached = rhythmCache.get(template.id);
  if (cached) return cached;
  const beatsPerBar = template.timeSignature.numerator * (4 / template.timeSignature.denominator);
  const steps = Array.from({ length: STEPS }, () => false);
  for (const event of template.events) {
    const isInFirstBar = event.startBeat < beatsPerBar;
    if (!isInFirstBar) continue;
    const step = Math.floor((event.startBeat / beatsPerBar) * STEPS);
    steps[step] = true;
  }
  rhythmCache.set(template.id, steps);
  return steps;
};

/**
 * Browse ~1,000 performance patterns: All, the ones used in this project, Favorites, then by
 * category. Hold a row to hear it on the target chord; let go to use it. Stays open.
 */
@customElement('maddie-pattern-picker')
export class MaddiePatternPicker extends LitElement {
  static styles = [
    tokens,
    css`
      :host {
        position: fixed;
        z-index: 20;
        display: flex;
        flex-direction: column;
        width: min(540px, calc(100vw - 16px));
        height: min(470px, calc(100vh - 16px));
        box-sizing: border-box;
        background: var(--surface-overlay);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-overlay);
        color: var(--_text);
        font-size: var(--font-size-sm);
        overflow: hidden;
      }
      .head { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); border-bottom: 1px solid var(--_border); }
      .title-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
      .title { font-weight: 600; }
      .target { color: var(--_text-muted); }
      .target strong { color: var(--_text); font-weight: 600; }
      .search {
        width: 100%;
        height: var(--control-height-sm);
        box-sizing: border-box;
        padding: 0 var(--space-3);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-md);
        background: var(--surface-default);
        color: var(--_text);
        font: inherit;
      }
      .search:focus-visible { outline: 2px solid var(--_focus); outline-offset: 1px; }
      .notice {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-md);
        background: color-mix(in oklch, var(--status-warning) 12%, transparent);
        color: color-mix(in oklab, var(--status-warning) 70%, var(--text-primary));
        font-weight: 500;
      }
      .notice.isFlashing { animation: flash 0.5s ease-out 2; }
      @keyframes flash { 50% { background: color-mix(in oklch, var(--status-warning) 30%, transparent); } }
      .body { display: flex; flex: 1; min-height: 0; }
      .lists { flex: none; width: 176px; padding: var(--space-1); overflow-y: auto; border-right: 1px solid var(--_border); }
      .list-button {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
        width: 100%;
        height: 30px;
        padding: 0 var(--space-2);
        border: 0;
        border-radius: var(--radius-md);
        background: transparent;
        color: var(--_text);
        font: inherit;
        font-weight: 500;
        text-align: left;
        cursor: pointer;
      }
      .list-button:hover { background: var(--_surface); }
      .list-button[aria-current='true'] { background: var(--_surface-2); font-weight: 600; }
      .list-button span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .count { color: var(--_text-faint); font-size: var(--font-size-xs); font-variant-numeric: tabular-nums; }
      .divider { height: 1px; margin: var(--space-1); background: var(--_border); }
      .rows { flex: 1; min-width: 0; padding: var(--space-1); overflow-y: auto; }
      .rows-heading { padding: var(--space-1) var(--space-2); color: var(--_text-muted); font-size: var(--font-size-xs); font-weight: 500; }
      .row { display: grid; grid-template-columns: minmax(0, 1fr) 24px; align-items: center; gap: var(--space-1); height: 38px; padding-right: var(--space-1); border-radius: var(--radius-md); }
      .row:hover { background: var(--_surface); }
      .row.isApplied { background: color-mix(in oklch, var(--accent-secondary) 12%, transparent); }
      .row.isPlaying { background: color-mix(in oklch, var(--accent-secondary) 22%, transparent); }
      .row-main {
        display: grid;
        grid-template-columns: 18px minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--space-2);
        height: 100%;
        padding: 0 var(--space-1) 0 var(--space-2);
        border: 0;
        border-radius: var(--radius-md);
        background: transparent;
        color: var(--_text);
        font: inherit;
        text-align: left;
        cursor: pointer;
        user-select: none;
      }
      .row-main:focus-visible { outline: 2px solid var(--_focus); outline-offset: -2px; }
      .check { display: flex; color: var(--accent-secondary); }
      .name { display: flex; flex-direction: column; min-width: 0; }
      .name-main { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
      .name-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--_text-faint); font-size: var(--font-size-xs); }
      .rhythm { display: grid; grid-template-columns: repeat(16, 4px); gap: 2px; }
      .step { height: 12px; border-radius: 1px; background: color-mix(in oklch, var(--_text) 10%, transparent); }
      .step.isHit { background: var(--_text-muted); }
      .isApplied .step.isHit, .isPlaying .step.isHit { background: var(--accent-secondary); }
      .star {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        padding: 0;
        border: 0;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--border-strong);
        cursor: pointer;
      }
      .star:hover { background: var(--_surface-2); color: var(--_text-muted); }
      .star[aria-pressed='true'] { color: var(--status-warning); }
      .star:focus-visible { outline: 2px solid var(--_focus); outline-offset: 1px; }
      .star svg { width: 14px; height: 14px; }
      .empty { padding: var(--space-6) var(--space-3); color: var(--_text-faint); text-align: center; line-height: 1.5; }
      .foot { display: flex; justify-content: space-between; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-top: 1px solid var(--_border); color: var(--_text-faint); font-size: var(--font-size-xs); }
    `,
  ];

  @property({ attribute: false }) scaled?: ScaledT;
  @property({ attribute: false }) appliedId = '';
  /** "Playing on" or "Changing", then the chord. */
  @property({ attribute: false }) targetPrefix = 'Playing on';
  @property({ attribute: false }) targetName = '';
  /** Template ids used somewhere in this project, most recent first. */
  @property({ attribute: false }) projectIds: readonly string[] = [];
  /** Start hearing a pattern on the target. Returns a stop function, or nothing when there's no target. */
  @property({ attribute: false }) preview?: (templateId: string) => (() => void) | undefined;
  @property({ attribute: false }) apply?: (templateId: string) => void;
  @property({ attribute: false }) close?: () => void;

  @state() private list = ALL;
  @state() private query = '';
  @state() private favorites = readPatternFavorites();
  @state() private playingId = '';
  @state() private isNoticeFlashing = false;
  private stopPreview?: () => void;
  private scrollByList = new Map<string, number>();

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('pointerdown', this.onOutside, true);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('pointerdown', this.onOutside, true);
    this.stopPreview?.();
  }

  private onKey = (event: KeyboardEvent) => {
    const isEscape = event.key === 'Escape';
    if (!isEscape) return;
    event.stopPropagation();
    this.close?.();
  };

  private onOutside = (event: PointerEvent) => {
    const isInside = event.composedPath().includes(this);
    if (isInside) return;
    const path = event.composedPath();
    const isTrigger = path.some((item) => item instanceof HTMLElement && item.hasAttribute('data-pattern-trigger'));
    if (isTrigger) return;
    this.close?.();
  };

  private get templates(): readonly TemplateT[] {
    return this.scaled?.performanceTemplates ?? [];
  }

  private chooseList(list: string) {
    const rows = this.renderRoot.querySelector('.rows');
    if (rows) this.scrollByList.set(this.list, rows.scrollTop);
    this.list = list;
    this.query = '';
    void this.updateComplete.then(() => {
      const next = this.renderRoot.querySelector('.rows');
      if (next) next.scrollTop = this.scrollByList.get(list) ?? 0;
    });
  }

  private toggleFavorite(id: string) {
    const isFavorite = this.favorites.includes(id);
    const next = isFavorite ? this.favorites.filter((item) => item !== id) : [id, ...this.favorites];
    this.favorites = next;
    writePatternFavorites(next);
  }

  private press(event: PointerEvent, id: string) {
    const isPrimary = event.button === 0;
    if (!isPrimary) return;
    this.stopPreview?.();
    const stop = this.preview?.(id);
    const hasTarget = stop !== undefined;
    if (!hasTarget) {
      this.isNoticeFlashing = false;
      requestAnimationFrame(() => { this.isNoticeFlashing = true; });
      return;
    }
    this.stopPreview = stop;
    this.playingId = id;
  }

  private release(id: string) {
    this.stopPreview?.();
    this.stopPreview = undefined;
    this.playingId = '';
    this.apply?.(id);
  }

  private cancel() {
    const isPlaying = this.playingId !== '';
    if (!isPlaying) return;
    this.stopPreview?.();
    this.stopPreview = undefined;
    this.playingId = '';
  }

  private listed(): { heading: string; templates: readonly TemplateT[]; emptyText: string } {
    const query = this.query.trim().toLowerCase();
    const hasQuery = query !== '';
    if (hasQuery) {
      const matches = this.templates.filter((item) => item.name.toLowerCase().includes(query) || item.subcategory.toLowerCase().includes(query));
      return { heading: `Results in all patterns · ${matches.length}`, templates: matches, emptyText: 'No patterns match.' };
    }
    const isProject = this.list === PROJECT;
    if (isProject) {
      const byId = new Map(this.templates.map((item) => [item.id, item]));
      const used = this.projectIds.flatMap((id) => byId.get(id) ?? []);
      return { heading: 'Used in this project', templates: used, emptyText: 'Patterns you use on chords in this project show here.' };
    }
    const isFavorites = this.list === FAVORITES;
    if (isFavorites) {
      const byId = new Map(this.templates.map((item) => [item.id, item]));
      const starred = this.favorites.flatMap((id) => byId.get(id) ?? []);
      return { heading: 'Starred · in every project', templates: starred, emptyText: 'Star a pattern to keep it here, in every project.' };
    }
    const isAll = this.list === ALL;
    if (isAll) return { heading: `All patterns · ${this.templates.length}`, templates: this.templates, emptyText: 'No patterns.' };
    const inCategory = this.templates.filter((item) => item.category === this.list);
    return { heading: `${formatPatternCategory(this.list)} · ${inCategory.length}`, templates: inCategory, emptyText: 'No patterns.' };
  }

  private renderListButton(id: string, label: string, count: number) {
    const isCurrent = this.list === id && this.query === '';
    return html`<button type="button" class="list-button" aria-current=${isCurrent} @click=${() => this.chooseList(id)}>
      <span>${label}</span><span class="count">${count}</span>
    </button>`;
  }

  private renderRow(template: TemplateT) {
    const isApplied = template.id === this.appliedId;
    const isPlaying = template.id === this.playingId;
    const isFavorite = this.favorites.includes(template.id);
    const rowClass = ['row', isApplied ? 'isApplied' : '', isPlaying ? 'isPlaying' : ''].join(' ');
    const steps = patternRhythm(template);
    const sub = `${formatPatternCategory(template.category)} · ${template.subcategory}`;
    const starLabel = isFavorite ? `Remove ${template.name} from favorites` : `Add ${template.name} to favorites`;
    const onKey = (event: KeyboardEvent) => {
      const isEnter = event.key === 'Enter';
      if (!isEnter) return;
      event.preventDefault();
      this.apply?.(template.id);
    };

    return html`<div class=${rowClass}>
      <button type="button" class="row-main" aria-pressed=${isApplied}
        @pointerdown=${(event: PointerEvent) => this.press(event, template.id)}
        @pointerup=${() => this.release(template.id)}
        @pointerleave=${() => this.cancel()}
        @pointercancel=${() => this.cancel()}
        @keydown=${onKey}>
        <span class="check">${isApplied ? icons.check : nothing}</span>
        <span class="name"><span class="name-main">${template.name}</span><span class="name-sub">${sub}</span></span>
        <span class="rhythm" aria-hidden="true">${steps.map((isHit) => html`<span class=${isHit ? 'step isHit' : 'step'}></span>`)}</span>
      </button>
      <button type="button" class="star" aria-pressed=${isFavorite} aria-label=${starLabel} title=${starLabel}
        @click=${() => this.toggleFavorite(template.id)}>${starIcon}</button>
    </div>`;
  }

  render() {
    const hasTemplates = this.templates.length > 0;
    if (!hasTemplates) return html`<div class="empty" role="status">Loading patterns…</div>`;
    const categories = [...new Set(this.templates.map((item) => item.category))].sort();
    const listed = this.listed();
    const shown = listed.templates.slice(0, ROW_LIMIT);
    const isCut = listed.templates.length > shown.length;
    const hasTarget = this.targetName !== '';
    const noticeClass = this.isNoticeFlashing ? 'notice isFlashing' : 'notice';
    const projectCount = this.projectIds.length;

    return html`
      <div class="head">
        <div class="title-row">
          <span class="title">Patterns</span>
          ${hasTarget ? html`<span class="target">${this.targetPrefix} <strong>${this.targetName}</strong></span>` : nothing}
        </div>
        <input class="search" type="search" placeholder=${`Search ${this.templates.length} patterns`} aria-label="Search patterns"
          .value=${this.query} @input=${(event: InputEvent) => { this.query = (event.target as HTMLInputElement).value; }}>
        ${hasTarget ? nothing : html`<div class=${noticeClass} role="status">Pick a chord to hear patterns.</div>`}
      </div>
      <div class="body">
        <div class="lists" role="navigation" aria-label="Pattern lists">
          ${this.renderListButton(ALL, 'All patterns', this.templates.length)}
          ${this.renderListButton(PROJECT, 'In this project', projectCount)}
          ${this.renderListButton(FAVORITES, 'Favorites', this.favorites.length)}
          <div class="divider"></div>
          ${categories.map((category) => this.renderListButton(category, formatPatternCategory(category),
            this.templates.filter((item) => item.category === category).length))}
        </div>
        <div class="rows">
          <div class="rows-heading">${listed.heading}</div>
          ${shown.length ? shown.map((template) => this.renderRow(template)) : html`<p class="empty">${listed.emptyText}</p>`}
          ${isCut ? html`<p class="empty">Showing the first ${ROW_LIMIT}. Search to find the rest.</p>` : nothing}
        </div>
      </div>
      <div class="foot"><span>Hold a pattern to hear it. Let go to use it.</span><span>Esc to close</span></div>
    `;
  }
}

const starIcon = html`<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/></svg>`;

declare global {
  interface HTMLElementTagNameMap {
    'maddie-pattern-picker': MaddiePatternPicker;
  }
}
