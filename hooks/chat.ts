// Clawd and the Octocat talking while checks run: half-block pixel art in a grid of cells, a pixel
// being half a cell, so one text row holds two pixel rows. Pure functions of a tick (10 per second).

export type Rgb = readonly [number, number, number]
export type Cell = { ch: string; fg?: Rgb; bg?: Rgb }

export const COLS = 38
export const ROWS = 4
export const TICK_MS = 100

const ORANGE: Rgb = [217, 119, 87]
const LIGHT: Rgb = [201, 209, 217]
const INK: Rgb = [11, 20, 23]
const WHITE: Rgb = [238, 245, 243]
const DIM: Rgb = [109, 140, 147]
const PALETTE: Record<string, Rgb> = { O: ORANGE, L: LIGHT, E: INK }

const CLAWD = [
  '.OOOOOOOO.',
  '.OEOOOOEO.',
  '.OEOOOOEO.',
  'OOOOOOOOOO',
  '.OOOOOOOO.',
  '.O.O..O.O.',
]
const CLAWD_BLINK = [...CLAWD]
CLAWD_BLINK[1] = CLAWD[0]

const OCTO = [
  '.LL....LL.',
  'LLLLLLLLLL',
  'LLELLLLELL',
  'LLLLEELLLL',
  '.LLLLLLLL.',
]
const OCTO_LEGS = [
  ['.L.LLLL.L.', 'L..L..L..L'],
  ['.L.LLLL.L.', '.L.L..L.L.'],
]

const SPEAKERS = ['clawd', 'octo', 'clawd', 'octo'] as const
const HOLD = 32
const DOT_TICKS = 5
export const PERIOD = HOLD * SPEAKERS.length
const CLAWD_X = 0
const OCTO_X = 28
const BOTTOM = ROWS * 2

type Pixels = (Rgb | undefined)[][]

function blit(pixels: Pixels, sprite: string[], x: number, y: number) {
  sprite.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const key = row[dx]
      if (key !== '.' && pixels[y + dy] && x + dx < COLS) pixels[y + dy][x + dx] = PALETTE[key]
    }
  })
}

function put(cells: Cell[][], row: number, col: number, text: string, fg: Rgb) {
  for (let i = 0; i < text.length; i++) if (col + i >= 0 && col + i < COLS) cells[row][col + i] = { ch: text[i], fg }
}

// each bubble sits in the gap beside its speaker, level with their eyes, its tail towards them
function bubble(cells: Cell[][], dots: number, isLeft: boolean) {
  const width = 7
  const x0 = isLeft ? CLAWD_X + 11 : OCTO_X - 1 - width
  put(cells, 0, x0, `╭${'─'.repeat(width - 2)}╮`, DIM)
  put(cells, 1, x0, `${isLeft ? '┤' : '│'}${' '.repeat(width - 2)}${isLeft ? '│' : '├'}`, DIM)
  put(cells, 1, x0 + 2, '.'.repeat(dots), WHITE)
  put(cells, 2, x0, `╰${'─'.repeat(width - 2)}╯`, DIM)
}

export function chatFrame(tick: number): Cell[][] {
  const t = tick % PERIOD
  const line = Math.floor(t / HOLD)
  const age = t % HOLD
  const speaker = SPEAKERS[line]
  const dots = Math.min(3, 1 + Math.floor(age / DOT_TICKS))
  const isTalking = age < 3 * DOT_TICKS + 4
  const bob = isTalking && age % 4 < 2 ? 1 : 0

  const clawd = tick % 37 < 2 ? CLAWD_BLINK : CLAWD
  const catBlink = (tick + 19) % 41 < 2
  const cat = [...OCTO, ...OCTO_LEGS[Math.floor(tick / 6) % 2]]
  if (catBlink) cat[4] = cat[5] = cat[3]

  const pixels: Pixels = Array.from({ length: ROWS * 2 }, () => Array(COLS).fill(undefined))
  blit(pixels, clawd, CLAWD_X, BOTTOM - clawd.length - (speaker === 'clawd' ? bob : 0))
  blit(pixels, cat, OCTO_X, BOTTOM - cat.length - (speaker === 'octo' ? bob : 0))

  const cells: Cell[][] = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => ({ ch: ' ' })))
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const top = pixels[2 * r][c]
      const bot = pixels[2 * r + 1][c]
      if (top) cells[r][c] = { ch: '▀', fg: top, bg: bot }
      else if (bot) cells[r][c] = { ch: '▄', fg: bot }
    }
  }
  bubble(cells, dots, speaker === 'clawd')
  return cells
}

export const hex = (c: Rgb) => `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`

// consecutive cells with the same colours become one run, so a row is a few Texts, not 56
export function runs(row: Cell[]): { text: string; fg?: string; bg?: string }[] {
  const out: { text: string; fg?: string; bg?: string }[] = []
  for (const { ch, fg, bg } of row) {
    const f = fg && hex(fg)
    const b = bg && hex(bg)
    const last = out[out.length - 1]
    if (last && last.fg === f && last.bg === b) last.text += ch
    else out.push({ text: ch, fg: f, bg: b })
  }
  return out
}
