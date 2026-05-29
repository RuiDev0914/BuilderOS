import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { DEFAULT_PROJECTS, DesktopActionResult, isProjectType, Project } from '@shared/projects'

const PROJECTS_FILE = 'projects.json'

const projectStorePath = (): string => join(app.getPath('userData'), PROJECTS_FILE)

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

  return { ok: true }
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

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
