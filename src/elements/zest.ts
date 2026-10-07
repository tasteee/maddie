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
import '@tasteee/zest/z-toast';
import '@tasteee/zest/z-toggle-button';
import '@tasteee/zest/z-toggle-button-group';
import '@tasteee/zest/z-toggle-button-group-item';
import '@tasteee/zest/z-tooltip';

export interface ZestOption {
  value: string;
  label: string;
  isDisabled?: boolean;
}

/** The accents Maddie uses. `dom` is Zest's dominant accent, `sub` the subordinate one; `error` is for destructive actions. */
export type ZestAccent = 'neutral' | 'dom' | 'sub' | 'error';
