# BOARD-SPEC — our own whiteboard engine, replacing tldraw

**Written:** 2026-10-30. **Status (2026-11-05): built, but not as planned below.** Konrad chose to
replace tldraw in one step rather than in stages, using existing libraries where they fit. What
shipped, how it differs from this plan, and what is still open are in **§16**. §1–§15 are the
original plan, kept because their open questions and tests still apply.
**Goal (Konrad):** remove tldraw and replace it with an in-house board that keeps its most useful
features (ink colours, widths, tool types, images, screenshots) and adds shapes that snap to perfect
forms, without that snapping ever touching mathematical writing.

**Provenance tags:** `[CODE]` read in this repo on the date above · `[TL]` read from the installed
tldraw 3.15.5 packages (data formats only, see §0) · `[WEB]` public source, listed in §15 · `[INF]`
our inference, verify before relying on it.

---

## 0. Licence rules (binding, every contributor)

tldraw's source is under its own licence, not MIT. So, as with the calculator (GRAPH-SPEC §0):

1. **Allowed:** reading tldraw's *saved data format* (`@tldraw/tlschema`), because the migrator in §11
   must read existing boards. Using a tldraw board as an ordinary user and recording behaviour.
   General geometry and graphics literature. MIT or similarly licensed libraries.
2. **Forbidden:** copying, porting or closely paraphrasing tldraw source, including its stroke
   pipeline, sync code, indexing code, cursors, icons or UI. Do not keep its source open while writing
   the same feature.
3. **`perfect-freehand` is allowed** and is the planned ink outliner. Its README lists MIT and asks
   commercial users to consider sponsoring the author `[WEB]`. Confirm the licence file of the exact
   version when installing it, and record it in the licence notices.
4. **Until Stage 7 ships, tldraw's rules still apply:** stay on 3.15.5, keep the watermark, and the
   OVERHAUL §5 task to get written confirmation from tldraw remains open. This spec does not close it.

---

## 1. Decision

**Replace tldraw, in stages, stopping at a gate if the ink doesn't feel right.**

| Reason | Weight |
|---|---|
| Licence: pinned to 3.15.5, watermark required, written confirmation still outstanding (OVERHAUL §5) | Strong |
| No upstream fixes on a frozen version; we already own its bugs | Strong |
| The board is the product; ink feel, shape snapping and follow mode are core, not add-ons | Strong |
| Unused features and interface clutter | Weak: Stage 1 fixes this without replacing anything |

**Why it's feasible:** our board code calls 26 distinct `editor` methods, and about ten source files import tldraw `[CODE]`.
Saved boards are plain JSON records. Our permission, follow, quiz, timer and calculator logic already
runs over our own control channel and survives the swap.

**What could stop it:** ink that feels worse than tldraw on a real iPad or Wacom (§12, Gate A). Stages
1 and 2 are worth keeping even if the project stops there.

**Not goals:** a general-purpose diagramming tool, embeds, bookmarks, video on the board, sticky
notes, frames, connectors that stay attached to shapes, dark-mode paper, multiplayer text editing
inside one text box.

---

## 2. What the board does today

Everything here must keep working. "Owner" is where it lives after the swap.

| Feature | Today `[CODE]` | Owner |
|---|---|---|
| Freehand, highlighter, eraser, shapes, line, arrow, text | tldraw tools | Engine (§8) |
| Colours, widths, dash styles | tldraw styles | Engine, our toolbar (Stage 1) |
| Pages, page add/rename/reorder | tldraw store + `PageMenu` | Doc model + our page strip |
| Paste, drop or pick an image | tldraw default file handler | Engine + existing `/uploads` |
| PDF dropped on the canvas becomes pages | `PdfDrop` + `planFromFiles` | Same code, new drop target |
| Follow the tutor's camera and page | `cameraSync.ts`, `pageSync.ts` over the control channel | Same protocol |
| Free reign (students roam) | `free-reign` + follow toggles | Same |
| Right-drag pan for the tutor | `rightClickPan.ts` | Engine input |
| Large class: write access per student | `access` message, `syncUsers`, session drop | Checked per operation (§5.5) |
| Ink visible while it's being drawn | Incomplete draw shapes through sync | Live strokes (§5.4) |
| Other people's cursors and names | tldraw presence | Presence messages (§5.6) |
| Roster count for "3/5 answered" | `getCollaborators().length` | Presence |
| Lesson plans load as locked image blocks on new pages | `lesson/load.ts` | Same flow, new calls |
| Answer boxes under problems | `AnswerOverlay` over `meta.q`, camera and shape bounds | Same component, new source (§10) |
| Page question list and labels | `getCurrentPageShapes`, `getPageShapeIds` | Engine queries |
| Whole-board PDF, lesson notes PDF | `exportPdf.ts` via `editor.toImage` | Our renderer (§6.5) |
| Autosave and restore | `boards.snapshot` every 60 s and on close | Same column and timing |
| Ephemeral `/try` boards | Memory only, dropped after 30 s | Same |
| Undo and redo | tldraw history | Engine (§5.7) |
| Copy, paste, duplicate, group, z-order, rotate, resize | tldraw select tool | Engine, except groups (§8) |

