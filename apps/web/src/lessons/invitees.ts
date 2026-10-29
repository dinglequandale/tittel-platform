// Reading people off a calendar invite the app doesn't know yet: what they're
// called and who is probably the student or a parent. Only ever a first
// guess, shown in LinkEventDialog for the tutor to correct.

export interface Proposal {
  /** New students: a name from their address (or blank, with a family name to hint at), and that address when it's theirs. */
  people: { name: string; email: string | null; surname?: string }[]
  /** Invitees taken to be the parents of everyone in `people`. */
  parents: string[]
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)
const SEVERAL_KIDS = /\b(kids|children|siblings|sons|daughters|brothers|sisters)\b/i
const ONE_KID = /\b(kid|child|son|daughter)\b/i
// Words in lesson titles that are never a student's name.
const NOT_NAMES = new Set(('math maths algebra calc calculus precalc geometry trig stats statistics sat act ap ib gcse '
  + 'physics chemistry chem biology bio english reading writing essay prep test tutoring tutor lesson session class '
  + 'group extra trial review homework hw').split(' '))

/** "leo.park09@…" → Leo Park; "n.okafor@…" → only a surname, Okafor. */
export function nameFromEmail(email: string): { first: string | null; last: string | null } {
  const parts = email.split('@')[0].toLowerCase().split(/[._+-]+/).map((p) => p.replace(/\d+/g, '')).filter(Boolean)
  const words = parts.filter((p) => /^\p{L}{2,}$/u.test(p))
  if (!words.length) return { first: null, last: null }
  // A leading initial means what follows is a surname.
  if (parts[0].length === 1) return { first: null, last: cap(words[0]) }
  return { first: cap(words[0]), last: words[1] ? cap(words[1]) : null }
}

const fullName = (n: { first: string | null; last: string | null }) => [n.first, n.last].filter(Boolean).join(' ')

/** "SAT prep w/ Ava" → Ava; "Calc - Isabel" → Isabel; "" when no name stands out. */
export function nameFromTitle(title: string): string {
  const w = title.match(/\b(?:w\/|with)\s*(\p{Lu}\p{L}+)/u)
  if (w) return w[1]
  const words = title.split(/[^\p{L}]+/u).filter((x) => /^\p{Lu}\p{Ll}+$/u.test(x) && !NOT_NAMES.has(x.toLowerCase()))
  return words[0] ?? ''
}

/**
 * Who the unknown invitees are. Anyone whose first name is in the title is a
 * student and the rest are parents ("Leo - Algebra" with leo.park and
 * grace.park). With nobody named: a title about someone's children, or an
 * address with no first name, means the invitees are parents of students not
 * yet named ("Haddad kids", "Mrs. Okafor's son"); otherwise every invitee is
 * a student ("SAT Math Group" with three of them).
 */
export function proposePeople(title: string, invitees: string[]): Proposal {
  const words = new Set(title.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean))
  const names = invitees.map((email) => ({ email, ...nameFromEmail(email) }))
  const named = names.filter((n) => n.first && words.has(n.first.toLowerCase()))
  if (named.length) {
    return {
      people: named.map((n) => ({ name: fullName(n), email: n.email })),
      parents: names.filter((n) => !named.includes(n)).map((n) => n.email),
    }
  }
  if (SEVERAL_KIDS.test(title) || ONE_KID.test(title) || names.some((n) => !n.first)) {
    const surname = names.find((n) => n.last)?.last ?? undefined
    const count = SEVERAL_KIDS.test(title) ? 2 : 1
    return { people: Array.from({ length: count }, () => ({ name: '', email: null, surname })), parents: invitees }
  }
  if (!names.length) return { people: [{ name: nameFromTitle(title), email: null }], parents: [] }
  return { people: names.map((n) => ({ name: fullName(n), email: n.email })), parents: [] }
}
