# Maddie — Architecture

A framework-agnostic, browser-based MIDI editor library.
Ships as **web components**, built on a **headless core**.
Package: `@tasteee/maddie`. Tags: `maddie-*`. Desktop first.

---

## 1. The core decision

**Ship both: the pieces *and* the big component. The big component is built from the pieces.**

```
┌──────────────────────────────────────────────────────────────┐
│ 4. Preset        <maddie-editor>   (zero-config, full editor) │
├──────────────────────────────────────────────────────────────┤
│ 3. Elements      <maddie-piano-roll> <maddie-keyboard>        │
│                  <maddie-ruler> <maddie-velocity-lane> ...    │
├──────────────────────────────────────────────────────────────┤
│ 2. Engine        renderer · gestures · animation · hit-test   │
│                  (DOM + canvas, no custom elements)           │
├──────────────────────────────────────────────────────────────┤
│ 1. Core          document · commands · history · selection    │
│                  view · snap · scale · transport  (no DOM)    │
└──────────────────────────────────────────────────────────────┘
          Output (pluggable): emits MIDI note events — consumer makes the sound
```

Each layer only depends on the layers below it.

| Consumer wants…                         | They use            |
| --------------------------------------- | ------------------- |
| A working editor in 3 lines             | `<maddie-editor>`   |
| Own layout, own toolbar, our roll       | Elements in `<maddie-root>` |
| Own renderer (WebGL, React Native, etc) | `@tasteee/maddie/core` only  |

**Benefits**
- One code path. The preset dogfoods the pieces, so the pieces stay good.
- Consumers can start with the preset and "eject" piece by piece.
- Core is testable without a browser.

**Risks**
- Larger public API surface to keep stable.
- Mitigation: mark layer 2 (engine) as internal until 1.0. Public = core + elements.

---

## 2. Data flow

One store per editor. Every element reads from it and writes to it through commands.

```
pointer/keyboard
      │
      ▼
 Gesture (engine)  ──preview──▶  Overlay render (ephemeral, no store write)
      │ commit
      ▼
 store.dispatch(command)
      │
      ├─▶ beforechange event (cancelable, consumer can veto/transform)
      ├─▶ apply → patches
      ├─▶ history.push(inverse patches, gestureId)
      ├─▶ signals update → only dirty elements re-render
      └─▶ change event { patches, origin, doc }  → consumer saves / syncs
```

### Four kinds of state — kept separate

| State         | Examples                                         | Undoable | Persisted | Owner |
| ------------- | ------------------------------------------------ | -------- | --------- | ----- |
| **Document**  | notes, tempo map, time sig, key/scale            | yes      | yes       | core `doc` |
| **Selection** | selected note ids, keyboard cursor               | restored with undo, never its own entry | no | core `selection` |
| **View**      | zoom, scroll, grid, snap, fold, tool, lock-to-scale | no    | optional  | core `view` |
| **Ephemeral** | hover, drag ghost, marquee rect, animations      | no       | no        | engine only |

This split is the most important rule in the codebase. It is what makes undo, controlled mode, collab, and perf all work.

---

## 3. Core (`@tasteee/maddie/core`) — no DOM

### 3.1 Document model

**Time is in ticks.** Seconds are always derived from the tempo map. Change tempo → notes never drift.

```ts
type Tick = number;            // integer, PPQ = 960 by default
type NoteId = string;          // stable, consumer can supply

interface Note {
  id: NoteId;
  pitch: number;               // 0–127
  start: Tick;
  duration: Tick;
  velocity: number;            // 0–1 float. See §3.1.1.
  channel?: number;            // 0–15
  muted?: boolean;
  data?: Record<string, unknown>; // consumer payload, round-tripped untouched
}

interface MaddieDoc {
  version: 1;
  ppq: number;
  tempo: TempoEvent[];         // [{ tick: 0, bpm: 120 }]
  timeSignature: TimeSigEvent[]; // [{ tick: 0, num: 4, den: 4 }]
  key?: { root: PitchClass; scale: ScaleId | number[] };
  tracks: Track[];             // one or many; editor edits `activeTrackId`
}

interface Track {
  id: string;
  name?: string;
  color?: string;
  notes: Note[];
}
```

- Multi-track from day one. The editor edits one track; others can render as **ghost notes** (read-only).
- `data` lets consumers attach anything (ids from their DB, lyrics, articulations).

