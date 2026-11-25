import './style.css';
import { html, nothing, render } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { live } from 'lit/directives/live.js';
import { CHORD_FAMILIES, CHORD_TYPES, chordName, type ChordType } from '../../src/core/music/chords';
import { isBlackKey, octaveOf, pitchClass, pitchClassName, pitchName } from '../../src/core/music/pitch';
import { CHORD_VOICINGS, offeredVoicings } from '../../src/core/view';
import { audition, hush, playNotes } from './audio';
import {
  BASIC_BASS, BEATS, BUTTON_PATTERNS, CASTRATO, PPQ, ROOT_SHAPE, getTrace, initialHits, makeEngine, noteSignature,
  pitchInstructions, type CustomHit, type Harmony, type PlaybackNote, type Result, type Rule, type Shape,
} from './model';

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const chapters = [
  {
    label: 'Chord', index: '01 / Chord', title: 'Choose your weapon.',
    lead: 'Try C and Cm. Both recipes start from C. The “m” swaps E for E♭, the piano key one step lower.',
  },
  {
    label: 'Voicing', index: '02 / Voicing', title: 'Give it a shape.',
    lead: 'Change the shape and compare the recipe with the keys Maddie actually plays.',
    detail: [
      ['Octave', 'Moves the shape higher or lower. C3 and C4 are a lower and a higher C.'],
      ['Inversion', 'Starts the shape from a different note at the bottom.'],
      ['Voicing', 'Changes how the notes are spaced. Some shapes repeat or skip a note.'],
    ],
  },
  {
    label: 'Pattern', index: '03 / Pattern', title: 'Follow a note.',
    lead: 'A hit is an instruction, like “play voiced note 2 half a beat in.” Maddie finds the key that instruction points to, then puts the note at the right time on the roll.',
  },
  {
    label: 'Compare', index: '04 / Compare', title: 'Why did nothing change?',
    lead: 'Play A and B with Castrato, then with Basic 1. The same change in voicing can affect one pattern and leave the other untouched.',
  },
  {
    label: 'Make', index: '05 / Make', title: 'Write the instructions.',
    lead: 'Give one hit a chord voice and another a fixed MIDI note. Change the inversion. Which hit follows the new shape, and which stays where you put it?',
  },
  {
    label: 'Explore', index: 'Explore', title: 'Make it your own.',
    lead: 'Change one thing at a time. Try the same pattern with a different voicing, then with a different root or scale. Compare what you hear with what moves on the roll.',
  },
];

const roots = Array.from({ length: 12 }, (_, pitch) => pitch);
const major = CHORD_TYPES.find((type) => type.id === 'maj')!;
const minor = CHORD_TYPES.find((type) => type.id === 'm')!;
const variantIds = ['maj', 'm', 'sus2', 'sus4', '6', 'm6', '7', 'maj7', 'm7', 'add9', 'm(add9)', '9'];
const variants = variantIds.map((id) => CHORD_TYPES.find((type) => type.id === id)).filter((type): type is ChordType => !!type);
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const guideEasing = 'cubic-bezier(.22,.72,.23,1)';
const intro = byId('intro');
const composition = intro.parentElement!;
const scene = byId('scene');
const sceneWrap = scene.parentElement!;
const roll = byId('roll');
const playButton = byId<HTMLButtonElement>('play');
const dataButton = byId<HTMLButtonElement>('data-toggle');
const drawer = byId<HTMLDialogElement>('drawer');
const nextButton = byId<HTMLButtonElement>('next');
const backButton = byId<HTMLButtonElement>('back');

let stage = 0;
let reached = 0;
let direction = 1;
let root = 0;
let type = major;
let shape = { ...ROOT_SHAPE };
let compareShape = { ...ROOT_SHAPE, inversion: 1 };
let keyRoot: number | null = null;
let keyScale: Harmony['key']['scale'] = 'major';
let templateId = CASTRATO;
let hits: CustomHit[] = initialHits.map((hit) => ({ ...hit }));
let query = '';
let explorePatternId = '';
let engine: Awaited<ReturnType<typeof makeEngine>>;
let result: Result | undefined;
let otherResult: Result | undefined;
let selectedNote = 0;
let playTimer = 0;
let playAnimation: Animation | undefined;
let heldPointer: number | undefined;
let activeAudition = false;
let error = '';
const marks = new Map<string, HTMLButtonElement>();
let gridKey = '';
let initialPaint = true;
let isChangingScene = false;
let queuedChapter: number | undefined;

