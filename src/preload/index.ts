import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopActionResult, Project } from '@shared/projects'

const api = {
  getProjects: (): Promise<Project[]> => ipcRenderer.invoke('projects:list'),
  saveProjects: (projects: Project[]): Promise<DesktopActionResult> => ipcRenderer.invoke('projects:save', projects),
  openFolder: (targetPath: string): Promise<DesktopActionResult> =>
    ipcRenderer.invoke('desktop:open-folder', targetPath),
  openUrl: (targetUrl: string): Promise<DesktopActionResult> => ipcRenderer.invoke('desktop:open-url', targetUrl),
  openPowerShell: (targetPath: string): Promise<DesktopActionResult> =>
    ipcRenderer.invoke('desktop:open-powershell', targetPath),
  copyText: (text: string): Promise<DesktopActionResult> => ipcRenderer.invoke('desktop:copy-text', text)
}

contextBridge.exposeInMainWorld('devLaunchPad', api)

export type DevLaunchPadApi = typeof api