**Existing gaps to fix, not copy `[CODE]`:**

- A board over 5 MB silently stops saving: `saveSnapshot` only logs a warning. The new engine tells the
  tutor (§11.3).
- `/try` boards can't enforce write access because the host role is self-asserted. That stays true by
  design; only persistent boards get real enforcement.
- On a persistent small-class board any guest can write, and any writer can edit lesson shapes that are
  only client-side locked. §5.5 tightens this.

---

## 3. Architecture

```
packages/ink/                 stroke recogniser, pure TS (Stage 1, built separately)
packages/board/               pure TS, no DOM, unit-tested in node; used by web AND server
  model.ts       records, ids, versioned document
  ops.ts         apply / invert / validate operations
  order.ts       fractional order keys
  geometry.ts    bounds, hit testing, transforms
  codec.ts       stroke point encoding
  migrate/       tldraw snapshot -> our document (§11)
apps/web/src/board/engine/
  store.ts       confirmed doc + pending ops, subscriptions
  sync.ts        doc socket client
  renderer.ts    canvas layers
  input.ts       pointer, pen, touch, wheel, keyboard
  tools/         select, pen, highlighter, eraser, shape, line, arrow, text, hand, laser
  index.ts       the BoardEngine interface (§10)
apps/server/src/board/
  docRoom.ts     authoritative document, op log, snapshot, presence
```

No `Editor`-style god object: `store` holds the document, `tools` turn input into operations, and
`renderer` draws what `store` holds. The server imports the same `ops.ts`, so client and server can't
disagree about what an operation means.

---

## 4. Document model

Plain JSON, versioned from day one. Coordinates are page units; one unit is one CSS pixel at 100% zoom.

```ts
interface BoardDoc {
  format: 'slate-board'
  v: 1
  pages: Record<string, Page>
  records: Record<string, BoardRecord>
}

interface Page {
  id: string
  name: string
  order: string             // fractional key
  /** Where a plan page came from. Same shape as today's `meta.lesson`. */
  lesson?: LessonRef
}

interface Base {
  id: string
  page: string
  order: string             // z-order on the page
  author: string            // user id, for permissions and undo
  locked?: boolean          // only the tutor may change or unlock it
}

type Line = { color: string; width: number; dash: 'solid' | 'dashed' | 'dotted' }

interface InkRecord extends Base, Line {
  type: 'ink'
  tool: 'pen' | 'highlighter'
  x: number; y: number      // origin
  pts: string               // codec.ts, see below
  pressure: boolean         // real pen pressure, or simulate on render
}

interface ShapeRecord extends Base, Line {
  type: 'shape'
  kind: 'rect' | 'ellipse' | 'triangle' | 'polygon'
  x: number; y: number; w: number; h: number; rotation: number
  /** Polygon or triangle corners, normalised to 0..1 of w and h. */
  corners?: [number, number][]
  fill?: string
}

interface PathRecord extends Base, Line {
  type: 'path'              // straight line, polyline, or arrow
  points: [number, number][]
  arrowStart?: boolean
  arrowEnd?: boolean
}

interface TextRecord extends Base {
  type: 'text'
  x: number; y: number; w: number; rotation: number
  text: string              // plain text with newlines
  color: string
  size: number
  fill?: string
}

interface ImageRecord extends Base {
  type: 'image'
  x: number; y: number; w: number; h: number; rotation: number
  src: string               // /uploads/:boardId/:id, unchanged
  crop?: { x: number; y: number; w: number; h: number }
  /** An answerable problem. Never contains an answer key. */
  q?: QuestionMeta
  lessonBlock?: string      // today's meta.lesson on a block
}
```

