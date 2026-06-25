import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell, Tray, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { APP_LEGACY_NAME, APP_NAME, APP_VERSION } from '@shared/app'
import {
  DEFAULT_PROJECTS,
  DesktopActionResult,
  isProjectType,
  migrateProjects,
  normalizeProjectIcon,
  normalizeProjectPublishHistory,
  normalizeProjectTaskProfiles,
  normalizeProjectWorkSessions,
  Project,
  ProjectGitSummary,
  ProjectLogEntry,
  ProjectLogLevel,
  ProjectRunEvent,
  ProjectRunState,
  ProjectRunStatus,
  ProjectTaskProfile,
  RecentActivity,
  RecentActivityInput,
  RecentActivityType
} from '@shared/projects'
import {
  BuilderDataActionResult,
  BuilderDataExport,
  BuilderSettings,
  DEFAULT_BUILDER_SETTINGS,
  normalizeBuilderSettings
} from '@shared/settings'

const PROJECTS_FILE = 'projects.json'
const ACTIVITIES_FILE = 'activities.json'
const SETTINGS_FILE = 'settings.json'
const APP_USER_MODEL_ID = 'com.suzuk.builderos'
const MAX_PROJECT_LOGS = 400
const MAX_RECENT_ACTIVITIES = 20
const QUICK_EXIT_MS = 8000
const URL_REACHABILITY_TIMEOUT_MS = 1600
const GIT_ACTION_TIMEOUT_MS = 30000
const MAX_DESKTOP_ACTION_OUTPUT = 16000
const DEV_APP_ICON_PATH = join(process.cwd(), 'resources/dev-launch-pad.ico')
const PACKAGED_APP_ICON_PATH = join(process.resourcesPath, 'dev-launch-pad.ico')

type CommandSignal = {
  label: string
  pattern: RegExp
}

type RunningProject = {
  child: ChildProcessWithoutNullStreams
  stopping: boolean
  alreadyReachable: boolean
  completed: boolean
  fatalDetected: boolean
  fatalSignal?: string
  startedAt: number
  successDetected: boolean
}

type CommandResult = {
  command: string
  code: number | null
  stdout: string
  stderr: string
  errorCode?: string
  timedOut: boolean
}

type GitContextResult =
  | {
      ok: true
      latestCommit: string
      gitStatus: string
    }
  | {
      ok: false
      message?: string
      output?: string
    }

const runningProjects = new Map<string, RunningProject>()
const projectStatuses = new Map<string, ProjectRunStatus>()
const projectLogs = new Map<string, ProjectLogEntry[]>()
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let logSequence = 0
let activitySequence = 0

const successSignals: CommandSignal[] = [
  { label: 'Ready in', pattern: /ready in/i },
  { label: 'Local:', pattern: /local:/i },
  { label: 'localhost:', pattern: /localhost:/i },
  { label: 'ready', pattern: /\bready\b/i },
  { label: 'compiled', pattern: /\bcompiled\b/i },
  { label: 'started server', pattern: /started server/i },
  { label: 'vite', pattern: /\bvite\b/i }
]

const fatalSignals: CommandSignal[] = [
  { label: 'Error:', pattern: /Error:/ },
  { label: 'EADDRINUSE', pattern: /EADDRINUSE/i },
  { label: 'Cannot find module', pattern: /Cannot find module/i },
  { label: 'command not found', pattern: /command not found/i },
  { label: 'failed', pattern: /\bfailed\b/i },
  { label: 'permission denied', pattern: /permission denied/i }
]

const recentActivityTypes: RecentActivityType[] = [
  'project-run',
  'open-folder',
  'open-url',
  'open-powershell',
  'dev-tools',
  'project-details'
]

const projectStorePath = (): string => join(app.getPath('userData'), PROJECTS_FILE)

const activityStorePath = (): string => join(app.getPath('userData'), ACTIVITIES_FILE)

const settingsStorePath = (): string => join(app.getPath('userData'), SETTINGS_FILE)

const legacyProjectStorePath = (): string => join(app.getPath('appData'), APP_LEGACY_NAME, PROJECTS_FILE)

const appIconPath = (): string => (app.isPackaged ? PACKAGED_APP_ICON_PATH : DEV_APP_ICON_PATH)

const migrateLegacyProjectStore = (): void => {
  const storePath = projectStorePath()
  const legacyStorePath = legacyProjectStorePath()

  if (storePath === legacyStorePath || existsSync(storePath) || !existsSync(legacyStorePath)) return

  mkdirSync(dirname(storePath), { recursive: true })
  writeFileSync(storePath, readFileSync(legacyStorePath, 'utf8'), 'utf8')
}

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID)
}

const broadcastRunEvent = (event: ProjectRunEvent): void => {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('projects:run-event', event)
  })
}

const setProjectStatus = (projectId: string, status: ProjectRunStatus): void => {
  projectStatuses.set(projectId, status)
  broadcastRunEvent({ projectId, status })
}

const appendProjectLog = (projectId: string, level: ProjectLogLevel, rawMessage: string): void => {
  const message = rawMessage.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd()
  if (!message.trim()) return

  const log: ProjectLogEntry = {
    id: `${Date.now()}-${++logSequence}`,
    projectId,
    level,
    message: message.length > 12000 ? `${message.slice(0, 12000)}\n[output truncated]` : message,
    createdAt: new Date().toISOString()
  }

  const logs = [...(projectLogs.get(projectId) ?? []), log].slice(-MAX_PROJECT_LOGS)
  projectLogs.set(projectId, logs)
  broadcastRunEvent({ projectId, log })
}