const currentHarmony = (): Harmony => ({
  root, type, symbol: chordName(root, type), key: { root: keyRoot ?? root, scale: keyScale },
});
const currentPattern = () => stage === 5 ? explorePatternId : stage === 2 || stage === 3 ? templateId : '';
const pitchList = (pitches: readonly number[]) => pitches.map(pitchName).join(' · ');
const shapeLabel = (current: Shape) => current.inversion ? ['Root', '1st inversion', '2nd inversion', '3rd inversion'][current.inversion] : CHORD_VOICINGS[current.voicing];
const option = (value: string | number, label: string) => html`<option value=${value}>${label}</option>`;
const changeValue = (event: Event) => (event.currentTarget as HTMLInputElement).value;
const beatText = (ticks: number) => (ticks / PPQ).toFixed(3).replace(/\.?0+$/, '');
const patternName = (id: string) => id === CASTRATO ? 'Castrato · Rhythms' : id === BASIC_BASS ? 'Basic 1 · Common Bass' : engine.templates.get(id)?.name ?? 'No pattern';

function stop() {
  hush();
  clearTimeout(playTimer);
  byId('playhead').classList.remove('active');
  playButton.setAttribute('aria-pressed', 'false');
  playButton.innerHTML = '<span aria-hidden="true">▶</span> Play';
  // Leave the cursor at its last position while it fades out.
  if (playAnimation?.playState === 'running') playAnimation.pause();
  activeAudition = false;
}

function play(target = result) {
  if (!target?.notes.length) return;
  stop();
  try {
    const length = playNotes(target.notes);
    const head = byId('playhead');
    head.classList.add('active');
    playAnimation?.cancel();
    if (!motion.matches) playAnimation = head.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(' + roll.clientWidth + 'px)' }], { duration: length, fill: 'forwards' });
    playButton.setAttribute('aria-pressed', 'true');
    playButton.innerHTML = '<span aria-hidden="true">■</span> Stop';
    activeAudition = true;
    playTimer = window.setTimeout(stop, length);
  } catch {
    byId('error').textContent = 'Audio is unavailable in this browser. You can still inspect the notes.';
  }
}

function showGrid(rows: number[]) {
  const pattern = rows.join(',');
  if (pattern === gridKey) return;
  gridKey = pattern;
  const rowHeight = (100 - 9.2) / rows.length;
  const row = (pitch: number, index: number, label: boolean) => html`<div class=${(label ? 'key-label' : 'pitch-row') + (isBlackKey(pitch) ? ' black' : '')}
    style=${'top:' + (9.2 + rowHeight * index) + '%;height:' + rowHeight + '%'}>${label ? pitchName(pitch) : nothing}</div>`;
  render(html`${repeat(rows, (pitch) => pitch, (pitch, i) => row(pitch, i, false))}
    ${Array.from({ length: BEATS * 2 }, (_, i) => html`<i class=${i % 2 ? 'beat-line sub' : 'beat-line'} style=${'left:' + i / (BEATS * 2) * 100 + '%'}></i>
      ${i % 2 === 0 ? html`<span class="beat-label" style=${'left:' + i / (BEATS * 2) * 100 + '%'}>${i / 2 + 1}</span>` : nothing}`)}`, byId('grid'));
  render(html`${repeat(rows, (pitch) => pitch, (pitch, i) => row(pitch, i, true))}`, byId('pitch-labels'));
}