**Stroke points.** `pts` holds delta-encoded integers: x and y at 1/10 page unit, pressure 0..255,
packed into a compact base64 string by `codec.ts`. tldraw stores one `{x,y,z}` object per point
`[TL]`, so this should reduce snapshot size substantially `[INF]`; measure it against real boards in
Stage 6 and record the result here.

**Colours** are stored as hex, not names, so palette changes never rewrite old boards.

**Pressure on ink, not on shapes.** A snapped shape is a real `ShapeRecord` with a uniform stroke, so it
stays perfect when resized.

**Answer keys never enter the document**, same as today (`lesson/load.ts`). `q` carries only the id,
format and choices.

---

## 5. Sync

### 5.1 Model: server-authoritative, not a CRDT

The server orders every change. The client applies its own change immediately, then reconciles.

Why not Yjs or another CRDT: this document barely conflicts. Finished ink never changes, and two people
rarely move the same object at once. The real requirement is the opposite of peer-to-peer merging:
the server must be able to *refuse* a change (§5.5), which is awkward with opaque CRDT updates `[INF]`.

### 5.2 Operations

```ts
type Op =
  | { op: 'put'; record: BoardRecord }
  | { op: 'patch'; id: string; fields: Partial<BoardRecord> }
  | { op: 'del'; ids: string[] }
  | { op: 'page-put'; page: Page }
  | { op: 'page-patch'; id: string; fields: Partial<Page> }
  | { op: 'page-del'; id: string }
```

Every message is a **batch applied atomically**, so a snapped shape (`del` ink + `put` shape) or a whole
lesson plan is one change and one undo step.

Conflict rule: last writer wins, per field, in server order. A `patch` to a deleted record is dropped.

### 5.3 Protocol

A new socket, `/doc/:boardId`, sits beside `/control/:boardId`. The upgrade reuses `resolveConnection`
unchanged `[CODE]`.

| Direction | Message | Meaning |
|---|---|---|
| C → S | `hello { epoch, rev, session }` | I have this revision |
| S → C | `doc { epoch, rev, doc }` | Full document |
| S → C | `catchup { rev, batches }` | What you missed |
| C → S | `ops { cid, ops }` | A batch; `cid` is per-session and increasing |
| S → all | `ops { rev, author, session, cid, ops }` | Applied; doubles as the sender's ack |
| S → C | `reject { cid, reason }` | Refused; the client drops it and rolls back |
| both | `live`, `presence` | Unsaved, see below |

- **Client state:** `confirmed` (server state) plus `pending` (sent, unacknowledged). What renders is
  `confirmed` with `pending` replayed on top. A remote batch updates `confirmed`, then replays `pending`.
- **Reconnect:** the client re-sends `pending` with the same `cid`s. The server remembers each session's
  highest `cid`, so a re-send can't apply twice.
- **Catch-up:** the room keeps a ring of recent batches. Too far behind gets a full `doc`.
- **`epoch`** is random per room load. A mismatch after a server restart forces a full `doc`.
- **Join** sends the full document; the server's 16 MiB frame limit is already above the 5 MB snapshot cap `[CODE]`.

### 5.4 Live strokes

Students must see writing as it happens. While a stroke is in progress the client sends
`live { strokeId, style, points }`, appending new points at about 30 Hz. The server relays these without
storing them, and other clients draw them on the live layer. On pen-up the normal `ops` batch commits
the stroke and replaces it. A live stroke with no update for 3 s is discarded, which covers a dropped
sender. A client that joins mid-stroke just sees it from then on.

### 5.5 Permissions: checked on every batch

The server applies these with the shared rules in `ops.ts`:

- **Who may write:** `role === 'host' || mode !== 'large' || writers.has(userId)`, the existing rule from
  `uploaderOrg` `[CODE]`. Because it is evaluated per batch, a grant or revoke applies immediately and
  the current workaround of closing that guest's sync sessions goes away.
