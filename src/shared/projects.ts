export const PROJECT_TYPES = ['Web app', 'Game', 'Tool'] as const

export type ProjectType = (typeof PROJECT_TYPES)[number]

export const DEFAULT_TASK_PROFILE_ID = 'development'
export const DEFAULT_TASK_PROFILE_NAME = 'Development'

export type ProjectTaskProfile = {
  id: string
  name: string
  command: string
}

export type ProjectWorkSession = {
  id: string
  startedAt: string
  endedAt: string | null
}

export type ProjectPublishStatus = 'success' | 'failed'

export type ProjectPublishHistoryEntry = {
  id: string
  status: ProjectPublishStatus
  startedAt: string
  endedAt: string
  message: string
  output?: string
}

export type Project = {
  id: string
  name: string
  path: string
  url: string
  runCommand: string
  taskProfiles: ProjectTaskProfile[]
  icon: string
  notes: string
  isFavorite: boolean
  launchCount: number
  lastLaunchedAt: string | null
  lastOpenedAt: string | null
  workSessions: ProjectWorkSession[]
  publishHistory: ProjectPublishHistoryEntry[]
  type: ProjectType
}

export type RecentActivityType =
  | 'project-run'
  | 'open-folder'
  | 'open-url'
  | 'open-powershell'
  | 'dev-tools'
  | 'project-details'

export type RecentActivity = {
  id: string
  type: RecentActivityType
  projectId: string
  projectName: string
  message: string
  createdAt: string
}

export type RecentActivityInput = {
  type: RecentActivityType
  projectId: string
  projectName: string
  message: string
}

export type DesktopActionResult = {
  ok: boolean
  message?: string
  output?: string
}

export type ProjectGitSummary = {
  ok: boolean
  isGitRepository: boolean
  branch: string
  latestCommit: string
  workingTreeStatus: string
  message?: string
}

export type ProjectRunStatus = 'Stopped' | 'Running' | 'Error'

export type ProjectLogLevel = 'info' | 'output' | 'error'

export type ProjectLogEntry = {
  id: string
  projectId: string
  level: ProjectLogLevel
  message: string
  createdAt: string
}

export type ProjectRunEvent = {
  projectId: string
  status?: ProjectRunStatus
  log?: ProjectLogEntry
  message?: string
}

export type ProjectRunState = {
  statuses: Record<string, ProjectRunStatus>
  logs: Record<string, ProjectLogEntry[]>
}