#### 3.1.1 Velocity is a 0–1 float

- Matches Web Audio gain, Tone.js, and MIDI 2.0 (16-bit velocity). No precision lost.
- Relative edits are clean: `+0.05`, `× 0.8`.
- Conversion helpers at the edges only:

```ts
import { toMidiVelocity, fromMidiVelocity } from '@tasteee/maddie/core';
toMidiVelocity(0.8)    // → 102  (round(v * 127), clamped 1–127 so note-on never becomes note-off)
fromMidiVelocity(102)  // → 0.803
```

- UI can display either: `velocity-display="percent" | "midi"` (default `midi`, musicians read 0–127).
- `.mid` import/export converts automatically.

### 3.2 Store

```ts
const editor = createEditor({ doc, view: { grid: '1/16', snap: true } });

editor.doc            // read-only snapshot (structurally shared, frozen in dev)
editor.selection      // Set<NoteId> + cursor
editor.view           // zoom, scroll, grid, snap, fold, tool…
editor.transport      // clock (see §6)
editor.history        // undo / redo

editor.dispatch(cmd)  // the only way to mutate the doc
editor.subscribe(selector, callback)  // fine-grained
```

- Internally uses **signals** for fine-grained updates. Public API is `subscribe(selector, cb)` so we don't leak the signal lib.
- Notes stored in a `Map<NoteId, Note>` plus a **spatial index** (sorted by start + interval tree) for fast range queries and hit testing at 20k+ notes.

### 3.3 Commands

Every edit is a named, serializable command. Commands produce **patches**; history stores inverse patches.

```ts
editor.commands.addNotes([{ pitch: 60, start: 0, duration: 480, velocity: 0.8 }]);
editor.commands.moveNotes(ids, { ticks: 240, pitches: 1 });
editor.commands.resizeNotes(ids, { edge: 'end', ticks: 120 });
editor.commands.setVelocity(ids, { mode: 'relative', value: -0.08 });
editor.commands.deleteNotes(ids);
editor.commands.quantize(ids, { grid: '1/16', strength: 1, swing: 0 });
editor.commands.transpose(ids, { semitones: 12 } | { scaleDegrees: 2 });
editor.commands.setTempo({ tick: 0, bpm: 128 });
```

Built-in command set (v1):

- **Notes:** add, delete, move, resize (start/end), split, glue, duplicate, mute, set velocity, legato, transpose, quantize, humanize
- **Clipboard:** copy, cut, paste (at cursor / playhead), duplicate-after
- **Doc:** set tempo, set time signature, set key/scale
- **Custom:** `editor.registerCommand(name, fn)` — consumers add their own, get undo for free

**Transactions** group many commands into one undo step:

```ts
editor.transact('Make chord', () => {
  editor.commands.addNotes(...);
  editor.commands.setVelocity(...);
});
```

**Gesture coalescing:** a drag fires many moves but creates **one** undo entry (keyed by `gestureId`).

### 3.4 History

- Patch-based undo/redo. Restores selection with each step.
- Configurable depth. `editor.history.canUndo` is a subscribable value (for toolbar buttons).
- Undo/redo is animated in the engine (see §8) so the user sees *what* changed.

### 3.5 Snap & grid — pure functions

```ts
type GridValue = '1/1' | '1/2' | '1/4' | '1/8' | '1/16' | '1/32' | '1/64'
               | `${string}T` /* triplet */ | `${string}.` /* dotted */ | 'auto';

snap(tick, { grid, mode, timeSig, ppq }) → Tick
```