- **`locked` records:** only the host may patch, delete or unlock them. Lesson blocks are locked.
- **`q` and `lesson` fields:** host only, so a student can't plant or alter a question.
- **Page add, delete, rename, reorder:** host only, plus guests during free reign if today's behaviour
  requires it; confirm against the current board in Stage 5.
- **Validation:** every batch goes through hand-written validators in `ops.ts`: known fields, finite
  numbers, `src` under this board's `/uploads` path, and limits (points per stroke, text length, records
  per page, batch size). A failure is a `reject`, never a crash.
- **Rate limit:** guests use the same per-client window pattern as `allowQuizMessage`.
- **`/try` boards:** roles are self-asserted, so these rules only guard against mistakes, not abuse.

### 5.6 Presence

`presence { user, name, color, page, cursor }`, throttled to about 15 Hz and relayed unsaved, carries
cursors and the roster. Roster count keeps today's meaning: everyone else connected. The large-class
write-access list moves from tldraw's `PeopleMenu` to our own panel.

### 5.7 Undo

Each client keeps its own stack of inverse batches and only undoes its own work. Undoing against a
record that someone else has since deleted is a no-op. Remote changes are never undoable locally. A
snapped shape's undo restores the raw ink, because both changes were one batch.

---

## 6. Rendering

### 6.1 Layers

| Layer | Holds | Redraws |
|---|---|---|
| Base canvas | Committed records | When the document or camera changes |
| Live canvas | In-progress ink, local and remote; laser; marquee | Every frame while active |
| DOM overlay | Selection handles, text editor, cursors, `AnswerOverlay` | React, camera-transformed |

### 6.2 Base canvas

Start simple and only add machinery the benchmark demands:

1. Cache one `Path2D` per record in page coordinates, built once.
2. A uniform spatial grid culls records outside the view; the same grid serves hit testing.
3. During a pan or pinch, move the existing bitmap with a CSS transform, and redraw when the gesture
   pauses or on idle frames, so a heavy board never drops the gesture.
4. Add tiles or `OffscreenCanvas` only if the §13 budget fails.

### 6.3 Ink

- **Solid pen:** `perfect-freehand` outline, filled. Real pressure is passed as the third value of each
  point with `simulatePressure: false`; mouse and touch simulate it `[WEB]`.
- **Dashed and dotted:** a smoothed centreline stroked with `setLineDash` at uniform width. Dotted uses
  round caps and a zero-length dash. Variable-width outlines and dashes don't combine well `[INF]`.
- **Highlighter:** drawn in a pass beneath ink with `multiply`, so writing stays crisp.
- **Line widths:** four named widths in the toolbar, mapped to page units; today's sizes are 2, 3.5, 5
  and 10 `[TL]`. Stored as a number so more can be added.

### 6.4 Text and images

Committed text draws with `fillText` and our own wrapping; editing uses a positioned `<textarea>`, so
every browser's input methods just work. Images decode to `ImageBitmap` and are drawn on the base layer.

### 6.5 Export

PDF runs the base renderer against an offscreen canvas per page, then the existing `jsPDF` flow, with
the same 40-unit padding, 2x scale and content-sized pages as `exportPdf.ts` `[CODE]`. Export must not
touch the viewer's camera or page, which is what stops students being yanked around today.

---

## 7. Input

Tutors feel this layer directly. It decides Gate A.

- **Pointer events** on one surface with `touch-action: none`, so the browser never claims a stroke as a
  scroll. `pointerrawupdate` where available.
- **Coalesced points:** read `getCoalescedEvents()` for every sample. Safari on iOS has it from 18.2
  `[WEB]`. iOS 18.2 returned coalesced events without `pointerId` or `target` `[WEB]`, so take identity
  from the parent event and only coordinates and pressure from coalesced ones.
- **Predicted points:** `getPredictedEvents()` (also iOS 18.2+ `[WEB]`) draw on the live layer only and
  are thrown away on the next event. They never reach the document.
- **Latency:** try `desynchronized: true` on the live canvas. Browsers that don't know it ignore it, and
  it can't sync with other HTML and doesn't always help `[WEB]`, so it stays a measured choice per
  browser. The Ink API (`navigator.ink`) is experimental and fails gracefully `[WEB]`: a later Chromium-only
  enhancement, not a dependency.
