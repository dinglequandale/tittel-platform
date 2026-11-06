// Pasted/dropped images upload to the server's asset store: kept in the
// database for a persistent board, in the room's memory for a /try board (see
// apps/server/src/board/assets.ts). `authParams` proves the uploader may write.
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
