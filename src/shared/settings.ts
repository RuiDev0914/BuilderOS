import type { Project, RecentActivity } from './projects'

export type BuilderTheme = 'dark' | 'light'
export type BuilderLanguage = 'en' | 'ja'
export type BuilderTerminal = 'powershell' | 'windows-terminal' | 'system'
export type BuilderEditor = 'vscode' | 'cursor' | 'system'

export type BuilderSettings = {
  theme: BuilderTheme
  language: BuilderLanguage
  autoSave: boolean
  startWithWindows: boolean
  defaultProjectFolder: string
  defaultTerminal: BuilderTerminal
  defaultEditor: BuilderEditor
}

export type BuilderDataExport = {
  schemaVersion: 1
  exportedAt: string
  appName: string
  appVersion: string
  settings: BuilderSettings
  projects: Project[]
  recentActivities: RecentActivity[]
}

export type BuilderDataActionResult = {
  ok: boolean
  message?: string
  path?: string
  settings?: BuilderSettings
  projects?: Project[]
  recentActivities?: RecentActivity[]
}

export const DEFAULT_BUILDER_SETTINGS: BuilderSettings = {
  theme: 'dark',
  language: 'en',
  autoSave: true,
  startWithWindows: false,
  defaultProjectFolder: '',
  defaultTerminal: 'powershell',
  defaultEditor: 'system'
}

const isBuilderTheme = (value: unknown): value is BuilderTheme => {
  return value === 'dark' || value === 'light'
}

const isBuilderLanguage = (value: unknown): value is BuilderLanguage => {
  return value === 'en' || value === 'ja'
}

const isBuilderTerminal = (value: unknown): value is BuilderTerminal => {
  return value === 'powershell' || value === 'windows-terminal' || value === 'system'
}

const isBuilderEditor = (value: unknown): value is BuilderEditor => {
  return value === 'vscode' || value === 'cursor' || value === 'system'
}

const normalizeTextSetting = (value: unknown, maxLength: number): string => {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

export const normalizeBuilderSettings = (
  input: unknown
): { settings: BuilderSettings; changed: boolean } => {
  if (!input || typeof input !== 'object') {
    return { settings: DEFAULT_BUILDER_SETTINGS, changed: true }
  }

  const candidate = input as Partial<BuilderSettings>
  const settings: BuilderSettings = {
    theme: isBuilderTheme(candidate.theme) ? candidate.theme : DEFAULT_BUILDER_SETTINGS.theme,
    language: isBuilderLanguage(candidate.language) ? candidate.language : DEFAULT_BUILDER_SETTINGS.language,
    autoSave:
      typeof candidate.autoSave === 'boolean' ? candidate.autoSave : DEFAULT_BUILDER_SETTINGS.autoSave,
    startWithWindows:
      typeof candidate.startWithWindows === 'boolean'
        ? candidate.startWithWindows
        : DEFAULT_BUILDER_SETTINGS.startWithWindows,
    defaultProjectFolder: normalizeTextSetting(candidate.defaultProjectFolder, 500),
    defaultTerminal: isBuilderTerminal(candidate.defaultTerminal)
      ? candidate.defaultTerminal
      : DEFAULT_BUILDER_SETTINGS.defaultTerminal,
    defaultEditor: isBuilderEditor(candidate.defaultEditor) ? candidate.defaultEditor : DEFAULT_BUILDER_SETTINGS.defaultEditor
  }

  return {
    settings,
    changed:
      settings.theme !== candidate.theme ||
      settings.language !== candidate.language ||
      settings.autoSave !== candidate.autoSave ||
      settings.startWithWindows !== candidate.startWithWindows ||
      settings.defaultProjectFolder !== candidate.defaultProjectFolder ||
      settings.defaultTerminal !== candidate.defaultTerminal ||
      settings.defaultEditor !== candidate.defaultEditor
  }
}