function drawRoll() {
  const activeNotes = result?.notes ?? [];
  const referenceNotes = otherResult?.notes ?? [];
  const allPitches = [...new Set([...activeNotes, ...referenceNotes].map((note) => note.pitch).concat(result?.region.pitches ?? []))].sort((a, b) => b - a);
  const high = allPitches[0] ?? 67;
  const low = allPitches.at(-1) ?? 60;
  const anchor = result?.region.rootMidi ?? low;
  const ceiling = Math.min(127, Math.max(high + 1, low + 10, anchor + 13));
  const floor = Math.max(0, Math.min(low - 1, anchor - 1));
  const rows = ceiling - floor < 19 ? Array.from({ length: ceiling - floor + 1 }, (_, i) => ceiling - i) : allPitches;
  showGrid(rows);
  const height = (100 - 9.2) / rows.length;
  const comparison = !!otherResult;
  const signatures = new Set(referenceNotes.map(noteSignature));
  const activeSignatures = new Set(activeNotes.map(noteSignature));
  const active = new Set<string>();
  const lane = byId('pitches');

  function place(notes: readonly PlaybackNote[], isReference: boolean) {
    const occurrences = new Map<number, number>();
    notes.forEach((note, index) => {
      if (isReference && activeSignatures.has(noteSignature(note))) return;
      const pc = pitchClass(note.pitch);
      const occurrence = (occurrences.get(pc) ?? 0) + 1;
      occurrences.set(pc, occurrence);
      const ordinal = result?.pattern ? index : pc + '-' + occurrence;
      const id = (isReference ? 'a-' : 'b-') + ordinal;
      active.add(id);
      let button = marks.get(id);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.addEventListener('click', () => {
          selectedNote = Number(button!.dataset.index);
          updateInspector();
          updateSelection();
        });
        marks.set(id, button);
        lane.append(button);
        if (!initialPaint && !motion.matches) {
          button.animate([{ opacity: 0, transform: 'translateY(7px)' }, { opacity: 1, transform: 'translateY(0)' }], {
            duration: 410, delay: Math.min(index * 24, 110), easing: guideEasing, fill: 'backwards',
          });
        }
      }
      button.className = 'mark ' + (isReference ? 'reference' : comparison ? signatures.has(noteSignature(note)) ? 'match' : 'comparison' : '');
      button.dataset.index = String(index);
      const label = pitchName(note.pitch);
      button.textContent = label;
      button.setAttribute('aria-label', label + ', beat ' + (1 + note.start / PPQ).toFixed(2) + ', MIDI ' + note.pitch);
      button.tabIndex = isReference ? -1 : 0;
      button.setAttribute('aria-hidden', String(isReference));
      button.style.top = (9.2 + height * rows.indexOf(note.pitch) + .5) + '%';
      button.style.height = Math.max(1.6, height - .9) + '%';
      button.style.left = (note.start / (BEATS * PPQ) * 100) + '%';
      button.style.width = 'calc(' + (note.duration / (BEATS * PPQ) * 100) + '% - 1px)';
    });
  }
  place(referenceNotes, true);
  place(activeNotes, false);
  for (const [id, mark] of marks) {
    if (active.has(id) || mark.classList.contains('leaving')) continue;
    mark.classList.add('leaving');
    mark.tabIndex = -1;
    mark.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => {
      if (mark.classList.contains('leaving')) {
        mark.remove();
        marks.delete(id);
      }
    }, motion.matches ? 0 : 350);
  }
  updateSelection();
  initialPaint = !result;
  render(comparison
    ? html`<span><i class="swatch a"></i> A only</span><span><i class="swatch b"></i> B only</span><span><i class="swatch"></i> Both</span>`
    : html`<span><i class="swatch"></i> ${result?.pattern ? 'Generated notes' : 'Voiced chord'}</span>`, byId('legend'));
}

function updateSelection() {
  for (const [id, mark] of marks) {
    mark.setAttribute('aria-pressed', String(id.startsWith('b-') && !mark.classList.contains('leaving') && stage >= 2 && Number(mark.dataset.index) === selectedNote));
  }
}

function recalculate(focusHit?: string) {
  stop();
  error = '';
  try {
    otherResult = stage === 3 ? engine.render(currentHarmony(), { ...ROOT_SHAPE, octave: shape.octave }, templateId) : undefined;
    const example = engine.render(currentHarmony(), stage === 3 ? { ...compareShape, octave: shape.octave } : shape, currentPattern(), stage === 4 ? hits : undefined);
    result = example;
    if (focusHit) {
      const match = example.notes.findIndex((note) => getTrace(example, note).event?.id === focusHit);
      if (match !== -1) selectedNote = match;
    }
    if (selectedNote >= result.notes.length) selectedNote = 0;
  } catch (problem) {
    result = undefined;
    otherResult = undefined;
    error = problem instanceof Error ? problem.message : 'This combination could not be rendered.';
  }
  update();
}

function setRoot(pitch: number, quality?: ChordType) {
  root = pitch;
  if (quality) setType(quality, false);
  recalculate();
}

function setType(quality: ChordType, refresh = true) {
  type = quality;
  const max = Math.min(3, type.intervals.length - 1);
  shape.inversion = Math.min(shape.inversion, max);
  compareShape.inversion = Math.min(compareShape.inversion, max);
  if (refresh) recalculate();
}

function selectTile(pitch: number, quality: ChordType, withSound: boolean) {
  setRoot(pitch, quality);
  if (withSound && result) audition(result.region.pitches, false);
}

