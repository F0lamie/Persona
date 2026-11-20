import { expect, test } from 'claude-code/testing'

const MENU = {
  active: 'ginette',
  source: 'global',
  global: 'ginette',
  project: '',
  lastRandom: '',
  userDir: '/home/x/.claude/personas',
  personas: [
    { name: 'ginette', description: 'Madame Ginette', origin: 'plugin', preview: 'Personnage : Madame Ginette' },
    { name: 'alpha', description: 'Alpha', origin: 'user', preview: 'Tu es alpha.' },
  ],
}

const PANE = {
  plugin: 'personas',
  component: 'Pane',
  requestId: 'persona-menu',
  surface: 'terminal',
  props: {
    title: 'Persona',
    isFocused: true,
    bodyColumns: 80,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('/persona opens the menu, a pick runs the script and tells the model', async ($, on) => {
  const runs: string[][] = []
  const appended: string[] = []
  const opened: unknown[] = []
  on('command.register', () => ({ value: { command: 'persona' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.hookEnv', () => ({ value: { CLAUDE_PLUGIN_ROOT: '/plug' } }))
  on('process.run', (_, e) => {
    const argv = [...(e as { argv: string[] }).argv]
    runs.push(argv)
    const verb = argv[2]
    const stdout =
      verb === 'json' ? JSON.stringify(MENU) : verb === 'alpha' ? 'PERSONA_ACTIVATED alpha (global)\n\n# Persona active : alpha' : ''

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', (_, e) => {
    opened.push(e)

    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.append', (_, e, next) => {
    appended.push(JSON.stringify(e))

    return next(e)
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'persona', args: '' } as Parameters<typeof $.command.run>[0])
  expect(runs[0]).toEqual(['bash', '/plug/scripts/persona.sh', 'json'])
  expect(opened.length).toBe(1)

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /Active : ginette \(global\)/ }))).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'p:alpha' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'random' })).toBeDefined()

  await ui.press({ key: 'p:alpha' })
  expect(runs.at(-1)).toEqual(['bash', '/plug/scripts/persona.sh', 'alpha'])
  expect(appended.length).toBe(1)
  expect(appended[0]).toContain('Persona active : alpha')
  await ui.unmount()
})

test('the scope toggle sends --project', async ($, on) => {
  const runs: string[][] = []
  on('command.register', () => ({ value: { command: 'persona' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.hookEnv', () => ({ value: { CLAUDE_PLUGIN_ROOT: '/plug' } }))
  on('process.run', (_, e) => {
    const argv = [...(e as { argv: string[] }).argv]
    runs.push(argv)

    return { value: { exitCode: 0, stdout: argv[2] === 'json' ? JSON.stringify(MENU) : 'PERSONA_DEACTIVATED (project)', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.append', (_, e, next) => next(e))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'persona', args: '' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'scope' })
  await ui.press({ key: 'off' })
  expect(runs.at(-1)).toEqual(['bash', '/plug/scripts/persona.sh', 'off', '--project'])
  await ui.unmount()
})

test('with arguments, no menu: the model gets the persona as context', async ($, on) => {
  on('command.register', () => ({ value: { command: 'persona' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.hookEnv', () => ({ value: { CLAUDE_PLUGIN_ROOT: '/plug' } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'PERSONA_ACTIVATED ginette (random, global)\nMode random', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const result = await $.command.run({ command: 'persona', args: 'open-space' } as Parameters<typeof $.command.run>[0])
  expect(result.text).toContain('Persona tirée au sort : ginette (global)')
  expect(result.context?.[0]).toContain('Adopte-la immédiatement')
})

test('a hundred personas: a window around the focus, the preview stays, no number hotkeys', async ($, on) => {
  const many = {
    ...MENU,
    personas: [
      { name: 'ginette', description: 'Madame Ginette', origin: 'plugin', preview: 'mot '.repeat(400).trim() },
      ...Array.from({ length: 100 }, (_, i) => ({
        name: `test-${String(i + 1).padStart(3, '0')}`,
        description: `Persona de test ${i + 1}`,
        origin: 'user',
        preview: '',
      })),
    ],
  }
  on('command.register', () => ({ value: { command: 'persona' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.hookEnv', () => ({ value: { CLAUDE_PLUGIN_ROOT: '/plug' } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(many), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.focus', { plugin: '*' }, () => ({}))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'persona', args: '' } as Parameters<typeof $.command.run>[0])

  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 50, scroll: { offset: 0, bodyRows: 40 } } })
  expect(await ui.find({ type: 'Button', key: 'p:ginette' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'p:test-100' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /↓ \d+ de plus/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Aperçu : ginette/ })).toBeDefined()
  const lines = await ui.findAll({ type: 'Text', text: /^mot/ })
  expect(lines.length).toBe(5)
  expect(lines.at(-1)?.text.endsWith('…')).toBe(true)

  // Down to the last persona, then the buttons below the list: the window stays at the bottom.
  await $.ui.focus({ component: 'Pane', requestId: 'persona-menu', element: 'random', origin: { kind: 'person' } })
  await ui.redraw()
  expect(await ui.find({ type: 'Button', key: 'p:test-100' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'p:ginette' })).toBeUndefined()

  // The ring wraps to the scope button above the list: the window goes back to the top,
  // so the next arrow down lands on the first persona.
  await $.ui.focus({ component: 'Pane', requestId: 'persona-menu', element: 'scope', origin: { kind: 'person' } })
  await ui.redraw()
  expect(await ui.find({ type: 'Button', key: 'p:ginette' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'p:test-100' })).toBeUndefined()
  // The preview keeps the last persona the ring was on.
  expect(await ui.find({ type: 'Text', text: /Aperçu : ginette/ })).toBeDefined()
  await ui.unmount()
})
