# @tasteee/maddie

A framework-agnostic, browser-based MIDI editor. Web components on a headless core.

- **Full editor:** `<maddie-editor>`
- **Compose your own:** `<maddie-root>` + `<maddie-piano-roll>`, `<maddie-keyboard>`, `<maddie-ruler>`, `<maddie-velocity-lane>`, toolbar controls
- **Headless:** `@tasteee/maddie/core`

Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Quick start

```html
<script type="module">
  import '@tasteee/maddie/elements';
</script>

<maddie-editor grid="1/16" scale="C minor" tempo="96"></maddie-editor>
```

```js
const el = document.querySelector('maddie-editor');
el.notes = [{ pitch: 60, start: 0, duration: 480, velocity: 0.8 }]; // ticks, PPQ 960
el.addEventListener('maddie-change', (e) => save(e.detail.doc));
```

## Sound

Maddie makes no sound. It schedules notes ahead of time and hands them to your `output`:

```js
import { SplendidGrandPiano } from 'smplr';
import { toMidiVelocity } from '@tasteee/maddie/core';

const ctx = new AudioContext();
const piano = SplendidGrandPiano(ctx);
el.audioContext = ctx; // share the clock
el.output = {
  noteOn: (e) => piano.start({ note: e.pitch, velocity: toMidiVelocity(e.velocity), time: e.time, duration: e.duration }),
  noteOff: () => {},
  allNotesOff: () => piano.stop(),
  audition: (e) => piano.start({ note: e.pitch, velocity: toMidiVelocity(e.velocity), duration: e.duration }),
};
```

## Compose your own

```html
<maddie-root scale="D dorian">
  <my-toolbar>
    <maddie-tool-select></maddie-tool-select>
    <maddie-grid-select></maddie-grid-select>
  </my-toolbar>
  <maddie-keyboard></maddie-keyboard>
  <maddie-piano-roll></maddie-piano-roll>
</maddie-root>
```

Pieces find the nearest `<maddie-root>` automatically. Or wire one directly: `roll.editor = root.editor`.

## Styling

1. **Tokens:** `--maddie-accent`, `--maddie-bg`, `--maddie-note`, `--maddie-note-radius`, … (light/dark built in, `theme="dark|light"`)
2. **Parts:** `maddie-editor::part(toolbar)`, `::part(piano-roll)`, …
3. **Slots:** replace `toolbar`, `corner`, `lane-label`, `footer`
4. **Canvas hook:** `roll.noteStyle = (note, state) => ({ fill: '#f59e0b' })`

## Develop

```sh
pnpm install
pnpm dev        # playground at localhost:5173
pnpm test       # core unit tests
pnpm build      # library → dist/
```
