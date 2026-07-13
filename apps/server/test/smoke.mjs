// Headless smoke test for the Phase 0 server: boots the real server, waits for
// its "listening" line (never trust a run without it — a stale server once
// silently served old code, PLAN.md §9.6), hits /api/health, then tears down.
// No installable browser in this dev environment, so this + typecheck + vite
// build is the whole verification story until Playwright-class tooling exists.
import { spawn, execSync } from 'node:child_process'

const PORT = 6061
const BASE = `http://localhost:${PORT}`

let failures = 0
function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failures++
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function killTree(pid) {
  // Windows: SIGTERM doesn't reliably reach child processes spawned via tsx;
  // taskkill /T kills the process tree. (PLAN.md §9.6 — pkill -f tsx does not
  // match node.exe on Windows.)
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill //PID ${pid} //T //F`, { stdio: 'ignore' })
    } catch {
      /* already exited */
    }
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      /* already exited */
    }
  }
}

const server = spawn('npx', ['tsx', 'src/index.ts'], {
  cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  env: { ...process.env, PORT: String(PORT) },
  shell: true,
})

let listening = false
server.stdout.on('data', (d) => {
  const line = d.toString()
  if (line.includes('listening')) listening = true
})
server.stderr.on('data', (d) => process.stderr.write(d))

try {
  for (let i = 0; i < 50 && !listening; i++) await wait(100)
  check('server printed "listening" before we trust it', listening)

  const health = await fetch(`${BASE}/api/health`)
  const body = await health.json()
  check('/api/health responds 200', health.status === 200)
  check('/api/health reports ok:true', body.ok === true)

  const session = await fetch(`${BASE}/api/tutor/session`)
  check('/api/tutor/session rejects unauthenticated requests', session.status === 401)

  const missing = await fetch(`${BASE}/api/nope`)
  check('unmatched /api route is a 404', missing.status === 404)
} finally {
  killTree(server.pid)
}

console.log(failures === 0 ? `\nAll smoke checks passed.` : `\n${failures} smoke check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
