import { LitElement, type PropertyValues } from 'lit';
import { property } from 'lit/decorators.js';
import type { Editor } from '../core';
import { Engine } from '../engine/engine';
import { ContextRequestEvent, editorContext, ROOT_READY } from './context';

/**
 * Base for every Maddie element. Finds its editor (explicit `.editor`,
 * or the nearest <maddie-root> via context) and manages subscriptions.
 */
export class MaddieElement extends LitElement {
  /** Wire an editor explicitly (when not nested in a <maddie-root>). */
  @property({ attribute: false }) editor?: Editor;

  /** The resolved editor. */
  protected ed: Editor | null = null;
  protected engine: Engine | null = null;
  private subs: Array<() => void> = [];
  private retry = () => this.resolve();

  connectedCallback() {
    super.connectedCallback();
    this.resolve();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.detach();
    document.removeEventListener(ROOT_READY, this.retry);
  }

  protected willUpdate(changed: PropertyValues) {
    if (changed.has('editor') && this.isConnected) this.resolve();
  }

  private resolve() {
    let found: Editor | null = this.editor ?? null;
    if (!found) this.dispatchEvent(new ContextRequestEvent(editorContext, (e) => (found = e)));
    if (found === this.ed) return;
    this.detach();
    if (!found) {
      document.addEventListener(ROOT_READY, this.retry);
      return;
    }
    document.removeEventListener(ROOT_READY, this.retry);
    this.ed = found;
    this.engine = Engine.for(found);
    this.attach(found, this.engine);
    this.requestUpdate();
  }

  private detach() {
    this.subs.forEach((s) => s());
    this.subs = [];
    if (this.ed) this.detached();
    this.ed = null;
    this.engine = null;
  }

  /** Register cleanup for the current editor. */
  protected track(...unsubs: Array<() => void>) {
    this.subs.push(...unsubs);
  }

  /** Override: subscribe to the editor. Use `this.track()` for cleanup. */
  protected attach(_editor: Editor, _engine: Engine) {}

  /** Override: extra cleanup. */
  protected detached() {}
}
