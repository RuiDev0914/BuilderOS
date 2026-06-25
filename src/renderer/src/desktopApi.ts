import {
  DEFAULT_PROJECTS,
  DesktopActionResult,
  migrateProjects,
  Project,
  ProjectGitSummary,
  ProjectRunEvent,
  ProjectRunState,
  RecentActivity,
  RecentActivityInput
} from '@shared/projects'
import {
  BuilderDataActionResult,
  BuilderDataExport,
  BuilderSettings,
  DEFAULT_BUILDER_SETTINGS,
  normalizeBuilderSettings
} from '@shared/settings'
import { APP_NAME, APP_VERSION } from '@shared/app'

const STORAGE_KEY = 'dev-launch-pad-preview-projects'
const ACTIVITY_STORAGE_KEY = 'dev-launch-pad-preview-activities'
const SETTINGS_STORAGE_KEY = 'builderos-preview-settings'
const MAX_PREVIEW_ACTIVITIES = 20

const readPreviewProjects = (): Project[] => {
  try {
    const rawProjects = localStorage.getItem(STORAGE_KEY)
    const projects = rawProjects ? (JSON.parse(rawProjects) as Project[]) : DEFAULT_PROJECTS
    const migration = migrateProjects(projects)

    if (migration.changed) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migration.projects))
    }

    return migration.projects
  } catch {
    return DEFAULT_PROJECTS
  }
}

const readPreviewActivities = (): RecentActivity[] => {
  try {
    const rawActivities = localStorage.getItem(ACTIVITY_STORAGE_KEY)
    const activities = rawActivities ? (JSON.parse(rawActivities) as RecentActivity[]) : []

    return Array.isArray(activities)
      ? activities
          .filter((activity) => activity && typeof activity.createdAt === 'string')
          .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
          .slice(0, MAX_PREVIEW_ACTIVITIES)
      : []
  } catch {
    return []
  }
}

const writePreviewActivities = (activities: RecentActivity[]): void => {
  localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(activities.slice(0, MAX_PREVIEW_ACTIVITIES)))
}

const readPreviewSettings = (): BuilderSettings => {
  try {
    const rawSettings = localStorage.getItem(SETTINGS_STORAGE_KEY)
    const migration = normalizeBuilderSettings(rawSettings ? JSON.parse(rawSettings) : DEFAULT_BUILDER_SETTINGS)

    if (migration.changed) {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(migration.settings))
    }

    return migration.settings
  } catch {
    return DEFAULT_BUILDER_SETTINGS
  }
}

const writePreviewSettings = (settings: BuilderSettings): BuilderSettings => {
  const migration = normalizeBuilderSettings(settings)
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(migration.settings))
  return migration.settings
}

const recordPreviewActivity = (activity: RecentActivityInput): RecentActivity[] => {
  const activities = [
    {
      id: `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      ...activity,
      createdAt: new Date().toISOString()
    },
    ...readPreviewActivities()
  ].slice(0, MAX_PREVIEW_ACTIVITIES)

  writePreviewActivities(activities)
  return activities
}

const previewOnly = (message: string): DesktopActionResult => ({
  ok: false,
  message
})

const downloadPreviewData = (data: BuilderDataExport): void => {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `BuilderOS-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  link.click()
  URL.revokeObjectURL(url)
}

const pickPreviewJsonFile = (): Promise<File | null> => {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.click()
  })
}

