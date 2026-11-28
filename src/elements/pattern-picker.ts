import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ScaledT } from '@tasteee/scaled/types';
import { PATTERN_SPEEDS, type PatternSpeed } from '../core';
import { icons } from './icons';
import { themeRegion, tokens } from './tokens';

type TemplateT = ScaledT.PerformanceTemplateT;
export type PatternChoice = { templateId?: string; patternSpeed?: PatternSpeed };

const FAVORITES_KEY = 'maddie.patternFavorites.v1';
const ALL = 'all';
const PROJECT = 'project';
const FAVORITES = 'favorites';
const PAGE_SIZE = 100;
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
 * category. Hold a row to audition it, and release to choose it.
 */
@customElement('maddie-pattern-picker')
export class MaddiePatternPicker extends LitElement {
  static styles = [
    tokens,
    ...themeRegion,
    css`
      :host {
        position: fixed;
        z-index: 20;
        display: block;
        /* The chord bar's host sets pointer-events: none so its empty span doesn't block the roll.
           Children inherit that, so the picker must opt back in or clicks pass through. */
        pointer-events: auto;
        width: min(540px, calc(100vw - 16px));
        height: min(470px, calc(100vh - 16px));
      }
      /* Always dark, like the chord bar. The theme region re-declares the tokens inside it. */
      .shell {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        background: var(--surface-overlay);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-overlay);
        color: var(--_text);
        font-size: var(--font-size-sm);
        overflow: hidden;
      }
      .shell:focus { outline: none; }
      .head { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); border-bottom: 1px solid var(--_border); }
      .title-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
      .title { font-weight: 600; }
      .target { color: var(--_text-muted); }
      .target strong { color: var(--_text); font-weight: 600; }
      .speed { display: inline-flex; align-items: center; gap: var(--space-2); margin-inline-start: auto; color: var(--_text-muted); font-size: var(--font-size-xs); }
      .speed-options { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--_border); border-radius: var(--radius-md); }
      .speed-option { min-width: 32px; padding: 3px 6px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--_text); font: inherit; cursor: pointer; }
      .speed-option:hover { background: var(--_surface-2); }
      .speed-option[aria-pressed='true'] { background: var(--accent-secondary); color: var(--on-accent); }
      .speed-option:focus-visible { outline: 2px solid var(--_focus); outline-offset: 1px; }
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
      .results { display: flex; flex: 1; flex-direction: column; min-width: 0; }
      .rows { flex: 1; min-height: 0; padding: var(--space-1); overflow-y: auto; }
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
      .foot, .pagination { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-top: 1px solid var(--_border); }
      .foot { flex-wrap: wrap; }
      .pagination { flex: none; }
      .page-count { min-width: 0; color: var(--_text-muted); font-size: var(--font-size-xs); }
      .actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
      .actions z-button { white-space: nowrap; }
    `,
  ];

  @property({ attribute: false }) scaled?: ScaledT;
  @property({ attribute: false }) appliedId?: string;
  @property({ attribute: false }) appliedSpeed?: PatternSpeed;
  @property({ attribute: false }) targetName = '';
  /** Template ids used somewhere in this project, most recent first. */
  @property({ attribute: false }) projectIds: readonly string[] = [];
  /** Start hearing a pattern on the target. Returns a stop function, or nothing when there's no target. */
  @property({ attribute: false }) preview?: (templateId: string) => (() => void) | undefined;
  @property({ attribute: false }) stage?: (choice: PatternChoice) => boolean;
  @property({ attribute: false }) commit?: () => boolean;
  @property({ attribute: false }) setSpeed?: (speed: PatternSpeed) => void;
  @property({ attribute: false }) togglePlayback?: () => void;
  @property({ attribute: false }) apply?: (templateId: string) => void | boolean;
  @property({ attribute: false }) close?: (restoreFocus?: boolean) => void;

