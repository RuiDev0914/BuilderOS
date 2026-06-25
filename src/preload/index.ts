import { contextBridge, ipcRenderer } from 'electron'
import type {
  DesktopActionResult,
  Project,
  ProjectGitSummary,
  ProjectRunEvent,
  ProjectRunState,
  RecentActivity,
  RecentActivityInput
} from '@shared/projects'
import type { BuilderDataActionResult, BuilderSettings } from '@shared/settings'

const api = {
  getProjects: (): Promise<Project[]> => ipcRenderer.invoke('projects:list'),
  saveProjects: (projects: Project[]): Promise<DesktopActionResult> => ipcRenderer.invoke('projects:save', projects),
  getRecentActivities: (): Promise<RecentActivity[]> => ipcRenderer.invoke('activities:list'),
  recordRecentActivity: (activity: RecentActivityInput): Promise<RecentActivity[]> =>
    ipcRenderer.invoke('activities:record', activity),
  getSettings: (): Promise<BuilderSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: BuilderSettings): Promise<BuilderDataActionResult> =>
    ipcRenderer.invoke('settings:save', settings),
  exportData: (): Promise<BuilderDataActionResult> => ipcRenderer.invoke('data:export'),
  importData: (): Promise<BuilderDataActionResult> => ipcRenderer.invoke('data:import'),
  resetData: (): Promise<BuilderDataActionResult> => ipcRenderer.invoke('data:reset'),
  getProjectRunState: (): Promise<ProjectRunState> => ipcRenderer.invoke('projects:run-state'),
  runProject: (projectId: string, taskProfileId?: string): Promise<DesktopActionResult> =>
    ipcRenderer.invoke('projects:run', projectId, taskProfileId),
  stopProject: (projectId: string): Promise<DesktopActionResult> => ipcRenderer.invoke('projects:stop', projectId),
  onProjectRunEvent: (callback: (event: ProjectRunEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, event: ProjectRunEvent): void => callback(event)
    ipcRenderer.on('projects:run-event', listener)
    return () => ipcRenderer.removeListener('projects:run-event', listener)
  },
  openFolder: (targetPath: string): Promise<DesktopActionResult> =>
    ipcRenderer.invoke('desktop:open-folder', targetPath),
  openUrl: (targetUrl: string): Promise<DesktopActionResult> => ipcRenderer.invoke('desktop:open-url', targetUrl),
  openPowerShell: (targetPath: string): Promise<DesktopActionResult> =>
    ipcRenderer.invoke('desktop:open-powershell', targetPath),
  openTerminal: (targetPath: string): Promise<DesktopActionResult> =>
    ipcRenderer.invoke('desktop:open-terminal', targetPath),
  copyProjectStatus: (projectId: string): Promise<DesktopActionResult> =>
    ipcRenderer.invoke('projects:copy-status', projectId),
  getProjectGitSummary: (projectId: string): Promise<ProjectGitSummary> =>
    ipcRenderer.invoke('projects:git-summary', projectId),
  copyChatGptContext: (projectId: string): Promise<DesktopActionResult> =>
    ipcRenderer.invoke('projects:copy-chatgpt-context', projectId),
  commitProject: (projectId: string, commitMessage: string): Promise<DesktopActionResult> =>
    ipcRenderer.invoke('projects:commit', projectId, commitMessage),
  publishProject: (projectId: string): Promise<DesktopActionResult> => ipcRenderer.invoke('projects:publish', projectId),
  openCodex: (projectId: string): Promise<DesktopActionResult> => ipcRenderer.invoke('projects:open-codex', projectId),
  copyText: (text: string): Promise<DesktopActionResult> => ipcRenderer.invoke('desktop:copy-text', text)
}

contextBridge.exposeInMainWorld('devLaunchPad', api)

export type DevLaunchPadApi = typeof api
