import { expect, test } from 'claude-code/testing'
import { COLS, PERIOD, ROWS, chatFrame, runs } from './hooks/chat.ts'

test('every frame of the loop is a ROWS x COLS grid with a bubble', () => {
  for (let tick = 0; tick < PERIOD; tick++) {
    const cells = chatFrame(tick)
    expect(cells.length).toBe(ROWS)
    expect(cells.every(row => row.length === COLS)).toBe(true)
    expect(cells.some(row => row.some(c => c.ch === '╭'))).toBe(true)
  }
})

test('the speaker alternates and the dots fill in', () => {
  const dots = (tick: number) => chatFrame(tick)[1].filter(c => c.ch === '.').length
  expect(dots(0)).toBe(1)
  expect(dots(12)).toBe(3)
})

test('runs merges neighbouring cells of one colour', () => {
  const row = [{ ch: 'a' }, { ch: 'b' }, { ch: 'c', fg: [255, 0, 0] as const }]
  expect(runs(row)).toEqual([{ text: 'ab', fg: undefined, bg: undefined }, { text: 'c', fg: '#ff0000', bg: undefined }])
})