function beginHold(event: PointerEvent, pitch: number, quality: ChordType) {
  if (!event.isPrimary || event.button !== 0) return;
  const button = event.currentTarget as HTMLButtonElement;
  heldPointer = event.pointerId;
  stop();
  try {
    const harmony = { ...currentHarmony(), root: pitch, type: quality, symbol: chordName(pitch, quality), key: { root: keyRoot ?? pitch, scale: keyScale } };
    const held = engine.render(harmony, { ...shape, inversion: Math.min(shape.inversion, quality.intervals.length - 1) });
    audition(held.region.pitches, true);
  } catch {
    // Selection still works if a note range or audio output is unavailable.
  }
  button.setPointerCapture(event.pointerId);
}

function finishHold(event: PointerEvent, pitch?: number, quality?: ChordType) {
  if (heldPointer !== event.pointerId) return;
  heldPointer = undefined;
  stop();
  if (pitch !== undefined && quality) selectTile(pitch, quality, false);
}

function playOptions() {
  return BUTTON_PATTERNS.map((id) => html`<button type="button" class="button" aria-pressed=${String(templateId === id)}
    @click=${() => { templateId = id; selectedNote = 0; recalculate(); }}>${patternName(id)}</button>`);
}

function shapeFields(current: Shape, compare = false) {
  const updateShape = (patch: Partial<Shape>) => {
    Object.assign(current, patch);
    recalculate();
  };
  const voicings = offeredVoicings(engine.scaled.voicingNames);
  return html`<div class="fields">
    ${compare ? nothing : html`<label>Octave<select .value=${live(String(current.octave))} @change=${(e: Event) => updateShape({ octave: +changeValue(e) })}>
      ${[1, 2, 3, 4, 5, 6].map((octave) => option(octave, String(octave)))}</select></label>`}
    <label>${compare ? 'B inversion' : 'Inversion'}<select .value=${live(String(current.inversion))}
      @change=${(e: Event) => updateShape({ inversion: +changeValue(e) })}>
      ${['Root', 'First', 'Second', 'Third'].slice(0, type.intervals.length).map((label, i) => option(i, label))}</select></label>
    <label>${compare ? 'B voicing' : 'Voicing'}<select .value=${live(current.voicing)}
      @change=${(e: Event) => updateShape({ voicing: changeValue(e) as Shape['voicing'] })}>
      ${voicings.map((voicing) => option(voicing, CHORD_VOICINGS[voicing]))}</select></label>
  </div>`;
}

function chooseScene() {
  return html`<div class="scene-title"><h2>Choose a chord</h2><p>Hold to hear it. Release to choose it.</p></div>
    <div class="tiles">${repeat([major, minor].flatMap((quality) => roots.map((pitch) => ({ pitch, quality }))), ({ pitch, quality }) => pitch + quality.id, ({ pitch, quality }) =>
      html`<button class="button tile" type="button" aria-pressed=${String(pitch === root && quality === type)}
        @pointerdown=${(event: PointerEvent) => beginHold(event, pitch, quality)}
        @pointerup=${(event: PointerEvent) => finishHold(event, pitch, quality)}
        @pointercancel=${(event: PointerEvent) => finishHold(event)}
        @lostpointercapture=${(event: PointerEvent) => finishHold(event)}
        @click=${(event: MouseEvent) => { if (event.detail === 0) selectTile(pitch, quality, true); }}>${chordName(pitch, quality)}</button>`)}</div>`;
}

function voicingScene() {
  return html`<div class="scene-title"><h2>Adjust the chord</h2><p>Try First inversion and watch the lowest note.</p></div>
    <div class="scene-row">${variants.map((variant) => html`<button type="button" class="button tile" aria-pressed=${String(type === variant)}
      @click=${() => { setType(variant); if (result) audition(result.region.pitches, false); }}>${chordName(root, variant)}</button>`)}</div>
    ${shapeFields(shape)}`;
}

function compareScene() {
  return html`<div class="scene-title"><h2>Compare two shapes</h2><div class="scene-row">${playOptions()}</div></div>
    <div class="scene-row">
      <button class="button" type="button" @click=${() => play(otherResult)}>Play A · Root position</button>
      <button class="button" type="button" @click=${() => play()}>Play B · ${shapeLabel(compareShape)}</button>
      ${shapeFields(compareShape, true)}
    </div>`;
}

function editHit(index: number, patch: Partial<CustomHit>) {
  hits = hits.map((hit, hitIndex) => hitIndex === index ? { ...hit, ...patch } : hit);
  recalculate('hit-' + (index + 1));
}