- **Palm rejection:** once a pen has been seen in the session, touch stops drawing and only pans and
  zooms. Until then, a finger draws. A toolbar toggle overrides this.
- **Gestures:** two fingers pan and pinch, wheel pans, Ctrl+wheel and trackpad pinch zoom, Space-drag
  pans, tutor right-drag pans as today. Students following the tutor have a locked camera.
- **Pen eraser end** (eraser button in pointer events) selects the eraser while it's down.
- **iPadOS Scribble** has been reported to swallow pointer events on web canvases; one reported
  workaround is a non-passive `touchmove` listener calling `preventDefault` `[WEB]`. Test this on a device
  in Stage 3 and record the result, because the reports are old and may not match current iPadOS.
- **Keyboard:** the surface handles shortcuts only when it or `body` has focus, and never when the target
  is an input, textarea, contenteditable or the calculator. The calculator's first-box bug (fixed
  2026-10-30) left typing aimed at a box with focus on the page `[CODE]`; this rule stops such keys
  reaching board shortcuts.

---

## 8. Tools

| Tool | v1 behaviour |
|---|---|
| Select | Click, marquee, multi-select, move, resize, rotate, copy, paste, duplicate, delete, bring forward, send back |
| Pen | Colour, width, solid/dashed/dotted. Recognition never runs |
| Highlighter | Colour, width |
| Eraser | Removes whole strokes it touches, like tldraw today. Splitting a stroke is later |
| Shape | Freehand stroke through the recogniser (§9) |
| Line, arrow | Drag; Shift snaps to 15° steps |
| Text | Click to type, plain text |
| Image | Paste, drop, or file picker |
| Hand | Pan |
| Laser | Unsaved pointer trail, sent through `live`, for pointing during explanation |

**Screenshots:** a screenshot on the clipboard pastes like any image, which covers Win+Shift+S and
Cmd+Ctrl+Shift+4. On iPad, screenshots come through the picker. Capturing a window from inside the app
(`getDisplayMedia`) is later.

**Groups are dropped.** Multi-select covers the need. Migrated groups become their children (§11).

**Later:** partial-stroke eraser, LaTeX text, graph-paper page backgrounds, multiple-page thumbnails,
placing a calculator graph on the board as an image.

---

## 9. Shape recognition

Built in Stage 1 as `packages/ink`, with no dependency on either engine. The engine consumes it
unchanged.

**The rule:** recognition runs only while the Shape tool is active. The pen never calls it. That is a
hard guarantee, not a threshold, so handwriting and mathematics can't be altered.

**Flow:** on pen-up, recognise the stroke. On a match, one atomic batch removes the ink and adds the
shape, so one undo brings the hand-drawn stroke back. With no match, the ink stays exactly as drawn.

**Classes:** line, circle, ellipse, rectangle, triangle.

**Regularising:**

- Near-equal ellipse axes become a circle.
- A nearly axis-aligned ellipse or rectangle snaps to the axes.
- Near-right corners become exactly 90°.
- Near-horizontal and near-vertical lines become exact.
- A triangle otherwise keeps the tutor's own corners, so a chosen right triangle doesn't become a generic one.

**Tuning:** synthetic strokes prove the logic, but thresholds need real strokes. Collect a small set
from Konrad's own hand (at least 20 each per class, plus handwriting that must not match) and keep it as
a test fixture. Add arrows and other classes only if real use asks for them.

---

## 10. Integration

### 10.1 The seam

Stage 2 introduces a `BoardEngine` interface and moves every tldraw call behind it, in one adapter file.
Everything else imports only this. Then Stage 4 adds a second implementation beside the first.

```ts
interface BoardEngine {
  // state
  getPages(): Page[]
  currentPageId(): string
  setCurrentPage(id: string): void
  records(pageId: string): BoardRecord[]
  bounds(id: string): Rect | null
  getCamera(): Camera
  setCamera(c: Camera): void
  setCameraLocked(locked: boolean): void
  collaborators(): Collaborator[]

  // reactive
  subscribe(fn: () => void): () => void
  onCameraChange(fn: (c: Camera) => void): () => void
  onPageChange(fn: (id: string) => void): () => void

  // edits
  batch(fn: (tx: Tx) => void): void
  addImage(file: Blob | string, at?: Point): Promise<void>
  setTool(tool: ToolId): void
  getTool(): ToolId

  // output
  renderPage(pageId: string, opts: RenderOpts): Promise<{ blob: Blob; width: number; height: number }>
}
```

