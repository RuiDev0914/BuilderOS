import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopActionResult, Project, ProjectRunEvent, ProjectRunState } from '@shared/projects'

const api = {
  getProjects: (): Promise<Project[]> => ipcRenderer.invoke('projects:list'),
  saveProjects: (projects: Project[]): Promise<DesktopActionResult> => ipcRenderer.invoke('projects:save', projects),
  getProjectRunState: (): Promise<ProjectRunState> => ipcRenderer.invoke('projects:run-state'),
  runProject: (projectId: string): Promise<DesktopActionResult> => ipcRenderer.invoke('projects:run', projectId),
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
  copyText: (text: string): Promise<DesktopActionResult> => ipcRenderer.invoke('desktop:copy-text', text)
}

contextBridge.exposeInMainWorld('devLaunchPad', api)

export type DevLaunchPadApi = typeof api
