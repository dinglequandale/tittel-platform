import { customAlphabet } from 'nanoid'

// URL-safe, unambiguous (no 0/o/1/l) lowercase+digits — matches the source
// repos' token alphabet (tittel-sat-homework/server/tokens.ts).
const alphabet = '23456789abcdefghijkmnpqrstuvwxyz'

// Row IDs: short, collision-safe at this scale (16 chars ≈ 80 bits).
export const newId = customAlphabet(alphabet, 16)

// Magic-link tokens (portal/attempt/report): longer, since a token is its own
// access control (24 chars ≈ 120 bits).
export const newToken = customAlphabet(alphabet, 24)