function updateBeat(event: Event, index: number, field: 'startBeat' | 'durationBeats') {
  const input = event.currentTarget as HTMLInputElement;
  const value = input.valueAsNumber;
  if (!Number.isFinite(value)) {
    input.value = String(hits[index][field]);
    return;
  }
  const minimum = field === 'startBeat' ? 0 : .125;
  const maximum = field === 'startBeat' ? 3.875 : 4;
  editHit(index, { [field]: Math.min(maximum, Math.max(minimum, value)) });
  input.value = String(hits[index][field]);
}

function makerScene() {
  return html`<div class="scene-title"><h2>Your four-beat loop</h2>${shapeFields(shape)}</div>
    <div class="event-editor">${hits.map((hit, i) => html`<fieldset>
      <legend><label><span><input type="checkbox" .checked=${live(hit.enabled)} @change=${(event: Event) => editHit(i, { enabled: (event.currentTarget as HTMLInputElement).checked })}> Hit ${i + 1}</span></label></legend>
      <label>Pitch rule<select ?disabled=${!hit.enabled} .value=${live(hit.rule)} @change=${(event: Event) => editHit(i, { rule: changeValue(event) as Rule })}>
        ${Object.entries(pitchInstructions).map(([rule, { label }]) => option(rule, label))}</select></label>
      <div class="timing">
        <label>Beat offset<input type="number" min="0" max="3.875" step=".125" ?disabled=${!hit.enabled} .value=${live(String(hit.startBeat))}
          @change=${(event: Event) => updateBeat(event, i, 'startBeat')}></label>
        <label>Length<input type="number" min=".125" max="4" step=".125" ?disabled=${!hit.enabled} .value=${live(String(hit.durationBeats))}
          @change=${(event: Event) => updateBeat(event, i, 'durationBeats')}></label>
      </div>
    </fieldset>`)}</div>`;
}

function exploreScene() {
  const terms = query.trim().toLowerCase().split(/\s+/);
  const groups = new Map<string, NonNullable<Result['template']>[]>();
  for (const template of engine.templates.values()) {
    const text = [template.name, template.category, template.subcategory].join(' ').toLowerCase();
    if (template.id !== explorePatternId && !terms.every((term) => text.includes(term))) continue;
    const group = groups.get(template.category);
    if (group) group.push(template);
    else groups.set(template.category, [template]);
  }
  return html`<div class="scene-title"><h2>Chord and key</h2></div>
    <div class="fields">
      <label>Root<select .value=${live(String(root))} @change=${(event: Event) => setRoot(+changeValue(event))}>${roots.map((pitch) => option(pitch, pitchClassName(pitch)))}</select></label>
      <label>Chord type<select .value=${live(type.id)} @change=${(event: Event) => setType(CHORD_TYPES.find((candidate) => candidate.id === changeValue(event))!)}>
        ${CHORD_FAMILIES.map((family) => html`<optgroup label=${family.label}>${CHORD_TYPES.filter((candidate) => candidate.family === family.id).map((candidate) => option(candidate.id, candidate.name))}</optgroup>`)}</select></label>
      <label>Key center<select .value=${live(keyRoot === null ? 'auto' : String(keyRoot))} @change=${(event: Event) => {
        const value = changeValue(event); keyRoot = value === 'auto' ? null : +value; recalculate();
      }}>${option('auto', 'Follow chord root')}${roots.map((pitch) => option(pitch, pitchClassName(pitch)))}</select></label>
      <label>Scale<select .value=${live(keyScale)} @change=${(event: Event) => { keyScale = changeValue(event) as Harmony['key']['scale']; recalculate(); }}>
        ${[['major', 'Major'], ['minor', 'Minor'], ['dorian', 'Dorian'], ['phrygian', 'Phrygian'], ['lydian', 'Lydian'], ['mixolydian', 'Mixolydian'], ['locrian', 'Locrian'], ['harmonicMinor', 'Harmonic minor'], ['melodicMinor', 'Melodic minor'], ['majorPentatonic', 'Major pentatonic'], ['minorPentatonic', 'Minor pentatonic'], ['blues', 'Blues']].map(([value, label]) => option(value, label))}
      </select></label>
      ${shapeFields(shape)}
    </div>
    <div class="fields">
      <label>Find a pattern<input type="search" placeholder="Name or category" .value=${live(query)} @input=${(event: Event) => { query = changeValue(event); updateScene(); }}></label>
      <label class="pattern-field">Factory pattern<select .value=${live(explorePatternId)} @change=${(event: Event) => {
        explorePatternId = changeValue(event); selectedNote = 0; recalculate();
      }}>${option('', 'No pattern')}${[...groups].map(([category, templates]) => html`<optgroup label=${category}>
        ${repeat(templates, (template) => template.id, (template) => option(template.id, template.name + ' · ' + template.subcategory))}
      </optgroup>`)}</select></label>
    </div>
    ${query.trim() && groups.size === 0 ? html`<p role="status">No patterns match your search.</p>` : nothing}`;
}