const getProjectRunState = (): ProjectRunState => {
  const statuses = readProjects().reduce<Record<string, ProjectRunStatus>>((accumulator, project) => {
    accumulator[project.id] = projectStatuses.get(project.id) ?? 'Stopped'
    return accumulator
  }, {})

  return {
    statuses,
    logs: Object.fromEntries(projectLogs)
  }
}

const createWindow = (): void => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    return
  }

  const browserWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1080,
    minHeight: 720,
    title: APP_NAME,
    icon: appIconPath(),
    backgroundColor: '#08111f',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  mainWindow = browserWindow

  browserWindow.on('ready-to-show', () => {
    browserWindow.show()
  })

  browserWindow.on('close', (event) => {
    if (isQuitting) return

    event.preventDefault()
    browserWindow.hide()
  })

  browserWindow.on('minimize', () => {
    if (isQuitting) return

    browserWindow.hide()
  })

  browserWindow.on('closed', () => {
    if (mainWindow === browserWindow) mainWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    browserWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    browserWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const showMainWindow = (): void => {
  createWindow()

  if (!mainWindow || mainWindow.isDestroyed()) return

  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

const createTray = (): void => {
  if (tray) return

  tray = new Tray(appIconPath())
  tray.setToolTip(APP_NAME)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open ${APP_NAME}`, click: showMainWindow },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', showMainWindow)
}

const normalizeProject = (input: unknown): Project | null => {
  if (!input || typeof input !== 'object') return null

  const candidate = input as Partial<Project>
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
  const path = typeof candidate.path === 'string' ? candidate.path.trim() : ''
  const url = typeof candidate.url === 'string' ? candidate.url.trim() : ''
  const legacyRunCommand = typeof candidate.runCommand === 'string' ? candidate.runCommand.trim() : ''
  const taskProfileMigration = normalizeProjectTaskProfiles(candidate.taskProfiles, legacyRunCommand)
  const runCommand = legacyRunCommand || taskProfileMigration.taskProfiles[0]?.command || ''
  const icon = normalizeProjectIcon(candidate.icon).icon
  const notes = typeof candidate.notes === 'string' ? candidate.notes : ''
  const isFavorite = candidate.isFavorite === true
  const launchCount =
    typeof candidate.launchCount === 'number' && Number.isFinite(candidate.launchCount) && candidate.launchCount > 0
      ? Math.floor(candidate.launchCount)
      : 0
  const lastLaunchedAt =
    typeof candidate.lastLaunchedAt === 'string' && !Number.isNaN(Date.parse(candidate.lastLaunchedAt))
      ? candidate.lastLaunchedAt
      : null
  const lastOpenedAt =
    typeof candidate.lastOpenedAt === 'string' && !Number.isNaN(Date.parse(candidate.lastOpenedAt))
      ? candidate.lastOpenedAt
      : null
  const workSessions = normalizeProjectWorkSessions(candidate.workSessions).workSessions
  const publishHistory = normalizeProjectPublishHistory(candidate.publishHistory).publishHistory
  const type = candidate.type

  if (!id || !name || !path || !runCommand || taskProfileMigration.taskProfiles.length === 0 || !isProjectType(type)) {
    return null
  }

  return {
    id,
    name,
    path,
    url,
    runCommand,
    taskProfiles: taskProfileMigration.taskProfiles,
    icon,
    notes,
    isFavorite,
    launchCount,
    lastLaunchedAt,
    lastOpenedAt,
    workSessions,
    publishHistory,
    type
  }
}

const readProjects = (): Project[] => {
  migrateLegacyProjectStore()

  const storePath = projectStorePath()

  if (!existsSync(storePath)) {
    writeProjects(DEFAULT_PROJECTS)
    return DEFAULT_PROJECTS
  }

  try {
    const parsed = JSON.parse(readFileSync(storePath, 'utf8')) as unknown
    if (!Array.isArray(parsed)) return DEFAULT_PROJECTS

    const projects = parsed.map(normalizeProject).filter((project): project is Project => Boolean(project))
    const safeProjects = projects.length > 0 ? projects : DEFAULT_PROJECTS
    const migration = migrateProjects(safeProjects)

    if (migration.changed) {
      writeProjects(migration.projects)
    }

    return migration.projects
  } catch {
    return DEFAULT_PROJECTS
  }
}

const writeProjects = (projects: Project[]): void => {
  const storePath = projectStorePath()
  mkdirSync(dirname(storePath), { recursive: true })
  writeFileSync(storePath, `${JSON.stringify(projects, null, 2)}\n`, 'utf8')
}

const readSettings = (): BuilderSettings => {
  const storePath = settingsStorePath()

  if (!existsSync(storePath)) {
    writeSettings(DEFAULT_BUILDER_SETTINGS)
    return DEFAULT_BUILDER_SETTINGS
  }

  try {
    const parsed = JSON.parse(readFileSync(storePath, 'utf8')) as unknown
    const migration = normalizeBuilderSettings(parsed)

    if (migration.changed) {
      writeSettings(migration.settings)
    }

    return migration.settings
  } catch {
    writeSettings(DEFAULT_BUILDER_SETTINGS)
    return DEFAULT_BUILDER_SETTINGS
  }
}

const writeSettings = (settings: BuilderSettings): void => {
  const storePath = settingsStorePath()
  mkdirSync(dirname(storePath), { recursive: true })
  writeFileSync(storePath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}

const saveSettings = (input: unknown): BuilderDataActionResult => {
  const migration = normalizeBuilderSettings(input)
  writeSettings(migration.settings)

  return {
    ok: true,
    message: 'Settings saved.',
    settings: migration.settings
  }
}

const isRecentActivityType = (value: unknown): value is RecentActivityType => {
  return typeof value === 'string' && recentActivityTypes.includes(value as RecentActivityType)
}

const cleanActivityText = (value: unknown, maxLength: number): string => {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

const normalizeRecentActivity = (input: unknown): RecentActivity | null => {
  if (!input || typeof input !== 'object') return null

  const candidate = input as Partial<RecentActivity>
  const id = cleanActivityText(candidate.id, 80)
  const type = candidate.type
  const projectId = cleanActivityText(candidate.projectId, 120)
  const projectName = cleanActivityText(candidate.projectName, 160)
  const message = cleanActivityText(candidate.message, 240)
  const createdAt = cleanActivityText(candidate.createdAt, 80)

  if (!id || !isRecentActivityType(type) || !projectId || !projectName || !message || Number.isNaN(Date.parse(createdAt))) {
    return null
  }

  return { id, type, projectId, projectName, message, createdAt }
}

const normalizeRecentActivityInput = (input: unknown): RecentActivityInput | null => {
  if (!input || typeof input !== 'object') return null

  const candidate = input as Partial<RecentActivityInput>
  const type = candidate.type
  const projectId = cleanActivityText(candidate.projectId, 120)
  const projectName = cleanActivityText(candidate.projectName, 160)
  const message = cleanActivityText(candidate.message, 240)

  if (!isRecentActivityType(type) || !projectId || !projectName || !message) return null

  return { type, projectId, projectName, message }
}

const writeRecentActivities = (activities: RecentActivity[]): void => {
  const storePath = activityStorePath()
  mkdirSync(dirname(storePath), { recursive: true })
  writeFileSync(storePath, `${JSON.stringify(activities.slice(0, MAX_RECENT_ACTIVITIES), null, 2)}\n`, 'utf8')
}

const readRecentActivities = (): RecentActivity[] => {
  const storePath = activityStorePath()
  if (!existsSync(storePath)) return []

  try {
    const parsed = JSON.parse(readFileSync(storePath, 'utf8')) as unknown
    if (!Array.isArray(parsed)) return []

    const activities = parsed
      .map(normalizeRecentActivity)
      .filter((activity): activity is RecentActivity => Boolean(activity))
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, MAX_RECENT_ACTIVITIES)

    if (activities.length !== parsed.length || parsed.length > MAX_RECENT_ACTIVITIES) {
      writeRecentActivities(activities)
    }

    return activities
  } catch {
    return []
  }
}

const recordRecentActivity = (input: unknown): RecentActivity[] => {
  const activityInput = normalizeRecentActivityInput(input)
  if (!activityInput) return readRecentActivities()

  const activity: RecentActivity = {
    id: `${Date.now()}-${++activitySequence}`,
    ...activityInput,
    createdAt: new Date().toISOString()
  }

  const activities = [activity, ...readRecentActivities()].slice(0, MAX_RECENT_ACTIVITIES)
  writeRecentActivities(activities)
  return activities
}

const activeDialogWindow = (): BrowserWindow | undefined => {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
}

const backupTimestamp = (): string => {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

const exportBuilderData = async (): Promise<BuilderDataActionResult> => {
  const options: SaveDialogOptions = {
    title: 'Export BuilderOS Data',
    defaultPath: join(app.getPath('documents'), `BuilderOS-backup-${backupTimestamp()}.json`),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }
  const ownerWindow = activeDialogWindow()
  const result = ownerWindow ? await dialog.showSaveDialog(ownerWindow, options) : await dialog.showSaveDialog(options)

  if (result.canceled || !result.filePath) {
    return { ok: false, message: 'Export canceled.' }
  }

  const data: BuilderDataExport = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    appName: APP_NAME,
    appVersion: APP_VERSION,
    settings: readSettings(),
    projects: readProjects(),
    recentActivities: readRecentActivities()
  }

  writeFileSync(result.filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')

  return {
    ok: true,
    message: `Data exported to ${result.filePath}`,
    path: result.filePath
  }
}

const importBuilderData = async (): Promise<BuilderDataActionResult> => {
  const options: OpenDialogOptions = {
    title: 'Import BuilderOS Data',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }
  const ownerWindow = activeDialogWindow()
  const result = ownerWindow ? await dialog.showOpenDialog(ownerWindow, options) : await dialog.showOpenDialog(options)

  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, message: 'Import canceled.' }
  }

  try {
    const parsed = JSON.parse(readFileSync(result.filePaths[0], 'utf8')) as Partial<BuilderDataExport>
    const rawProjects = Array.isArray(parsed.projects) ? parsed.projects : null

    if (!rawProjects) {
      return { ok: false, message: 'Import file does not contain projects.' }
    }

    const projects = rawProjects.map(normalizeProject)

    if (projects.some((project) => !project)) {
      return { ok: false, message: 'Import file contains invalid project data.' }
    }

    const projectMigration = migrateProjects(projects as Project[])
    const settingsMigration = normalizeBuilderSettings(parsed.settings)
    const recentActivities = Array.isArray(parsed.recentActivities)
      ? parsed.recentActivities
          .map(normalizeRecentActivity)
          .filter((activity): activity is RecentActivity => Boolean(activity))
          .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
          .slice(0, MAX_RECENT_ACTIVITIES)
      : []

    writeProjects(projectMigration.projects)
    writeSettings(settingsMigration.settings)
    writeRecentActivities(recentActivities)

    return {
      ok: true,
      message: `Data imported from ${result.filePaths[0]}`,
      path: result.filePaths[0],
      settings: settingsMigration.settings,
      projects: projectMigration.projects,
      recentActivities
    }
  } catch {
    return { ok: false, message: 'Import failed. Check that the file is valid JSON.' }
  }
}

const resetBuilderData = (): BuilderDataActionResult => {
  writeProjects(DEFAULT_PROJECTS)
  writeSettings(DEFAULT_BUILDER_SETTINGS)
  writeRecentActivities([])
  projectStatuses.clear()
  projectLogs.clear()

  return {
    ok: true,
    message: 'BuilderOS data reset.',
    settings: DEFAULT_BUILDER_SETTINGS,
    projects: DEFAULT_PROJECTS,
    recentActivities: []
  }
}

const ensureDirectory = (targetPath: string): DesktopActionResult => {
  if (!targetPath.trim()) {
    return { ok: false, message: 'Project path is empty.' }
  }

  if (!existsSync(targetPath)) {
    return { ok: false, message: `Folder does not exist: ${targetPath}` }
  }

  try {
    return statSync(targetPath).isDirectory()
      ? { ok: true }
      : { ok: false, message: `Path is not a folder: ${targetPath}` }
  } catch {
    return { ok: false, message: `Folder cannot be read: ${targetPath}` }
  }
}

const dangerousCommandReason = (command: string): string | null => {
  const normalized = command.toLowerCase()

  if (normalized.includes('delete')) return 'delete'
  if (normalized.includes('remove-item')) return 'Remove-Item'
  if (/\brm\b/.test(normalized)) return 'rm'
  if (/\brd\s+\/s\b/.test(normalized)) return 'rd /s'
  if (normalized.includes('rmdir')) return 'rmdir'
  if (/\berase\b/.test(normalized)) return 'erase'
  if (normalized.includes('format')) return 'format'
  if (/\bdel\s+\/s\b/.test(normalized)) return 'del /s'
  if (/\bgit\s+reset\b.*\s--hard\b/.test(normalized)) return 'git reset --hard'
  if (/\bgit\s+clean\b/.test(normalized)) return 'git clean'
  if (/\bshutdown\b/.test(normalized)) return 'shutdown'
  if (normalized.includes('restart-computer')) return 'Restart-Computer'
  if (normalized.includes('stop-computer')) return 'Stop-Computer'

  return null
}

const findSignal = (signals: CommandSignal[], output: string): string | null => {
  return signals.find((signal) => signal.pattern.test(output))?.label ?? null
}

const isProjectUrlReachable = (targetUrl: string): Promise<boolean> => {
  return new Promise((resolve) => {
    let settled = false

    const settle = (reachable: boolean): void => {
      if (settled) return
      settled = true
      resolve(reachable)
    }

    try {
      const url = new URL(targetUrl)
      if (!['http:', 'https:'].includes(url.protocol)) {
        settle(false)
        return
      }

      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
        url,
        {
          method: 'GET',
          timeout: URL_REACHABILITY_TIMEOUT_MS
        },
        (response) => {
          response.resume()
          settle(true)
        }
      )

      request.on('timeout', () => {
        request.destroy()
        settle(false)
      })
      request.on('error', () => settle(false))
      request.end()
    } catch {
      settle(false)
    }
  })
}

const escapePowerShellSingleQuoted = (value: string): string => value.replace(/'/g, "''")

const hasControlCharacters = (value: string): boolean => {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
}

const compactOutput = (value: string): string => {
  const cleaned = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()

  if (cleaned.length <= MAX_DESKTOP_ACTION_OUTPUT) return cleaned

  return `${cleaned.slice(0, MAX_DESKTOP_ACTION_OUTPUT)}\n[output truncated]`
}

const runFixedCommand = (
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = GIT_ACTION_TIMEOUT_MS
): Promise<CommandResult> => {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const child = spawn(command, args, {
      cwd,
      windowsHide: true
    })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) return

      settled = true
      clearTimeout(timer)
      resolve({
        command: [command, ...args].join(' '),
        code: null,
        stdout: '',
        stderr: error.message,
        errorCode: error.code,
        timedOut
      })
    })

    child.on('close', (code) => {
      if (settled) return

      settled = true
      clearTimeout(timer)
      resolve({
        command: [command, ...args].join(' '),
        code,
        stdout: compactOutput(stdout),
        stderr: compactOutput(stderr),
        timedOut
      })
    })
  })
}

const commandBlock = (label: string, result: CommandResult): string => {
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
  const exitLine = result.code === 0 || result.code === null ? '' : `\n(exit code ${result.code})`

  return [`$ ${label}`, output || '(no output)', exitLine].filter(Boolean).join('\n')
}

const isGitMissing = (result: CommandResult): boolean => result.errorCode === 'ENOENT'

const isNotGitRepository = (result: CommandResult): boolean =>
  /not a git repository/i.test(result.stderr) || /not a git repository/i.test(result.stdout)

const isGitRepositoryWithoutCommits = (result: CommandResult): boolean =>
  /does not have any commits|bad default revision|unknown revision/i.test(`${result.stdout}\n${result.stderr}`)

const gitActionError = (result: CommandResult): string => {
  if (isGitMissing(result)) return 'Git is not installed or is not available in PATH.'
  if (isNotGitRepository(result)) return 'This folder is not a Git repository.'
  if (result.timedOut) return 'Git command timed out.'

  return result.stderr || result.stdout || 'Git command failed.'
}

const launchDetached = (command: string, args: string[], cwd: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    let settled = false

    try {
      const child = spawn(command, args, {
        cwd,
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      })

      child.once('spawn', () => {
        settled = true
        child.unref()
        resolve()
      })

      child.once('error', (error) => {
        if (settled) return

        settled = true
        reject(error)
      })
    } catch (error) {
      reject(error)
    }
  })
}

const openPowerShellAt = (targetPath: string): DesktopActionResult => {
  const directoryCheck = ensureDirectory(targetPath)
  if (!directoryCheck.ok) return directoryCheck

  const command = `Set-Location -LiteralPath '${escapePowerShellSingleQuoted(targetPath)}'`
  const encodedCommand = Buffer.from(command, 'utf16le').toString('base64')
  const child = spawn(
    'cmd.exe',
    ['/c', 'start', '""', 'powershell.exe', '-NoExit', '-NoLogo', '-EncodedCommand', encodedCommand],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }
  )

  child.unref()
  return { ok: true, message: 'PowerShell opened.' }
}

const openTerminalAt = async (targetPath: string): Promise<DesktopActionResult> => {
  const directoryCheck = ensureDirectory(targetPath)
  if (!directoryCheck.ok) return directoryCheck

  try {
    await launchDetached('wt.exe', ['-d', targetPath], targetPath)
    return { ok: true, message: 'Terminal opened.' }
  } catch {
    const fallback = openPowerShellAt(targetPath)
    return fallback.ok ? { ok: true, message: 'PowerShell opened because Windows Terminal was not available.' } : fallback
  }
}

const findSavedProject = (projectId: string): Project | null => {
  return readProjects().find((project) => project.id === projectId) ?? null
}

const getProjectOrFail = (projectId: string): Project | DesktopActionResult => {
  const project = findSavedProject(projectId)
  return project ?? { ok: false, message: 'Saved project was not found.' }
}

const notGitRepositorySummary = (): ProjectGitSummary => ({
  ok: true,
  isGitRepository: false,
  branch: '',
  latestCommit: '',
  workingTreeStatus: '',
  message: 'Not a git repository'
})

const gitSummaryFailure = (message: string): ProjectGitSummary => ({
  ok: false,
  isGitRepository: false,
  branch: '',
  latestCommit: '',
  workingTreeStatus: '',
  message
})

const readProjectGitSummary = async (projectId: string): Promise<ProjectGitSummary> => {
  const project = getProjectOrFail(projectId)
  if ('ok' in project) return gitSummaryFailure(project.message ?? 'Saved project was not found.')

  const directoryCheck = ensureDirectory(project.path)
  if (!directoryCheck.ok) return gitSummaryFailure(directoryCheck.message ?? 'Project folder is not available.')

  const branch = await runFixedCommand('git', ['branch', '--show-current'], project.path)
  if (branch.code !== 0) {
    if (isNotGitRepository(branch)) return notGitRepositorySummary()
    return gitSummaryFailure(gitActionError(branch))
  }

  const log = await runFixedCommand('git', ['log', '--oneline', '-1'], project.path)
  if (isNotGitRepository(log)) return notGitRepositorySummary()
  if (log.code !== 0 && !isGitRepositoryWithoutCommits(log)) return gitSummaryFailure(gitActionError(log))

  const status = await runFixedCommand('git', ['status', '--short'], project.path)
  if (status.code !== 0) {
    if (isNotGitRepository(status)) return notGitRepositorySummary()
    return gitSummaryFailure(gitActionError(status))
  }

  return {
    ok: true,
    isGitRepository: true,
    branch: branch.stdout || 'Detached HEAD',
    latestCommit: log.code === 0 && log.stdout ? log.stdout : 'No commits found.',
    workingTreeStatus: status.stdout || 'Clean'
  }
}

const latestCommitAndShortStatus = async (
  project: Project
): Promise<GitContextResult> => {
  const directoryCheck = ensureDirectory(project.path)
  if (!directoryCheck.ok) {
    return {
      ok: false,
      message: directoryCheck.message,
      output: directoryCheck.output
    }
  }

  const status = await runFixedCommand('git', ['status', '--short'], project.path)

  if (status.code !== 0) {
    const message = gitActionError(status)

    if (isGitMissing(status) || isNotGitRepository(status)) {
      return {
        ok: true,
        latestCommit: message,
        gitStatus: message
      }
    }

    return {
      ok: false,
      message,
      output: commandBlock('git status --short', status)
    }
  }

  const log = await runFixedCommand('git', ['log', '--oneline', '-1'], project.path)

  return {
    ok: true,
    latestCommit: log.code === 0 ? log.stdout : isGitMissing(log) ? 'Git is not available.' : 'No commits found.',
    gitStatus: status.stdout || 'Clean working tree'
  }
}

const formatTaskProfilesForSummary = (project: Project): string => {
  return project.taskProfiles.map((profile) => `${profile.name}: ${profile.command}`).join('\n')
}

const buildStatusSummary = (project: Project, latestCommit: string, gitStatus: string): string => {
  return [
    'Project:',
    project.name,
    'Path:',
    project.path,
    'URL:',
    project.url || '-',
    'Task profiles:',
    formatTaskProfilesForSummary(project),
    'Latest commit:',
    latestCommit || '-',
    'Git status:',
    gitStatus || 'Clean working tree'
  ].join('\n')
}

const buildChatGptContext = (project: Project, latestCommit: string, gitStatus: string): string => {
  return [
    'Project:',
    project.name,
    'Path:',
    project.path,
    'URL:',
    project.url || '-',
    'Task profiles:',
    formatTaskProfilesForSummary(project),
    'Latest commit:',
    latestCommit || '-',
    'Git status:',
    gitStatus || 'Clean working tree',
    '',
    'Current issue:',
    '',
    '',
    'What I need help with:',
    ''
  ].join('\n')
}

const copyProjectStatusSummary = async (projectId: string): Promise<DesktopActionResult> => {
  const project = getProjectOrFail(projectId)
  if ('ok' in project) return project

  const gitContext = await latestCommitAndShortStatus(project)
  if (!gitContext.ok) return gitContext

  const summary = buildStatusSummary(project, gitContext.latestCommit, gitContext.gitStatus)
  clipboard.writeText(summary)

  return { ok: true, message: 'Status copied.', output: summary }
}

const copyProjectChatGptContext = async (projectId: string): Promise<DesktopActionResult> => {
  const project = getProjectOrFail(projectId)
  if ('ok' in project) return project

  const gitContext = await latestCommitAndShortStatus(project)
  if (!gitContext.ok) return gitContext

  const summary = buildChatGptContext(project, gitContext.latestCommit, gitContext.gitStatus)
  clipboard.writeText(summary)

  return { ok: true, message: 'ChatGPT context copied.', output: summary }
}

const validateCommitMessage = (message: string): DesktopActionResult => {
  if (!message.trim()) return { ok: false, message: 'Commit message is required.' }
  if (message.length > 200) return { ok: false, message: 'Commit message must be 200 characters or fewer.' }
  if (hasControlCharacters(message)) {
    return { ok: false, message: 'Commit message cannot contain control characters or line breaks.' }
  }

  return { ok: true }
}

const commitProject = async (projectId: string, rawMessage: string): Promise<DesktopActionResult> => {
  const project = getProjectOrFail(projectId)
  if ('ok' in project) return project

  const directoryCheck = ensureDirectory(project.path)
  if (!directoryCheck.ok) return directoryCheck

  const commitMessage = String(rawMessage ?? '').trim()
  const messageCheck = validateCommitMessage(commitMessage)
  if (!messageCheck.ok) return messageCheck

  const status = await runFixedCommand('git', ['status'], project.path)

  if (status.code !== 0) {
    return {
      ok: false,
      message: gitActionError(status),
      output: commandBlock('git status', status)
    }
  }

  const add = await runFixedCommand('git', ['add', '.'], project.path)

  if (add.code !== 0) {
    return {
      ok: false,
      message: gitActionError(add),
      output: [commandBlock('git status', status), commandBlock('git add .', add)].join('\n\n')
    }
  }

  const commit = await runFixedCommand('git', ['commit', '-m', commitMessage], project.path)
  const log = await runFixedCommand('git', ['log', '--oneline', '-1'], project.path)
  const output = [
    commandBlock('git status', status),
    commandBlock('git add .', add),
    commandBlock(`git commit -m "${commitMessage}"`, commit),
    commandBlock('git log --oneline -1', log)
  ].join('\n\n')

  if (commit.code !== 0) {
    const noChanges = /nothing to commit|no changes added/i.test(`${commit.stdout}\n${commit.stderr}`)
    return { ok: false, message: noChanges ? 'No changes to commit.' : gitActionError(commit), output }
  }

  return { ok: true, message: 'Commit completed.', output }
}

const publishProject = async (projectId: string): Promise<DesktopActionResult> => {
  const project = getProjectOrFail(projectId)
  if ('ok' in project) return project

  const directoryCheck = ensureDirectory(project.path)
  if (!directoryCheck.ok) return directoryCheck

  const commitMessage = `Publish ${new Date().toISOString()}`
  const outputBlocks: string[] = []

  const runPublishStep = async (label: string, args: string[], timeoutMs = GIT_ACTION_TIMEOUT_MS): Promise<CommandResult> => {
    const result = await runFixedCommand('git', args, project.path, timeoutMs)
    outputBlocks.push(commandBlock(label, result))
    return result
  }

  const status = await runPublishStep('git status', ['status'])
  if (status.code !== 0) {
    return {
      ok: false,
      message: gitActionError(status),
      output: compactOutput(outputBlocks.join('\n\n'))
    }
  }

  const add = await runPublishStep('git add .', ['add', '.'])
  if (add.code !== 0) {
    return {
      ok: false,
      message: gitActionError(add),
      output: compactOutput(outputBlocks.join('\n\n'))
    }
  }

  const commit = await runPublishStep(`git commit -m "${commitMessage}"`, ['commit', '-m', commitMessage])
  if (commit.code !== 0) {
    const noChanges = /nothing to commit|no changes added/i.test(`${commit.stdout}\n${commit.stderr}`)
    return {
      ok: false,
      message: noChanges ? 'No changes to commit.' : gitActionError(commit),
      output: compactOutput(outputBlocks.join('\n\n'))
    }
  }

  const push = await runPublishStep('git push', ['push'], GIT_ACTION_TIMEOUT_MS * 2)
  if (push.code !== 0) {
    return {
      ok: false,
      message: gitActionError(push),
      output: compactOutput(outputBlocks.join('\n\n'))
    }
  }

  return {
    ok: true,
    message: 'Publish completed.',
    output: compactOutput(outputBlocks.join('\n\n'))
  }
}

const openCodexForProject = async (projectId: string): Promise<DesktopActionResult> => {
  const project = getProjectOrFail(projectId)
  if ('ok' in project) return project

  const directoryCheck = ensureDirectory(project.path)
  if (!directoryCheck.ok) return directoryCheck

  try {
    await launchDetached('wt.exe', ['-d', project.path, 'powershell.exe', '-NoExit', '-Command', 'codex'], project.path)
    return { ok: true, message: 'Codex terminal opened.' }
  } catch {
    try {
      await launchDetached('powershell.exe', ['-NoExit', '-NoLogo', '-Command', 'codex'], project.path)
      return { ok: true, message: 'PowerShell opened and attempted to run codex.' }
    } catch {
      const fallback = openPowerShellAt(project.path)
      return fallback.ok
        ? { ok: true, message: 'PowerShell opened. Run this command: codex', output: 'codex' }
        : fallback
    }
  }
}

const failProjectRun = (projectId: string, message: string): DesktopActionResult => {
  setProjectStatus(projectId, 'Error')
  appendProjectLog(projectId, 'error', `fatal error detected: ${message}`)
  return { ok: false, message }
}

const markProjectAlreadyReachable = (project: Project, running?: RunningProject): DesktopActionResult => {
  if (running) running.alreadyReachable = true

  setProjectStatus(project.id, 'Running')
  appendProjectLog(project.id, 'info', 'Project is already reachable. Marked as running.')
  broadcastRunEvent({
    projectId: project.id,
    message: 'This project already seems to be running.'
  })

  return { ok: true, message: 'This project already seems to be running.' }
}

const reconcileReachableProjectAfterFatal = async (project: Project, running: RunningProject): Promise<void> => {
  if (!running.fatalDetected || running.alreadyReachable) return

  const reachable = await isProjectUrlReachable(project.url)
  if (!reachable) return

  markProjectAlreadyReachable(project, running)
}

const inspectProjectOutput = (project: Project, running: RunningProject, output: string): void => {
  const fatalSignal = findSignal(fatalSignals, output)
  if (fatalSignal && !running.fatalDetected) {
    running.fatalDetected = true
    running.fatalSignal = fatalSignal
    appendProjectLog(project.id, 'error', `fatal error detected: ${fatalSignal}`)
    void reconcileReachableProjectAfterFatal(project, running)
    return
  }

  const successSignal = findSignal(successSignals, output)
  if (successSignal && !running.successDetected) {
    running.successDetected = true
    if (!running.fatalDetected) setProjectStatus(project.id, 'Running')
    appendProjectLog(project.id, 'info', `success signal detected: ${successSignal}`)
    appendProjectLog(project.id, 'info', 'process running')
  }
}

const resolveTaskProfile = (project: Project, taskProfileId?: string): ProjectTaskProfile | null => {
  if (!taskProfileId) return project.taskProfiles[0] ?? null

  return project.taskProfiles.find((profile) => profile.id === taskProfileId) ?? null
}

const startProjectRun = async (projectId: string, taskProfileId?: string): Promise<DesktopActionResult> => {
  const project = findSavedProject(projectId)
  if (!project) return failProjectRun(projectId, 'Saved project was not found.')
  const taskProfile = resolveTaskProfile(project, taskProfileId)
  if (!taskProfile) return failProjectRun(project.id, 'Task profile was not found.')

  if (runningProjects.has(project.id)) {
    if (await isProjectUrlReachable(project.url)) {
      return markProjectAlreadyReachable(project, runningProjects.get(project.id))
    }

    setProjectStatus(project.id, 'Running')
    return { ok: true, message: 'This project already seems to be running.' }
  }

  const directoryCheck = ensureDirectory(project.path)
  if (!directoryCheck.ok) return failProjectRun(project.id, directoryCheck.message ?? 'Project folder is not available.')

  const blockedCommand = dangerousCommandReason(taskProfile.command)
  if (blockedCommand) {
    return failProjectRun(project.id, `Blocked dangerous command token: ${blockedCommand}`)
  }

  if (await isProjectUrlReachable(project.url)) {
    return markProjectAlreadyReachable(project)
  }

  appendProjectLog(project.id, 'info', `task started: ${taskProfile.name}`)
  appendProjectLog(project.id, 'info', `command started: ${taskProfile.command}`)
  setProjectStatus(project.id, 'Running')

  try {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', taskProfile.command], {
      cwd: project.path,
      windowsHide: true
    })

    const running: RunningProject = {
      child,
      alreadyReachable: false,
      completed: false,
      fatalDetected: false,
      startedAt: Date.now(),
      stopping: false,
      successDetected: false
    }

    runningProjects.set(project.id, running)
    appendProjectLog(project.id, 'info', 'process running')

    child.stdout.on('data', (chunk: Buffer) => {
      const output = chunk.toString('utf8')
      appendProjectLog(project.id, 'output', output)
      inspectProjectOutput(project, running, output)
    })

    child.stderr.on('data', (chunk: Buffer) => {
      const output = chunk.toString('utf8')
      appendProjectLog(project.id, 'error', output)
      inspectProjectOutput(project, running, output)
    })

    child.on('error', async (error) => {
      if (running.completed) return
      running.completed = true
      running.fatalDetected = true
      running.fatalSignal = error.message
      runningProjects.delete(project.id)
      appendProjectLog(project.id, 'error', `fatal error detected: ${error.message}`)

      if (await isProjectUrlReachable(project.url)) {
        markProjectAlreadyReachable(project, running)
        return
      }

      setProjectStatus(project.id, 'Error')
    })

    child.on('close', async (code, signal) => {
      if (running.completed) return
      running.completed = true
      runningProjects.delete(project.id)

      if (running.stopping || code === 0) {
        setProjectStatus(project.id, 'Stopped')
        appendProjectLog(project.id, 'info', 'process stopped')
        return
      }

      if (running.alreadyReachable) {
        setProjectStatus(project.id, 'Running')
        appendProjectLog(project.id, 'info', 'process stopped')
        return
      }

      if (running.fatalDetected && (await isProjectUrlReachable(project.url))) {
        markProjectAlreadyReachable(project, running)
        appendProjectLog(project.id, 'info', 'process stopped')
        return
      }

      if (running.fatalDetected) {
        setProjectStatus(project.id, 'Error')
        appendProjectLog(project.id, 'info', 'process stopped')
        return
      }

      const elapsedMs = Date.now() - running.startedAt
      const exitSummary = `process exited with code ${code ?? 'unknown'}${signal ? ` and signal ${signal}` : ''}`

      if (code !== null && code !== 0 && elapsedMs < QUICK_EXIT_MS && (await isProjectUrlReachable(project.url))) {
        markProjectAlreadyReachable(project, running)
        appendProjectLog(project.id, 'info', 'process stopped')
        return
      }

      setProjectStatus(project.id, 'Stopped')
      appendProjectLog(project.id, 'info', `process stopped: ${exitSummary}`)
    })

    return { ok: true, message: `${project.name}: ${taskProfile.name} started.` }
  } catch (error) {
    runningProjects.delete(project.id)
    return failProjectRun(project.id, error instanceof Error ? error.message : 'Project failed to start.')
  }
}

const killProcessTree = (pid: number): Promise<void> => {
  return new Promise((resolve) => {
    const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore'
    })

    killer.on('error', () => resolve())
    killer.on('close', () => resolve())
  })
}

const stopProjectRun = async (projectId: string): Promise<DesktopActionResult> => {
  const running = runningProjects.get(projectId)
  if (!running) return { ok: false, message: 'Project is not running.' }

  running.stopping = true

  if (running.child.pid) {
    await killProcessTree(running.child.pid)
  }

  if (!running.child.killed) {
    running.child.kill()
  }

  return { ok: true, message: 'Stop signal sent.' }
}

ipcMain.handle('projects:list', () => readProjects())

ipcMain.handle('activities:list', () => readRecentActivities())

ipcMain.handle('activities:record', (_event, activity: unknown) => recordRecentActivity(activity))

ipcMain.handle('settings:get', () => readSettings())

ipcMain.handle('settings:save', (_event, settings: unknown) => saveSettings(settings))

ipcMain.handle('data:export', () => exportBuilderData())

ipcMain.handle('data:import', () => importBuilderData())

ipcMain.handle('data:reset', () => resetBuilderData())

ipcMain.handle('projects:save', (_event, rawProjects: unknown): DesktopActionResult => {
  if (!Array.isArray(rawProjects)) {
    return { ok: false, message: 'Project payload must be an array.' }
  }

  const projects = rawProjects.map(normalizeProject)

  if (projects.some((project) => !project)) {
    return { ok: false, message: 'One or more projects are missing required fields.' }
  }

  writeProjects(projects as Project[])
  return { ok: true, message: 'Projects saved.' }
})

ipcMain.handle('desktop:open-folder', async (_event, targetPath: string): Promise<DesktopActionResult> => {
  const directoryCheck = ensureDirectory(targetPath)
  if (!directoryCheck.ok) return directoryCheck

  const errorMessage = await shell.openPath(targetPath)
  return errorMessage ? { ok: false, message: errorMessage } : { ok: true, message: 'Folder opened.' }
})

ipcMain.handle('desktop:open-url', async (_event, targetUrl: string): Promise<DesktopActionResult> => {
  try {
    const url = new URL(targetUrl)
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { ok: false, message: 'Only http and https URLs can be opened.' }
    }

    await shell.openExternal(url.toString())
    return { ok: true, message: 'URL opened.' }
  } catch {
    return { ok: false, message: 'Invalid URL.' }
  }
})

ipcMain.handle('desktop:open-powershell', (_event, targetPath: string): DesktopActionResult => {
  return openPowerShellAt(targetPath)
})

ipcMain.handle('desktop:open-terminal', (_event, targetPath: string): Promise<DesktopActionResult> => {
  return openTerminalAt(targetPath)
})

ipcMain.handle('desktop:copy-text', (_event, text: string): DesktopActionResult => {
  clipboard.writeText(String(text ?? ''))
  return { ok: true, message: 'Copied to clipboard.' }
})

ipcMain.handle('projects:copy-status', (_event, projectId: unknown): Promise<DesktopActionResult> | DesktopActionResult => {
  return typeof projectId === 'string' ? copyProjectStatusSummary(projectId) : { ok: false, message: 'Project id is required.' }
})

ipcMain.handle('projects:git-summary', (_event, projectId: unknown): Promise<ProjectGitSummary> | ProjectGitSummary => {
  return typeof projectId === 'string'
    ? readProjectGitSummary(projectId)
    : gitSummaryFailure('Project id is required.')
})

ipcMain.handle(
  'projects:copy-chatgpt-context',
  (_event, projectId: unknown): Promise<DesktopActionResult> | DesktopActionResult => {
    return typeof projectId === 'string'
      ? copyProjectChatGptContext(projectId)
      : { ok: false, message: 'Project id is required.' }
  }
)

ipcMain.handle(
  'projects:commit',
  (_event, projectId: unknown, commitMessage: unknown): Promise<DesktopActionResult> | DesktopActionResult => {
    return typeof projectId === 'string' && typeof commitMessage === 'string'
      ? commitProject(projectId, commitMessage)
      : { ok: false, message: 'Project id and commit message are required.' }
  }
)

ipcMain.handle('projects:publish', (_event, projectId: unknown): Promise<DesktopActionResult> | DesktopActionResult => {
  return typeof projectId === 'string' ? publishProject(projectId) : { ok: false, message: 'Project id is required.' }
})

ipcMain.handle('projects:open-codex', (_event, projectId: unknown): Promise<DesktopActionResult> | DesktopActionResult => {
  return typeof projectId === 'string' ? openCodexForProject(projectId) : { ok: false, message: 'Project id is required.' }
})

ipcMain.handle('projects:run-state', () => getProjectRunState())

ipcMain.handle(
  'projects:run',
  (_event, projectId: unknown, taskProfileId?: unknown): Promise<DesktopActionResult> | DesktopActionResult => {
    if (typeof projectId !== 'string') return { ok: false, message: 'Project id is required.' }
    if (taskProfileId !== undefined && typeof taskProfileId !== 'string') {
      return { ok: false, message: 'Task profile id must be a string.' }
    }

    return startProjectRun(projectId, taskProfileId)
  }
)

ipcMain.handle('projects:stop', (_event, projectId: unknown): Promise<DesktopActionResult> | DesktopActionResult => {
  return typeof projectId === 'string' ? stopProjectRun(projectId) : { ok: false, message: 'Project id is required.' }
})

app.whenReady().then(() => {
  createWindow()
  createTray()

  app.on('activate', () => {
    showMainWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
})
