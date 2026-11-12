// The database pool's TLS settings (src/lib/dbSsl.ts), checked against a real
// TLS handshake: a stand-in Postgres on 127.0.0.2 answers the SSL request and
// presents a certificate from a test CA (test/fixtures/tls, test-only keys).
import fs from 'node:fs'
import net from 'node:net'
import tls from 'node:tls'
import pg from 'pg'
import { dbSsl } from '../src/lib/dbSsl.ts'

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`)
  if (!ok) failures++
}

const fixture = (f) => fs.readFileSync(new URL(`./fixtures/tls/${f}`, import.meta.url), 'utf8')
const ca = fixture('ca.pem')
const otherCa = fixture('other-ca.pem')

// ---- the settings ---------------------------------------------------------
const remote = 'postgres://u:p@db.example.com:5432/postgres'
check('no TLS for a local database', dbSsl('postgres://postgres@127.0.0.1:5499/postgres', { DATABASE_CA_CERT: ca }) === undefined)
check('without a CA the default is unchanged (not verified)', dbSsl(remote, {})?.rejectUnauthorized === false)
check('with DATABASE_CA_CERT the certificate is verified against it', dbSsl(remote, { DATABASE_CA_CERT: ca })?.rejectUnauthorized === true && dbSsl(remote, { DATABASE_CA_CERT: ca })?.ca === ca.trim())
check('a PEM pasted on one line with \\n works', dbSsl(remote, { DATABASE_CA_CERT: ca.trim().replace(/\n/g, '\\n') })?.ca === ca.trim())
check('PGSSLMODE=no-verify still turns verification off', dbSsl(remote, { DATABASE_CA_CERT: ca, PGSSLMODE: 'no-verify' })?.rejectUnauthorized === false)

// ---- a real handshake -------------------------------------------------------
// Answers Postgres's SSLRequest with 'S', then speaks TLS. A completed
// handshake is all this checks; the connection then closes.
const handshakes = []
const server = net.createServer((socket) => {
  socket.on('error', () => {})
  socket.once('data', () => {
    socket.write('S')
    const secure = new tls.TLSSocket(socket, { isServer: true, key: fixture('server-key.pem'), cert: fixture('server.pem') })
    secure.on('secure', () => {
      handshakes.push('ok')
      secure.destroy()
    })
    secure.on('error', () => handshakes.push('refused'))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.2', resolve))
const url = `postgres://u:p@127.0.0.2:${server.address().port}/postgres`

async function connect(env) {
  // A real database is reached by name; this one is at an IP, so name it as its certificate does.
  const ssl = { ...dbSsl(url, env), servername: 'db.test' }
  const client = new pg.Client({ connectionString: url, ssl, connectionTimeoutMillis: 5000 })
  client.on('error', () => {})
  try {
    await client.connect()
    return 'connected'
  } catch (err) {
    return err.message
  } finally {
    await client.end().catch(() => {})
  }
}

const withCa = await connect({ DATABASE_CA_CERT: ca })
check('the right CA completes the TLS handshake', handshakes.at(-1) === 'ok', withCa)
const wrongCa = await connect({ DATABASE_CA_CERT: otherCa })
check('a certificate from another CA is refused', /self[- ]signed|unable to verify|certificate/i.test(wrongCa), wrongCa)
const noCa = await connect({})
check('without a CA it connects unverified, as before', handshakes.at(-1) === 'ok' && !/certificate/i.test(noCa), noCa)

server.close()
console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
