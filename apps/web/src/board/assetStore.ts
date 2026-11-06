// Pasted/dropped images upload to the server's per-room asset store (in-memory
// for both ephemeral and persistent boards for now — see apps/server/src/board/assets.ts).
// `authParams` is the board's own credential, sent so the server can check it.
export async function uploadBoardImage(boardId: string, authParams: string, file: Blob, name = 'image'): Promise<string> {
  const id = `${crypto.randomUUID()}-${name}`
  const url = `/uploads/${encodeURIComponent(boardId)}/${encodeURIComponent(id)}`
  const res = await fetch(`${url}?${authParams}`, {
    method: 'POST',
    body: file,
    headers: { 'content-type': file.type || 'application/octet-stream' },
  })
  if (!res.ok) throw new Error(`Couldn’t upload that image (${res.status})`)
  return url
}