const browserFallbackApi = {
  getProjects: async (): Promise<Project[]> => readPreviewProjects(),
  saveProjects: async (projects: Project[]): Promise<DesktopActionResult> => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
    return { ok: true, message: 'Projects saved in browser preview.' }
  },
  getRecentActivities: async (): Promise<RecentActivity[]> => readPreviewActivities(),
  recordRecentActivity: async (activity: RecentActivityInput): Promise<RecentActivity[]> => recordPreviewActivity(activity),
  getSettings: async (): Promise<BuilderSettings> => readPreviewSettings(),
  saveSettings: async (settings: BuilderSettings): Promise<BuilderDataActionResult> => ({
    ok: true,
    message: 'Settings saved in browser preview.',
    settings: writePreviewSettings(settings)
  }),
  exportData: async (): Promise<BuilderDataActionResult> => {
    downloadPreviewData({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      appName: APP_NAME,
      appVersion: APP_VERSION,
      settings: readPreviewSettings(),
      projects: readPreviewProjects(),
      recentActivities: readPreviewActivities()
    })

    return { ok: true, message: 'Data exported from browser preview.' }
  },
  importData: async (): Promise<BuilderDataActionResult> => {
    try {
      const file = await pickPreviewJsonFile()
      if (!file) return { ok: false, message: 'Import canceled.' }

      const parsed = JSON.parse(await file.text()) as Partial<BuilderDataExport>
      const rawProjects = Array.isArray(parsed.projects) ? (parsed.projects as Project[]) : null

      if (!rawProjects) return { ok: false, message: 'Import file does not contain projects.' }

      const projectMigration = migrateProjects(rawProjects)
      const settings = writePreviewSettings(normalizeBuilderSettings(parsed.settings).settings)
      const recentActivities = Array.isArray(parsed.recentActivities)
        ? parsed.recentActivities
            .filter((activity): activity is RecentActivity => {
              return Boolean(
                activity &&
                  typeof activity.id === 'string' &&
                  typeof activity.type === 'string' &&
                  typeof activity.projectId === 'string' &&
                  typeof activity.projectName === 'string' &&
                  typeof activity.message === 'string' &&
                  typeof activity.createdAt === 'string' &&
                  !Number.isNaN(Date.parse(activity.createdAt))
              )
            })
            .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
            .slice(0, MAX_PREVIEW_ACTIVITIES)
        : []

      localStorage.setItem(STORAGE_KEY, JSON.stringify(projectMigration.projects))
      writePreviewActivities(recentActivities)

      return {
        ok: true,
        message: 'Data imported in browser preview.',
        settings,
        projects: projectMigration.projects,
        recentActivities
      }
    } catch {
      return { ok: false, message: 'Import failed. Check that the file is valid JSON.' }
    }
  },
  resetData: async (): Promise<BuilderDataActionResult> => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_PROJECTS))
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(DEFAULT_BUILDER_SETTINGS))
    writePreviewActivities([])

    return {
      ok: true,
      message: 'BuilderOS data reset in browser preview.',
      settings: DEFAULT_BUILDER_SETTINGS,
      projects: DEFAULT_PROJECTS,
      recentActivities: []
    }
  },
  getProjectRunState: async (): Promise<ProjectRunState> => ({
    statuses: {},
    logs: {}
  }),
  runProject: async (): Promise<DesktopActionResult> => previewOnly('Run requires the Electron desktop app.'),
  stopProject: async (): Promise<DesktopActionResult> => previewOnly('Stop requires the Electron desktop app.'),
  onProjectRunEvent: (callback: (event: ProjectRunEvent) => void): (() => void) => {
    void callback
    return () => undefined
  },
  openFolder: async (): Promise<DesktopActionResult> => previewOnly('Open folder requires the Electron desktop app.'),
  openUrl: async (targetUrl: string): Promise<DesktopActionResult> => {
    window.open(targetUrl, '_blank', 'noopener,noreferrer')
    return { ok: true, message: 'URL opened.' }
  },
  openPowerShell: async (): Promise<DesktopActionResult> => previewOnly('PowerShell requires the Electron desktop app.'),
  openTerminal: async (): Promise<DesktopActionResult> => previewOnly('Terminal requires the Electron desktop app.'),
  copyProjectStatus: async (): Promise<DesktopActionResult> =>
    previewOnly('Copy status requires the Electron desktop app.'),
  getProjectGitSummary: async (): Promise<ProjectGitSummary> => ({
    ok: false,
    isGitRepository: false,
    branch: '',
    latestCommit: '',
    workingTreeStatus: '',
    message: 'Git summary requires the Electron desktop app.'
  }),
  copyChatGptContext: async (): Promise<DesktopActionResult> =>
    previewOnly('Copy ChatGPT context requires the Electron desktop app.'),
  commitProject: async (): Promise<DesktopActionResult> => previewOnly('Commit requires the Electron desktop app.'),
  publishProject: async (): Promise<DesktopActionResult> => previewOnly('Publish requires the Electron desktop app.'),
  openCodex: async (): Promise<DesktopActionResult> => previewOnly('Codex requires the Electron desktop app.'),
  copyText: async (text: string): Promise<DesktopActionResult> => {
    await navigator.clipboard.writeText(text)
    return { ok: true, message: 'Copied to clipboard.' }
  }
}

export const desktopApi = window.devLaunchPad ?? browserFallbackApi