  @state() private list = ALL;
  @state() private page = 0;
  @state() private favorites = readPatternFavorites();
  @state() private playingId = '';
  @state() private pending: PatternChoice = {};
  @state() private isNoticeFlashing = false;
  private held?: { pointerId: number; id: string; previous?: string; stop?: () => void };
  private hasFocused = false;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('pointerdown', this.onOutside, true);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('pointerdown', this.onOutside, true);
    this.held?.stop?.();
    this.held = undefined;
  }

  protected updated() {
    if (this.hasFocused || !this.templates.length) return;
    this.renderRoot.querySelector<HTMLElement>('.shell')?.focus({ preventScroll: true });
    this.hasFocused = true;
  }

  private onKey = (event: KeyboardEvent) => {
    if (!event.composedPath().includes(this) || event.isComposing || event.defaultPrevented) return;
    const isSpace = this.togglePlayback && event.code === 'Space' &&
      !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if (!isSpace && event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (isSpace) {
      if (!event.repeat) {
        this.finishHold(this.held?.pointerId);
        this.togglePlayback?.();
      }
    } else {
      this.close?.(true);
    }
  };

  private onOutside = (event: PointerEvent) => {
    const path = event.composedPath();
    if (path.includes(this)) return;
    const root = this.getRootNode();
    const isOwnTrigger = path.some((item) => item instanceof HTMLElement &&
      item.hasAttribute('data-pattern-trigger') && item.getRootNode() === root);
    if (!isOwnTrigger) this.dismiss();
  };

  dismiss(restoreFocus = false) {
    if (this.hasPending && !this.commit?.()) return;
    this.close?.(restoreFocus);
  }

  private get hasPending() {
    return this.pending.templateId !== undefined || this.pending.patternSpeed !== undefined;
  }

  private get templates(): readonly TemplateT[] {
    return this.scaled?.performanceTemplates ?? [];
  }

  private chooseList(list: string) {
    this.list = list;
    this.goToPage(0);
  }

  private goToPage(page: number) {
    this.page = page;
    this.renderRoot.querySelector('.rows')?.scrollTo({ top: 0 });
  }

  private toggleFavorite(id: string) {
    const isFavorite = this.favorites.includes(id);
    const next = isFavorite ? this.favorites.filter((item) => item !== id) : [id, ...this.favorites];
    this.favorites = next;
    writePatternFavorites(next);
    if (this.list === FAVORITES) {
      const page = Math.min(this.page, Math.max(0, Math.ceil(this.listed().templates.length / PAGE_SIZE) - 1));
      if (page !== this.page) this.goToPage(page);
    }
  }

  private press(event: PointerEvent, id: string) {
    if (event.button !== 0 || !event.isPrimary || this.held) return;
    const previous = this.pending.templateId;
    if (this.stage && !this.chooseTemplate(id)) return;
    const button = event.currentTarget as HTMLButtonElement;
    button.setPointerCapture(event.pointerId);
    const stop = this.preview?.(id);
    this.held = { pointerId: event.pointerId, id, previous, stop };
    if (!stop) {
      this.isNoticeFlashing = false;
      requestAnimationFrame(() => { this.isNoticeFlashing = true; });
      return;
    }
    this.playingId = id;
  }

  private finishHold(pointerId: number | undefined, canceled = false) {
    const held = this.held;
    if (!held || held.pointerId !== pointerId) return;
    this.held = undefined;
    held.stop?.();
    this.playingId = '';
    if (this.stage) {
      if (canceled) this.chooseTemplate(held.previous);
    } else if (!canceled) {
      this.apply?.(held.id);
    }
  }

  private chooseTemplate(id?: string) {
    return this.choosePending({ ...this.pending, templateId: id === this.appliedId ? undefined : id });
  }

  private choosePending(choice: PatternChoice) {
    if (choice.templateId === this.pending.templateId && choice.patternSpeed === this.pending.patternSpeed) return true;
    if (!this.stage?.(choice)) return false;
    this.pending = choice;
    return true;
  }

  private listed(): { heading: string; templates: readonly TemplateT[]; emptyText: string } {
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
    const isCurrent = this.list === id;
    return html`<button type="button" class="list-button" aria-current=${isCurrent} @click=${() => this.chooseList(id)}>
      <span>${label}</span><span class="count">${count}</span>
    </button>`;
  }

  private renderRow(template: TemplateT) {
    const chosen = (this.held && this.stage ? this.held.previous : this.pending.templateId) ?? this.appliedId;
    const isApplied = template.id === chosen;
    const isPlaying = template.id === this.playingId;
    const isFavorite = this.favorites.includes(template.id);
    const rowClass = ['row', isApplied ? 'isApplied' : '', isPlaying ? 'isPlaying' : ''].join(' ');
    const steps = patternRhythm(template);
    const sub = `${formatPatternCategory(template.category)} · ${template.subcategory}`;
    const starLabel = isFavorite ? `Remove ${template.name} from favorites` : `Add ${template.name} to favorites`;
    return html`<div class=${rowClass}>
      <button type="button" class="row-main" aria-pressed=${isApplied}
        @pointerdown=${(event: PointerEvent) => this.press(event, template.id)}
        @pointerup=${(event: PointerEvent) => this.finishHold(event.pointerId)}
        @pointercancel=${(event: PointerEvent) => this.finishHold(event.pointerId, true)}
        @lostpointercapture=${(event: PointerEvent) => this.finishHold(event.pointerId, true)}
        @click=${(event: MouseEvent) => {
          if (event.detail !== 0) return;
          if (this.stage) this.chooseTemplate(template.id);
          else this.apply?.(template.id);
        }}>
        <span class="check">${isApplied ? icons.check : nothing}</span>
        <span class="name"><span class="name-main">${template.name}</span><span class="name-sub">${sub}</span></span>
        <span class="rhythm" aria-hidden="true">${steps.map((isHit) => html`<span class=${isHit ? 'step isHit' : 'step'}></span>`)}</span>
      </button>
      <button type="button" class="star" aria-pressed=${isFavorite} aria-label=${starLabel} title=${starLabel}
        @click=${() => this.toggleFavorite(template.id)}>${starIcon}</button>
    </div>`;
  }

  private renderActions() {
    const chosen = this.pending.templateId ?? this.appliedId;
    return html`<div class="foot">
      <z-button size="sm" kind="ghost" ?is-disabled=${chosen === ''} @click=${() => this.chooseTemplate('')}>Remove Pattern</z-button>
      <div class="actions">
        <z-button size="sm" kind="outline" @click=${() => this.close?.(true)}>Cancel</z-button>
        <z-button size="sm" kind="solid" tone="secondary" ?is-disabled=${!this.hasPending}
          @click=${() => this.dismiss(true)}>Apply</z-button>
      </div>
    </div>`;
  }

  private renderSpeed() {
    const speed = this.pending.patternSpeed ?? this.appliedSpeed;
    return html`<div class="speed" role="group" aria-label="Pattern speed" title=${speed === undefined ? 'Mixed pattern speeds' : nothing}>
      <span>Speed</span>
      <span class="speed-options">
        ${PATTERN_SPEEDS.map((value) => html`<button type="button" class="speed-option" aria-pressed=${value === speed}
          @click=${() => {
            if (!this.stage) this.setSpeed?.(value);
            else this.choosePending({ ...this.pending, patternSpeed: value === this.appliedSpeed ? undefined : value });
          }}>${value === 0.5 ? '½' : value}×</button>`)}
      </span>
    </div>`;
  }

  render() {
    const hasTemplates = this.templates.length > 0;
    if (!hasTemplates) return html`<div class="shell" data-theme="dark"><div class="empty" role="status">Loading patterns…</div></div>`;
    const categories = [...new Set(this.templates.map((item) => item.category))].sort();
    const listed = this.listed();
    const pageCount = Math.max(1, Math.ceil(listed.templates.length / PAGE_SIZE));
    const page = Math.min(this.page, pageCount - 1);
    const start = page * PAGE_SIZE;
    const shown = listed.templates.slice(start, start + PAGE_SIZE);
    const hasTarget = !!this.stage || this.targetName !== '';
    const noticeClass = this.isNoticeFlashing ? 'notice isFlashing' : 'notice';
    const projectCount = this.projectIds.length;

    return html`
      <div class="shell" data-theme="dark" role="dialog" aria-label="Patterns" tabindex="-1">
      <div class="head">
        <div class="title-row">
          <span class="title">Patterns</span>
          ${this.targetName ? html`<span class="target">Playing on <strong>${this.targetName}</strong></span>` : nothing}
          ${this.stage || this.setSpeed ? this.renderSpeed() : nothing}
        </div>
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
        <div class="results">
          <div class="rows">
            <div class="rows-heading">${listed.heading}</div>
            ${shown.length ? shown.map((template) => this.renderRow(template)) : html`<p class="empty">${listed.emptyText}</p>`}
          </div>
          ${pageCount > 1 ? html`<nav class="pagination" aria-label="Pattern pages">
            <z-button size="xs" kind="ghost" ?is-disabled=${page === 0} @click=${() => this.goToPage(page - 1)}>Previous</z-button>
            <span class="page-count" role="status">Page ${page + 1} of ${pageCount}</span>
            <z-button size="xs" kind="ghost" ?is-disabled=${page === pageCount - 1} @click=${() => this.goToPage(page + 1)}>Next</z-button>
          </nav>` : nothing}
        </div>
      </div>
      ${this.stage ? this.renderActions() : nothing}
      </div>
    `;
  }
}

const starIcon = html`<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/></svg>`;

declare global {
  interface HTMLElementTagNameMap {
    'maddie-pattern-picker': MaddiePatternPicker;
  }
}
