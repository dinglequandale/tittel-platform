import type { TLAssetStore } from 'tldraw'

// Pasted/dropped images upload to the server's per-room asset store (in-memory
// for both ephemeral and persistent boards for now — see apps/server/src/board/assets.ts).
export function makeAssetStore(boardId: string): TLAssetStore {
  return {
    async upload(_asset, file) {
      const id = `${crypto.randomUUID()}-${file.name || 'asset'}`
      const url = `/uploads/${encodeURIComponent(boardId)}/${encodeURIComponent(id)}`
      const res = await fetch(url, {
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
