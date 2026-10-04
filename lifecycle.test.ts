import { expect, mock, test } from 'claude-code/testing'

const BAND = { plugin: 'cc-pr-tracker', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 160, rows: 40 }, props: {} }
const pane = (id: string) => ({ ...BAND, component: 'Pane', requestId: id, props: { title: 'PR', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} } })
const context = (name: string, conclusion = 'SUCCESS') => ({ __typename: 'CheckRun', isRequired: true, name, status: 'COMPLETED', conclusion, detailsUrl: 'https://github.com/o/r/actions/runs/1' })
const response = (title: string, state = 'OPEN', nodes = [context('lint')], next: string | null = null, oid = 'head1') => ({ data: { repository: { pullRequest: {
  number: 42, title, state, isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED',
  commits: { nodes: [{ commit: { oid, statusCheckRollup: { contexts: { nodes, pageInfo: { hasNextPage: next !== null, endCursor: next } } } } }] },
} } } })

function setup(on, answer) {
  const clock = mock.clock(on)
  mock.env(on, {})
  const calls: string[][] = []
  const toasts: string[] = []
  on('session.start', () => ({ cwd: '/work' }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('fs.exists', () => ({ value: false }))
  on('config.list', () => ({ value: [] }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['base'] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  on('process.run', ($, e) => {
    calls.push(e.argv)
    return { value: { exitCode: 0, stderr: '', stdout: JSON.stringify(answer(e.argv, calls.length)) } }
  })
  return { clock, calls, toasts }
}

// Refresh starts in the background; drain its promise continuations without real timers.
async function drain() { for (let i = 0; i < 100; i++) await Promise.resolve() }
const start = async $ => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
const watch = async ($, url = 'https://github.com/o/api/pull/42') => { await $.prompt.submit({ text: url }); await drain() }

test('same-name repositories have separate panes and correct details', async ($, on) => {
  setup(on, argv => response(argv.find(a => a.startsWith('o='))!))
  await start($)
  await watch($, 'https://github.com/org-a/api/pull/42 https://github.com/org-b/api/pull/42')
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Link', text: 'org-a/api#42' })).toBeDefined()
  for (const [id, owner] of [['pr-1', 'org-a'], ['pr-2', 'org-b']]) {
    await band.press({ key: `details:${id}` })
    const detail = await $.ui.mount(pane(id))
    expect(await detail.find({ type: 'Text', text: `o=${owner}` })).toBeDefined()
    await detail.unmount()
  }
})

test('required failing check beyond page 100 is included', async ($, on) => {
  const { calls } = setup(on, argv => argv.includes('after=page2')
    ? response('paginated', 'OPEN', [context('late-required', 'FAILURE')])
    : response('paginated', 'OPEN', Array.from({ length: 100 }, (_, i) => context(`test-${i}`)), 'page2'))
  await start($)
  await watch($)
  expect(calls.length).toBe(2)
  expect(calls[1]).toContain('after=page2')
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: ' ✗1' })).toBeDefined()
  const detail = await $.ui.mount(pane('pr-1'))
  expect(await detail.find({ type: 'Text', text: 'Required checks (101)' })).toBeDefined()
  expect(await detail.find({ type: 'Link', text: 'late-required' })).toBeDefined()
})

for (const state of ['MERGED', 'CLOSED']) {
  test(`${state} transition freezes polling, retains row and notifies once`, async ($, on) => {
    const { calls, clock, toasts } = setup(on, (_, n) => response('finished', n === 1 ? 'OPEN' : state))
    await start($)
    await watch($)
    await clock.advance(60_000); await drain()
    expect(calls.length).toBe(2)
    expect(toasts.length).toBe(1)
    expect(toasts[0]).toContain(`state: open → ${state.toLowerCase()}`)
    await clock.advance(180_000); await drain()
    expect(calls.length).toBe(2)
    const band = await $.ui.mount(BAND)
    expect(await band.find({ type: 'Text', text: ` ${state.toLowerCase()} · ` })).toBeDefined()
  })
}

test('initially closed PR is displayed once without repeated polling', async ($, on) => {
  const { calls, clock, toasts } = setup(on, () => response('already closed', 'CLOSED'))
  await start($); await watch($)
  await clock.advance(120_000); await drain()
  expect(calls.length).toBe(1)
  expect(toasts).toEqual([])
})

test('head change during pagination fails visibly without committing partial checks', async ($, on) => {
  const { calls } = setup(on, (_, n) => response('changed', 'OPEN', [context(`test-${n}`)], n === 1 ? 'page2' : null, `head${n}`))
  await start($); await watch($)
  expect(calls.length).toBe(2)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /head changed while fetching/ })).toBeDefined()
})


test('failed second page preserves previous complete snapshot', async ($, on) => {
  const { clock } = setup(on, (_, n) => n === 1 ? response('stable')
    : n === 2 ? response('partial', 'OPEN', [context('new')], 'page2')
    : { errors: [{ message: 'rate limited' }] })
  await start($); await watch($)
  await clock.advance(60_000); await drain()
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: ' · stable' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: ' · refresh failed' })).toBeDefined()
  const detail = await $.ui.mount(pane('pr-1'))
  expect(await detail.find({ type: 'Link', text: 'lint' })).toBeDefined()
  expect(await detail.find({ type: 'Link', text: 'new' })).toBeUndefined()
})

test('repeated pagination cursor fails instead of looping forever', async ($, on) => {
  const { calls } = setup(on, () => response('bad cursor', 'OPEN', [context('lint')], 'same'))
  await start($); await watch($)
  expect(calls.length).toBe(2)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /invalid check pagination cursor/ })).toBeDefined()
})
