// A signed-in test stack that never touches Supabase or the real database:
//  - PGlite (real Postgres in WASM) over the wire protocol, with db/schema.sql applied
//  - a mock Supabase JWKS, plus /test-session?u=<slug> minting a tutor session
//  - the API (src/index.ts) booted against both
//
// As a module (the test suites): `startStack()` picks free ports and keeps the
// database in memory. From the command line, for signed-in screens in a browser:
//   node apps/server/test/stack/stack.mjs
// serves pg :5499, JWKS :5498 and the API :6070, keeping its data in
// test/stack/.data so a restart keeps tutors and their sessions.
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { spawn, execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { generateKeyPair, exportJWK, importJWK, SignJWT } from 'jose'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverDir = path.resolve(here, '../..')
const schemaFile = path.resolve(serverDir, '../../db/schema.sql')


async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

function killTree(pid) {
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' })
    } catch {
      /* already exited */
    }
  } else {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* already exited */
    }
  }
}

async function loadKeys(dataDir) {
  const keyFile = dataDir && path.join(dataDir, 'key.json')
  if (keyFile && fs.existsSync(keyFile)) {
    const k = JSON.parse(fs.readFileSync(keyFile, 'utf8'))
    return { publicKey: await importJWK(k.pub, 'RS256'), privateKey: await importJWK(k.priv, 'RS256') }
  }
  const keys = await generateKeyPair('RS256', { extractable: true })
  // Kept with the data, so a browser's stored session outlives a stack restart.
  if (keyFile) fs.writeFileSync(keyFile, JSON.stringify({ pub: await exportJWK(keys.publicKey), priv: await exportJWK(keys.privateKey) }))
  return keys
}

/**
 * Starts the stack. `dataDir` keeps the database on disk (else in memory).
 * `env` adds to the API's environment. Resolves once the API printed "listening".
 */
export async function startStack({ dataDir, pgPort, jwksPort, apiPort, env = {}, log = false } = {}) {
  pgPort ??= await freePort()
  jwksPort ??= await freePort()
  apiPort ??= await freePort()
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true })

  const db = await PGlite.create(dataDir ? path.join(dataDir, 'pg') : undefined)
  await db.exec(fs.readFileSync(schemaFile, 'utf8'))
  const pgServer = new PGLiteSocketServer({ db, port: pgPort, host: '127.0.0.1', maxConnections: 20 })
  await pgServer.start()

  const { publicKey, privateKey } = await loadKeys(dataDir)
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256', use: 'sig' }
  const lifetime = 30 * 24 * 3600

  /** A supabase-js shaped session for tutor `slug` (a fresh org on its first request). */
  async function session(slug = 'tutor') {
    const sub = `test-${slug}`
    const email = `${slug}@test.local`
    const now = Math.floor(Date.now() / 1000)
    const accessToken = await new SignJWT({ email, role: 'authenticated', user_metadata: {} })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(sub)
      .setIssuedAt(now)
      .setExpirationTime(now + lifetime)
      .sign(privateKey)
    return {
      access_token: accessToken, refresh_token: 'test-refresh', token_type: 'bearer',
      expires_in: lifetime, expires_at: now + lifetime,
      user: { id: sub, email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
    }
  }

  const jwks = http.createServer((req, res) => {
    if (req.url === '/auth/v1/.well-known/jwks.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ keys: [jwk] }))
    } else if (req.url.startsWith('/test-session')) {
      const u = new URL(req.url, 'http://x').searchParams.get('u') || 'tutor'
      session(u).then((s) => {
        res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
        res.end(JSON.stringify(s))
      })
    } else {
      res.writeHead(404).end()
    }
  })
  await new Promise((resolve) => jwks.listen(jwksPort, '127.0.0.1', resolve))

  const databaseUrl = `postgres://postgres@127.0.0.1:${pgPort}/postgres`
  // The API gets a clean environment and runs from this folder, which has no
  // .env: apps/server/.env points at the real database and must never load here.
  const apiEnv = {
    PATH: process.env.PATH,
    SYSTEMROOT: process.env.SYSTEMROOT,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    NODE_ENV: 'test',
    PORT: String(apiPort),
    DATABASE_URL: databaseUrl,
    SUPABASE_URL: `http://127.0.0.1:${jwksPort}`,
    BOARD_TOKEN_SECRET: 'test-board-secret',
    ...env,
  }
  if (!/^postgres:\/\/postgres@127\.0\.0\.1:\d+\/postgres$/.test(apiEnv.DATABASE_URL)) {
    throw new Error('test stack: refusing to start the API against a non-local database')
  }

  let api = null
  async function startApi() {
    // `--import tsx` keeps the API one process (tsx's CLI forks a child), so killing it frees the port.
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(serverDir, 'src/index.ts')], { cwd: here, env: apiEnv })
    let out = ''
    const listening = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`API did not start in 90s:\n${out}`)), 90_000)
      child.stdout.on('data', (d) => {
        out += d
        if (log) process.stdout.write(d)
        if (String(d).includes('listening')) {
          clearTimeout(timer)
          resolve()
        }
      })
      child.stderr.on('data', (d) => {
        out += d
        if (log) process.stderr.write(d)
      })
      child.on('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`API exited (${code}) before listening:\n${out}`))
      })
    })
    api = { child, output: () => out }
    await listening
  }

  async function stopApi() {
    if (!api) return
    const { child } = api
    api = null
    const exited = new Promise((resolve) => child.once('exit', resolve))
    killTree(child.pid)
    await exited
  }

  await startApi()

  const apiUrl = `http://127.0.0.1:${apiPort}`
  return {
    apiUrl,
    wsUrl: `ws://127.0.0.1:${apiPort}`,
    databaseUrl,
    jwksUrl: `http://127.0.0.1:${jwksPort}`,
    /** Bearer token for tutor `slug`. */
    token: async (slug) => (await session(slug)).access_token,
    session,
    /** Direct SQL against the test database, for checks the API doesn't expose. */
    query: (sql, params) => db.query(sql, params),
    apiOutput: () => api?.output() ?? '',
    /** Kills the API and boots it again on the same port and database. */
    async restartApi() {
      await stopApi()
      await startApi()
    },
    async stop() {
      await stopApi()
      jwks.close()
      await pgServer.stop()
      await db.close()
    },
  }
}

// Run directly: the fixed ports the browser test config (.claude/launch.json `test-web`) expects.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stack = await startStack({ dataDir: path.join(here, '.data'), pgPort: 5499, jwksPort: 5498, apiPort: 6070, log: true })
  console.log(`test stack ready: api ${stack.apiUrl}, pg ${stack.databaseUrl}, sessions ${stack.jwksUrl}/test-session?u=<slug>`)
  const shutdown = () => stack.stop().finally(() => process.exit(0))
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
