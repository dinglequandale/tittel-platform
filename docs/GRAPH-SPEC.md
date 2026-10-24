# GRAPH-SPEC — a clean-room, Desmos-equivalent graphing calculator

**Written:** 2026-10-21. **Status:** research complete enough to build G1–G2; hands-on gaps listed in §9.
**Goal (Konrad):** "feel like Desmos and operate like Desmos as much as possible." The College Board's
SAT calculator *is* Desmos, so for SAT students fidelity is the product. For the board, owning the
calculator also removes the fragile Desmos sync workaround (PLAN gotcha §9.2).

---

## 0. Clean-room rules (binding, every contributor)

Copying Desmos's code breaches the Desmos API Terms §5(b)(v) ("shall not … reverse engineer"),
which the board already accepted by loading their API. It would also be copyright infringement.
Behaviour, layout conventions and mathematics are not protected. So:

1. **Allowed sources:** Desmos's public documentation (API docs, help centre, user guide, testing
   PDFs); using desmos.com as an ordinary user and recording what is on screen; openly licensed
   code (notably Desmos's own **MPL-2.0 MathQuill fork**, §2.1); general maths and numerical-methods
   literature.
2. **Forbidden:**
   - Opening, downloading, deobfuscating or reading Desmos's JavaScript, network payloads, or
     internal state objects.
   - Copying their saved-graph JSON format.
   - Copying their icons, logo, the green chrome, or the "desmos" name. The calculator ships
     under our brand.
   - Calling it "Desmos" anywhere in the product or marketing.
3. **Functional layout may match** (the keypad key positions, expression list beside the graph,
   gutter with colour icon). That is what makes SAT practice transfer. **Visual styling is ours**
   (tokens from OVERHAUL.md §2).
4. **Provenance tags** below: `[API]` Desmos API v1.11 docs · `[DOC]` help centre or user guide ·
   `[CB]` College Board testing PDF SY2026-27 · `[OBS]` observed hands-on 2026-10-21 · `[MQ]`
   desmosinc/mathquill docs · `[INF]` our inference, verify before relying on it.
5. The raw research log (sources, quotes, observations) is kept with this file's history. Any new
   observation goes into §9 with its tag before it changes behaviour.

---

## 1. What we are matching

- **SAT, PSAT/NMSQT, PSAT 8/9 & 10 graphing calculator = standard Desmos minus images, folders and
  notes, with Log Mode forced on** for applicable exponential, logarithmic and power regressions
  `[CB]`. Everything else (lists, tables, regressions, statistics, distributions, calculus,
  matrices …) is available to students on test day.
- **The SAT also has the Scientific calculator** (identical to desmos.com), and students toggle
  between the two, with no shared content `[CB][DOC]`.
- Desmos's free tools, help centre and Testing page are the reference. The College Board practice
  build lives at `desmos.com/testing/collegeboard/graphing`.

---

## 2. Architecture (build vs borrow)

```
packages/graph/            pure TS, no DOM — unit-tested in node
  parse/      LaTeX (MathQuill dialect) → AST            (own; Desmos grammar is non-standard)
  analyze/    item types, dependency graph, free vars, errors
  eval/       AST → compiled closures; lists broadcast; points; distributions
  plot/       explicit, implicit, inequality, parametric, polar, points, polygons
  poi/        zeros, extrema, intersections, intercepts, exact-form recognition
  regress/    linear least squares (QR) + nonlinear LM multi-start + log mode
  format/     number display, fraction toggle, digit grouping
  state.ts    our own JSON schema (versioned) + undo/redo history
apps/web/src/graph/        React UI
  ExpressionList, Row, SliderRow, TableItem, Keypad, GraphPaper (canvas), PoiCard, SettingsMenu
```

### 2.1 Math input: Desmos's own open-source field (decided)
- **`desmosinc/mathquill`** (TypeScript, MPL-2.0, maintained; pushed Aug 2026). It is Desmos's
  actual typing engine, published under an open licence. MPL-2.0 is file-level copyleft, so we may
  ship it inside a closed product. If we *modify* its files, those changes must be published (a
  public fork is fine). Vendor it as a git dependency pinned to a commit. Keep a `LICENSE`/NOTICE
  entry. **Do not modify it unless necessary**; configure it instead.
- Configuration per its docs (Desmos's own choices are named there) `[MQ]`:
  - `autoSubscriptNumerals: true`: `x2` becomes `x_2`, also observed `[OBS]`.
  - `autoCommands`: pi, tau, theta, sqrt, nthroot, sum, prod, int, infinity/infty …
  - `autoOperatorNames`: the full function list in §5, each with a speech alias (`sin|sine`).
  - `prefixOperatorNames` includes the trig, log and ln functions, so `sin -1` reads as negative.
    `infixOperatorNames: 'for with'`.
  - `charsThatBreakOutOfSupSub: '+-=<>'`, `supSubsRequireOperand`, `restrictMismatchedBrackets`,
    `sumStartsWithNEquals`, `leftRightIntoCmdGoes: 'up'`, `spaceBehavesLikeTab` *(verify)*,
    `enableDigitGrouping`, `tripleDotsAreEllipsis`.
  - `substituteTextarea` → `<textarea inputmode=none>` when our keypad is open (Desmos does this to
    suppress the OS keyboard).
  - Handlers: `enter` → new row below; `upOutOf`/`downOutOf`/`moveOutOf`/`deleteOutOf` → move
    between rows (Backspace on an empty row deletes it and moves up `[INF]`).
- MathLive (MIT) and Compute Engine (MIT) were the alternatives. MathQuill wins on exact feel.

### 2.2 Evaluation and parsing: our own
Compute Engine parses standard LaTeX, but Desmos's grammar (juxtaposition `sin x`, restrictions
`{}`, piecewise `{c: v, …}`, `for`/`with`, `~`, `->`, subscripted identifiers, `p.x`, `% of`) needs
exact semantics. Write a Pratt parser over the MathQuill LaTeX subset. Use double precision
throughout. `0^0 = 1` `[DOC]`.

### 2.3 State and sync
Our own versioned JSON (`{v, settings, viewport, items[]}`, item ids are nanoids). Edits are
applied as small ops (`set item latex`, `set slider value`, `set viewport` …) so the board's
ControlChannel can broadcast ops instead of whole states. This retires the interaction-gated
Desmos broadcast hack. Undo/redo is an op log.

---

## 3. UI and feel spec

### 3.1 Layout `[OBS][API]`
- **Wide (> 450px container):** expression list on the left (≈ ⅓ width; 420px at 1280px), graph
  paper on the right `[API: switches at 450px]`.
- **Narrow:** graph on top, list below, and a toolbar between them: `[+][keyboard] … [undo][redo] …
  [settings][collapse ⌄]` `[OBS]`. Focusing a row on narrow screens auto-opens the keypad `[OBS]`.
- **List toolbar (wide):** `[+ add item] … [undo][redo] … [edit-list][« collapse list]` `[OBS]`.
- **Graph overlay, top-right:** settings (wrench), then a separated `[+]` / `[−]` zoom pair
  (rounded square buttons) `[OBS]`. Also "default viewport" (home), which appears after the user
  pans or zooms `[DOC][INF]`.
- When a row is focused, a keypad toggle (keyboard icon with a caret) shows bottom-left of the
  list `[OBS]`.

### 3.2 Expression rows `[OBS][DOC]`
- A numbered gutter (≈ 38px; index top-left). An empty ghost row always sits at the end; clicking
  it or pressing Enter on the last row creates a row.
- **Gutter icon by state:**
  - graphed item: filled colour circle with a white curve glyph
  - point: point glyph *(verify)*
  - slider: play button, with an animation-mode icon (⇄) below it
  - undefined variables: warning triangle
  - error: warning with message on hover *(verify wording)*
- Clicking the colour icon toggles hidden. Long-press, Shift+click or Ctrl+Shift+O opens the style
  menu `[DOC]`.
- **Focused row:** blue gutter fill and a blue outline. The X (delete) shows at the right `[OBS]`.
- **Evaluation:** a right-aligned grey "= value" chip under or beside the expression when the row
  is a pure number or an evaluation `[DOC][INF]` *(observe exact placement)*.
- **Undefined free variables** show an `add slider:` line with pill buttons, one per variable plus
  `all` (highlighted). Clicking creates rows `m = 1` directly below, default value **1**, range
  **−10…10**, continuous `[OBS][DOC]`. Reserved names (never sliders): x, y, θ, r (when θ is
  present), e, and i in complex mode `[DOC]`.
- **Slider row:** `m = 1` math; under it `−10 ── ● ── 10` with editable end labels (click to edit
  min, max, step); a play button in the gutter; animation menu (loop ↔, one direction, once,
  forever, speed) `[OBS][DOC]`. Bounds may reference other variables `[DOC]`.

### 3.3 Graph paper `[OBS][API]`
- **Default viewport:** x ∈ [−10, 10] across the graph's width, y scaled for a **1:1 aspect**
  (observed ±8 at 860×700 and ±38 in a tall pane), centred on the origin.
- **Grid:** major lines and numeric labels at "nice" steps (1, 2, 5 × 10ⁿ). At ±10 across about
  860px the major step is 2 with **4 minor subdivisions** (0.5) `[OBS]`. Minor subdivisions are
  automatic and settable 0–5 `[API]`.
- Axis labels sit below the x-axis and left of the y-axis, in a small sans with a white halo where
  they cross lines `[OBS][INF]`. The step can be set to `π` for multiples of π `[DOC]`.
- **Curves:** width 2.5, opacity 0.9 `[API]`. The selected curve draws thicker `[OBS]`. Default
  colour cycle order: red, blue, green, purple, orange, black `[API][OBS]`. **Use our own six
  hues in the same order and roles**, contrast-checked on white (no trade dress).
- **Pan:** drag. **Zoom:** wheel or trackpad about the cursor; `+`/`−` buttons zoom about the
  centre. Keyboard: Alt± on Windows, Ctrl± on Mac `[DOC]`. Settings can lock the viewport `[DOC]`.

### 3.4 Points of interest (POI) `[OBS][DOC]`
- **Only for the selected curve** (selected in the list or by clicking the curve): grey dots at
  zeros, the y-intercept, local extrema, and intersections with every other visible curve.
- **Hover** previews the coordinates. **Click** makes the dot black and larger, and pins a white
  rounded card with a soft shadow showing the coordinates **in exact form when recognisable**,
  e.g. `(−3π/2, 1)` with a stacked fraction. A second click unpins it.
- The card has an **"export to expression list"** button that appends the point as a new row
  `[OBS][DOC]`.
- Not shown for parametric curves `[DOC]`. Tracing: drag along the curve to show a moving
  coordinate `[API: trace]`.
- **Exact-form recognition** `[INF]`: try rationals p/q (q ≤ 12) and (p/q)·π, within a 1e-9
  relative tolerance. Otherwise show a decimal (§3.7).

### 3.5 Inequalities and restrictions `[DOC]`
- `<`/`>` give a **dashed** boundary *(the guide says dashed and one help article says dotted;
  observe)*. `≤`/`≥` give a solid boundary. Typing `<` then `=` produces `≤`.
- Shading uses the curve colour at fill opacity ≈ 0.4 `[API: fillOpacity]` *(verify for
  inequalities)*. Works for explicit and implicit forms (`x²+y² < 4` shades a disc). Compound
  `1 < y < x` is allowed.
- **Restrictions:** braces at the end, `y = x {−2 < x < 2}`, and they apply to y too. Chained
  `{…}{…}` or `and` means AND; `or` means OR. They also bound regression parameters
  (`{1 < b < 5}`).

### 3.6 Tables `[DOC]`
- Created by typing `table` in an empty row, by Add Item, by Ctrl+Alt+T, or by pasting spreadsheet
  data (≤ 10,000 rows per table, splitting beyond that; no headers).
- Default headers `x₁ y₁`, auto-numbered. Arrow keys move between cells; Enter adds a row.
- A header containing a function of the first column (e.g. `f(x₁)`, `sin(x₁)`) computes its
  cells; computed cells are grey and read-only. A header may reference an external list.
- **Create Table** from a function, point or point list via the edit-list mode. A function table
  defaults to x = −2…2. Not available for implicit, parametric or polar.
- Style: points, lines, or both. "Make all points draggable" is one toggle. **Zoom Fit**
  (Shift+Alt+Z).
- **Add Regression** button under the table → a linear regression row with a model dropdown.

### 3.7 Numbers and evaluation display `[DOC][INF]`
- Show about 12 significant digits, with trailing zeros trimmed *(observe)*. Switch to scientific
  notation for very large or small values (format `1.23×10⁻⁸`).
- **Fraction toggle** appears when a good rational approximation exists (decimalToFraction)
  `[API][DOC]`.
- Digit grouping uses thin spaces every three digits `[MQ]`.
- Undefined results show "undefined" *(observe)*.

### 3.8 Keypad `[OBS]` (layout functional, styling ours)
- **Main:**
  - left 4×4: `x y a² aᵇ` / `( ) < >` / `|a| , ≤ ≥` / `ABC 🔊 √ π`
  - centre: `7 8 9 ÷` / `4 5 6 ×` / `1 2 3 −` / `0 . = +`
  - right: `functions` / `← →` / `⌫` / `↵` (primary)
  - Narrow screens label `functions` as `funcs`.
- **ABC page:** QWERTY layout by default `[API: qwertyKeyboard]`, with `~` in its bottom row
  `[DOC]` *(observe full layout)*.
- **Functions page:** categories trig, inverse trig, statistics, list ops, visualisations,
  distributions, calculus, hyperbolic, number theory, geometry, custom colours … `[DOC]`
  *(observe order)*.
- Opens docked across the full width under both panes; the graph shrinks to fit `[OBS]`.

### 3.9 Keyboard shortcuts `[DOC]`
| Shortcut | Action |
|---|---|
| Enter | New row below |
| Ctrl+Alt+X / O / T / F / I | Add expression / note / table / folder / image |
| Ctrl+Alt+G | Graph settings |
| Alt+K | Keypad |
| Ctrl+/ | Shortcut list |
| Ctrl+Shift+O | Style menu |
| Ctrl+Alt+D | Edit list |
| Shift+Alt+Z | Zoom fit |
| Alt+Up / Alt+Down | Collapse / open folder |
| Ctrl+Alt+P | Focus a movable point (arrow keys move it) |
| Alt+T | Audio trace |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+C / Ctrl+V | Copy / paste a whole row |

Mac equivalents use Ctrl+Cmd.

### 3.10 Settings menu (wrench) `[DOC][API]`
- Grid on/off; Cartesian or polar grid; axis numbers; minor gridlines; each axis on/off; axis
  labels; x and y min/max; step (accepts `π`); arrows.
- Radians/degrees (**graphing default: radians**; scientific default: degrees).
- Complex mode; lock viewport; projector mode; reverse contrast; enlarge.

---

## 4. Behaviour catalogue (each item is a testable statement)

**Typing and parsing**
1. `y=x^2` plots live as you type `[OBS]`.
2. `sin x` = `sin(x)`: function juxtaposition `[OBS]`.
3. Implicit multiplication: `2x`, `xy`, `2πr`, `(x+1)(x−1)` `[DOC]`.
4. Typing `pi`, `theta`, `sqrt`, `sum`, `int`, `infinity` turns them into symbols or templates
   `[MQ]`.
5. Typing `/` makes a fraction that takes the preceding operand `[DOC]`.
6. `<=` becomes `≤` and `->` becomes `→` `[DOC]`.
7. `x2` becomes `x₂`, a distinct variable `[OBS][MQ]`.
8. `sin^-1(x)` and `arcsin(x)` are equivalent `[DOC]`.
9. `log` is base 10, `ln` natural, and `log_a(x)` takes a base `[DOC]`.

**Item types (inferred from the expression's form)**
10. Equation solved for y gives an explicit curve. Solved for x gives `x = f(y)` `[DOC]`.
11. Equation in x and y that isn't solved gives an implicit curve (`3x−4y=1`, `x²+y²=25`) `[DOC]`.
    An equation quadratic in y or x is solved for it `[API: "solving (quadratic in x or y)"]`.
12. `(a, b)` is a point. `(a,b),(c,d)` is several points. `(f(t), g(t))` is a parametric curve,
    t ∈ [0, 1] by default, with domain inputs on the row `[DOC]`.
13. `r = f(θ)` is polar, θ ∈ [0, 12π] by default, shortened to one period when periodic `[DOC]`.
    It must be linear in r. Polar inequalities shade only where r > 0.
14. `name = number` makes a slider. `f(x) = …` is a function definition (not plotted unless its
    body depends only on x, then it plots `[INF]`; verify). `f(3)` evaluates.
15. A bare expression with no free variables evaluates (`2+3` → `= 5`).
16. `y1 ~ m x1 + b` is a regression; fitted parameters become global variables `[DOC]`.
17. `[1,2,3]` is a list and broadcasts. `[1...10]`, `[1,3...11]`. Indexing is 1-based: `L[1]`,
    `L[1...5]`, `L[3...]`, `L[L>0]`, `L[M]` `[DOC]`.
18. `polygon(…)` and `polygon(x₁,y₁)` `[DOC]`.
19. `{x<0: sin x, x≥0: 2x}` is piecewise, with an optional final else value `[DOC]`.
20. `(a,b) for a=[…], b=[…]` gives the Cartesian product. `(a,a) for 1≤a≤3` gives a continuous
    curve `[DOC]`.
21. `expr with a=2` substitutes `[DOC]`.
22. `f'(x)`, `f''(x)`, `d/dx(…)`, `∫ₐᵇ … dx` (including infinite bounds), `Σ`, `Π` `[DOC]`.
23. `p.x`, `p.y`, `|p|`, `p+q`, `k·p` `[DOC]`.
24. `110% of f(n−1)`, the `% of` operator `[DOC]`.
25. Recursion `f(n)=f(n−1)+2` with a prompt to add a base case `f(1)` `[DOC]`.

**Sliders and dragging**
26. Free variables prompt `add slider` (one per variable, plus `all`). The defaults are value 1,
    range −10…10, continuous `[OBS][DOC]`.
27. A point with slider coordinates is draggable and drives its sliders. `(a, f(a))` drags along
    the curve `[DOC]`.
28. Drag modes: X, Y, XY, none, auto `[API]`.

**Regressions** `[DOC]`
29. All fits use least squares. Models linear in their parameters are solved in closed form.
    Nonlinear models use multi-start iterative fitting: initial guesses in ±5000 biased towards 0,
    restricted by any parameter restriction, keeping the best SSE. Heuristics: low frequencies for
    trig models; ignore negative bases in exponential models.
30. Log mode transforms exponential, power and logarithmic models to linear form. r and r² come
    from the transformed data, residuals from the untransformed data. **Forced on in SAT mode**
    `[CB]`.
31. Output shows r (linear) or R² (nonlinear), the parameters, and residuals (plottable). R² can be
    negative.

**Statistics and distributions** `[DOC]`
32. The function set in §5. `stats(L)` shows count, mean, median, stdev, stdevp and a five-number
    summary. `boxplot` uses Moore & McCabe quartiles. `histogram` and `dotplot` default to bin
    width 1.
33. Distributions graph a PDF (curve) or PMF (points). A Cumulative Probability control shades the
    CDF. `random()` and seeds follow `[DOC]`.

**Display**
34. POI behaviour as in §3.4. Exact π and fraction forms in POI cards `[OBS]`.
35. Strict inequalities draw dashed boundaries; non-strict draw solid ones.
36. Too-complex plots render at lower resolution instead of failing (time budget) `[DOC]`.
37. Removable discontinuities are not drawn as holes; the user plots an open point `[DOC]`.

---

## 5. Function library (Desmos-equivalent names)

Priority: **A** = G1, **B** = G2, **C** = G3, **D** = G4 (see §6).

| Category | Functions | Priority |
|---|---|---|
| Arithmetic | `+ − × ÷`, `^`, `√`, `nthroot`, `\|x\|`, `!`, `%`, `mod`, `floor`, `ceil`, `round(x[,places])`, `sign`, `exp` | A |
| Trig | `sin cos tan csc sec cot`, inverses as `sin⁻¹` and `arcsin`, … | A |
| Hyperbolic | `sinh … coth` | C |
| Logarithms | `log`, `ln`, `log_a` | A |
| Statistics | `mean median min max count total stdev stdevp var varp cov covp corr spearman mad quartile quantile stats` | B |
| Lists | `sort join unique repeat shuffle`, `for` | B/C |
| Visualisation | `histogram dotplot boxplot` | C |
| Distributions | `normaldist tdist chisqdist uniformdist binomialdist poissondist geodist discretedist`, `.pdf .cdf .inversecdf .random`, `random` | C |
| Calculus | `d/dx`, `f'`, `∫`, `Σ`, `Π` | C |
| Number theory | `gcd lcm nPr nCr` | B |
| Geometry | `polygon distance midpoint` | B/C |
| Colour | `rgb hsv okhsv oklab oklch` | D |
| Matrices | `det trace rref rank rows columns transpose inverse`, `#rc`, `A[i;j]` | D |
| Inference | `ztest ttest zproptest chisqtest chisqgof`, `.p .conf …` | D |
| Advanced | actions `→`, ticker, `tone`, complex mode (`real imag conj arg`) | D |
| Constants | `π τ e ∞`, `width height` | A |

---

## 6. Build phases (merges into OVERHAUL.md O2/O4)

| Phase | Scope | Accept |
|---|---|---|
| **G1 Board graphing** (≈1–2 wks) | MathQuill rows + list UX (§3.2), parser and evaluator for priority-A functions, explicit / x=f(y) / points / sliders (with prompt) / restrictions, grid, pan and zoom (§3.3), POI with exact-form cards (§3.4), evaluation and fraction toggle, own state + op-sync on the board, replacing the Desmos mirror | Catalogue items 1–10, 14–15, 26–27, 34 pass as automated tests; two-window board sync without the interaction-gating hack |
| **G2 SAT core** (≈2–3 wks) | Implicit curves and conics (quadtree + marching squares), inequalities and shading, tables (+ create table, computed columns, paste), lists and stats, regressions (closed form + LM + log mode), piecewise, full keypad (main, ABC, functions), degree mode, settings menu, narrow layout | Items 11, 16–17, 19, 29–32, 35 pass; a tutor solves 10 real SAT calculator questions identically in ours and in Desmos |
| **G3 SAT breadth** (≈2–3 wks) | Parametric, polar, polygons, calculus, distributions and CDF shading, histograms, `for`/`with`, list indexing, recursion, point ops, labels (dynamic `${}`), drag modes, slider animation, Scientific calculator skin | Remaining items 12–13, 18, 20–25, 28, 33 |
| **G4 Long tail** | Matrices, complex, inference, actions/ticker, tone, accessibility (audio trace, braille) | Case by case |

**SAT mode** = feature flags: images, folders and notes off; log mode forced (§1).

**G1 status (2026-10-22):**
- **Built.**
  - Engine: `packages/graph`, with 68 tests (`npm test`) covering catalogue items 1–10, 14–15,
    26–27 and 34, plus the G1 golden cases.
  - UI: `apps/web/src/graph`, on the vendored MathQuill.
  - Board: `Calculator.tsx` now uses our calculator, `desmos.ts` is deleted, and sync is plain
    full-state broadcast on user edits.
- **Verified in the browser** (dev-only `/dev/graph`):
  - typing (`sinx` → `\sin x`), Enter for new rows
  - live curves, the add-slider prompt, slider drag
  - curve selection, the exact POI card `(π/2, 1)`, export to a row
  - the `= 0.333333333333` value chip with fraction toggle, undo, dragging `(a, a²)`
- **Deviations:**
  - Sync is full state, not ops (§2.3). It's simpler; state is a few KB and the server caps
    it at 256 KB. Revisit if it ever matters.
  - Inequalities, implicit curves, the keypad and slider animation are G2/G3 as planned.
- **Not yet verified:** visual styling by eye (screenshots were unavailable), and a two-window
  board session. Konrad browser-check.

**G2 status (2026-10-23):**
- **Built (engine, 52 new tests in `test/g2.test.mjs`; 119 in total):**
  - Lists: literals, `[1...10]`, `[1,3...11]`, 1-based indexing, ranges, `L[3...]`, filters
    `L[L>0]`, and broadcasting through operators, functions and user functions.
  - Statistics and list functions (§5), with quartiles by Moore & McCabe.
  - Piecewise `{c: v, …, else}`.
  - Inequalities: explicit, `a<y<b` bands and implicit regions, with dashed or solid boundaries
    and restrictions.
  - Implicit curves: an adaptive quadtree plus marching squares, rejecting false contours at
    poles.
  - Tables: data columns become list variables; header expressions compute their column.
  - Regressions:
    - least squares; QR when the model is linear in its parameters, otherwise multi-start
      Levenberg–Marquardt
    - parameter bounds from restrictions
    - log mode for a·bˣ, a·e^(bx) and a·x^b (it matches TI ExpReg)
    - r and r² for y ~ mx + b, R² otherwise; round-off dust snaps to 0
    - fitted parameters are global variables, and the model is plotted
  - Parser fix: `a(x+1)^2` is a·(x+1)² when `a` is not a function.
- **Built (UI):**
  - shading, dashed boundaries and implicit curves on the graph paper
  - table rows: typing `table`, editable headers and cells, grey computed cells, a growing blank
    row, pasting spreadsheet data
  - regression results; list values in the `= value` chip
  - the keypad (main page laid out as the reference, plus ABC and functions pages)
  - a settings toggle for log-mode regressions
- **Verified in the browser** (`/dev/graph`):
  - `table` → x₁/y₁; filling cells
  - `y1~mx1+b` → r = 1, m = 2, b = 0
  - shading above `y>x^2`, and the circle `x^2+y^2=16` through (0,4) and (4,0), checked by
    sampling pixels
  - keypad entry `x^{2}-4` and Enter; pasting a 4×2 grid → a table with x₂/y₂
- **Deferred:**
  - the per-regression log-mode toggle and residual variables (e₁)
  - "Create table" from a function (the edit-list mode)
  - table column style menu (point style/lines)
  - POIs for x = f(y) and implicit curves
  - SAT mode wiring in the runner (O4)

---

## 7. Golden test cases (seed set; extend continuously)

| Input | Expected |
|---|---|
| `y=x^2-3x+1`, selected | POIs: vertex (1.5, −1.25); zeros ≈ (0.382, 0), (2.618, 0); y-intercept (0, 1) |
| `y=\sin x` with the above | Intersections with the parabola shown; max card at x = −3π/2 reads `(−3π/2, 1)` |
| `y=mx+b`, then add all sliders | Rows `m=1`, `b=1` inserted below; line y = x + 1 drawn |
| `2+3` | `= 5` |
| `1/3` | `= 0.333333333333`; fraction toggle → `1/3` *(digit count to observe)* |
| `x^2+y^2=25` | Implicit circle, radius 5 |
| `x^2+y^2<4` | Dashed circle, disc shaded |
| `y=x\{-2<x<2\}` | Segment only |
| `L=[1...5]`, `L^2` | `= [1,4,9,16,25]` |
| `f(x)=x^2+3x`, `f(3)` | `= 18` |
| `\int_0^3 (x^2/10+1)dx` | `= 3.9` |
| `y_1 \sim m x_1 + b` on (1,2),(2,4),(3,6) | m = 2, b = 0, r = 1 |
| SAT mode: `y_1 \sim a b^{x_1}` | Fitted in log mode (matches TI ExpReg) |
| `0^0` | `= 1` |

---

## 8. Risks

- **Fidelity long tail:** Desmos has a decade of polish. Mitigate by prioritising by SAT usage
  (§6) and letting Konrad's students A/B-test in G2.
- **Implicit plotting quality:** the hardest renderer. Use an adaptive quadtree with
  interval-arithmetic culling, then refine near sign changes.
- **Nonlinear regression robustness:** follow the documented multi-start approach; add tests from
  real SAT data.
- **MPL obligations:** keep MathQuill unmodified or publish the fork; record attribution in the
  third-party notices.
- **Legal posture:** keep this spec's provenance tags honest. If anyone cannot say where a
  behaviour came from, it doesn't ship.

---

## 9. Open observations (to verify hands-on before or while building)

Hands-on testing stopped when the browser pane became too small and hidden. To finish, use a
wide window at desmos.com/testing/collegeboard/graphing. Synthesized keystrokes drop symbol
keys, so use the on-screen keypad for symbols.

- [ ] Number display: significant digits, sci-notation thresholds, the `= value` chip position
      and styling, and the fraction toggle UI.
- [ ] Error message wording and placement (e.g. "Too many variables", undefined function).
- [ ] Strict-inequality boundary: dashed or dotted; shading opacity.
- [ ] ABC and functions keypad pages: exact layout and category order.
- [ ] Style menu contents per item type (colour swatches, line style, width, opacity, point style,
      label, drag).
- [ ] Table UI: cell sizes, header editing, regression panel layout (r, R², residual plotting).
- [ ] Settings menu layout.
- [ ] Gutter icons for points, tables and errors.
- [ ] Default-viewport (home) button behaviour, and zoom step factor per click.
- [ ] Hover vs click POI; trace behaviour while dragging along a curve.
- [ ] Edit-list mode (gear): duplicate, convert to table, delete.
- [ ] Whether function definitions in x alone plot (catalogue item 14).