function updateScene() {
  const content = [
    chooseScene, voicingScene,
    () => html`<div class="scene-title"><h2>Try a factory pattern</h2><p>Select any note in the roll to follow it.</p></div><div class="scene-row">${playOptions()}</div>`,
    compareScene, makerScene, exploreScene,
  ][stage]();
  render(content, scene);
}

const reading = (label: string, value: string | number) => html`<div><dt>${label}</dt><dd>${value}</dd></div>`;

function chordExample({ region }: Result) {
  const recipe = [...new Set(region.intervals.map((interval) => pitchClass(region.root + interval)))];
  const names = recipe.map(pitchClassName).join(' · ');
  if (stage !== 1 && stage !== 5) return html`<h2>Notes in this recipe</h2><p class="recipe-notes">${names}</p>`;

  const copies = new Map<number, number>();
  for (const key of region.pitches) {
    const name = pitchClass(key);
    copies.set(name, (copies.get(name) ?? 0) + 1);
  }
  const repeats = [...copies].filter(([, count]) => count > 1).map(([name]) => name);
  const missing = recipe.filter((name) => !copies.has(name));
  const keys = region.pitches.map((key, i) => html`${i ? ' · ' : ''}${repeats.includes(pitchClass(key))
    ? html`<strong class="repeated-key">${pitchName(key)}</strong>`
    : pitchName(key)}`);
  const guitar = region.voicing === 'guitar';
  return html`<dl class="recipe-comparison">
    ${reading('Notes in this recipe', names)}
    <div><dt>Keys in this voicing</dt><dd>${keys}</dd></div>
  </dl>
  ${guitar || repeats.length || missing.length ? html`<p>
    ${guitar ? 'Guitar fits the chord to a playable shape. ' : nothing}
    ${repeats.length && guitar ? html`${repeats.map((name, index) => html`${index ? ' and ' : ''}
      ${copies.get(name)} strings play <strong>${pitchClassName(name)}</strong>`)} in different octaves. ` : nothing}
    ${repeats.length && !guitar ? html`
      <strong>${repeats.map(pitchClassName).join(' and ')}</strong> ${repeats.length === 1 ? 'appears' : 'appear'} more than once. ` : nothing}
    ${missing.length ? html`This shape leaves out <strong>${missing.map(pitchClassName).join(' and ')}</strong>.` : nothing}
  </p>` : nothing}`;
}

function comparisonExample(a: Result, b: Result) {
  const signature = (example: Result) => example.notes.map(noteSignature).sort().join('|');
  const matches = signature(a) === signature(b);
  const octaveA = octaveOf(Math.min(...a.region.pitches));
  const octaveB = octaveOf(Math.min(...b.region.pitches));
  const noteNames = (example: Result) => [...new Set(example.region.pitches.map(pitchClass))].sort((a, b) => a - b).join(',');
  const sameNoteNames = noteNames(a) === noteNames(b);
  const sameShape = a.region.pitches.join(',') === b.region.pitches.join(',');
  const reason = sameShape
    ? 'A and B use the same keys. Change B’s inversion or voicing to test a different shape.'
    : templateId === CASTRATO
      ? 'Castrato picks from the actual keys in each shape.'
      : matches && sameNoteNames && octaveA === octaveB
        ? 'Basic 1 uses the chord’s note names and the lowest key’s octave. Both shapes kept the same note names, and both lowest keys are in octave ' + octaveA + '.'
        : 'Basic 1 fits a bass line to the chord and key. The lowest voiced key helps set its octave.' +
          (octaveA !== octaveB ? ' Here the lowest key moved from octave ' + octaveA + ' to octave ' + octaveB + '.' : '');
  return html`<h2>${matches ? 'Identical MIDI output' : 'The MIDI output changed'}</h2>
    <p>${reason}</p>
    <dl>${reading('A · Voiced keys', pitchList(a.region.pitches))}${sameShape ? nothing : reading('B · Voiced keys', pitchList(b.region.pitches))}</dl>`;
}

