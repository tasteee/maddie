/**
 * Registers the Zest elements Maddie renders. Each import defines one `<z-*>` tag, so a build only
 * ships what the editor uses. The page still needs Zest's tokens: `import '@tasteee/zest/ink.css'`.
 */
import '@tasteee/zest/z-badge';
import '@tasteee/zest/z-button';
import '@tasteee/zest/z-button-group';
import '@tasteee/zest/z-input';
import '@tasteee/zest/z-kbd';
import '@tasteee/zest/z-number-input';
import '@tasteee/zest/z-popover';
import '@tasteee/zest/z-select';
import '@tasteee/zest/z-separator';
import '@tasteee/zest/z-slider';
import '@tasteee/zest/z-subheading';
import '@tasteee/zest/z-switch';
import '@tasteee/zest/z-text';
import '@tasteee/zest/z-toggle-button';
import '@tasteee/zest/z-tooltip';

import '@tasteee/zest/z-menu';
import '@tasteee/zest/z-context-menu';
import '@tasteee/zest/z-scroll-area';
import '@tasteee/zest/z-status-dot';
import '@tasteee/zest/z-toggle-button-group';
import '@tasteee/zest/z-toggle-button-group-item';
import '@tasteee/zest/z-toolbar';
import '@tasteee/zest/z-toolbar-group';
import '@tasteee/zest/z-alert-dialog';
import '@tasteee/zest/z-checkbox';
import '@tasteee/zest/z-sortable';

import { toaster } from '@tasteee/zest/z-toaster';
import type { Toast } from '../engine/engine';

const connectShadow = (element: Element | undefined, apply: (root: ShadowRoot, host: Element) => void) => {
  if (!element) return;
  const attach = () => {
    const root = element.shadowRoot;
    if (!root) {
      if (element.isConnected) requestAnimationFrame(attach);
      return;
    }
    apply(root, element);
  };
  requestAnimationFrame(attach);
};

export const onFocusedSelectClose = (element: Element | undefined, onClose: () => void) => connectShadow(element, (root, host) => {
  const trigger = root.querySelector('[role="combobox"]');
  if (!trigger) return;
  // Zest restores focus to its trigger after choosing an option, even when the value stays the same.
  new MutationObserver(() => {
    if (host.isConnected && trigger.getAttribute('aria-expanded') === 'false' && root.activeElement === trigger) onClose();
  }).observe(trigger, { attributes: true, attributeFilter: ['aria-expanded'] });
});

// Zest keeps a closing popover in the top layer while it fades.
export const allowClicksThroughClosingPopover = (element?: Element) => connectShadow(element, (root, host) => {
  const update = (event: Event) => {
    const isOwnEvent = event.target === host;
    if (!isOwnEvent) return;
    const surface = root.querySelector<HTMLElement>('[popover]');
    if (!surface) return;
    const isOpen = (event as CustomEvent<{ open: boolean }>).detail.open;
    surface.style.pointerEvents = isOpen ? '' : 'none';
  };
  host.addEventListener('toggle', update);
});

export const sizeEditorMenu = (element?: Element) => connectShadow(element, (root) => {
  const update = () => {
    const panel = root.querySelector<HTMLElement>('[popover]');
    if (panel) panel.style.width = 'min(232px, calc(100vw - 16px))';
  };
  new MutationObserver(update).observe(root, { childList: true, subtree: true });
  update();
});

