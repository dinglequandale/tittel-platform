// Headless unit test for the unified grader (src/grade.ts) — combines the
// case coverage from both source repos' test suites:
//   tittel-tutoring-app/test/grade.mjs (normalizeAnswer + choice/grid via QuestionKey)
//   tittel-sat-homework/test/units.ts (gradeMc/gradeGrid/normalizeNumeric)
// adapted to the new bank-problem shape (type mc|multi|numeric|text|frq).
import { normalizeAnswer, gradeResponse } from '../src/grade.ts'

let failures = 0
function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failures++
}

const mc = (correct, accept) => ({ type: 'mc', correct, accept })
const numeric = (correct, accept) => ({ type: 'numeric', correct, accept })
const text = (correct, accept) => ({ type: 'text', correct, accept })
const multi = (correct) => ({ type: 'multi', correct })
const frq = () => ({ type: 'frq', correct: null })

// ---- normalizeAnswer --------------------------------------------------
check('normalize trims and strips internal whitespace', normalizeAnswer('  1 / 2 ') === '1/2')
check('normalize converts unicode minus', normalizeAnswer('−3') === '-3')
check('normalize converts en-dash', normalizeAnswer('–3') === '-3')
check('normalize strips leading +', normalizeAnswer('+8') === '8')
check('normalize strips surrounding parens', normalizeAnswer('(A)') === 'A')
check('normalize leaves plain value alone', normalizeAnswer('8') === '8')
check('normalize does not lowercase', normalizeAnswer('AbC') === 'AbC')

// ---- mc (choice) --------------------------------------------------------
check("mc: 'b' vs key 'B' -> true", gradeResponse(mc('B'), 'b') === true)
check("mc: '(C)' vs key 'C' -> true", gradeResponse(mc('C'), '(C)') === true)
check("mc: 'A' vs key 'B' -> false", gradeResponse(mc('B'), 'A') === false)
check("mc: null answer -> false", gradeResponse(mc('B'), null) === false)
check("mc: null correct -> false", gradeResponse(mc(null), 'B') === false)

// ---- numeric (grid-in): exact / equivalent literals -----------------------
check("numeric: '8' vs key '8'", gradeResponse(numeric('8'), '8') === true)
check("numeric: '8.0' vs key '8'", gradeResponse(numeric('8'), '8.0') === true)
check("numeric: '+8' vs key '8'", gradeResponse(numeric('8'), '+8') === true)
check("numeric: '-3' vs key '-3'", gradeResponse(numeric('-3'), '-3') === true)
check("numeric: unicode minus '−3' vs key '-3' -> true", gradeResponse(numeric('-3'), '−3') === true)

// ---- numeric: fractions ------------------------------------------------------
check("numeric: '1/2' vs key '0.5' -> true", gradeResponse(numeric('0.5'), '1/2') === true)
check("numeric: '.5' vs key '1/2' -> true", gradeResponse(numeric('1/2'), '.5') === true)
check("numeric: '4/6' vs key '2/3' -> true", gradeResponse(numeric('2/3'), '4/6') === true)

// ---- numeric: SAT repeating-decimal convention (0.1% relative tolerance) -----
check("numeric: '.6666' vs key '2/3' -> true", gradeResponse(numeric('2/3'), '.6666') === true)
check("numeric: '0.6667' vs key '2/3' -> true", gradeResponse(numeric('2/3'), '0.6667') === true)
check("numeric: '2/3' vs key '2/3' -> true", gradeResponse(numeric('2/3'), '2/3') === true)
check("numeric: '.67' vs key '2/3' -> false (too coarse)", gradeResponse(numeric('2/3'), '.67') === false)
check("numeric: '.6' vs key '2/3' -> false (too coarse)", gradeResponse(numeric('2/3'), '.6') === false)

// ---- numeric: accept[] escape hatch -------------------------------------------
check(
  "numeric: 'x=4' vs key '4' with accept ['x=4'] -> true",
  gradeResponse(numeric('4', ['x=4']), 'x=4') === true,
)

// ---- numeric: rejections -------------------------------------------------------
check("numeric: '' vs key '8' -> false (Number('')===0 trap)", gradeResponse(numeric('8'), '') === false)
check("numeric: ' ' vs key '8' -> false", gradeResponse(numeric('8'), ' ') === false)
check("numeric: 'abc' vs key '8' -> false", gradeResponse(numeric('8'), 'abc') === false)
check("numeric: '1/0' vs key '8' -> false (division by zero)", gradeResponse(numeric('8'), '1/0') === false)
check("numeric: '9' vs key '8' -> false", gradeResponse(numeric('8'), '9') === false)
check("numeric: null answer -> false", gradeResponse(numeric('8'), null) === false)

// ---- text ---------------------------------------------------------------------
check("text: case-insensitive exact match", gradeResponse(text('Paris'), 'paris') === true)
check("text: accept[] literal alternate", gradeResponse(text('NYC', ['New York City']), 'new york city') === true)
check("text: mismatch -> false", gradeResponse(text('Paris'), 'London') === false)

// ---- multi (multiple-select) ---------------------------------------------------
check("multi: exact set match -> true", gradeResponse(multi(['A', 'C']), ['C', 'A']) === true)
check("multi: missing option -> false", gradeResponse(multi(['A', 'C']), ['A']) === false)
check("multi: extra option -> false", gradeResponse(multi(['A', 'C']), ['A', 'B', 'C']) === false)
check("multi: empty correct -> false", gradeResponse(multi([]), []) === false)

// ---- frq (never auto-graded) ---------------------------------------------------
check("frq: always null", gradeResponse(frq(), 'anything') === null)

console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILURE(S)'}`)
process.exit(failures === 0 ? 0 : 1)
