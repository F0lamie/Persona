// /persona: a menu in the style of /plugin to pick the persona.
// scripts/persona.sh stays the source of truth (state files, random draw,
// SessionStart injection); this module only draws the menu and calls it.
import { atom, read, update } from 'claude-code'
import type { CommandRunResult, EngineInterface, Register } from 'claude-code'

import type { MenuData, Scope } from '../types'

const PANE = 'persona-menu'

// Change the shape tag when MenuData's fields change.
const data = atom({ plugin: 'personas', key: 'data' } as const, null, { shape: 'menu-1' })
const scope = atom({ plugin: 'personas', key: 'scope' } as const, 'global')
const focused = atom({ plugin: 'personas', key: 'focused' } as const, '')
// Which part of the list the window shows: a persona's name, or FIRST / LAST
// while the ring is on the buttons above or below the list.
const anchor = atom({ plugin: 'personas', key: 'anchor' } as const, '')
const FIRST = '__first'
const LAST = '__last'

const RANDOM = '__random'
const OFF = '__off'

async function script($: EngineInterface, args: readonly string[]): Promise<string> {
  const env = await $.process.hookEnv()
  const { stdout, stderr, exitCode } = await $.process.run(
    ['bash', `${env.CLAUDE_PLUGIN_ROOT}/scripts/persona.sh`, ...args],
    { env },
  )
  if (exitCode !== 0) throw new Error(`persona.sh ${args.join(' ')}: ${stderr || stdout}`)

  return stdout.trimEnd()
}

// What the model reads after a change, as the classic command tells it.
function noteFor(out: string): string | undefined {
  if (out.includes('PERSONA_ACTIVATED')) {
    return [
      "L'utilisateur vient de choisir une persona avec /persona. Adopte-la immédiatement, en respectant son cadre, pour toute la suite de la session. Elle remplace toute persona adoptée plus tôt.",
      '',
      out,
    ].join('\n')
  }
  if (out.includes('PERSONA_DEACTIVATED')) {
    return [
      "L'utilisateur vient de désactiver la persona avec /persona. Abandonne toute persona adoptée plus tôt dans la session et reprends ton ton habituel, sauf si le texte ci-dessous indique qu'une autre reste active.",
      '',
      out,
    ].join('\n')
  }

  return undefined
}

// One line for the person.
function summary(out: string): string {
  const first = out.split('\n')[0] ?? ''
  const on = /^PERSONA_ACTIVATED (\S+) \((.+)\)/.exec(first)
  if (on) {
    const [, name = '', how = ''] = on

    return how.startsWith('random')
      ? `Persona tirée au sort : ${name} (${how.replace('random, ', '')}). Nouveau tirage à chaque session, /clear et compaction.`
      : `Persona active : ${name} (${how}).`
  }
  const off = /^PERSONA_DEACTIVATED \((.+)\)/.exec(first)
  if (off) {
    const still = /la persona (\S+) reste active via la config (\S+)/.exec(out)

    return still ? `Persona désactivée (${off[1]}), mais ${still[1]} reste active via la config ${still[2]}.` : `Persona désactivée (${off[1]}).`
  }
  if (first === 'PERSONA_PROJECT_RESET') return 'Réglage du projet retiré.'

  return first
}

const PREVIEW_LINES = 5

// Rows a line of text takes once wrapped at `cols`.
function rowsOf(text: string, cols: number): number {
  return wrap(text, cols).length
}

// Word wrap, as the terminal does it; a word longer than the line is cut.
function wrap(text: string, cols: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let rest = word
    while (rest.length > cols) {
      if (line) lines.push(line)
      lines.push(rest.slice(0, cols))
      rest = rest.slice(cols)
      line = ''
    }
    if (!line) line = rest
    else if (line.length + 1 + rest.length <= cols) line += ' ' + rest
    else {
      lines.push(line)
      line = rest
    }
  }
  if (line) lines.push(line)

  return lines.length > 0 ? lines : ['']
}