// Zest 1.1.1 renders a dismiss button without a part or option.
export const styleEditorToast = (element?: Element) => connectShadow(element, (root, host) => {
  const update = () => {
    const close = root.querySelector<HTMLElement>('.close');
    if (close) close.style.display = 'none';
    const toast = root.querySelector<HTMLElement>('.toast');
    if (toast) {
      toast.style.inlineSize = 'max-content';
      // Zest's tint gradient has no accent on neutral toasts.
      toast.style.backgroundColor = 'var(--surface-overlay)';
    }
    const title = root.querySelector<HTMLElement>('.title');
    if (!title) return;
    const isCapture = host.hasAttribute('data-capture');
    title.style.paddingInlineStart = isCapture ? 'var(--space-4)' : '';
    title.style.background = isCapture
      ? 'radial-gradient(circle, var(--status-danger) 3px, transparent 3px) left center / 6px 6px no-repeat'
      : '';
  };
  const observer = new MutationObserver(update);
  observer.observe(root, { childList: true, subtree: true });
  observer.observe(host, { attributes: true, attributeFilter: ['data-capture'] });
  update();
  // Toasts use the opposite theme to the page.
  const invert = () => {
    const isPageDark = document.documentElement.dataset.theme === 'dark';
    host.setAttribute('data-theme', isPageDark ? 'light' : 'dark');
  };
  new MutationObserver(invert).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  invert();
});

export const showEditorToast = (title: string, kind?: Toast['kind']) => {
  const editors = document.querySelectorAll('maddie-editor');
  for (const editor of editors) editor.shadowRoot?.querySelector('z-toaster')?.toggleAttribute('data-capture', kind === 'capture');
  toaster.show({ id: 'editor', title, tone: kind === 'warning' ? 'warning' : 'neutral', duration: 2400 });
};

const PLAIN_CHORD_WARNING_KEY = 'maddie-skip-plain-chord-warning';

// Storage can be blocked (private mode, embeds). Then the warning just shows every time.
const checkIfPlainChordWarningIsHidden = (): boolean => {
  try {
    return localStorage.getItem(PLAIN_CHORD_WARNING_KEY) === 'true';
  } catch {
    return false;
  }
};

const hidePlainChordWarning = () => {
  try {
    localStorage.setItem(PLAIN_CHORD_WARNING_KEY, 'true');
  } catch {
    // Nothing to do: the choice just won't persist.
  }
};

type AlertDialogT = HTMLElement & { isOpen: boolean; heading: string; description: string; confirmLabel: string; cancelLabel: string };
type CheckboxT = HTMLElement & { isChecked: boolean; label: string };

/** Asks before a chord lands on a regular track, where it becomes plain notes. Resolves true to go ahead. */
export const confirmPlainChordPlacement = (host: Node): Promise<boolean> => {
  const isWarningHidden = checkIfPlainChordWarningIsHidden();
  if (isWarningHidden) return Promise.resolve(true);

  return new Promise((resolve) => {
    const dialog = document.createElement('z-alert-dialog') as AlertDialogT;
    const checkbox = document.createElement('z-checkbox') as CheckboxT;
    dialog.heading = 'Place chord as plain notes?';
    dialog.description = "This isn't a chord track, so the chord is placed as separate notes. You won't be able to edit it as a chord later.";
    dialog.confirmLabel = 'Place notes';
    dialog.cancelLabel = 'Cancel';
    checkbox.label = "Don't show this again";
    dialog.append(checkbox);

    const finish = (isConfirmed: boolean) => {
      const shouldRemember = isConfirmed && checkbox.isChecked;
      if (shouldRemember) hidePlainChordWarning();
      dialog.remove();
      resolve(isConfirmed);
    };
    dialog.addEventListener('confirm', () => finish(true));
    dialog.addEventListener('cancel', () => finish(false));

    const rootNode = host.getRootNode();
    const container = rootNode instanceof ShadowRoot ? rootNode : document.body;
    container.append(dialog);
    dialog.isOpen = true;
  });
};

export type ZestOptionT = {
  value: string;
  label: string;
  isDisabled?: boolean;
  isGroup?: boolean;
  children?: ZestOptionT[];
};

/** The tones Maddie uses. `primary` is Zest's dominant accent, `secondary` the subordinate one; `danger` is for destructive actions. */
export type ZestTone = 'neutral' | 'primary' | 'secondary' | 'danger';
