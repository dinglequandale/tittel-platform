// Math graphics from the tutoring website (website/tutoring/graphics.js),
// ported verbatim: small "objects" (scramble stand-ins, empty-state art),
// thumbnails (the cycling ( ) line), and collage cards (landing/auth/404).
// Inline SVG strings so there are no image files to manage. Gradient ids are
// written as `__-name`; <MathArt> swaps `__` for a per-instance prefix so two
// copies on one page don't share (and break) each other's gradients.

const svg = (vb: string, body: string) => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`

export const MATH_OBJECTS = {
  piTile: svg('0 0 100 100', `
    <defs><linearGradient id="__-pt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF9B45"/><stop offset="1" stop-color="#F26A12"/></linearGradient></defs>
    <rect x="4" y="4" width="92" height="92" rx="24" fill="url(#__-pt)"/>
    <rect x="16" y="16" width="68" height="68" rx="16" fill="#FF8A2E" stroke="#E25F0C" stroke-width="3"/>
    <path d="M30 38h40M42 38v28M58 38c0 14 0 22 6 26" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/>`),
  die: svg('0 0 100 100', `
    <defs><linearGradient id="__-di" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FAFAFA"/><stop offset="1" stop-color="#C9CBCE"/></linearGradient></defs>
    <rect x="6" y="6" width="88" height="88" rx="22" fill="url(#__-di)" stroke="#B5B8BC" stroke-width="2"/>
    <g fill="#1C1D20"><circle cx="31" cy="31" r="11"/><circle cx="69" cy="31" r="11"/><circle cx="31" cy="69" r="11"/><circle cx="69" cy="69" r="11"/><circle cx="50" cy="50" r="7"/></g>
    <g fill="#fff" opacity=".55"><circle cx="27" cy="27" r="3"/><circle cx="65" cy="27" r="3"/><circle cx="27" cy="65" r="3"/><circle cx="65" cy="65" r="3"/></g>`),
  pieDisc: svg('0 0 100 100', `
    <defs><radialGradient id="__-pd" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#4BE38A"/><stop offset="1" stop-color="#14A852"/></radialGradient></defs>
    <circle cx="50" cy="50" r="46" fill="url(#__-pd)"/>
    <path d="M50 50 L50 4 A46 46 0 0 1 93 36 Z" fill="#9BF2BE" opacity=".85"/>
    <g fill="none" stroke="#0E8A42" stroke-width="1.5" opacity=".6"><circle cx="50" cy="50" r="36"/><circle cx="50" cy="50" r="26"/></g>
    <circle cx="50" cy="50" r="9" fill="#E9FFF1"/><circle cx="50" cy="50" r="3" fill="#0E8A42"/>`),
  pencil: svg('0 0 24 130', `
    <rect x="4" y="18" width="16" height="92" fill="#E3342F"/><rect x="4" y="18" width="5" height="92" fill="#F05A55"/>
    <rect x="4" y="8" width="16" height="12" rx="2" fill="#F4A6B7"/><rect x="4" y="17" width="16" height="4" fill="#C9CCD1"/>
    <path d="M4 110 L20 110 L12 128 Z" fill="#F2CFA0"/><path d="M9.5 122 L14.5 122 L12 128 Z" fill="#2B2B2B"/>`),
  book: svg('0 0 74 100', `
    <rect x="6" y="3" width="64" height="94" rx="3" fill="#F04A1D"/><rect x="6" y="3" width="8" height="94" fill="#C9370F"/>
    <text x="22" y="30" font-family="Outfit, sans-serif" font-weight="700" font-size="15" fill="#1B1B1B">euclid</text>
    <text x="22" y="46" font-family="Outfit, sans-serif" font-weight="400" font-size="11" fill="#1B1B1B">elements</text>
    <rect x="22" y="70" width="38" height="2" fill="#1B1B1B"/><rect x="22" y="76" width="26" height="2" fill="#1B1B1B"/>`),
  knob: svg('0 0 100 100', `
    <defs><radialGradient id="__-kn" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#D9DADC"/></radialGradient></defs>
    <circle cx="50" cy="53" r="44" fill="#000" opacity=".08"/>
    <circle cx="50" cy="50" r="44" fill="url(#__-kn)" stroke="#D0D1D3" stroke-width="1.5"/>
    <g stroke="#FF7A1A" stroke-width="4" stroke-linecap="round">${[-120, -80, -40, 0, 40, 80, 120].map((d) => `<path d="M50 14v5" transform="rotate(${d} 50 50)"/>`).join('')}</g>
    <circle cx="50" cy="50" r="26" fill="#FBFBFB" stroke="#E2E3E5" stroke-width="1.5"/>
    <path d="M50 50 L50 28" stroke="#FF5A12" stroke-width="5" stroke-linecap="round" transform="rotate(35 50 50)"/>`),
  arc: svg('0 0 100 100', `
    <path d="M86 50 A36 36 0 1 0 50 86" fill="none" stroke="#F5C518" stroke-width="18" stroke-linecap="round"/>
    <g stroke="#B48A06" stroke-width="2.5"><path d="M50 18v9M21 32l7 5M14 62l9-2"/></g>`),
}

export const MATH_THUMBS = {
  protractor: svg('0 0 160 100', `
    <rect width="160" height="100" fill="#F4F4F2"/>
    <ellipse cx="80" cy="84" rx="58" ry="7" fill="#000" opacity=".08"/>
    <path d="M26 80 A54 54 0 0 1 134 80 Z" fill="#FFFFFF" stroke="#D8D8D8" stroke-width="2"/>
    <g stroke="#F26A12" stroke-width="3" stroke-linecap="round"><path d="M36 80h-6M80 34v-6M127 80h6M47 47l-4-4M113 47l4-4"/></g>
    <path d="M80 80 L104 46" stroke="#F26A12" stroke-width="5" stroke-linecap="round"/>
    <circle cx="80" cy="80" r="7" fill="#1C1C1C"/>`),
  cube: svg('0 0 160 100', `
    <rect width="160" height="100" fill="#2140E8"/>
    <g transform="translate(80 50)">
      <path d="M0 -38 L33 -19 L0 0 L-33 -19 Z" fill="#fff"/>
      <path d="M-33 -19 L0 0 L0 38 L-33 19 Z" fill="#FF5A1F"/>
      <path d="M33 -19 L0 0 L0 38 L33 19 Z" fill="#FFD21F"/>
      <g stroke="#111" stroke-width="2.4" fill="none">
        <path d="M0 -38 L33 -19 L0 0 L-33 -19 Z M-33 -19 L0 0 L0 38 L-33 19 Z M33 -19 L0 0 L0 38 L33 19 Z"/>
        <path d="M-11 -31.7 L22 -12.7 M11 -31.7 L-22 -12.7 M-22 -25.3 L11 -6.3 M22 -25.3 L-11 -6.3"/>
        <path d="M-11 -6.3 L-11 31.7 M-22 -12.7 L-22 25.3 M11 -6.3 L11 31.7 M22 -12.7 L22 25.3"/>
        <path d="M-33 -6.3 L0 12.7 L33 -6.3 M-33 6.3 L0 25.3 L33 6.3"/></g></g>`),
  d20: svg('0 0 160 100', `
    <rect width="160" height="100" fill="#C9B8FF"/>
    <g transform="translate(80 50)">
      <path d="M0 -40 L35 -20 L35 20 L0 40 L-35 20 L-35 -20 Z" fill="#6A3DF0"/>
      <path d="M0 -24 L21 13 L-21 13 Z" fill="#8F6BFF"/>
      <g stroke="#3C1DB0" stroke-width="2" fill="none" stroke-linejoin="round">
        <path d="M0 -40 L35 -20 L35 20 L0 40 L-35 20 L-35 -20 Z M0 -24 L21 13 L-21 13 Z"/>
        <path d="M0 -40 L0 -24 M35 -20 L0 -24 M-35 -20 L0 -24 M35 -20 L21 13 M35 20 L21 13 M0 40 L21 13 M0 40 L-21 13 M-35 20 L-21 13 M-35 -20 L-21 13"/></g>
      <text x="0" y="7" text-anchor="middle" font-family="Outfit, sans-serif" font-weight="800" font-size="15" fill="#fff">20</text></g>`),
  pie: svg('0 0 160 100', `
    <rect width="160" height="100" fill="#FFE27A"/>
    <ellipse cx="78" cy="80" rx="42" ry="7" fill="#000" opacity=".1"/>
    <path d="M78 50 L78 14 A36 36 0 1 0 109 32 Z" fill="#D9822B"/>
    <path d="M78 50 L78 14 A36 36 0 1 0 109 32 Z" fill="none" stroke="#9B5512" stroke-width="3"/>
    <circle cx="78" cy="50" r="27" fill="#B8321E"/>
    <path d="M88 44 L102 14 A40 40 0 0 1 123 30 Z" fill="#D9822B" stroke="#9B5512" stroke-width="3" transform="translate(6 -4)"/>
    <text x="78" y="58" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="26" fill="#FFE9C9">π</text>`),
  compass: svg('0 0 160 100', `
    <rect width="160" height="100" fill="#9FF0D0"/>
    <circle cx="80" cy="56" r="30" fill="none" stroke="#0F7A55" stroke-width="2" stroke-dasharray="4 5"/>
    <g stroke-linecap="round">
      <path d="M80 14 L64 84" stroke="#3A3F47" stroke-width="6"/><path d="M80 14 L96 84" stroke="#3A3F47" stroke-width="6"/>
      <path d="M64 84 L62 92" stroke="#111" stroke-width="3"/><path d="M96 84 L97 90" stroke="#F26A12" stroke-width="5"/></g>
    <circle cx="80" cy="16" r="7" fill="#C9CCD1" stroke="#3A3F47" stroke-width="3"/>`),
  parabola: svg('0 0 160 100', `
    <rect width="160" height="100" fill="#FFFFFF"/>
    <g stroke="#BFD3FF" stroke-width="1">${Array.from({ length: 16 }, (_, i) => `<path d="M${i * 10 + 5} 0V100"/>`).join('')}${Array.from({ length: 10 }, (_, i) => `<path d="M0 ${i * 10 + 5}H160"/>`).join('')}</g>
    <path d="M0 55H160M80 0V100" stroke="#6F8FD9" stroke-width="1.6"/>
    <path d="M30 10 Q80 140 130 10" fill="none" stroke="#E3342F" stroke-width="4" stroke-linecap="round"/>
    <circle cx="80" cy="75" r="4.5" fill="#1C1C1C"/>`),
}

export const MATH_CARDS = {
  // Cobalt print in a white frame: proof without words of a² + b² = c²
  pythagoras: svg('0 0 300 400', `
    <rect width="300" height="400" fill="#E9E6E1"/>
    <rect x="28" y="30" width="244" height="330" fill="#FFFFFF" stroke="#D2CEC7" stroke-width="2"/>
    <rect x="46" y="48" width="208" height="294" fill="#1236F0"/>
    <g transform="translate(150 196)" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round">
      <path d="M-30 30 L30 30 L-30 -50 Z" fill="#fff"/>
      <path d="M-30 30 L30 30 L30 90 L-30 90 Z"/>
      <path d="M-30 30 L-30 -50 L-110 -50 L-110 30 Z"/>
      <path d="M30 30 L-30 -50 L50 -110 L110 -30 Z"/></g>
    <text x="62" y="328" font-family="Outfit, sans-serif" font-weight="700" font-size="15" fill="#fff">a² + b² = c²</text>`),
  // Black poster: Euler's identity
  euler: svg('0 0 300 300', `
    <rect width="300" height="300" fill="#0C0C0C"/>
    <rect x="18" y="18" width="264" height="264" fill="none" stroke="#2A2A2A" stroke-width="2"/>
    <text x="34" y="62" font-family="Outfit, sans-serif" font-weight="800" font-size="34" fill="#FF5A1F">EULER'S</text>
    <text x="34" y="96" font-family="Outfit, sans-serif" font-weight="800" font-size="34" fill="#FF5A1F">IDENTITY</text>
    <rect x="70" y="122" width="160" height="104" rx="10" fill="#FF5A1F"/>
    <text x="150" y="190" text-anchor="middle" font-family="'EB Garamond', Georgia, serif" font-style="italic" font-weight="700" font-size="38" fill="#0C0C0C">e<tspan font-size="22" dy="-16">iπ</tspan><tspan dy="16"> + 1 = 0</tspan></text>
    <text x="34" y="262" font-family="Outfit, sans-serif" font-weight="500" font-size="12" fill="#8A8A8A">five constants, one line</text>`),
  // Orange block with a white tile and a pink token
  orange: svg('0 0 400 300', `
    <rect width="400" height="300" fill="#FF4F12"/>
    <rect x="70" y="70" width="330" height="230" rx="34" fill="#FFFFFF"/>
    <circle cx="122" cy="122" r="26" fill="#FFD3E6"/>
    <text x="122" y="132" text-anchor="middle" font-family="'EB Garamond', Georgia, serif" font-style="italic" font-weight="700" font-size="28" fill="#D6337A">x²</text>`),
  // Graph-paper sheet with a hand-drawn sine wave
  sheet: svg('0 0 300 400', `
    <rect width="300" height="400" fill="#DCE3EE"/>
    <g transform="rotate(-6 150 200)">
      <rect x="40" y="40" width="220" height="300" fill="#FDFCF8"/>
      <g stroke="#CFE0FF" stroke-width="1">${Array.from({ length: 21 }, (_, i) => `<path d="M${40 + i * 11} 40V340"/>`).join('')}${Array.from({ length: 28 }, (_, i) => `<path d="M40 ${40 + i * 11}H260"/>`).join('')}</g>
      <path d="M40 190H260" stroke="#7D97D6" stroke-width="2"/>
      <path d="M52 190 C70 120, 95 120, 112 190 S155 260, 172 190 S215 120, 232 190" fill="none" stroke="#2140E8" stroke-width="5" stroke-linecap="round"/>
      <text x="58" y="88" font-family="'EB Garamond', Georgia, serif" font-style="italic" font-size="26" fill="#2140E8">y = sin x</text></g>
    <g transform="translate(206 300) rotate(-38)"><rect x="0" y="0" width="16" height="120" fill="#FFD21F"/><rect x="0" y="0" width="6" height="120" fill="#FFE57A"/><path d="M0 120 L16 120 L8 140 Z" fill="#F2CFA0"/></g>`),
  // Floating orange Penrose triangle (an impossible object)
  penrose: svg('0 0 200 180', `
    <g stroke="#B9400C" stroke-width="2" stroke-linejoin="round">
      <path d="M100 10 L190 166 L150 166 L100 79 L56 156 L30 156 Z" fill="#FF8A3D"/>
      <path d="M30 156 L56 156 L150 166 L190 166 L176 176 L14 176 Z" fill="#E8641A"/>
      <path d="M100 10 L14 176 L30 156 L100 34 Z" fill="#FFB07A"/></g>`),
}

export type MathObjectName = keyof typeof MATH_OBJECTS
export type MathThumbName = keyof typeof MATH_THUMBS
export type MathCardName = keyof typeof MATH_CARDS
export type MathArtName = MathObjectName | MathThumbName | MathCardName

export const MATH_ART: Record<MathArtName, string> = { ...MATH_OBJECTS, ...MATH_THUMBS, ...MATH_CARDS }
