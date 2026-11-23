import { html } from 'lit';
import { live } from 'lit/directives/live.js';
import type { ScaledT } from '@tasteee/scaled/types';

export function chordSelect(label: string, value: string, options: readonly object[], change: (value: string) => void) {
  return html`<label class="chord-field">
    <span>${label}</span>
    <z-select size="sm" label=${label} .value=${live(value)} .options=${options}
      @change=${(event: CustomEvent<{ value: string }>) => change(event.detail.value)}></z-select>
  </label>`;
}

const sustainedOption = { value: '', label: 'Sustained chord' };

const formatCategory = (category: string) => (category === 'StrummedSequences' ? 'Strummed sequences' : category);

export function nestedPerformanceOptions(scaled: ScaledT) {
  const categories = [...new Set(scaled.performanceTemplates.map((item) => item.category))].sort();
  const groups = categories.map((category) => {
    const templates = scaled.performanceTemplates.filter((item) => item.category === category);
    const children = templates.map((item) => ({ value: item.id, label: item.name }));
    const label = formatCategory(category);
    return { label, value: label, isGroup: true, children };
  });
  return [sustainedOption, ...groups];
}

export function performanceCategories(scaled: ScaledT) {
  return [...new Set(scaled.performanceTemplates.map((item) => item.category))]
    .sort().map((value) => ({ value, label: formatCategory(value) }));
}

export function performanceOptions(scaled: ScaledT, category: string) {
  return scaled.performanceTemplates.filter((item) => item.category === category).map(({ id, name }) => ({ value: id, label: name }));
}