// The first `max` lines; when some are left out, the last one ends on a word and "…".
function clip(lines: string[], max: number, cols: number): string[] {
  if (lines.length <= max) return lines
  const kept = lines.slice(0, max)
  let last = kept[max - 1] ?? ''
  while (last.length + 2 > cols && last.includes(' ')) last = last.slice(0, last.lastIndexOf(' '))
  kept[max - 1] = `${last} …`

  return kept
}

// The slice [from, to) of rows around `at` whose heights fit `budget`, `at`
// kept off the edges so the arrows always find a row to move to.
function windowAround(heights: number[], at: number, budget: number): [number, number] {
  if (heights.length === 0) return [0, 0]
  let from = at
  let to = at + 1
  let used = heights[at] ?? 1
  let down = true
  for (;;) {
    const canDown = to < heights.length && used + (heights[to] ?? 1) <= budget
    const canUp = from > 0 && used + (heights[from - 1] ?? 1) <= budget
    if (!canDown && !canUp) break
    if ((down && canDown) || !canUp) used += heights[to++] ?? 1
    else used += heights[--from] ?? 1
    down = !down
  }

  return [from, to]
}

// /persona with or without arguments.
async function run($: EngineInterface, raw: string): Promise<CommandRunResult> {
  const args = raw.trim().split(/\s+/).filter(Boolean)

  // With arguments: the same as the classic command, without the menu.
  if (args.length > 0) {
    const out = await script($, args)
    const note = noteFor(out)

    return note
      ? { text: summary(out), context: [note], isTextDisplayOnly: true as const }
      : { text: out, isTextDisplayOnly: true as const }
  }

  const menu = JSON.parse(await script($, ['json'])) as MenuData
  const start: Scope = menu.project ? 'project' : 'global'
  await update($, data, () => menu)
  await update($, scope, () => start)
  const first = menu.active !== 'off' && menu.personas.some(p => p.name === menu.active) ? menu.active : menu.personas[0]?.name ?? ''
  await update($, focused, () => first)
  await update($, anchor, () => first)

  const opened = await $.ui.open({
    id: PANE,
    title: 'Persona',
    focus: true,
    closeOnEscape: true,
    holdToasts: true,
    rows: menu.personas.length + 20,
  })
  if (!opened.isPlaced) return { text: await script($, ['list']), isTextDisplayOnly: true as const }

  return {}
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'persona',
      description: 'Choisir la persona de Claude (menu, ou list, <nom>, random, off, reset --project)',
      argumentHint: '[<nom> | random | open-space | off | reset | list | new <nom> | check [nom]] [--project]',
    })

    return next(e)
  })

  on('command.run', { command: 'persona' }, ($, e) =>
    run($, e.args).catch((error: unknown) => ({
      text: `persona : ${error instanceof Error ? error.message : String(error)}`,
      isTextDisplayOnly: true as const,
    })),
  )

  // The preview follows the focus ring.
  on('ui.focus', async ($, e, next) => {
    if (e.requestId === PANE && e.element?.startsWith('p:')) {
      const name = e.element.slice(2)
      await update($, focused, () => name).catch(() => undefined)
      await update($, anchor, () => name).catch(() => undefined)
    } else if (e.requestId === PANE && e.element) {
      // Above the list, the next arrow down lands on its first row; below it,
      // the next arrow up lands on its last: the window goes there first.
      const edge = e.element === 'scope' ? FIRST : e.element === 'random' || e.element === 'off' ? LAST : ''
      if (edge) await update($, anchor, () => edge).catch(() => undefined)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const menu = await read($, data)
    const where = await read($, scope)
    const seen = await read($, focused)
    const around = await read($, anchor)
    if (!menu) return <Text dimColor>Chargement…</Text>

    const cols = Math.max(20, e.props.bodyColumns)

    // What the chosen scope holds now: a name, "random", "off" or "" (nothing set).
    const held = where === 'project' ? menu.project : menu.global
    const mark = (value: string) => (held === value ? ' ●' : '')

    const choose = async (value: string) => {
      const verb = value === RANDOM ? 'random' : value === OFF ? 'off' : value
      const out = await script($, where === 'project' ? [verb, '--project'] : [verb])
      await $.ui.close({ id: PANE })
      const note = noteFor(out)
      if (note) await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: note }] } })
      $.ui.toast(summary(out))
    }

    const activeLine =
      'Active : ' +
      (menu.active === 'off'
        ? 'aucune'
        : menu.active === 'random'
          ? `aléatoire (${menu.source}), tirage en cours : ${menu.lastRandom || '?'}`
          : `${menu.active} (${menu.source})`)
    const scopeLine = `t: Portée : ${where === 'global' ? 'Global ●  Projet ○' : 'Global ○  Projet ●'}`
    const randomLine = `r: Aléatoire (open-space)${mark('random')}`
    const offLine = `o: Aucune${held === 'off' || (where === 'global' && held === '') ? ' ●' : ''}`
    const footer = '↑↓ choisir · Entrée valider · Échap fermer'

    // The preview: its title, then at most PREVIEW_LINES lines cut on a word.
    const current = menu.personas.find(p => p.name === seen)
    const inner = Math.max(10, cols - 4)
    const previewLines = current
      ? clip(current.preview.split('\n').flatMap(line => wrap(line, inner)), PREVIEW_LINES, inner)
      : []

    // Rows everything but the list takes, so the preview always shows.
    const fixed =
      rowsOf(activeLine, cols) + rowsOf(scopeLine, cols) + 1 + // header, blank
      2 + // the "more above / below" lines
      1 + rowsOf(randomLine, cols) + rowsOf(offLine, cols) + 1 + // separator, choices, blank
      2 + 1 + PREVIEW_LINES + // the preview's border, title and lines
      rowsOf(footer, cols) + 1 // footer, a row of slack
    const budget = Math.max(3, e.props.scroll.bodyRows - fixed)

    const width = Math.max(8, ...menu.personas.map(p => p.name.length))
    const rowText = (p: (typeof menu.personas)[number]) =>
      `${p.name.padEnd(width)}  ${p.description}${p.origin === 'user' ? ' (perso)' : ''}${mark(p.name)}`
    const heights = menu.personas.map(p => rowsOf(rowText(p), cols))
    const at =
      around === FIRST
        ? 0
        : around === LAST
          ? menu.personas.length - 1
          : Math.max(0, menu.personas.findIndex(p => p.name === (around || seen)))
    const [from, to] = windowAround(heights, at, budget)
    const above = from
    const below = menu.personas.length - to

    return (
      <Box flexDirection="column">
        <Text dimColor>{activeLine}</Text>
        <Button key="scope" plain hotkey="t" onPress={() => void update($, scope, s => (s === 'global' ? 'project' : 'global'))}>
          {scopeLine.slice(3)}
        </Button>
        <Text> </Text>
        {menu.personas.length === 0 && <Text dimColor>Aucune persona. Ajoutez-en dans {menu.userDir}</Text>}
        <Text dimColor>{above > 0 ? `  ↑ ${above} de plus` : ' '}</Text>
        {menu.personas.slice(from, to).map(p => (
          <Button
            key={`p:${p.name}`}
            plain
            autoFocus={p.name === seen ? true : undefined}
            onPress={() => void choose(p.name)}
          >
            {p.name.padEnd(width)}  <Text dimColor>{p.description}{p.origin === 'user' ? ' (perso)' : ''}</Text>{mark(p.name)}
          </Button>
        ))}
        <Text dimColor>{below > 0 ? `  ↓ ${below} de plus` : ' '}</Text>
        <Text dimColor>────────</Text>
        <Button key="random" plain hotkey="r" onPress={() => void choose(RANDOM)}>
          {randomLine.slice(3)}
        </Button>
        <Button key="off" plain hotkey="o" onPress={() => void choose(OFF)}>
          {offLine.slice(3)}
        </Button>
        <Text> </Text>
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          <Text bold>Aperçu : {current ? current.name : 'aucune persona sélectionnée'}</Text>
          {current && previewLines.length === 0 && <Text dimColor>(persona vide)</Text>}
          {previewLines.map(line => (
            <Text dimColor>{line}</Text>
          ))}
        </Box>
        <Text dimColor>{footer}</Text>
      </Box>
    )
  })
}
