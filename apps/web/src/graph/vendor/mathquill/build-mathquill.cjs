// Reproduces desmosinc/mathquill's Makefile `dev` target (js + css + font) without GNU make.
// Usage (from the repo root, with `npm i -D less` available somewhere on PATH or locally):
//   node apps/web/src/graph/vendor/mathquill/build-mathquill.cjs <mathquill-checkout> <out-dir>
// CSS is built with omit-font-face=true; graph.css declares the Symbola face itself.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const ts = require(require.resolve('typescript', { paths: [process.cwd()] }))

const [src, out] = process.argv.slice(2)
const S = (p) => path.join(src, 'src', p)

// Order copied from the Makefile's BASE_SOURCES + SOURCES_FULL.
const BASE = [
  'has-spacing-bug.ts', 'utils.ts', 'dom.ts', 'unicode.ts', 'browser.ts', 'animate.ts',
  'services/aria.ts', 'domFragment.ts', 'tree.ts', 'cursor.ts', 'controller.ts', 'publicapi.ts',
  'services/parser.util.ts', 'services/saneKeyboardEvents.util.ts', 'services/exportText.ts',
  'services/focusBlur.ts', 'services/keystroke.ts', 'services/latex.ts', 'services/mouse.ts',
  'services/scrollHoriz.ts', 'services/textarea.ts',
]
const FULL = [...BASE, 'commands/math.ts', 'commands/text.ts', 'commands/math/advancedSymbols.ts',
  'commands/math/basicSymbols.ts', 'commands/math/commands.ts', 'commands/math/LatexCommandInput.ts']

const version = 'v' + JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')).version
fs.mkdirSync(out, { recursive: true })

// JS: cat intro + sources + outro | escape-non-ascii | tsc transpile (es5)
let cat = [S('intro.js'), ...FULL.map(S), S('outro.js')].map((f) => fs.readFileSync(f, 'utf8')).join('\n')
cat = cat.replace(/[^\x00-\x7F]/g, (c) => '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4))
let js = ts.transpileModule(cat, { compilerOptions: { target: ts.ScriptTarget.ES5 } }).outputText
js = js.replace(/\{VERSION\}/, version) // Makefile: perl s/{VERSION}/v$(VERSION)/ (first match)
fs.writeFileSync(path.join(out, 'mathquill.js'), js)

// CSS: lessc main.less, then the same {VERSION} substitution
const lessc = process.env.LESSC || 'lessc'
let css = execFileSync(lessc, ['--modify-var=omit-font-face=true', S('css/main.less')], { encoding: 'utf8', shell: true })
css = css.replace(/\{VERSION\}/, version)
fs.writeFileSync(path.join(out, 'mathquill.css'), css)

// Fonts
fs.cpSync(S('fonts'), path.join(out, 'fonts'), { recursive: true })
console.log(`built ${version}: mathquill.js ${js.length} B, mathquill.css ${css.length} B`)