### 10.2 What changes where `[CODE]`

| File | Change |
|---|---|
| `BoardCanvas.tsx` | `<Tldraw>`, `useSync`, `components`, `atom`, `useValue` go. Our toolbar, page strip and panels mount directly |
| `cameraSync.ts` | `editor.on('tick')` polling becomes `onCameraChange`; same wire messages |
| `pageSync.ts` | The deferred-apply workaround for re-entering tldraw's flush goes away |
| `rightClickPan.ts` | Absorbed into `input.ts` |
| `lesson/load.ts` | `editor.run` + `createPage/createAssets/createShape` become one `batch` |
| `lesson/useLessons.ts` | Read pages through the engine |
| `quiz/AnswerOverlay.tsx` | Keeps its logic; reads questions from `records()` and the camera from the engine, and loses the hand-copied layer transform |
| `exportPdf.ts` | `toImage` becomes `renderPage` |
| `assetStore.ts` | Goes; `addImage` calls `/uploads` directly |
| `rooms.ts`, `index.ts` | `socketRoom` is replaced by `docRoom`; `/connect` retires at Stage 7 |
| `controlChannel.ts` (both) | No change except removing the `access` session-drop loop at cutover |
| `assets.ts` | Only comments change. Video uploads can be refused at Stage 7 |

---

## 11. Saved boards

### 11.1 Format

`boards.snapshot` stays. A document has `format: 'slate-board'`; a tldraw snapshot is
`{ clock, documents, tombstones, schema }` `[TL]`. So the format is detectable with no extra column.

Schema additions, in the `-- migrations (idempotent)` section:

```sql
alter table boards add column if not exists engine text not null default 'tldraw';
alter table boards add column if not exists snapshot_legacy jsonb;
```

`engine` lets boards move individually, starting with Konrad's own. New boards flip to `'slate'` at
Stage 6.

### 11.2 Conversion

`packages/board/migrate` is pure and has no tldraw dependency. It reads records from
`snapshot.documents[].state`. Each record's `typeName` is `page`, `shape`, `asset` and so on `[TL]`.

| tldraw shape `[TL]` | Becomes | Notes |
|---|---|---|
| `draw` | `ink` (pen) | `props.segments[].points` is `{x,y,z}`; with `isPen`, `z` is pen pressure × 1.25, otherwise 0.5. Width is `STROKE_SIZES[size] * scale`. `draw` dash becomes solid |
| `highlight` | `ink` (highlighter) | Same points |
| `geo` | `shape` | rectangle, ellipse, triangle, others as `polygon`. A label becomes a separate `text` |
| `line` | `path` | Keyed points sorted by `index`. Cubic splines are sampled |
| `arrow` | `path` | Bound ends read the binding's target centre, since bindings are separate records |
| `text` | `text` | `richText` flattened to plain text |
| `note` | `text` | With a fill |
| `image` | `image` | `src` from the asset record. `meta.q` → `q`, `meta.lesson` → `lessonBlock`, `isLocked` → `locked` |
| `group`, `frame` | their children | Parent transforms flattened into each child |
| `video`, `bookmark`, `embed` | dropped | Counted and logged; the original survives in `snapshot_legacy` |
| page records | `Page` | `meta.lesson` → `lesson`. Page ids are preserved so stored references stay valid |

Named colours (`black`, `blue`, `light-red` and so on) map to our hex palette. Fixtures come from real
tldraw 3.15.5 boards, captured before Stage 7 removes the package.

### 11.3 Cutover

1. On loading a board whose `engine` is `slate` and whose snapshot is tldraw-format, the room converts
   it, copies the original to `snapshot_legacy`, and writes the new snapshot.
2. Keep `snapshot_legacy` for at least 90 days after Stage 7.
3. Over-limit boards: when a save exceeds `MAX_SNAPSHOT_BYTES`, tell the host through the control channel
   and offer a PDF export, instead of only logging. Keep the room's in-memory state.