function noteExample(example: Result, note: PlaybackNote) {
  const pitch = pitchName(note.pitch);
  const { event, rhythmVoice } = getTrace(example, note);
  let heading = 'Pattern hit → ' + pitch;
  let explanation;
  if (rhythmVoice !== undefined) {
    heading = 'Voiced note ' + rhythmVoice + ' → ' + pitch;
  } else if (example.template?.category === 'Bass') {
    heading = 'Bass hit → ' + pitch;
    if (!example.region.pitches.includes(note.pitch)) explanation = 'The pattern chose a key outside the voicing while fitting the bass line to the chord and key.';
  } else if (stage === 4 && event) {
    const rule = event.pitch;
    const hitIndex = Number(event.id?.split('-').at(-1)) - 1;
    const hit = hits[hitIndex];
    heading = hit ? pitchInstructions[hit.rule].label + ' → ' + pitch : heading;
    if (rule.type === 'chordTone' && rule.index >= example.region.pitches.length) {
      explanation = 'This shape runs out of voices, so the count starts again an octave higher.';
    } else if (rule.type === 'rootOffset') {
      explanation = 'The count starts on the chord root, in the octave of the lowest voiced key.';
    } else if (rule.type === 'scaleDegree') {
      explanation = 'This counts through the selected scale, starting from the key center.';
    }
  }
  return html`<h2>${heading}</h2>${explanation ? html`<p>${explanation}</p>` : nothing}
    <dl>${reading('Starts', note.start === 0 ? 'At the start' : beatText(note.start) + (note.start === PPQ ? ' beat in' : ' beats in'))}
      ${reading('Held for', beatText(note.duration) + (note.duration === PPQ ? ' beat' : ' beats'))}</dl>`;
}

function updateInspector() {
  const note = result?.notes[selectedNote];
  const observation = !result ? nothing
    : otherResult ? comparisonExample(otherResult, result)
    : !result.pattern ? chordExample(result)
    : note ? noteExample(result, note)
    : html`<h2>This bar is silent</h2><p>${stage === 4 ? 'Turn on a hit to give the pattern a note to play.' : 'Try another chord or pattern to generate notes here.'}</p>`;
  render(observation, byId('observation'));
  if (drawer.open) updateData();
}

function updateData() {
  if (!result) {
    render(nothing, byId('data'));
    return;
  }
  const { region, notes, pattern, template } = result;
  const picked = notes[selectedNote];
  const trace = getTrace(result, picked);
  const reader = (label: string, data: unknown) => html`<section><h3>${label}</h3><pre>${JSON.stringify(data, null, 2)}</pre></section>`;
  render(html`<div class="data-grid">
    ${reader('Chord and voicing', { symbol: region.symbol, root: region.root, intervals: region.intervals, rootMidi: region.rootMidi,
      pitches: region.pitches, voicing: region.voicing, inversion: region.inversion,
      lowestNoteOctave: octaveOf(Math.min(...region.pitches)),
      ...(region.performance ? { key: region.performance.key, scale: region.performance.scale, templateId: region.performance.templateId, phaseTicks: 0 } : {}) })}
    ${pattern ? reader(stage === 4 ? 'Pattern event' : 'Template and adapted event', {
      name: template?.name ?? pattern.name, category: template?.category, loopBeats: pattern.durationBeats,
      sourceEvent: trace.source, adaptedEvent: trace.event,
    }) : reader('Region timing', { startTick: region.start, durationTicks: region.duration, ppq: PPQ })}
    ${reader('Piano-roll note', picked ? { pitch: picked.pitch, start: picked.start, duration: picked.duration, ppq: PPQ, velocity: Number(picked.velocity.toFixed(6)) } : { notes: [] })}
  </div>`, byId('data'));
}

function snapshot(element: HTMLElement) {
  const copy = element.cloneNode(true) as HTMLElement;
  copy.removeAttribute('id');
  copy.querySelectorAll('[id]').forEach((item) => item.removeAttribute('id'));
  const fields = element.querySelectorAll('select, input');
  copy.querySelectorAll('select, input').forEach((field, i) => {
    const original = fields[i];
    if (field instanceof HTMLSelectElement && original instanceof HTMLSelectElement) field.value = original.value;
    if (field instanceof HTMLInputElement && original instanceof HTMLInputElement) {
      field.value = original.value;
      field.checked = original.checked;
    }
  });
  copy.inert = true;
  copy.setAttribute('aria-hidden', 'true');
  const bounds = element.getBoundingClientRect();
  const offsetY = element.offsetTop;
  const offsetX = element.offsetLeft;
  copy.style.cssText = 'position:absolute;pointer-events:none;z-index:1;width:' + bounds.width + 'px;top:' + offsetY + 'px;left:' + offsetX + 'px';
  element.after(copy);
  return copy;
}