export const makeTaskProfileId = (name: string, existingIds: string[] = []): string => {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'task'

  let id = base
  let suffix = 2

  while (existingIds.includes(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }

  return id
}

export const createDefaultTaskProfile = (command = ''): ProjectTaskProfile => ({
  id: DEFAULT_TASK_PROFILE_ID,
  name: DEFAULT_TASK_PROFILE_NAME,
  command
})

const normalizeTaskProfile = (input: unknown, existingIds: string[]): ProjectTaskProfile | null => {
  if (!input || typeof input !== 'object') return null

  const candidate = input as Partial<ProjectTaskProfile>
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
  const command = typeof candidate.command === 'string' ? candidate.command.trim() : ''
  const rawId = typeof candidate.id === 'string' ? candidate.id.trim() : ''

  if (!name || !command) return null

  const id = rawId && !existingIds.includes(rawId) ? rawId : makeTaskProfileId(name, existingIds)
  return { id, name, command }
}

export const normalizeProjectTaskProfiles = (
  input: unknown,
  legacyRunCommand: string
): { taskProfiles: ProjectTaskProfile[]; changed: boolean } => {
  const existingIds: string[] = []
  const normalizedProfiles = Array.isArray(input)
    ? input.reduce<ProjectTaskProfile[]>((profiles, item) => {
        const profile = normalizeTaskProfile(item, existingIds)
        if (!profile) return profiles

        existingIds.push(profile.id)
        return [...profiles, profile]
      }, [])
    : []

  if (normalizedProfiles.length > 0) {
    return {
      taskProfiles: normalizedProfiles,
      changed: !Array.isArray(input) || normalizedProfiles.length !== input.length
    }
  }

  const command = legacyRunCommand.trim()
  return {
    taskProfiles: command ? [createDefaultTaskProfile(command)] : [],
    changed: Boolean(command)
  }
}

export const normalizeProjectIcon = (input: unknown): { icon: string; changed: boolean } => {
  if (typeof input !== 'string') {
    return { icon: '', changed: true }
  }

  const icon = Array.from(input.trim()).slice(0, 4).join('')
  return { icon, changed: icon !== input }
}

const isValidDateString = (value: unknown): value is string => {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

const normalizeWorkSession = (input: unknown, index: number): ProjectWorkSession | null => {
  if (!input || typeof input !== 'object') return null

  const candidate = input as Partial<ProjectWorkSession>
  if (!isValidDateString(candidate.startedAt)) return null

  const rawId = typeof candidate.id === 'string' ? candidate.id.trim() : ''
  const endedAt = isValidDateString(candidate.endedAt) ? candidate.endedAt : null

  return {
    id: rawId || `work-session-${Date.parse(candidate.startedAt)}-${index}`,
    startedAt: candidate.startedAt,
    endedAt
  }
}

export const normalizeProjectWorkSessions = (
  input: unknown
): { workSessions: ProjectWorkSession[]; changed: boolean } => {
  if (!Array.isArray(input)) {
    return { workSessions: [], changed: true }
  }

  const workSessions = input
    .map(normalizeWorkSession)
    .filter((session): session is ProjectWorkSession => Boolean(session))

  return {
    workSessions,
    changed:
      workSessions.length !== input.length ||
      workSessions.some((session, index) => {
        const candidate = input[index] as Partial<ProjectWorkSession>
        return session.id !== candidate.id || session.startedAt !== candidate.startedAt || session.endedAt !== (candidate.endedAt ?? null)
      })
  }
}

const normalizePublishHistoryEntry = (input: unknown, index: number): ProjectPublishHistoryEntry | null => {
  if (!input || typeof input !== 'object') return null

  const candidate = input as Partial<ProjectPublishHistoryEntry>
  const status = candidate.status === 'success' || candidate.status === 'failed' ? candidate.status : null
  const startedAt = isValidDateString(candidate.startedAt) ? candidate.startedAt : null
  const endedAt = isValidDateString(candidate.endedAt) ? candidate.endedAt : null
  const message = typeof candidate.message === 'string' ? candidate.message.trim() : ''
  const output = typeof candidate.output === 'string' ? candidate.output : undefined
  const rawId = typeof candidate.id === 'string' ? candidate.id.trim() : ''

  if (!status || !startedAt || !endedAt || !message) return null

  return {
    id: rawId || `publish-${Date.parse(startedAt)}-${index}`,
    status,
    startedAt,
    endedAt,
    message,
    ...(output ? { output } : {})
  }
}

export const normalizeProjectPublishHistory = (
  input: unknown
): { publishHistory: ProjectPublishHistoryEntry[]; changed: boolean } => {
  if (!Array.isArray(input)) {
    return { publishHistory: [], changed: true }
  }

  const publishHistory = input
    .map(normalizePublishHistoryEntry)
    .filter((entry): entry is ProjectPublishHistoryEntry => Boolean(entry))

  return {
    publishHistory,
    changed:
      publishHistory.length !== input.length ||
      publishHistory.some((entry, index) => {
        const candidate = input[index] as Partial<ProjectPublishHistoryEntry>
        return (
          entry.id !== candidate.id ||
          entry.status !== candidate.status ||
          entry.startedAt !== candidate.startedAt ||
          entry.endedAt !== candidate.endedAt ||
          entry.message !== candidate.message ||
          entry.output !== candidate.output
        )
      })
  }
}

type DefaultProjectPortMigration = {
  id: string
  oldRunCommands: string[]
  oldUrls: string[]
  runCommand: string
  url: string
}

const DEFAULT_PROJECT_PORT_MIGRATIONS: DefaultProjectPortMigration[] = [
  {
    id: 'ai-homework-safe-checker',
    oldRunCommands: ['npm run dev'],
    oldUrls: ['http://localhost:3000'],
    runCommand: 'npm run dev -- --port 3001',
    url: 'http://localhost:3001'
  },
  {
    id: 'block-parkour-rush',
    oldRunCommands: ['npm run dev'],
    oldUrls: ['http://localhost:3000'],
    runCommand: 'npm run dev -- --port 3002',
    url: 'http://localhost:3002'
  },
  {
    id: 'ai-work-navigator',
    oldRunCommands: ['npm run dev'],
    oldUrls: ['http://localhost:3000'],
    runCommand: 'npm run dev -- --port 3003',
    url: 'http://localhost:3003'
  },
  {
    id: 'my-project-hub',
    oldRunCommands: ['npm run dev'],
    oldUrls: ['http://localhost:3000'],
    runCommand: 'npm run dev -- --hostname 127.0.0.1 --port 3210',
    url: 'http://127.0.0.1:3210'
  }
]

export const DEFAULT_PROJECTS: Project[] = [
  {
    id: 'ai-homework-safe-checker',
    name: 'AI宿題セーフチェッカー',
    path: 'C:\\Users\\suzuk\\Documents\\ai-homework-safe-checker',
    url: 'http://localhost:3001',
    runCommand: 'npm run dev -- --port 3001',
    taskProfiles: [createDefaultTaskProfile('npm run dev -- --port 3001')],
    icon: '',
    notes: '',
    isFavorite: false,
    launchCount: 0,
    lastLaunchedAt: null,
    lastOpenedAt: null,
    workSessions: [],
    publishHistory: [],
    type: 'Web app'
  },
  {
    id: 'block-parkour-rush',
    name: 'Block Parkour Rush',
    path: 'C:\\Users\\suzuk\\Documents\\block-parkour-game',
    url: 'http://localhost:3002',
    runCommand: 'npm run dev -- --port 3002',
    taskProfiles: [createDefaultTaskProfile('npm run dev -- --port 3002')],
    icon: '',
    notes: '',
    isFavorite: false,
    launchCount: 0,
    lastLaunchedAt: null,
    lastOpenedAt: null,
    workSessions: [],
    publishHistory: [],
    type: 'Game'
  },
  {
    id: 'ai-work-navigator',
    name: 'AI作業ナビ',
    path: 'C:\\Users\\suzuk\\Documents\\ai-work-navigator',
    url: 'http://localhost:3003',
    runCommand: 'npm run dev -- --port 3003',
    taskProfiles: [createDefaultTaskProfile('npm run dev -- --port 3003')],
    icon: '',
    notes: '',
    isFavorite: false,
    launchCount: 0,
    lastLaunchedAt: null,
    lastOpenedAt: null,
    workSessions: [],
    publishHistory: [],
    type: 'Tool'
  },
  {
    id: 'my-project-hub',
    name: 'My Project Hub',
    path: 'C:\\Users\\suzuk\\Documents\\my-project-hub',
    url: 'http://127.0.0.1:3210',
    runCommand: 'npm run dev -- --hostname 127.0.0.1 --port 3210',
    taskProfiles: [createDefaultTaskProfile('npm run dev -- --hostname 127.0.0.1 --port 3210')],
    icon: '',
    notes: '',
    isFavorite: false,
    launchCount: 0,
    lastLaunchedAt: null,
    lastOpenedAt: null,
    workSessions: [],
    publishHistory: [],
    type: 'Tool'
  },
  {
    id: 'lead-profit-dashboard',
    name: 'Lead Profit Dashboard',
    path: 'C:\\Users\\suzuk\\Documents\\Codex\\2026-05-20\\inspect-my-existing-laravel-monetyzr-codebase\\lead-profit-dashboard',
    url: 'http://127.0.0.1:8000/lead-profit-dashboard',
    runCommand: 'php artisan serve --host=127.0.0.1 --port=8000',
    taskProfiles: [createDefaultTaskProfile('php artisan serve --host=127.0.0.1 --port=8000')],
    icon: '',
    notes: '',
    isFavorite: false,
    launchCount: 0,
    lastLaunchedAt: null,
    lastOpenedAt: null,
    workSessions: [],
    publishHistory: [],
    type: 'Tool'
  }
]

export const isProjectType = (value: unknown): value is ProjectType => {
  return typeof value === 'string' && PROJECT_TYPES.includes(value as ProjectType)
}

export const migrateDefaultProjectPorts = (projects: Project[]): { projects: Project[]; changed: boolean } => {
  let changed = false

  const migratedProjects = projects.map((project) => {
    const migration = DEFAULT_PROJECT_PORT_MIGRATIONS.find((candidate) => candidate.id === project.id)
    if (!migration) return project

    const shouldUpdateUrl = migration.oldUrls.includes(project.url)
    const shouldUpdateRunCommand = migration.oldRunCommands.includes(project.runCommand)
    const existingTaskProfiles = project.taskProfiles ?? []
    const taskProfiles = existingTaskProfiles.map((profile) =>
      migration.oldRunCommands.includes(profile.command)
        ? {
            ...profile,
            command: migration.runCommand
          }
        : profile
    )
    const shouldUpdateTaskProfiles = taskProfiles.some(
      (profile, index) => profile.command !== existingTaskProfiles[index]?.command
    )

    if (!shouldUpdateUrl && !shouldUpdateRunCommand && !shouldUpdateTaskProfiles) return project

    changed = true

    return {
      ...project,
      url: shouldUpdateUrl ? migration.url : project.url,
      runCommand: shouldUpdateRunCommand ? migration.runCommand : project.runCommand,
      taskProfiles
    }
  })

  return { projects: migratedProjects, changed }
}

export const migrateProjectTaskProfiles = (projects: Project[]): { projects: Project[]; changed: boolean } => {
  let changed = false

  const migratedProjects = projects.map((project) => {
    const candidate = project as Project & { taskProfiles?: unknown; runCommand?: unknown }
    const legacyRunCommand = typeof candidate.runCommand === 'string' ? candidate.runCommand.trim() : ''
    const migration = normalizeProjectTaskProfiles(candidate.taskProfiles, legacyRunCommand)
    const runCommand = legacyRunCommand || migration.taskProfiles[0]?.command || ''

    if (
      migration.changed ||
      runCommand !== project.runCommand ||
      migration.taskProfiles.length !== project.taskProfiles?.length
    ) {
      changed = true
    }

    return {
      ...project,
      runCommand,
      taskProfiles: migration.taskProfiles
    }
  })

  return { projects: migratedProjects, changed }
}

export const migrateProjectNotes = (projects: Project[]): { projects: Project[]; changed: boolean } => {
  let changed = false

  const migratedProjects = projects.map((project) => {
    const candidate = project as Project & { notes?: unknown }
    const notes = typeof candidate.notes === 'string' ? candidate.notes : ''

    if (notes !== candidate.notes) {
      changed = true
    }

    return {
      ...project,
      notes
    }
  })

  return { projects: migratedProjects, changed }
}

export const migrateProjectIcons = (projects: Project[]): { projects: Project[]; changed: boolean } => {
  let changed = false

  const migratedProjects = projects.map((project) => {
    const candidate = project as Project & { icon?: unknown }
    const migration = normalizeProjectIcon(candidate.icon)

    if (migration.changed) {
      changed = true
    }

    return {
      ...project,
      icon: migration.icon
    }
  })

  return { projects: migratedProjects, changed }
}

export const migrateProjectFavorites = (projects: Project[]): { projects: Project[]; changed: boolean } => {
  let changed = false

  const migratedProjects = projects.map((project) => {
    const candidate = project as Project & { isFavorite?: unknown }
    const isFavorite = candidate.isFavorite === true

    if (candidate.isFavorite !== isFavorite) {
      changed = true
    }

    return {
      ...project,
      isFavorite
    }
  })

  return { projects: migratedProjects, changed }
}

const normalizeLaunchCount = (value: unknown): number => {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

const normalizeLaunchDate = (value: unknown): string | null => {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null
}

export const migrateProjectLaunchStats = (projects: Project[]): { projects: Project[]; changed: boolean } => {
  let changed = false

  const migratedProjects = projects.map((project) => {
    const candidate = project as Project & { launchCount?: unknown; lastLaunchedAt?: unknown }
    const launchCount = normalizeLaunchCount(candidate.launchCount)
    const lastLaunchedAt = normalizeLaunchDate(candidate.lastLaunchedAt)

    if (candidate.launchCount !== launchCount || candidate.lastLaunchedAt !== lastLaunchedAt) {
      changed = true
    }

    return {
      ...project,
      launchCount,
      lastLaunchedAt
    }
  })

  return { projects: migratedProjects, changed }
}

export const migrateProjectOpenStats = (projects: Project[]): { projects: Project[]; changed: boolean } => {
  let changed = false

  const migratedProjects = projects.map((project) => {
    const candidate = project as Project & { lastOpenedAt?: unknown }
    const lastOpenedAt = normalizeLaunchDate(candidate.lastOpenedAt)

    if (candidate.lastOpenedAt !== lastOpenedAt) {
      changed = true
    }

    return {
      ...project,
      lastOpenedAt
    }
  })

  return { projects: migratedProjects, changed }
}

export const migrateProjectWorkSessions = (projects: Project[]): { projects: Project[]; changed: boolean } => {
  let changed = false

  const migratedProjects = projects.map((project) => {
    const candidate = project as Project & { workSessions?: unknown }
    const migration = normalizeProjectWorkSessions(candidate.workSessions)

    if (migration.changed) {
      changed = true
    }

    return {
      ...project,
      workSessions: migration.workSessions
    }
  })

  return { projects: migratedProjects, changed }
}

export const migrateProjectPublishHistory = (projects: Project[]): { projects: Project[]; changed: boolean } => {
  let changed = false

  const migratedProjects = projects.map((project) => {
    const candidate = project as Project & { publishHistory?: unknown }
    const migration = normalizeProjectPublishHistory(candidate.publishHistory)

    if (migration.changed) {
      changed = true
    }

    return {
      ...project,
      publishHistory: migration.publishHistory
    }
  })

  return { projects: migratedProjects, changed }
}

export const migrateProjects = (projects: Project[]): { projects: Project[]; changed: boolean } => {
  const taskProfileMigration = migrateProjectTaskProfiles(projects)
  const defaultPortMigration = migrateDefaultProjectPorts(taskProfileMigration.projects)
  const iconsMigration = migrateProjectIcons(defaultPortMigration.projects)
  const notesMigration = migrateProjectNotes(iconsMigration.projects)
  const favoritesMigration = migrateProjectFavorites(notesMigration.projects)
  const launchStatsMigration = migrateProjectLaunchStats(favoritesMigration.projects)
  const openStatsMigration = migrateProjectOpenStats(launchStatsMigration.projects)
  const workSessionsMigration = migrateProjectWorkSessions(openStatsMigration.projects)
  const publishHistoryMigration = migrateProjectPublishHistory(workSessionsMigration.projects)

  return {
    projects: publishHistoryMigration.projects,
    changed:
      taskProfileMigration.changed ||
      defaultPortMigration.changed ||
      iconsMigration.changed ||
      notesMigration.changed ||
      favoritesMigration.changed ||
      launchStatsMigration.changed ||
      openStatsMigration.changed ||
      workSessionsMigration.changed ||
      publishHistoryMigration.changed
  }
}
