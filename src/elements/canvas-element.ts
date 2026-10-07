import { css, html } from 'lit';
import type { Editor } from '../core';
import type { Engine } from '../engine/engine';
import { luminance, ThemeReader } from '../engine/theme';
import { MaddieElement } from './base';
import { PALETTE_TOKENS, tokens, type Palette } from './tokens';

/** An element that draws on a canvas every engine frame. */
export abstract class CanvasElement extends MaddieElement {
  static styles = [
    tokens,
    css`
      :host {
        display: block;
        position: relative;
        overflow: hidden;
        user-select: none;
        -webkit-user-select: none;
        touch-action: none;
        outline: none;
      }
      canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
      }
    `,
  ];

  protected canvas!: HTMLCanvasElement;
  protected ctx!: CanvasRenderingContext2D;
  protected width = 0;
  protected height = 0;
  protected palette: Palette | null = null;
  private theme: ThemeReader | null = null;
  private ro: ResizeObserver | null = null;

  protected render() {
    return html`<canvas part="canvas"></canvas>${this.renderOverlay()}`;
  }

  protected renderOverlay(): unknown {
    return null;
  }

  protected firstUpdated() {
    this.canvas = this.renderRoot.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.theme = new ThemeReader(this.shadowRoot!, () => {
      this.palette = null;
      this.engine?.invalidate();
    });
    this.ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      this.width = width;
      this.height = height;
      this.resized();
      this.engine?.invalidate();
    });
    this.ro.observe(this);
    // Canvas text uses whatever font is loaded at draw time: redraw when web fonts arrive.
    document.fonts?.addEventListener('loadingdone', this.onFonts);
  }

  private onFonts = () => this.engine?.invalidate();

  disconnectedCallback() {
    super.disconnectedCallback();
    this.ro?.disconnect();
    document.fonts?.removeEventListener('loadingdone', this.onFonts);
  }

  protected attach(_editor: Editor, engine: Engine) {
    this.track(engine.addRenderer((now) => this.frame(now)));
  }

  /** Re-read theme tokens. Call after changing CSS in ways the sentinel can't see. */
  refreshTheme() {
    this.theme?.refresh();
  }

  protected resized() {}

  protected getPalette(): Palette {
    if (!this.palette && this.theme) {
      const p = {} as Palette;
      for (const t of PALETTE_TOKENS) p[t] = this.theme.color(t);
      p.noteMinOpacity = this.theme.number('note-min-opacity', 0.32);
      p.noteRadius = this.theme.number('note-radius', 3);
      p.font = this.theme.value('font') || 'system-ui';
      p.fontMono = this.theme.value('font-mono') || 'monospace';
      p.dark = luminance(p.bg) < 0.4;
      const num = (t: string, fallback: number) => {
        const n = parseFloat(this.theme!.value(t));
        return Number.isFinite(n) ? n : fallback;
      };
      p.pitch = {
        lightness: num('pitch-lightness', p.dark ? 0.72 : 0.64),
        chroma: num('pitch-chroma', p.dark ? 0.15 : 0.18),
        hueLow: num('pitch-hue-low', 265),
        hueHigh: num('pitch-hue-high', 15),
      };
      p.pitchCache = new Map();
      this.palette = p;
    }
    return this.palette!;
  }

  private frame(now: number) {
    if (!this.canvas || !this.ed || !this.engine || !this.width || !this.height) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(this.width * dpr);
    const h = Math.round(this.height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw(this.ctx, now, this.ed, this.engine, this.getPalette());
  }

  protected abstract draw(ctx: CanvasRenderingContext2D, now: number, editor: Editor, engine: Engine, palette: Palette): void;

  /** Pointer position relative to this element. */
  protected local(e: { clientX: number; clientY: number }) {
    const r = this.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
}
