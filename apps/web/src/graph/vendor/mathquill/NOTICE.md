# MathQuill (vendored, unmodified build)

- **Source:** https://github.com/desmosinc/mathquill, commit `bb9974ab637e1dd57673fe8c96a00c85cfc3da37`
  (2026-08-07), version 0.10.1.
- **Licence:** Mozilla Public License 2.0 (https://mozilla.org/MPL/2.0/). The Source Code Form
  of these files is available at the URL and commit above. The MPL header is preserved at the top
  of `mathquill.js`.
- **What is here:** `mathquill.js` and `mathquill.css`, built from that commit by
  `build-mathquill.cjs`. It reproduces the upstream Makefile's `dev` target without GNU make:
  concatenate the sources, escape non-ASCII, `ts.transpileModule` to ES5, `lessc`. The CSS uses
  the upstream build option `omit-font-face=true`. `fonts/Symbola.woff2` and `fonts/Symbola.woff`
  are copied unchanged from the repository's `src/fonts/`.
- **No modifications.** Configure MathQuill from `../../mathquill.ts`; do not edit these files.
  If a change is ever unavoidable, MPL-2.0 requires publishing the modified MathQuill files
  (e.g. a public fork) and updating this notice.
- Why we use it: GRAPH-SPEC.md §2.1 (it is the reference calculator's own math-input field,
  published under an open-source licence).
