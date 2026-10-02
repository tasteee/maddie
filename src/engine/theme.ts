/**
 * Canvas can't read CSS. This reads resolved token values from a probe
 * element inside the shadow root, and fires `onChange` when they change.
 *
 * Change detection: a sentinel element binds key tokens to real color
 * properties with a 1ms transition. Any token change (theme attribute,
 * class on <html>, prefers-color-scheme) fires `transitionrun`. No polling.
 */
export class ThemeReader {
  private probe: HTMLElement;
  private cache = new Map<string, string>();

  constructor(root: ShadowRoot, private onChange: () => void) {
    this.probe = document.createElement('span');
    this.probe.setAttribute('aria-hidden', 'true');
    this.probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;visibility:hidden';
    const sentinel = document.createElement('span');
    sentinel.setAttribute('aria-hidden', 'true');
    sentinel.style.cssText = [
      'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;visibility:hidden',
      'color:var(--_bg)',
      'background-color:var(--_note)',
      'border-top-color:var(--_text)',
      'border-bottom-color:var(--_accent)',
      'outline-color:var(--_line-bar)',
      'font-family:var(--_font)',
      'transition:color 1ms,background-color 1ms,border-top-color 1ms,border-bottom-color 1ms,outline-color 1ms',
    ].join(';');
    sentinel.addEventListener('transitionrun', () => this.refresh());
    root.append(this.probe, sentinel);
  }

  refresh() {
    this.cache.clear();
    this.onChange();
  }

  /** Resolved color (rgb/rgba string) for an internal token like `note`. */
  color(token: string): string {
    const key = `c:${token}`;
    let v = this.cache.get(key);
    if (v === undefined) {
      this.probe.style.color = `var(--_${token})`;
      v = normalizeColor(getComputedStyle(this.probe).color);
      this.cache.set(key, v);
    }
    return v;
  }

  /** Raw string value of a token. */
  value(token: string): string {
    const key = `v:${token}`;
    let v = this.cache.get(key);
    if (v === undefined) {
      v = getComputedStyle(this.probe).getPropertyValue(`--_${token}`).trim();
      this.cache.set(key, v);
    }
    return v;
  }

  /** Token as a number. `"120ms"` → 120. */
  number(token: string, fallback = 0): number {
    const n = parseFloat(this.value(token));
    return Number.isFinite(n) ? n : fallback;
  }
}

/** rgb(…) → rgba(…, a). */
export function withAlpha(color: string, alpha: number): string {
  const m = /rgba?\(([^)]+)\)/.exec(color);
  if (!m) return color;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3);
  const base = m[1].includes('/') || m[1].split(',').length === 4 ? Number(m[1].split(/[,/]/).pop()) : 1;
  return `rgba(${parts.join(',')},${(Number.isFinite(base) ? base : 1) * alpha})`;
}

/** Mix two rgb colors. */
export function mix(a: string, b: string, t: number): string {
  const pa = rgb(a);
  const pb = rgb(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  const alpha = pa[3] + (pb[3] - pa[3]) * t;
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

function rgb(color: string): [number, number, number, number] {
  const m = /rgba?\(([^)]+)\)/.exec(color);
  if (!m) return [0, 0, 0, 1];
  const nums = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0, nums[3] ?? 1];
}

let normCtx: CanvasRenderingContext2D | null = null;

/** Any CSS color (oklch, color-mix, …) → rgba(). Canvas does the conversion. */
export function normalizeColor(color: string): string {
  if (/^rgba?\(/.test(color)) return color;
  normCtx ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!normCtx) return color;
  normCtx.clearRect(0, 0, 1, 1);
  normCtx.fillStyle = color;
  normCtx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = normCtx.getImageData(0, 0, 1, 1).data;
  return `rgba(${r},${g},${b},${Math.round((a / 255) * 1000) / 1000})`;
}
