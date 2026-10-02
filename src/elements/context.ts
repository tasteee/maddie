import type { Editor } from '../core';

/**
 * Minimal implementation of the Web Components Community Group context protocol.
 * https://github.com/webcomponents-cg/community-protocols/blob/main/proposals/context.md
 */
export const editorContext = 'maddie-editor' as const;

export class ContextRequestEvent extends Event {
  constructor(
    readonly context: typeof editorContext,
    readonly callback: (editor: Editor) => void,
  ) {
    super('context-request', { bubbles: true, composed: true });
  }
}

/** Fired on `document` when a root connects, so orphans can retry. */
export const ROOT_READY = 'maddie-root-ready';
