export type Persona = {
  name: string
  description: string
  origin: 'plugin' | 'user'
  preview: string
}

// What `persona.sh json` prints: the library and where each setting stands.
export type MenuData = {
  active: string
  source: 'global' | 'project' | 'none'
  global: string
  project: string
  lastRandom: string
  userDir: string
  personas: Persona[]
}

export type Scope = 'global' | 'project'

declare module 'claude-code' {
  interface PluginState {
    personas: { data: Shaped<MenuData | null>; scope: Scope; focused: string; anchor: string }
  }
}
