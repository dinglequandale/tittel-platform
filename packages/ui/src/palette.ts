// The website's five-colour math palette, used only as categorical colour.
export const PALETTE = ['blue', 'mint', 'gold', 'coral', 'pink'] as const
export type PaletteColor = (typeof PALETTE)[number]

// Stable colour for an entity (student, group, tag): same id, same colour.
export function paletteFor(id: string): PaletteColor {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return PALETTE[Math.abs(h) % PALETTE.length]
}