4. **No path back:** a board edited after conversion can't return to tldraw without losing those edits.
   This is why `engine` moves one board at a time and Stage 5 runs on real lessons first.

---

## 12. Stages and gates

| Stage | Work | Exit |
|---|---|---|
| **1. Toolbar + Shape tool** | Our toolbar, `packages/ink`, Shape tool on tldraw. **Running now in its own session** | Snapping works and syncs on `/try` |
| **2. Seam** | `BoardEngine`, tldraw adapter, all callers moved. No visible change | No `from 'tldraw'` outside the adapter; all board behaviour in §2 unchanged |
| **3. Solo engine** | `packages/board`, renderer, input, tools; `/dev/board` route, no network | **Gate A** |
| **4. Multi-user on `/try`** | `docRoom`, `/doc` socket, live strokes, presence; ephemeral boards opt in with `?engine=slate` on the board link, and the first connection sets the room's engine | **Gate B** |
| **5. Full parity** | Lessons, quiz overlay, follow, PDF, large class; Konrad's boards via `boards.engine` | **Gate C** |
| **6. Migration** | Converter, fixtures, gradual per-board rollout; new boards default to slate | Every saved board converts or is listed with a reason |
| **7. Removal** | Delete adapter, tldraw packages, watermark, `/connect`; update OVERHAUL §5 | No tldraw in the lockfile; bundle size recorded |

**Gate A: ink.** Konrad writes real maths on an iPad with Apple Pencil and a Windows pen tablet, side by
side with tldraw. Pass means "at least as good" in his judgement *and* the §13 latency target. **Fail
means stop.** Keep Stages 1 and 2, and revisit.

**Gate B: multi-user.** The convergence fuzz (§13) passes, and a real session with several devices, one
of which loses Wi-Fi mid-stroke, ends with every screen identical and nothing lost.

**Gate C: real lessons.** At least 5 real lessons on the new engine with no lost work and no reversion to
tldraw needed.

**Size** `[INF]`: about 4–6k new lines. A rough guess until Stage 3 gives real data. The seam (Stage 2)
touches about 2k existing lines in files that use tldraw, but only their tldraw calls.

---

## 13. Test plan and budgets

**Automated** (`packages/board/test`, in the `packages/graph` style):

- `ops`: apply + invert returns the original, for every operation.
- **Convergence fuzz:** several simulated clients, random operations, random delays, drops, reconnects.
  After settling, every client's document equals the server's. This is the most important test here.
- Permissions: every refused case in §5.5 is refused by the server, not just hidden in the UI.
- Validation: malformed and hostile batches get `reject` and never throw.
- `codec`: round-trip within quantisation.
- Migration: captured fixtures, plus bounds preserved within 1 unit per record.
- Recogniser: `packages/ink` synthetic plus Konrad's real strokes (§9).

**Device matrix for Gates A and B:** iPad Safari with Apple Pencil; Windows Chrome with a pen tablet;
Surface or other Windows pen; Mac Chrome and Safari with mouse and trackpad; Android Chrome with touch.

**Budgets:**

| Measure | Target |
|---|---|
| Pen to ink on screen | No worse than tldraw on the same device, measured by slow-motion video |
| Ink seen by another viewer | Under 200 ms on an ordinary connection |
| Pan and zoom | 60 fps on a mid-range laptop with a 5,000-stroke page |
| Committing a stroke | Under 4 ms on that page |
| Joining a 5 MB board | Under 2 s to first render on a good connection |
| Class fan-out | 30 viewers on one server without visible lag |

---

## 14. Risks and open questions

| Risk or question | Handling |
|---|---|
| Ink feel loses to tldraw | Gate A stops the project cheaply |
| Sync bugs appear live in lessons | Fuzz first; Stage 5 on Konrad's boards only; per-board `engine` |
| Safari surprises | iPad is in the device matrix from Stage 3, not left to the end |
| Undo across pages or after reconnect feels odd | Test explicitly in Gate B |
| **How many saved boards exist, and how big?** | Unknown. Konrad to run a read-only count on production before Stage 6. It decides whether fidelity for rare shapes matters |
| **Do tutors use arrows bound to shapes, or sticky notes?** | Assumed no. Check real boards in the same pass |
| **What may students do to pages in free reign?** | Confirm in Stage 5 (§5.5) |
| **Do students need their own private layer in free reign?** | Not today. Out of scope |
| Attribution for `perfect-freehand` | Add to licence notices at Stage 3 |
| Timing against launch | This is large. It should not block T0, security or launch work in OVERHAUL unless Konrad decides so |