- **Snap modes:** `off`, `grid` (absolute), `relative` (keeps a note's offset from the grid when moving), `magnetic` (snaps only within N px).
- **`auto` grid** picks the finest division with ≥ ~12px between lines at the current zoom. Lines fade, not pop (see §8).
- **Temporary bypass:** hold `Alt` while dragging.
- Grid is **time-signature aware** (bar lines follow the time sig map).
- Swing lives on quantize, not on the grid.

### 3.6 Scale, lock, fold — via one abstraction: `RowMap`

The y-axis is **not** pitch. It is a list of **rows**. A `RowMap` maps `row ↔ pitch`.

```ts
interface RowMap {
  rows: readonly Row[];              // top → bottom
  rowOfPitch(pitch): number | null;  // null = folded away
  pitchOfRow(row): number;
}
interface Row { pitch: number; label: string; inScale: boolean; isBlackKey: boolean; }
```

| Mode            | Rows shown                                  |
| --------------- | ------------------------------------------- |
| `fold: 'none'`  | all 128 pitches                             |
| `fold: 'scale'` | only in-scale pitches                       |
| `fold: 'used'`  | only pitches that have notes                |
| `fold: 'map'`   | consumer-supplied rows (drum maps: "Kick", "Snare"…) |

- **Scale lock** (`lockToScale: true`) is separate from fold. It constrains placing and pitch-dragging to in-scale pitches. Vertical moves step by scale degree.
- **Scale highlight** dims out-of-scale rows without hiding them.
- Keyboard, roll, and lanes all use the same `RowMap`, so fold "just works" everywhere.
- Changing fold animates rows collapsing (see §8).

Scales ship as data: major, minors, modes, pentatonics, blues, harmonic/melodic minor, custom interval arrays.

### 3.7 Viewport

Pure transform between model space and pixels:

```ts
viewport.tickToX(t)  viewport.xToTick(x)
viewport.rowToY(r)   viewport.yToRow(y)
viewport.zoomAt({ x, y }, factor)   // anchored zoom
```

- Zoom X and Y independently. Zoom is anchored to the pointer.
- All hit testing happens in model space, never in pixels stored on notes.

---

## 4. Engine (internal) — rendering + interaction

### 4.1 Rendering: canvas for content, DOM for chrome

| Surface                         | Tech           | Why |
| ------------------------------- | -------------- | --- |
| Grid lines, notes, velocity stems | **Canvas 2D** | 20k notes at 60fps. DOM can't. |
| Playhead                        | Canvas (v0) → DOM `transform` later | v0 redraws per frame while playing anyway (note flash). |
| Toolbar, inputs, menus, keyboard labels | **DOM** | Real focus, a11y, `::part` styling. |
| Screen reader layer             | DOM (visually hidden) | See §10. |

**Layered canvases per roll** (each redraws only when its inputs change):

1. `grid` — rows, beat/bar lines, scale shading. Redraws on view change.
2. `notes` — notes. Redraws on doc/selection/view change. Visible range only (via spatial index).
3. `overlay` — drag ghosts, marquee, hover, animating notes. Redraws during gestures.

- **One shared rAF scheduler** for all elements. No rAF loop when idle.
- DPR-aware, crisp 1px lines (half-pixel alignment).
- Optional OffscreenCanvas worker for the notes layer later (perf escape hatch, not v1).

### 4.2 Canvas + CSS styling bridge

Canvas can't read CSS directly. So:

1. Theme is defined as CSS custom properties on the host (see §7).
2. Engine reads resolved tokens via `getComputedStyle` on connect.
3. Token changes are detected by a **sentinel trick**: tokens are registered with `@property`, a hidden sentinel element has `transition: all 1ms` on them, and `transitionrun` fires when any token changes (theme switch, class change, media query). No polling.
4. Manual escape hatch: `el.refreshTheme()`.

Beyond tokens, per-note styling via JS hooks:

```ts
roll.noteStyle = (note, state) => ({ fill: note.channel === 9 ? '#f59e0b' : undefined });
roll.renderNote = (ctx, note, rect, state, defaultRender) => { defaultRender(); drawLyric(ctx, note); };
```

### 4.3 Gestures: explicit state machines

Each pointer interaction is a small state machine. No tangled `if (isDragging && !isResizing)` flags.

```
idle ──down──▶ pressed ──move>3px──▶ dragging:{move|resizeStart|resizeEnd|marquee|draw|velocity}
  ▲                │ up (no move)                     │ up
  │                ▼                                  ▼
  └──────────── click action                     commit command (one undo entry)
                                                 Esc → cancel, nothing committed
```

**Hit zones** (in px, so they work at every zoom):
- Note body → move
- Left/right edge (6px, min 1/3 of note width) → resize
- Empty space → marquee (select tool) or draw (draw tool)
- Velocity tool (`G`) + drag vertical on a note → velocity. `Alt` is reserved for snap bypass.

**Tools:** `select`, `draw`, `erase`, `velocity` (`slice` later). Draw tool on empty space = click to place, drag to set length.

Pointer Events + `setPointerCapture`. **Desktop first:** mouse, trackpad (pinch = zoom, two-finger = scroll), pen. Pointer Events keep touch possible later without a rewrite, but touch is not a v1 target.

**Smart defaults that make it feel premium:**
- New notes inherit the **last used length and velocity**.
- Drag a selection by one note → all move together, relative offsets kept.
- `Shift` constrains drag to one axis. `Alt` bypasses snap. `Cmd/Ctrl`+drag duplicates.
- Auto-scroll when dragging near edges, speed scales with distance.
- Audition the pitch on place / pitch change (debounced, via the output).

### 4.4 Keymap

Declarative and overridable:

```ts
editor.keymap = {
  ...defaultKeymap,
  'mod+d': 'duplicate',
  'q': 'quantize',
  'alt+arrowup': ['setVelocity', { mode: 'relative', value: 0.05 }],
};
```

Full keyboard editing: arrows move cursor/selection by grid, `shift+arrow` resize, `alt+arrow` velocity, `Enter` insert at cursor, `Delete`, `mod+z/shift+z`, `mod+a`, `mod+c/x/v`, `space` play/stop, `+/-` zoom.

---

## 5. Elements (`@tasteee/maddie/elements`)

### 5.1 Element list

| Element                     | Does |
| --------------------------- | ---- |
| `<maddie-root>`             | Owns the store. Provides it to descendants. No UI. |
| `<maddie-editor>`           | Preset. Is a `<maddie-root>` + a default layout of every piece. |
| `<maddie-piano-roll>`       | Grid + notes. The main canvas. |
| `<maddie-keyboard>`         | Vertical piano keys / row labels. Click to audition. Follows `RowMap`. |
| `<maddie-ruler>`            | Bars/beats, seek, loop region, time sig/tempo markers. |
| `<maddie-velocity-lane>`    | Velocity stems. Draw/drag to edit. |
| `<maddie-lane type="cc">`   | (later) CC / pitch bend lanes. Same base as velocity lane. |
| `<maddie-overview>`         | Minimap of the whole clip. Drag to scroll/zoom. |
| `<maddie-transport>`        | Play/stop/loop/metronome buttons + position display. |
| `<maddie-toolbar>`          | Default toolbar, composed of the controls below. |
| Controls                    | `<maddie-tool-select>` `<maddie-grid-select>` `<maddie-snap-toggle>` `<maddie-scale-select>` `<maddie-fold-select>` `<maddie-tempo>` `<maddie-zoom>` `<maddie-quantize>` |
| `<maddie-note-inspector>`   | Edit pitch/start/length/velocity of selection numerically. |

### 5.2 How pieces find the store: context

Elements find the nearest `<maddie-root>` ancestor via the **Web Components Community Group context protocol** (`context-request` event). Works across shadow roots, works with any framework.

```html
<maddie-root id="root" grid="1/16" scale="C minor">
  <my-own-toolbar>
    <maddie-grid-select></maddie-grid-select>
    <button onclick="root.editor.history.undo()">Undo</button>
  </my-own-toolbar>

  <div class="my-layout">
    <maddie-keyboard></maddie-keyboard>
    <maddie-piano-roll></maddie-piano-roll>
    <maddie-velocity-lane></maddie-velocity-lane>
  </div>
</maddie-root>
```

Or wire explicitly when elements aren't nested (portals, split panes):

```js
roll.editor = editor;   // any element accepts `.editor`
```

Scroll and zoom sync is automatic: keyboard, roll, ruler, and lanes all read the same `view`.

### 5.3 Attributes vs properties

- **Attributes** for simple scalars: `grid`, `snap`, `scale`, `fold`, `tool`, `tempo`, `zoom`, `theme`, `readonly`.
- **Properties** for data and objects: `doc`, `notes`, `editor`, `keymap`, `output`, `noteStyle`, `renderNote`.
- Attributes behave like `<input value>`: they set state; the user can change state through the UI; re-setting the attribute wins. We **do not** reflect UI changes back onto attributes (avoids fights with frameworks).

### 5.4 Events

All `CustomEvent`, `bubbles: true, composed: true`, prefixed `maddie-`.

| Event                     | Detail | Cancelable |
| ------------------------- | ------ | ---------- |
| `maddie-beforechange`     | `{ command, patches }` | yes — veto or replace |
| `maddie-change`           | `{ patches, origin, doc }` | no |
| `maddie-selectionchange`  | `{ ids }` | no |
| `maddie-viewchange`       | `{ view }` | no |
| `maddie-transportchange`  | `{ state, tick }` | no |
| `maddie-noteon` / `maddie-noteoff` | `{ note, time }` during playback + audition | no |

`origin` is `'user' | 'api' | 'history' | 'remote'` so consumers can avoid echo loops when syncing.

### 5.5 Controlled vs uncontrolled

- **Uncontrolled (default):** the element owns the doc. Read `el.doc` anytime, listen to `maddie-change`.
- **Controlled:** `<maddie-root controlled>`. Commits fire `maddie-beforechange` and are **not applied** until the consumer sets `el.doc`. Drag previews still render (they're ephemeral), so it stays smooth. Fits React/Redux/server-authoritative apps.
- **Patch sync:** `editor.applyPatches(patches, { origin: 'remote' })` — the hook for Yjs/Automerge/multiplayer adapters.

### 5.6 Base class

**Decided: Lit.** All elements extend one `MaddieElement extends LitElement` base that handles: context lookup, `.editor` property, `subscribe` cleanup on disconnect, theme bridge.

- Chrome elements (toolbar, controls, inspector) render with Lit templates.
- Canvas elements (roll, keyboard, ruler, lanes) use Lit only for the shell; the engine draws.
- **Benefits:** standard, well-known, tiny (~5kb), fast, great TS decorators.
- **Risks:** one runtime dep. Lit is a `dependency`, not bundled, so apps already using Lit share one copy.

### 5.7 Registration

```js
import '@tasteee/maddie/elements';             // defines all, side effect
import '@tasteee/maddie/elements/piano-roll';  // define one
import { defineMaddie } from '@tasteee/maddie/elements';
defineMaddie({ prefix: 'acme' });            // <acme-piano-roll>, avoids tag collisions
```

Safe double-define (no throw if already registered with same class).

---

## 6. Playback — who owns what

**We own the clock. We dispatch MIDI. The consumer makes the sound.**

No built-in synth. The playhead, follow-mode, loop region, note highlighting, and ruler all need a clock, so that's ours. Sound varies wildly per app, so we only emit note events.

```
Transport (core) ── schedules ──▶ note events
   play/stop/seek/loop               ├─ editor.output.noteOn/noteOff   (scheduled, sample-accurate time)
   tempo map → seconds               ├─ maddie-noteon / maddie-noteoff DOM events (for UI, logging)
   lookahead scheduler               └─ nothing set → silent, visual only
```

### 6.1 Transport

```ts
editor.transport.play(); .stop(); .pause(); .seek(tick);
editor.transport.loop = { start: 0, end: 3840, enabled: true };
editor.transport.position   // subscribable tick
editor.transport.state      // 'stopped' | 'playing' | 'paused'
```

- **Lookahead scheduler** on an `AudioContext` clock (25ms timer, ~100ms horizon). Rock solid timing, not `setTimeout` timing.
- Uses the consumer's `AudioContext` if given (`createEditor({ audioContext })`), so scheduled times line up with their instrument. Otherwise creates one lazily on first play.
- Reads the **tempo map**, so tempo changes mid-song are correct.
- Edits during playback are picked up on the next scheduling window.
- Playhead position = `transport.tickAt(audioCtx.currentTime - outputLatency)` per frame.
- Metronome is an event too (`onTick` of beat/bar) — consumer decides if it clicks.

### 6.2 Output interface

The scheduler calls these **ahead of time** with an exact `AudioContext` time. DOM events are too late and too jittery for audio, so audio goes through `output`, not events.

```ts
interface Output {
  noteOn(e: NoteEvent): void;
  noteOff(e: NoteEvent): void;
  allNotesOff(): void;                 // stop, seek, loop wrap
  audition?(e: NoteEvent): void;       // preview while editing (place, drag pitch, click key)
}

interface NoteEvent {
  note: Note;          // full note, incl. consumer `data`
  pitch: number;       // 0–127
  velocity: number;    // 0–1
  time: number;        // AudioContext seconds; 0 = now (audition)
  duration?: number;   // seconds, on noteOn — lets sample players skip noteOff
}
```

Adapters stay tiny. Web MIDI, for example:

```ts
const midiOut = (port: MIDIOutput, ctx: AudioContext): Output => {
  const at = (t: number) => performance.now() + (t - ctx.currentTime) * 1000;
  return {
    noteOn:  e => port.send([0x90, e.pitch, toMidiVelocity(e.velocity)], at(e.time)),
    noteOff: e => port.send([0x80, e.pitch, 0], at(e.time)),
    allNotesOff: () => port.send([0xb0, 123, 0]),
  };
};
```

We may ship `webMidiOutput()` later as a ~20-line helper. Not v1.

### 6.3 Demo / POC: smplr Splendid Grand Piano

The playground (not the library) wires up [smplr](https://github.com/danigb/smplr):

```ts
import { SplendidGrandPiano } from 'smplr';

const audioContext = new AudioContext();
const piano = new SplendidGrandPiano(audioContext);
const editor = document.querySelector('maddie-editor').editor;

editor.audioContext = audioContext;   // share the clock
editor.output = {
  noteOn: e => piano.start({ note: e.pitch, velocity: toMidiVelocity(e.velocity), time: e.time, duration: e.duration }),
  noteOff: () => {},                  // duration already handles release
  allNotesOff: () => piano.stop(),
  audition: e => piano.start({ note: e.pitch, velocity: toMidiVelocity(e.velocity), duration: 0.4 }),
};
```

`smplr` is a playground `devDependency` only. The library never imports it.

### 6.4 External clock (consumer owns time)

For apps that already have a transport (a DAW, Tone.js):

```ts
editor.transport = externalTransport({
  getTick: () => toneTransportTicks(),
  play, stop, seek,
});
```

The editor then only **follows**: renders the playhead, never schedules notes.

**Benefits:** library has zero audio deps; consumers use any instrument; one timing source.
**Risks:** a bare `<maddie-editor>` is silent. Mitigation: docs lead with the 8-line smplr recipe; dev-mode logs a one-time hint on first play with no output.

---

## 7. Styling — three tiers

### Tier 1: Design tokens (CSS custom properties)

Inherited, so set them anywhere above the element:

```css
maddie-editor {
  --maddie-accent: oklch(70% 0.18 280);
  --maddie-note-fill: var(--maddie-accent);
  --maddie-note-radius: 3px;
  --maddie-grid-bar: oklch(100% 0 0 / 0.14);
  --maddie-font: "Inter", system-ui;
  --maddie-motion-fast: 90ms;
}
```

Token groups:

- **Color:** `bg`, `surface`, `surface-raised`, `text`, `text-muted`, `accent`, `border`, `focus`
- **Grid:** `row-white`, `row-black`, `row-out-of-scale`, `line-bar`, `line-beat`, `line-sub`
- **Notes:** `note-fill`, `note-fill-selected`, `note-border`, `note-muted`, `note-ghost`, `note-velocity-min-opacity`, `note-radius`
- **Playback:** `playhead`, `loop-region`, `note-playing-flash`
- **Type:** `font`, `font-mono`, `font-size-*`
- **Space:** `row-height` (default), `keyboard-width`, `ruler-height`, `lane-height`
- **Motion:** `motion-fast`, `motion-medium`, `motion-slow`, `ease-out`, `ease-spring`

Ships `light` and `dark` built in, follows `prefers-color-scheme`, override with `theme="dark"`. Uses `oklch` for perceptually even velocity shading.

### Tier 2: `::part()` for DOM chrome

```css
maddie-editor::part(toolbar) { border-bottom: none; }
maddie-editor::part(button) { border-radius: 999px; }
```

The preset re-exports all child parts (`exportparts`) so deep pieces are styleable from outside.

### Tier 3: Full control

- **Slots** in the preset: `toolbar`, `toolbar-start`, `toolbar-end`, `footer`, `inspector`, `empty`. Replace any region.
- **`unstyled` attribute:** drops all visual CSS, keeps layout + behavior.
- **Global style injection:** `maddie.adoptStyles(cssSheet)` adds a stylesheet to every Maddie shadow root.
- **Canvas hooks:** `noteStyle`, `renderNote` (see §4.2).
- **Headless:** skip elements entirely, use `@tasteee/maddie/core`.

All built-in CSS lives in `@layer maddie` so any consumer CSS wins without `!important`.

### Visual language: flat, gorgeous

- No gradients, no shadows on content. Depth from **color steps** only (`bg` → `surface` → `surface-raised`).
- Notes: solid fill, 2–3px radius, **velocity = fill lightness/opacity**. Selected = brighter fill + 1.5px inner outline in `focus` color.
- Grid hierarchy by line weight + opacity: bar > beat > subdivision. Black-key rows a subtle tint. Out-of-scale rows dimmer when scale is shown.
- Tabular numerals for all numbers. One accent color. Generous hit areas, tight visuals.

---

## 8. Motion design

**Rule 1: direct manipulation is never animated.** The note under your pointer follows it 1:1. Zero lag.
**Rule 2: system-caused changes are always animated.** Undo, quantize, transpose, fold, paste — the user should *see* what changed.
**Rule 3: nothing animates longer than 240ms.** Motion explains; it never waits.

| Event | Motion | Duration / easing |
| --- | --- | --- |
| Place note | Fades + scales in from 85% height | 90ms, ease-out |
| Delete note | Fades + shrinks to 0 width from center | 120ms, ease-in |
| Drag across snap points | Glides between snap positions (not teleport) | 50ms, ease-out |
| Release drag | Settles into final spot | 80ms, spring (no overshoot > 2px) |
| Undo / redo | Notes tween from old to new state | 160ms, ease-in-out |
| Quantize / transpose / paste | Notes tween to new positions, slight stagger by time | 180ms + ≤60ms stagger |
| Grid / zoom changes subdivision | Lines crossfade, never pop | 150ms |
| Keyboard zoom (`+`/`-`) | Smooth viewport tween, anchored | 180ms, ease-out |
| Trackpad pinch / ctrl-wheel zoom | Direct, 1:1 (rule 1) | — |
| Fold toggle | Rows collapse/expand; notes and keys travel with their rows | 220ms, ease-in-out |
| Scale highlight on | Out-of-scale rows dim | 150ms |
| Selection | Outline fades in | 80ms |
| Playback hit | Note flashes brighter, decays | 150ms decay |
| Playhead | Linear, compositor transform | per frame |

**Implementation:**
- Engine keeps an `AnimatedRect` per visible note id: `{ current, target }`. Commands set targets; renderer interpolates.
- Animations run in the shared rAF scheduler; loop stops when all settle.
- Animated `RowMap` positions make fold animations free for every element.
- Durations come from motion tokens. `prefers-reduced-motion` → all positional motion off, opacity fades ≤ 80ms.

---

## 9. Performance budget

| Target | Budget |
| --- | --- |
| Notes in doc | 50k without degradation in editing |
| Drag 500 selected notes | 60fps |
| Zoom/scroll 20k visible-range notes | 60fps |
| Idle CPU | 0 (no rAF when idle) |
| Core bundle | < 15kb gz |
| Elements + engine | < 35kb gz |

Techniques: spatial index, visible-range culling, layered canvases, dirty flags, structural sharing, batched commits, no layout reads during frames.

---

## 10. Accessibility

- Full keyboard editing (see §4.4). A visible **keyboard cursor** on the grid (pitch × time) for inserting notes without a mouse.
- Hidden DOM layer exposes the focused note and selection: role, pitch name, position (`bar 3, beat 2`), length (`eighth`), velocity.
- Live region announces command results: "Moved 4 notes up 1 semitone".
- All controls are real buttons/inputs with labels. Focus ring uses `--maddie-focus`.
- Contrast-checked default themes. Respects `prefers-reduced-motion` and `forced-colors`.

---

## 11. Packaging

**One package, subpath exports.** Framework wrappers as separate tiny packages.

```
@tasteee/maddie
├─ @tasteee/maddie/core          store, model, commands, snap, scale, transport (no DOM)
├─ @tasteee/maddie/elements      all custom elements (+ per-element subpaths)
├─ @tasteee/maddie/midi          .mid import/export (SMF 0/1)
├─ @tasteee/maddie/themes/*.css  optional extra themes
└─ custom-elements.json          manifest for IDEs, docs, wrapper generation

@tasteee/maddie-react   @tasteee/maddie-vue   @tasteee/maddie-svelte   (generated from the manifest)

Dependencies: lit. That's it. No audio deps.
```

- ESM only, TypeScript source, `sideEffects` set so unused elements tree-shake.
- `HTMLElementTagNameMap` + JSX typings so `document.querySelector('maddie-piano-roll')` is typed.
- Wrappers map events to idiomatic props (`onChange`, `v-model:doc`, `bind:doc`).

### Developer experience checklist

- 3-line hello world. Works from a CDN `<script type="module">`.
- Every element works with zero config **and** every default is overridable.
- Typed everything. Helpful dev-mode warnings (`"<maddie-keyboard> found no <maddie-root>. Pass .editor or nest it."`).
- `editor.debug = true` → overlays hit zones, dirty rects, FPS.
- Playground + docs site with live, editable examples for each piece.

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@tasteee/maddie/elements"></script>
<maddie-editor grid="1/16" scale="C minor" tempo="120"></maddie-editor>
```

---

## 12. Ownership summary

| Concern | Owner | Consumer can override? |
| --- | --- | --- |
| Note data / document | Maddie (uncontrolled) or consumer (controlled) | yes |
| Undo / redo | Maddie | extend via custom commands |
| Selection, view, tools | Maddie | yes, via `editor.view` / attrs |
| Rendering | Maddie | tokens, parts, hooks, or headless |
| Layout | Preset: Maddie. Pieces: consumer | yes |
| Clock / transport | Maddie | yes, external transport |
| Sound | Consumer (we dispatch note events) | — |
| Persistence | Consumer (via `maddie-change`) | — |
| MIDI file I/O | Maddie (`@tasteee/maddie/midi`) | optional |
| Collaboration | Consumer, via patches | — |

---

## 13. Repo layout

```
src/
  core/
    doc/          model, schema, migrations, spatial index
    commands/     one file per command + registry
    history/
    selection/
    view/         viewport, zoom, grid
    music/        snap, scale, rowmap, tempo map, time sig
    transport/    clock, scheduler, external adapter
  engine/
    render/       layers, scheduler, theme bridge, note painter
    gestures/     state machines per gesture
    animation/
    keymap/
  elements/       one folder per element
  midi/           smf parse/write
  themes/
test/
  core/           vitest, pure
  e2e/            playwright: gestures, a11y, visual regression
  perf/           benchmarks with 20k/50k notes
playground/       demo app, smplr Splendid Grand Piano as the output
```

Tooling: pnpm, TypeScript strict, Vite (lib mode + playground), Vitest, Playwright, Changesets, CEM analyzer.

---

## 14. Build order

Status as of v0.0.1: ✅ done · 🟡 partial · ⬜ not started

1. ✅ **Core:** doc model, commands, history (gesture coalescing), snap, scale/RowMap, tempo map, time sig. Unit tested.
2. ✅ **Roll MVP:** `<maddie-root>`, `<maddie-piano-roll>`, `<maddie-keyboard>`. Draw, select, marquee, move, ⌘-drag copy, resize, erase, zoom, scroll, auto-scroll.
3. 🟡 **Feel pass:** motion system (tween on undo/commands, snap glide, pop-in, fade-out, fold, keyboard zoom), theme bridge, light/dark, keymap, hit zones. Todo: hover lift polish, focus/cursor a11y layer.
4. ✅ **Playback:** lookahead transport, `Output` + note events, ruler seek + loop drag, playhead, follow. Playground plays through smplr.
5. 🟡 **Lanes + controls:** velocity lane (drag + paint), toolbar controls, `<maddie-editor>` preset. Todo: note inspector, overview/minimap, custom popover menus (selects are native for now).
6. 🟡 **Music tools:** quantize, transpose (semitone + degree), scale lock, fold (scale/notes), clipboard, legato, mute. Todo: humanize, split/glue, time-sig UI.
7. ⬜ **Ecosystem:** MIDI file I/O, `webMidiOutput()`, framework wrappers, docs site.
8. ⬜ **Later:** touch, CC/pitch bend lanes, tempo automation, MPE, OffscreenCanvas, collab adapter, a11y screen-reader layer.

---

## 15. Decisions log

| Question | Decision |
| --- | --- |
| Velocity range | **0–1 float.** Helpers convert to/from 0–127 at the edges. |
| Base class | **Lit.** |
| Built-in sound | **None.** We dispatch note events via `Output`. Demo uses smplr Splendid Grand Piano. |
| Platform priority | **Desktop first.** Touch later. |
| Package / tags | **`@tasteee/maddie`**, tags `maddie-*` (prefix configurable). |
