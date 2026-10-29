import { Router } from 'express'
import express from 'express'
import { newId, newToken } from '@tittel/shared'
import { orgQuery, fileQuery } from '../db.ts'

// Uploads kept in Postgres (schema.sql `files`): worksheets, PDF pages a plan
// shows on the board, students' photos of their work. Served by token, so a
// plan's image block, a portal and an attempt link can all show them.

export const MAX_FILE_BYTES = 15 * 1024 * 1024
const ALLOWED = /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/i

export interface StoredFile { token: string; name: string; type: string }

/** Validates an upload's type and size; a message for the client if it's not one we keep. */
export function checkUpload(contentType: string, body: unknown): string | null {
  if (!ALLOWED.test(contentType)) return 'only PDFs and images (PNG, JPEG, WebP, GIF) can be uploaded'
  if (!Buffer.isBuffer(body) || body.byteLength === 0) return 'the file is empty'
  if (body.byteLength > MAX_FILE_BYTES) return 'files can be up to 15 MB'
  return null
}

export async function storeFile(orgId: string, name: string, contentType: string, bytes: Buffer): Promise<StoredFile> {
  const token = newToken()
  await orgQuery(
    orgId,
    `insert into files (id, org_id, file_token, name, content_type, size, bytes) values ($2, $1, $3, $4, $5, $6, $7)`,
    [newId(), token, name.slice(0, 200), contentType.toLowerCase(), bytes.byteLength, bytes],
  )
  return { token, name, type: contentType.toLowerCase() }
}

/** The files of this org among `tokens` (anything else is dropped), in the given order. */
export async function ownFiles(orgId: string, tokens: unknown): Promise<StoredFile[]> {
  const list = Array.isArray(tokens) ? tokens.filter((t): t is string => typeof t === 'string').slice(0, 30) : []
  if (!list.length) return []
  const rows = await orgQuery<{ file_token: string; name: string | null; content_type: string }>(
    orgId,
    `select file_token, name, content_type from files where org_id = $1 and file_token = any($2::text[])`,
    [list],
  )
  return list.flatMap((t) => {
    const r = rows.find((x) => x.file_token === t)
    return r ? [{ token: r.file_token, name: r.name ?? 'file', type: r.content_type }] : []
  })
}

export const filesRouter = Router()

// POST /api/tutor/files?name=…  body: the raw file.
filesRouter.post('/files', express.raw({ type: () => true, limit: MAX_FILE_BYTES + 1024 }), async (req, res) => {
  const contentType = req.header('content-type') ?? ''
  const bad = checkUpload(contentType, req.body)
  if (bad) return res.status(contentType && ALLOWED.test(contentType) ? 413 : 415).json({ error: bad })
  const name = typeof req.query.name === 'string' && req.query.name.trim() ? req.query.name.trim() : 'upload'
  const file = await storeFile(req.auth!.orgId, name, contentType, req.body as Buffer)
  res.status(201).json({ file: { ...file, url: `/api/files/${file.token}` } })
})

export const publicFilesRouter = Router()

publicFilesRouter.get('/:token', async (req, res) => {
  const [file] = await fileQuery<{ content_type: string; bytes: Buffer; name: string | null }>(
    req.params.token,
    `select content_type, bytes, name from files where file_token = $1`,
  )
  if (!file) return res.status(404).json({ error: 'not found' })
  res.setHeader('content-type', file.content_type)
  res.setHeader('x-content-type-options', 'nosniff')
  // Images can't carry script here (only these types are stored); a PDF needs
  // the browser's viewer, which a sandbox CSP would blank out.
  if (!file.content_type.startsWith('application/pdf')) {
    res.setHeader('content-security-policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox")
  }
  res.setHeader('content-disposition', `inline; filename="${(file.name ?? 'file').replace(/[^\w.\- ]+/g, '_')}"`)
  res.setHeader('cache-control', 'private, max-age=31536000, immutable')
  res.end(file.bytes)
})