function go(next: number) {
  if (!engine || next < 0 || next >= chapters.length || next === stage) return;
  direction = next > stage ? 1 : -1;
  if (isChangingScene && !motion.matches) {
    queuedChapter = next;
    return;
  }
  const canAnimate = !motion.matches;
  const heights = [composition, sceneWrap].map((element) => ({ element, before: element.offsetHeight }));
  const outgoing = canAnimate ? [snapshot(intro), snapshot(scene)] : [];
  stage = next;
  reached = Math.max(reached, stage);
  selectedNote = 0;
  recalculate();
  byId('current-title').focus({ preventScroll: true });
  if (document.documentElement.clientWidth < 680 && window.scrollY > 40) {
    window.scrollTo({ top: 0, behavior: motion.matches ? 'instant' : 'smooth' });
  }
  if (canAnimate) {
    isChangingScene = true;
    byId('observation').animate([
      { opacity: .70, transform: 'translateY(5px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 570, easing: guideEasing });
    const resized = heights.map(({ element, before }) => ({ element, before, after: element.offsetHeight }));
    for (const { element, before, after } of resized) {
      if (before === after) continue;
      element.animate([
        { height: before + 'px', overflow: 'clip' },
        { height: after + 'px', overflow: 'clip' },
      ], { duration: 660, easing: guideEasing });
    }
    outgoing.forEach((copy) => {
      const exit = copy.animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(' + direction * -16 + 'px)' }],
        { duration: 330, easing: 'ease-out', fill: 'forwards' });
      exit.finished.then(() => copy.remove(), () => copy.remove());
    });
    const entrance = [intro, scene].map((element, i) => element.animate([
      { opacity: 0, transform: 'translateY(' + direction * (i ? 28 : 19) + 'px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: i ? 680 : 610, delay: i ? 80 : 24, easing: guideEasing, fill: 'backwards' }));
    Promise.allSettled(entrance.map((animation) => animation.finished)).then(() => {
      isChangingScene = false;
      if (queuedChapter === undefined) return;
      const queued = queuedChapter;
      queuedChapter = undefined;
      go(queued);
    });
  }
}

function renderIntro() {
  const chapter = chapters[stage];
  render(html`<span class="eyebrow">${chapter.index}</span>
    <h1 id="current-title" tabindex="-1">${chapter.title}</h1>
    <p class="lesson-lead">${chapter.lead}</p>
    ${chapter.detail ? html`<dl class="lesson-detail">${chapter.detail.map(([label, description]) => reading(label, description))}</dl>` : nothing}`, intro);
}

function update() {
  renderIntro();
  render(html`${chapters.map(({ label }, i) => html`<button type="button" class="chapter" @click=${() => go(i)}
    aria-current=${i === stage ? 'step' : 'false'} ?disabled=${i > reached + 1 && i !== 5}>${label}</button>`)}`, byId('chapters'));
  byId('context').textContent = currentHarmony().symbol + ' · ' + (result?.pattern?.name ?? 'Held chord');
  byId('progress').textContent = stage < 5 ? 'Scene ' + (stage + 1) + ' of 5' : 'Free play';
  byId('error').textContent = error;
  playButton.disabled = !result?.notes.length;
  dataButton.disabled = !result;
  backButton.disabled = stage === 0;
  nextButton.textContent = stage === 4 ? 'Explore' : stage === 5 ? 'Back to chord' : 'Continue';
  updateScene();
  drawRoll();
  updateInspector();
}

backButton.addEventListener('click', () => go(stage - 1));
nextButton.addEventListener('click', () => go(stage === 5 ? 0 : stage + 1));
playButton.addEventListener('click', () => activeAudition ? stop() : play());
dataButton.addEventListener('click', () => {
  updateData();
  drawer.showModal();
});
drawer.addEventListener('click', (event) => {
  if (event.target !== drawer) return;
  const { left, right, top, bottom } = drawer.getBoundingClientRect();
  if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) drawer.close();
});
window.addEventListener('blur', () => { heldPointer = undefined; stop(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { heldPointer = undefined; stop(); } });

renderIntro();
render(html`<p class="loading" role="status">Loading chord and pattern data…</p>`, scene);
showGrid([71, 70, 69, 68, 67, 66, 65, 64, 63, 62, 61, 60]);
dataButton.disabled = playButton.disabled = nextButton.disabled = backButton.disabled = true;
makeEngine().then((ready) => {
  engine = ready;
  nextButton.disabled = false;
  recalculate();
}).catch(() => {
  render(html`<p class="error" role="alert">The chord and pattern library could not load. Refresh to try again.</p>`, scene);
});



