export const PROJECT_TYPES = ['Web app', 'Game', 'Tool'] as const

export type ProjectType = (typeof PROJECT_TYPES)[number]

export type Project = {
  id: string
  name: string
  path: string
  url: string
  runCommand: string
  type: ProjectType
}

export type DesktopActionResult = {
  ok: boolean
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
    type: 'Web app'
  },
  {
    id: 'block-parkour-rush',
    name: 'Block Parkour Rush',
    path: 'C:\\Users\\suzuk\\Documents\\block-parkour-game',
    url: 'http://localhost:3002',
    runCommand: 'npm run dev -- --port 3002',
    type: 'Game'
  },
  {
    id: 'ai-work-navigator',
    name: 'AI作業ナビ',
    path: 'C:\\Users\\suzuk\\Documents\\ai-work-navigator',
    url: 'http://localhost:3003',
    runCommand: 'npm run dev -- --port 3003',
    type: 'Tool'
  },
  {
    id: 'my-project-hub',
    name: 'My Project Hub',
    path: 'C:\\Users\\suzuk\\Documents\\my-project-hub',
    url: 'http://127.0.0.1:3210',
    runCommand: 'npm run dev -- --hostname 127.0.0.1 --port 3210',
    type: 'Tool'
  },
  {
    id: 'lead-profit-dashboard',
    name: 'Lead Profit Dashboard',
    path: 'C:\\Users\\suzuk\\Documents\\Codex\\2026-05-20\\inspect-my-existing-laravel-monetyzr-codebase\\lead-profit-dashboard',
    url: 'http://127.0.0.1:8000/lead-profit-dashboard',
    runCommand: 'php artisan serve --host=127.0.0.1 --port=8000',
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
    if (!shouldUpdateUrl && !shouldUpdateRunCommand) return project

    changed = true

    return {
      ...project,
      url: shouldUpdateUrl ? migration.url : project.url,
      runCommand: shouldUpdateRunCommand ? migration.runCommand : project.runCommand
    }
  })

  return { projects: migratedProjects, changed }
}
