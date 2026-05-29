import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  DEFAULT_PROJECTS,
  DesktopActionResult,
  isProjectType,
  Project,
  ProjectLogEntry,
  ProjectLogLevel,
  ProjectRunEvent,
  ProjectRunState,
  ProjectRunStatus
} from '@shared/projects'

const PROJECTS_FILE = 'projects.json'
const MAX_PROJECT_LOGS = 400
const QUICK_EXIT_MS = 8000

type CommandSignal = {
  label: string
  pattern: RegExp
}

type RunningProject = {
  child: ChildProcessWithoutNullStreams
  stopping: boolean
  completed: boolean
  fatalDetected: boolean
  startedAt: number
  successDetected: boolean
}

const runningProjects = new Map<string, RunningProject>()
const projectStatuses = new Map<string, ProjectRunStatus>()
const projectLogs = new Map<string, ProjectLogEntry[]>()
let logSequence = 0

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

const projectStorePath = (): string => join(app.getPath('userData'), PROJECTS_FILE)

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
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1080,
    minHeight: 720,
    title: 'Dev Launch Pad',
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

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const normalizeProject = (input: unknown): Project | null => {
  if (!input || typeof input !== 'object') return null

  const candidate = input as Partial<Project>
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
  const path = typeof candidate.path === 'string' ? candidate.path.trim() : ''
  const url = typeof candidate.url === 'string' ? candidate.url.trim() : ''
  const runCommand = typeof candidate.runCommand === 'string' ? candidate.runCommand.trim() : ''
  const type = candidate.type

  if (!id || !name || !path || !runCommand || !isProjectType(type)) return null

  return { id, name, path, url, runCommand, type }
}

const readProjects = (): Project[] => {
  const storePath = projectStorePath()

  if (!existsSync(storePath)) {
    writeProjects(DEFAULT_PROJECTS)
    return DEFAULT_PROJECTS
  }

  try {
    const parsed = JSON.parse(readFileSync(storePath, 'utf8')) as unknown
    if (!Array.isArray(parsed)) return DEFAULT_PROJECTS

    const projects = parsed.map(normalizeProject).filter((project): project is Project => Boolean(project))
    return projects.length > 0 ? projects : DEFAULT_PROJECTS
  } catch {
    return DEFAULT_PROJECTS
  }
}

const writeProjects = (projects: Project[]): void => {
  const storePath = projectStorePath()
  mkdirSync(dirname(storePath), { recursive: true })
  writeFileSync(storePath, `${JSON.stringify(projects, null, 2)}\n`, 'utf8')
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
  if (/\brm\b/.test(normalized)) return 'rm'
  if (normalized.includes('rmdir')) return 'rmdir'
  if (normalized.includes('format')) return 'format'
  if (/\bdel\s+\/s\b/.test(normalized)) return 'del /s'

  return null
}

const findSignal = (signals: CommandSignal[], output: string): string | null => {
  return signals.find((signal) => signal.pattern.test(output))?.label ?? null
}

const escapePowerShellSingleQuoted = (value: string): string => value.replace(/'/g, "''")

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

const findSavedProject = (projectId: string): Project | null => {
  return readProjects().find((project) => project.id === projectId) ?? null
}

const failProjectRun = (projectId: string, message: string): DesktopActionResult => {
  setProjectStatus(projectId, 'Error')
  appendProjectLog(projectId, 'error', `fatal error detected: ${message}`)
  return { ok: false, message }
}

const inspectProjectOutput = (projectId: string, running: RunningProject, output: string): void => {
  const fatalSignal = findSignal(fatalSignals, output)
  if (fatalSignal && !running.fatalDetected) {
    running.fatalDetected = true
    setProjectStatus(projectId, 'Error')
    appendProjectLog(projectId, 'error', `fatal error detected: ${fatalSignal}`)
    return
  }

  const successSignal = findSignal(successSignals, output)
  if (successSignal && !running.successDetected) {
    running.successDetected = true
    if (!running.fatalDetected) setProjectStatus(projectId, 'Running')
    appendProjectLog(projectId, 'info', `success signal detected: ${successSignal}`)
    appendProjectLog(projectId, 'info', 'process running')
  }
}

const startProjectRun = (projectId: string): DesktopActionResult => {
  const project = findSavedProject(projectId)
  if (!project) return failProjectRun(projectId, 'Saved project was not found.')

  if (runningProjects.has(project.id)) {
    return { ok: false, message: `${project.name} is already running.` }
  }

  const directoryCheck = ensureDirectory(project.path)
  if (!directoryCheck.ok) return failProjectRun(project.id, directoryCheck.message ?? 'Project folder is not available.')

  const blockedCommand = dangerousCommandReason(project.runCommand)
  if (blockedCommand) {
    return failProjectRun(project.id, `Blocked dangerous command token: ${blockedCommand}`)
  }

  appendProjectLog(project.id, 'info', `command started: ${project.runCommand}`)
  setProjectStatus(project.id, 'Running')

  try {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', project.runCommand], {
      cwd: project.path,
      windowsHide: true
    })

    const running: RunningProject = {
      child,
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
      inspectProjectOutput(project.id, running, output)
    })

    child.stderr.on('data', (chunk: Buffer) => {
      const output = chunk.toString('utf8')
      appendProjectLog(project.id, 'error', output)
      inspectProjectOutput(project.id, running, output)
    })

    child.on('error', (error) => {
      if (running.completed) return
      running.completed = true
      running.fatalDetected = true
      runningProjects.delete(project.id)
      setProjectStatus(project.id, 'Error')
      appendProjectLog(project.id, 'error', `fatal error detected: ${error.message}`)
    })

    child.on('close', (code, signal) => {
      if (running.completed) return
      running.completed = true
      runningProjects.delete(project.id)

      if (running.stopping || code === 0) {
        setProjectStatus(project.id, 'Stopped')
        appendProjectLog(project.id, 'info', 'process stopped')
        return
      }

      if (running.fatalDetected) {
        appendProjectLog(project.id, 'info', 'process stopped')
        return
      }

      const elapsedMs = Date.now() - running.startedAt
      const exitSummary = `process exited with code ${code ?? 'unknown'}${signal ? ` and signal ${signal}` : ''}`

      if (code !== null && code !== 0 && elapsedMs < QUICK_EXIT_MS) {
        setProjectStatus(project.id, 'Error')
        appendProjectLog(project.id, 'error', `fatal error detected: ${exitSummary} after ${elapsedMs}ms`)
        return
      }

      setProjectStatus(project.id, 'Stopped')
      appendProjectLog(project.id, 'info', `process stopped: ${exitSummary}`)
    })

    return { ok: true, message: `${project.name} started.` }
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

ipcMain.handle('desktop:copy-text', (_event, text: string): DesktopActionResult => {
  clipboard.writeText(String(text ?? ''))
  return { ok: true, message: 'Copied to clipboard.' }
})

ipcMain.handle('projects:run-state', () => getProjectRunState())

ipcMain.handle('projects:run', (_event, projectId: unknown): DesktopActionResult => {
  return typeof projectId === 'string' ? startProjectRun(projectId) : { ok: false, message: 'Project id is required.' }
})

ipcMain.handle('projects:stop', (_event, projectId: unknown): Promise<DesktopActionResult> | DesktopActionResult => {
  return typeof projectId === 'string' ? stopProjectRun(projectId) : { ok: false, message: 'Project id is required.' }
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
