import type { TLAssetStore } from 'tldraw'

// Pasted/dropped images upload to the server's asset store: kept in the
// database for a persistent board, in the room's memory for a /try board (see
// apps/server/src/board/assets.ts). `authParams` proves the uploader may write.
export function makeAssetStore(boardId: string, authParams: string): TLAssetStore {
  return {
    async upload(_asset, file) {
      const id = `${crypto.randomUUID()}-${file.name || 'asset'}`
      const url = `/uploads/${encodeURIComponent(boardId)}/${encodeURIComponent(id)}`
      const res = await fetch(`${url}?${authParams}`, {
        method: 'POST',
        body: file,
        headers: { 'content-type': file.type || 'application/octet-stream' },
      })
      if (!res.ok) {
        throw new Error(`Failed to upload asset: ${res.status}`)
      }
      return { src: url }
    },
    resolve(asset) {
      return asset.props.src
    },
  }
}