---

## 15. Sources

- [MDN-derived `getCoalescedEvents` compatibility](https://docs.w3cub.com/dom/pointerevent/getcoalescedevents)
- [caniuse: `getPredictedEvents`](https://caniuse.com/mdn-api_pointerevent_getpredictedevents)
- [Flutter engine workaround for iOS Safari 18.2 coalesced events](https://dart.googlesource.com/external/github.com/flutter/engine/+/23447c4674b0837ada66d29099147e05a695cec4)
- [MDN: Ink API](https://developer.mozilla.org/en-US/docs/Web/API/Ink_API)
- [PWA inking notes on `desynchronized`](https://blog.pwabuilder.com/posts/pwa-inking-enable-2d-inking-for-the-web!/)
- [Perfect Freehand README (mirror)](https://github.com/xiaoyanit/perfect-freehand)
- [Apple forum: missing PointerEvents with Scribble](https://developer.apple.com/forums/thread/662874)
- [WebKit bug 217430](https://bugs.webkit.org/show_bug.cgi?id=217430)
- [Apple forum: PointerEvents with Apple Pencil Pro](https://developer.apple.com/forums/thread/776468)

---

## 16. What was built (2026-11-05)

Commits `6554202` (toolbar, Shape tool, recogniser) and `771b8a3` (the engine), merged into
`overhaul`. tldraw and its 117 packages are gone, so OVERHAUL §5's tldraw licence task no longer
applies.

### 16.1 Where it differs from this plan

| This plan | Built |
|---|---|
| Server-ordered operations of our own (§5) | **Yjs** documents over the y-websocket protocol, served by our own `apps/server/src/board/sync.ts`; per-person undo and presence come from Yjs |
| Stages with gates A–C (§12) | One step. No gate was run; see §16.3 |
| `boards.engine` per board, `snapshot_legacy` (§11) | `boards.doc` (bytea, Yjs state). A board with no `doc` is imported from `boards.snapshot` on first open; `snapshot` is never overwritten, so it stays the original |
| Hex colours, quantised points (§4) | tldraw's named colours and s/m/l/xl sizes, kept so imported boards look the same (`packages/board/src/schema.ts`) |
| Canvas renderer with `Path2D` caches (§6) | `apps/web/src/board/engine`: `Canvas.tsx`, `ShapeGraphic.tsx`, `editor.ts`, `gestures.ts`; `perfect-freehand` for ink, `@use-gesture` for pinch and wheel |
| PDF through our renderer (§6.5) | `html-to-image` + `jsPDF` |
| Page reorder, groups, bound and curved arrows | Not built. Unusual tldraw shapes import as rectangles (triangles and diamonds are kept); frames, embeds and video are dropped on import |

Kept from the plan: recognition runs only with the Shape tool (§9); a pen in use turns touch into
pan (§7); coalesced pointer events are read where available.

### 16.2 Server-side checks: still open

`sync.ts` drops every edit from a read-only session (a large-class student without write access).
It does **not** yet do what §5.5 asks:

- A student who may write can still change or delete locked lesson blocks and question records.
  tldraw's server didn't stop this either, so it isn't a regression, but it should be fixed before
  paying tutors run graded questions on the board.
- Yjs updates aren't validated, so a writer's malformed or very large update reaches every
  client. Whether clients survive hostile data hasn't been tested.
- A board over 5 MB still stops saving with only a server log line (§11.3, item 3).

### 16.3 Not yet tested

- **Gate A never ran:** no real stylus. Handwriting feel, palm rejection and touch pinch are
  untested on an iPad or a pen tablet. Do this before using the board in a lesson.
- **Recogniser thresholds** were tuned on synthetic strokes only (§9's real-stroke fixture is still
  to collect).
- **Real saved boards:** the import ran against a small fixture board on the test database. Run the
  schema change before deploying, then watch the server log for `imported from tldraw` lines as old
  boards open.
