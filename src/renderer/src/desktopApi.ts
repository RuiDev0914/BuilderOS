import { DEFAULT_PROJECTS, DesktopActionResult, Project, ProjectRunEvent, ProjectRunState } from '@shared/projects'

const STORAGE_KEY = 'dev-launch-pad-preview-projects'

const readPreviewProjects = (): Project[] => {
  try {
    const rawProjects = localStorage.getItem(STORAGE_KEY)
    return rawProjects ? (JSON.parse(rawProjects) as Project[]) : DEFAULT_PROJECTS
  } catch {
    return DEFAULT_PROJECTS
  }
}

const previewOnly = (message: string): DesktopActionResult => ({
  ok: false,
  message
})

const browserFallbackApi = {
  getProjects: async (): Promise<Project[]> => readPreviewProjects(),
  saveProjects: async (projects: Project[]): Promise<DesktopActionResult> => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
    return { ok: true, message: 'Projects saved in browser preview.' }
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
  copyText: async (text: string): Promise<DesktopActionResult> => {
    await navigator.clipboard.writeText(text)
    return { ok: true, message: 'Copied to clipboard.' }
  }
}

export const desktopApi = window.devLaunchPad ?? browserFallbackApi
