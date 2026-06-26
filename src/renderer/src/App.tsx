import {
  Check,
  ChevronDown,
  Clipboard,
  Code2,
  Download,
  Edit3,
  ExternalLink,
  FileText,
  FolderOpen,
  Github,
  GitBranch,
  MonitorPlay,
  Moon,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Square,
  Star,
  Sun,
  Terminal,
  Trash2,
  Upload,
  X,
  Zap
} from 'lucide-react'
import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  APP_BUILD_NUMBER,
  APP_GITHUB_REPOSITORY_URL,
  APP_NAME,
  APP_RELEASE_LABEL,
  APP_TAGLINE,
  APP_VERSION
} from '@shared/app'
import {
  DEFAULT_PROJECTS,
  DesktopActionResult,
  PROJECT_TYPES,
  Project,
  ProjectGitSummary,
  ProjectLogEntry,
  ProjectPublishHistoryEntry,
  ProjectRunStatus,
  ProjectTaskProfile,
  ProjectType,
  ProjectWorkSession,
  RecentActivity,
  RecentActivityInput,
  createDefaultTaskProfile,
  makeTaskProfileId
} from '@shared/projects'
import { BuilderSettings, DEFAULT_BUILDER_SETTINGS } from '@shared/settings'
import { desktopApi } from './desktopApi'

type FilterType = 'All' | ProjectType

type ProjectFormState = Omit<Project, 'id'> & {
  id?: string
}

type CommitDialogState = {
  project: Project
  message: string
  running: boolean
  result: DesktopActionResult | null
}

type PublishState = {
  projectId: string | null
  running: boolean
  result: DesktopActionResult | null
}

type GitSummaryState = {
  projectId: string | null
  loading: boolean
  summary: ProjectGitSummary | null
}

type NotesSaveState = 'idle' | 'saving' | 'saved' | 'error'

type DataAction = 'export' | 'import' | 'reset' | null

const LANGUAGE_COMING_SOON_MESSAGE = 'Language coming soon. UI text remains English for now.'

const applyDocumentTheme = (theme: BuilderSettings['theme']): void => {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  document.body.dataset.theme = theme
}

type QuickAction = {
  id: string
  label: string
  description: string
  icon: JSX.Element
  disabled?: boolean
  onClick: () => void
}

type CommandPaletteGroup = 'Project' | 'Quick Actions' | 'Settings' | 'Favorites'

type CommandPaletteItem = {
  id: string
  group: CommandPaletteGroup
  label: string
  description: string
  icon: JSX.Element
  keywords: string[]
  disabled?: boolean
  onSelect: () => void
}

const emptyProjectForm: ProjectFormState = {
  name: '',
  path: '',
  url: '',
  runCommand: '',
  taskProfiles: [createDefaultTaskProfile()],
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

const filters: FilterType[] = ['All', ...PROJECT_TYPES]
const runStatuses: ProjectRunStatus[] = ['Starting', 'Running', 'Stopped', 'Error']

const typeTone: Record<ProjectType, string> = {
  'Web app': 'tone-cyan',
  Game: 'tone-violet',
  Tool: 'tone-emerald'
}

const typeIcon: Record<ProjectType, string> = {
  'Web app': '🌐',
  Game: '🎮',
  Tool: '🛠️'
}

const statusTone: Record<ProjectRunStatus, string> = {
  Stopped: 'status-stopped',
  Starting: 'status-starting',
  Running: 'status-running',
  Error: 'status-error'
}

const statusLabel: Record<ProjectRunStatus, string> = {
  Stopped: 'Stopped',
  Starting: 'Starting...',
  Running: 'Running',
  Error: 'Error'
}

const roadmapItems = ['TODO System', 'Time Tracking', 'Project Notes', 'Git Integration', 'Screenshot Management']
const FIRST_LAUNCH_WIZARD_STORAGE_KEY = 'builderos-first-launch-wizard-dismissed'

const makeProjectId = (name: string): string => {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

  return `${base || 'project'}-${crypto.randomUUID().slice(0, 8)}`
}

const quotePowerShellPath = (path: string): string => `"${path.replace(/"/g, '`"')}"`

const cdCommandFor = (project: Project): string => `Set-Location -LiteralPath ${quotePowerShellPath(project.path)}`
const codexCommandFor = (project: Project): string => `${cdCommandFor(project)}; codex`
const gitStatusCommandFor = (project: Project): string => `${cdCommandFor(project)}; git status`
const codexPromptFor = (project: Project): string =>
  [
    `I am working in this project: ${project.name}.`,
    `Path: ${project.path}.`,
    'Task profiles:',
    taskCommandSummaryFor(project),
    'Please inspect this project, check the project files, summarize the stack, and wait for my next instruction. Do not make changes yet.'
  ].join('\n')
const formatLogTime = (createdAt: string): string => {
  const date = new Date(createdAt)
  return Number.isNaN(date.getTime())
    ? '--:--:--'
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const formatActivityTime = (createdAt: string): string => {
  const date = new Date(createdAt)
  return Number.isNaN(date.getTime()) ? '--:--' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

const isToday = (createdAt: string | null): boolean => {
  if (!createdAt) return false

  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return false

  const today = new Date()
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  )
}

const formatInsightTime = (createdAt: string | null): string => {
  if (!createdAt) return 'No launches yet'

  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return 'No launches yet'

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const formatRelativeTime = (createdAt: string | null, nowMs: number): string => {
  if (!createdAt) return 'Not opened yet'

  const createdMs = Date.parse(createdAt)
  if (Number.isNaN(createdMs)) return 'Not opened yet'

  const diffMinutes = Math.max(0, Math.floor((nowMs - createdMs) / 60000))
  if (diffMinutes < 1) return 'Just now'
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`

  return formatInsightTime(createdAt)
}

const formatPublishTime = (createdAt: string): string => {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return 'Unknown time'

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

type WorkTimeSummary = {
  todayMs: number
  weekMs: number
  totalMs: number
}

const emptyWorkTimeSummary: WorkTimeSummary = {
  todayMs: 0,
  weekMs: 0,
  totalMs: 0
}

const startOfLocalDay = (timestamp: number): number => {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

const startOfLocalWeek = (timestamp: number): number => {
  const date = new Date(startOfLocalDay(timestamp))
  const daysSinceMonday = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - daysSinceMonday)
  return date.getTime()
}

const sessionDurationInRange = (
  session: ProjectWorkSession,
  rangeStartMs: number,
  rangeEndMs: number,
  nowMs: number
): number => {
  const startedAt = Date.parse(session.startedAt)
  const endedAt = session.endedAt ? Date.parse(session.endedAt) : nowMs

  if (Number.isNaN(startedAt) || Number.isNaN(endedAt) || endedAt <= startedAt) return 0

  return Math.max(0, Math.min(endedAt, rangeEndMs) - Math.max(startedAt, rangeStartMs))
}

const summarizeWorkSessions = (sessions: ProjectWorkSession[], nowMs: number): WorkTimeSummary => {
  const todayStartMs = startOfLocalDay(nowMs)
  const weekStartMs = startOfLocalWeek(nowMs)

  return sessions.reduce<WorkTimeSummary>(
    (summary, session) => ({
      todayMs: summary.todayMs + sessionDurationInRange(session, todayStartMs, nowMs, nowMs),
      weekMs: summary.weekMs + sessionDurationInRange(session, weekStartMs, nowMs, nowMs),
      totalMs: summary.totalMs + sessionDurationInRange(session, 0, nowMs, nowMs)
    }),
    emptyWorkTimeSummary
  )
}

const formatWorkDuration = (durationMs: number): string => {
  const totalMinutes = Math.max(0, Math.floor(durationMs / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

const cleanProjectIcon = (icon: string): string => {
  return Array.from(icon.trim()).slice(0, 4).join('')
}

const displayProjectIconFor = (project: Project): string => {
  return project.icon.trim() || typeIcon[project.type]
}

const isInteractiveClickTarget = (target: EventTarget | null): boolean => {
  return target instanceof Element && Boolean(target.closest('button, a, input, textarea, select, label, summary'))
}

const normalizeCommandText = (value: string): string => value.trim().toLowerCase()

const commandMatchesQuery = (item: CommandPaletteItem, query: string): boolean => {
  if (!query) return true

  const searchableText = [item.group, item.label, item.description, ...item.keywords].join(' ').toLowerCase()

  return query
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => searchableText.includes(part))
}

const primaryTaskFor = (project: Project): ProjectTaskProfile => project.taskProfiles[0] ?? createDefaultTaskProfile(project.runCommand)

const taskCommandSummaryFor = (project: Project): string => {
  return project.taskProfiles.map((profile) => `${profile.name}: ${profile.command}`).join('\n')
}

const firstNoteLineFor = (project: Project): string => {
  return project.notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? 'No notes yet'
}

const formStateForProject = (project: Project): ProjectFormState => ({
  ...project,
  taskProfiles: project.taskProfiles.length > 0 ? project.taskProfiles : [createDefaultTaskProfile(project.runCommand)],
  runCommand: project.runCommand || project.taskProfiles[0]?.command || ''
})

const cleanTaskProfiles = (taskProfiles: ProjectTaskProfile[]): ProjectTaskProfile[] => {
  const existingIds: string[] = []

  return taskProfiles.map((profile) => {
    const name = profile.name.trim()
    const command = profile.command.trim()
    const rawId = profile.id.trim()
    const id = rawId && !existingIds.includes(rawId) ? rawId : makeTaskProfileId(name, existingIds)
    existingIds.push(id)

    return { id, name, command }
  })
}

export function App(): JSX.Element {
  const [projects, setProjects] = useState<Project[]>(DEFAULT_PROJECTS)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<FilterType>('All')
  const [formOpen, setFormOpen] = useState(false)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [form, setForm] = useState<ProjectFormState>(emptyProjectForm)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(DEFAULT_PROJECTS[0]?.id ?? null)
  const [statuses, setStatuses] = useState<Record<string, ProjectRunStatus>>({})
  const [logsByProject, setLogsByProject] = useState<Record<string, ProjectLogEntry[]>>({})
  const [recentActivities, setRecentActivities] = useState<RecentActivity[]>([])
  const [notesSaveState, setNotesSaveState] = useState<NotesSaveState>('idle')
  const [notice, setNotice] = useState<string>('Ready')
  const [lastSuccess, setLastSuccess] = useState(false)
  const [commitDialog, setCommitDialog] = useState<CommitDialogState | null>(null)
  const [publishState, setPublishState] = useState<PublishState>({
    projectId: null,
    running: false,
    result: null
  })
  const [firstLaunchWizardOpen, setFirstLaunchWizardOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<BuilderSettings>(DEFAULT_BUILDER_SETTINGS)
  const [dataAction, setDataAction] = useState<DataAction>(null)
  const [advancedToolsOpen, setAdvancedToolsOpen] = useState(false)
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('')
  const [commandPaletteActiveIndex, setCommandPaletteActiveIndex] = useState(0)
  const [timeNow, setTimeNow] = useState(() => Date.now())
  const [gitSummary, setGitSummary] = useState<GitSummaryState>({
    projectId: null,
    loading: false,
    summary: null
  })
  const projectsRef = useRef<Project[]>(DEFAULT_PROJECTS)
  const notesSaveTimerRef = useRef<number | null>(null)
  const devToolsSectionRef = useRef<HTMLElement | null>(null)
  const notesTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const commandPaletteInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let active = true

    desktopApi
      .getProjects()
      .then((loadedProjects) => {
        if (!active) return
        projectsRef.current = loadedProjects
        setProjects(loadedProjects)
        setSelectedProjectId((current) => current ?? loadedProjects[0]?.id ?? null)
      })
      .catch(() => setNotice('Could not load local projects.'))

    desktopApi
      .getProjectRunState()
      .then((state) => {
        if (!active) return
        setStatuses(state.statuses)
        setLogsByProject(state.logs)
      })
      .catch(() => setNotice('Could not load project run state.'))

    desktopApi
      .getRecentActivities()
      .then((activities) => {
        if (!active) return
        setRecentActivities(activities)
      })
      .catch(() => undefined)

    desktopApi
      .getSettings()
      .then((loadedSettings) => {
        if (!active) return
        setSettings(loadedSettings)
      })
      .catch(() => setNotice('Could not load local settings.'))

    const unsubscribe = desktopApi.onProjectRunEvent((event) => {
      if (event.status) {
        setStatuses((current) => ({
          ...current,
          [event.projectId]: event.status ?? current[event.projectId] ?? 'Stopped'
        }))
      }

      if (event.log) {
        const log = event.log
        setLogsByProject((current) => ({
          ...current,
          [event.projectId]: [...(current[event.projectId] ?? []), log].slice(-400)
        }))
      }

      if (event.message) {
        setNotice(event.message)
        setLastSuccess(true)
      }
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    projectsRef.current = projects
  }, [projects])

  useEffect(() => {
    document.documentElement.lang = 'en'
    applyDocumentTheme(settings.theme)
  }, [settings.theme])

  const openCommandPalette = useCallback((): void => {
    setCommandPaletteOpen(true)
    setCommandPaletteQuery('')
    setCommandPaletteActiveIndex(0)
    setFavoritesOpen(false)
  }, [])

  const closeCommandPalette = useCallback((): void => {
    setCommandPaletteOpen(false)
    setCommandPaletteQuery('')
    setCommandPaletteActiveIndex(0)
  }, [])

  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase()
      const isCommandPaletteShortcut =
        (event.ctrlKey || event.metaKey) && (key === 'k' || (event.shiftKey && key === 'p'))

      if (isCommandPaletteShortcut) {
        event.preventDefault()
        openCommandPalette()
        return
      }

      if (event.key === 'Escape' && commandPaletteOpen) {
        event.preventDefault()
        closeCommandPalette()
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [closeCommandPalette, commandPaletteOpen, openCommandPalette])

  useEffect(() => {
    if (!commandPaletteOpen) return

    window.setTimeout(() => commandPaletteInputRef.current?.focus(), 0)
  }, [commandPaletteOpen])

  useEffect(() => {
    return () => {
      if (notesSaveTimerRef.current) {
        window.clearTimeout(notesSaveTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (window.localStorage.getItem(FIRST_LAUNCH_WIZARD_STORAGE_KEY) === 'true') return

    setFirstLaunchWizardOpen(true)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setTimeNow(Date.now()), 60000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (projects.length === 0) {
      setSelectedProjectId(null)
      return
    }

    if (!selectedProjectId || !projects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(projects[0].id)
    }
  }, [projects, selectedProjectId])

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return projects.filter((project) => {
      const matchesQuery = normalizedQuery ? project.name.toLowerCase().includes(normalizedQuery) : true
      const matchesType = typeFilter === 'All' ? true : project.type === typeFilter
      return matchesQuery && matchesType
    })
  }, [projects, query, typeFilter])

  const favoriteProjects = useMemo(() => projects.filter((project) => project.isFavorite), [projects])

  const typeCounts = useMemo(() => {
    return PROJECT_TYPES.reduce<Record<ProjectType, number>>(
      (counts, type) => ({
        ...counts,
        [type]: projects.filter((project) => project.type === type).length
      }),
      { 'Web app': 0, Game: 0, Tool: 0 }
    )
  }, [projects])

  const statusCounts = useMemo(() => {
    return projects.reduce<Record<ProjectRunStatus, number>>(
      (counts, project) => {
        const status = statuses[project.id] ?? 'Stopped'
        return {
          ...counts,
          [status]: counts[status] + 1
        }
      },
      { Stopped: 0, Starting: 0, Running: 0, Error: 0 }
    )
  }, [projects, statuses])

  const taskProfileCount = useMemo(() => {
    return projects.reduce((count, project) => count + project.taskProfiles.length, 0)
  }, [projects])

  const dashboardInsights = useMemo(() => {
    const launchedProjects = projects.filter((project) => project.launchCount > 0)
    const mostUsedProject =
      launchedProjects.length > 0
        ? launchedProjects.reduce((currentMostUsed, project) =>
            project.launchCount > currentMostUsed.launchCount ? project : currentMostUsed
          )
        : null
    const lastProject =
      launchedProjects.length > 0
        ? launchedProjects.reduce((currentLatest, project) => {
            const currentLatestTime = Date.parse(currentLatest.lastLaunchedAt ?? '')
            const projectTime = Date.parse(project.lastLaunchedAt ?? '')
            return projectTime > currentLatestTime ? project : currentLatest
          })
        : null

    return {
      todayProjectCount: projects.filter((project) => isToday(project.lastLaunchedAt)).length,
      mostUsedProject,
      lastProject,
      totalLaunchCount: projects.reduce((count, project) => count + project.launchCount, 0),
      totalWorkTimeMs: projects.reduce(
        (total, project) => total + summarizeWorkSessions(project.workSessions, timeNow).totalMs,
        0
      )
    }
  }, [projects, timeNow])

  const continueBuildingProject = useMemo(() => {
    const openedProjects = projects.filter((project) => {
      return project.lastOpenedAt && !Number.isNaN(Date.parse(project.lastOpenedAt))
    })

    return openedProjects.length > 0
      ? openedProjects.reduce((currentLatest, project) => {
          const currentLatestTime = Date.parse(currentLatest.lastOpenedAt ?? '')
          const projectTime = Date.parse(project.lastOpenedAt ?? '')
          return projectTime > currentLatestTime ? project : currentLatest
        })
      : null
  }, [projects])

  const selectedProject = useMemo(() => {
    return projects.find((project) => project.id === selectedProjectId) ?? null
  }, [projects, selectedProjectId])

  const selectedWorkTimeSummary = selectedProject
    ? summarizeWorkSessions(selectedProject.workSessions, timeNow)
    : emptyWorkTimeSummary
  const selectedProjectStatus = selectedProject ? statuses[selectedProject.id] ?? 'Stopped' : 'Stopped'
  const selectedLogs = selectedProjectId ? logsByProject[selectedProjectId] ?? [] : []
  const projectStatusFor = (projectId: string): ProjectRunStatus => statuses[projectId] ?? 'Stopped'
  const activeGitSummary = selectedProject && gitSummary.projectId === selectedProject.id ? gitSummary.summary : null
  const gitSummaryLoading = Boolean(selectedProject && gitSummary.projectId === selectedProject.id && gitSummary.loading)
  const selectedPublishRunning = Boolean(selectedProject && publishState.projectId === selectedProject.id && publishState.running)
  const selectedPublishResult = selectedProject && publishState.projectId === selectedProject.id ? publishState.result : null
  const latestPublish = selectedProject?.publishHistory[0] ?? null
  const quickActionProject = selectedProject ?? continueBuildingProject ?? projects[0] ?? null

  const loadGitSummary = useCallback((project: Project): void => {
    setGitSummary({
      projectId: project.id,
      loading: true,
      summary: null
    })

    desktopApi
      .getProjectGitSummary(project.id)
      .then((summary) => {
        setGitSummary((current) =>
          current.projectId === project.id
            ? {
                projectId: project.id,
                loading: false,
                summary
              }
            : current
        )
      })
      .catch(() => {
        setGitSummary((current) =>
          current.projectId === project.id
            ? {
                projectId: project.id,
                loading: false,
                summary: {
                  ok: false,
                  isGitRepository: false,
                  branch: '',
                  latestCommit: '',
                  workingTreeStatus: '',
                  message: 'Could not read Git summary.'
                }
              }
            : current
        )
      })
  }, [])

  useEffect(() => {
    if (!selectedProject) {
      setGitSummary({ projectId: null, loading: false, summary: null })
      return
    }

    loadGitSummary(selectedProject)
  }, [loadGitSummary, selectedProject])

  const persistProjects = async (nextProjects: Project[], successMessage: string): Promise<void> => {
    const previousProjects = projectsRef.current
    projectsRef.current = nextProjects
    const result = await desktopApi.saveProjects(nextProjects)
    if (!result.ok) {
      projectsRef.current = previousProjects
      setNotice(result.message ?? 'Save failed.')
      setLastSuccess(false)
      return
    }

    setProjects(nextProjects)
    setNotice(successMessage)
    setLastSuccess(true)
  }

  const saveProjectsSilently = useCallback((nextProjects: Project[], failureMessage: string): void => {
    projectsRef.current = nextProjects
    setProjects(nextProjects)

    desktopApi
      .saveProjects(nextProjects)
      .then((result) => {
        if (result.ok) return

        setNotice(result.message ?? failureMessage)
        setLastSuccess(false)
      })
      .catch(() => {
        setNotice(failureMessage)
        setLastSuccess(false)
      })
  }, [])

  const closeActiveWorkSession = useCallback(
    (projectId: string): void => {
      const endedAt = new Date().toISOString()
      let changed = false
      const nextProjects = projectsRef.current.map((project) => {
        if (project.id !== projectId || !project.workSessions.some((session) => !session.endedAt)) return project

        changed = true
        return {
          ...project,
          workSessions: project.workSessions.map((session) => (session.endedAt ? session : { ...session, endedAt }))
        }
      })

      if (!changed) return

      saveProjectsSilently(nextProjects, 'Work time save failed.')
    },
    [saveProjectsSilently]
  )

  useEffect(() => {
    Object.entries(statuses).forEach(([projectId, status]) => {
      if (status === 'Stopped' || status === 'Error') {
        closeActiveWorkSession(projectId)
      }
    })
  }, [closeActiveWorkSession, statuses])

  const updateProjectNotes = (projectId: string, notes: string): void => {
    setProjects((current) => {
      const nextProjects = current.map((project) => (project.id === projectId ? { ...project, notes } : project))
      projectsRef.current = nextProjects
      return nextProjects
    })

    setNotesSaveState('saving')

    if (notesSaveTimerRef.current) {
      window.clearTimeout(notesSaveTimerRef.current)
    }

    notesSaveTimerRef.current = window.setTimeout(() => {
      notesSaveTimerRef.current = null

      desktopApi
        .saveProjects(projectsRef.current)
        .then((result) => {
          if (!result.ok) {
            setNotice(result.message ?? 'Notes save failed.')
            setLastSuccess(false)
            setNotesSaveState('error')
            return
          }

          setNotesSaveState('saved')
        })
        .catch(() => {
          setNotice('Notes save failed.')
          setLastSuccess(false)
          setNotesSaveState('error')
        })
    }, 650)
  }

  const updateProjectIcon = (projectId: string, icon: string): void => {
    const nextIcon = cleanProjectIcon(icon)
    const nextProjects = projectsRef.current.map((project) =>
      project.id === projectId ? { ...project, icon: nextIcon } : project
    )

    saveProjectsSilently(nextProjects, 'Project icon save failed.')
  }

  const updateSettings = (patch: Partial<BuilderSettings>): void => {
    const nextSettings = {
      ...settings,
      ...patch
    }

    applyDocumentTheme(nextSettings.theme)
    setSettings(nextSettings)

    desktopApi
      .saveSettings(nextSettings)
      .then((result) => {
        if (result.ok) return

        setNotice(result.message ?? 'Settings save failed.')
        setLastSuccess(false)
      })
      .catch(() => {
        setNotice('Settings save failed.')
        setLastSuccess(false)
      })
  }

  const updateTheme = (theme: BuilderSettings['theme']): void => {
    if (theme === settings.theme) return
    updateSettings({ theme })
  }

  const showLanguageComingSoon = (): void => {
    setNotice(LANGUAGE_COMING_SOON_MESSAGE)
    setLastSuccess(false)
  }

  const runDesktopAction = async (action: () => Promise<DesktopActionResult>): Promise<DesktopActionResult> => {
    const result = await action()
    setNotice(result.message ?? (result.ok ? 'Done.' : 'Action failed.'))
    setLastSuccess(result.ok)
    return result
  }

  const applyImportedData = (result: {
    projects?: Project[]
    recentActivities?: RecentActivity[]
    settings?: BuilderSettings
  }): void => {
    if (result.projects) {
      projectsRef.current = result.projects
      setProjects(result.projects)
      setSelectedProjectId(result.projects[0]?.id ?? null)
    }

    if (result.recentActivities) {
      setRecentActivities(result.recentActivities)
    }

    if (result.settings) {
      setSettings(result.settings)
    }
  }

  const exportData = async (): Promise<void> => {
    setDataAction('export')

    try {
      const result = await desktopApi.exportData()
      setNotice(result.message ?? (result.ok ? 'Data exported.' : 'Export canceled.'))
      setLastSuccess(result.ok)
    } catch {
      setNotice('Export failed.')
      setLastSuccess(false)
    } finally {
      setDataAction(null)
    }
  }

  const importData = async (): Promise<void> => {
    const confirmed = window.confirm('Import BuilderOS data? This will replace current projects, activity, and settings.')
    if (!confirmed) return

    setDataAction('import')

    try {
      const result = await desktopApi.importData()

      if (result.ok) {
        applyImportedData(result)
      }

      setNotice(result.message ?? (result.ok ? 'Data imported.' : 'Import canceled.'))
      setLastSuccess(result.ok)
    } catch {
      setNotice('Import failed.')
      setLastSuccess(false)
    } finally {
      setDataAction(null)
    }
  }

  const resetData = async (): Promise<void> => {
    const confirmed = window.confirm('Reset BuilderOS? This will restore default projects and clear recent activity.')
    if (!confirmed) return

    setDataAction('reset')

    try {
      const result = await desktopApi.resetData()

      if (result.ok) {
        applyImportedData(result)
        window.localStorage.removeItem(FIRST_LAUNCH_WIZARD_STORAGE_KEY)
      }

      setNotice(result.message ?? (result.ok ? 'BuilderOS reset.' : 'Reset failed.'))
      setLastSuccess(result.ok)
    } catch {
      setNotice('Reset failed.')
      setLastSuccess(false)
    } finally {
      setDataAction(null)
    }
  }

  const openGitHubRepository = (): void => {
    void runDesktopAction(() => desktopApi.openUrl(APP_GITHUB_REPOSITORY_URL))
  }

  const checkForUpdates = (): void => {
    setNotice('Check for Updates is not available in BuilderOS Alpha yet.')
    setLastSuccess(true)
  }

  const recordActivity = useCallback((activity: RecentActivityInput): void => {
    desktopApi
      .recordRecentActivity(activity)
      .then((activities) => setRecentActivities(activities))
      .catch(() => undefined)
  }, [])

  const recordProjectActivity = (project: Project, activity: Omit<RecentActivityInput, 'projectId' | 'projectName'>): void => {
    recordActivity({
      ...activity,
      projectId: project.id,
      projectName: project.name
    })
  }

  const markProjectOpened = (project: Project): void => {
    const openedAt = new Date().toISOString()
    const nextProjects = projectsRef.current.map((candidate) =>
      candidate.id === project.id ? { ...candidate, lastOpenedAt: openedAt } : candidate
    )

    saveProjectsSilently(nextProjects, 'Smart Start save failed.')
  }

  const openProjectDetails = (project: Project): void => {
    const changedProject = selectedProjectId !== project.id
    setSelectedProjectId(project.id)
    setAdvancedToolsOpen(false)
    markProjectOpened(project)

    if (!changedProject) return

    recordProjectActivity(project, {
      type: 'project-details',
      message: `${project.name}の詳細を開いた`
    })
  }

  const toggleProjectFavorite = (project: Project): void => {
    const nextIsFavorite = !project.isFavorite
    const nextProjects = projectsRef.current.map((candidate) =>
      candidate.id === project.id ? { ...candidate, isFavorite: nextIsFavorite } : candidate
    )

    void persistProjects(nextProjects, nextIsFavorite ? 'Project pinned.' : 'Project unpinned.')
  }

  const recordProjectLaunch = (project: Project): void => {
    const launchedAt = new Date().toISOString()
    const nextProjects = projectsRef.current.map((candidate) =>
      candidate.id === project.id
        ? {
            ...candidate,
            launchCount: candidate.launchCount + 1,
            lastLaunchedAt: launchedAt,
            lastOpenedAt: launchedAt,
            workSessions: candidate.workSessions.some((session) => !session.endedAt)
              ? candidate.workSessions
              : [
                  ...candidate.workSessions,
                  {
                    id: `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
                    startedAt: launchedAt,
                    endedAt: null
                  }
                ]
          }
        : candidate
    )

    saveProjectsSilently(nextProjects, 'Launch and work time save failed.')
  }

  const copyCommand = (label: string, command: string): void => {
    void runDesktopAction(async () => {
      const result = await desktopApi.copyText(command)
      return result.ok ? { ok: true, message: `${label} copied.` } : result
    })
  }

  const showDevTools = (project: Project): void => {
    setSelectedProjectId(project.id)
    setAdvancedToolsOpen(false)
    markProjectOpened(project)
    recordProjectActivity(project, {
      type: 'dev-tools',
      message: `${project.name}のDev Toolsを開いた`
    })

    window.requestAnimationFrame(() => {
      devToolsSectionRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      devToolsSectionRef.current?.focus({ preventScroll: true })
    })
  }

  const toggleAdvancedTools = (): void => {
    setAdvancedToolsOpen((current) => !current)
  }

  const copyProjectStatus = (project: Project): void => {
    void runDesktopAction(() => desktopApi.copyProjectStatus(project.id))
  }

  const copyChatGptContext = (project: Project): void => {
    void runDesktopAction(() => desktopApi.copyChatGptContext(project.id))
  }

  const copyCodexPrompt = (project: Project): void => {
    copyCommand('Codex prompt', codexPromptFor(project))
  }

  const openCodex = (project: Project): void => {
    void runDesktopAction(() => desktopApi.openCodex(project.id)).then((result) => {
      if (result.ok) markProjectOpened(project)
    })
  }

  const openProjectFolder = (project: Project): void => {
    setSelectedProjectId(project.id)
    void runDesktopAction(() => desktopApi.openFolder(project.path)).then((result) => {
      if (!result.ok) return
      markProjectOpened(project)
      recordProjectActivity(project, {
        type: 'open-folder',
        message: `${project.name}のフォルダを開いた`
      })
    })
  }

  const openProjectUrl = (project: Project): void => {
    setSelectedProjectId(project.id)
    void runDesktopAction(() => desktopApi.openUrl(project.url)).then((result) => {
      if (!result.ok) return
      markProjectOpened(project)
      recordProjectActivity(project, {
        type: 'open-url',
        message: `${project.name}のURLを開いた`
      })
    })
  }

  const openProjectPowerShell = (project: Project): void => {
    setSelectedProjectId(project.id)
    void runDesktopAction(() => desktopApi.openPowerShell(project.path)).then((result) => {
      if (!result.ok) return
      markProjectOpened(project)
      recordProjectActivity(project, {
        type: 'open-powershell',
        message: `${project.name}でPowerShellを開いた`
      })
    })
  }

  const openProjectTerminal = (project: Project): void => {
    setSelectedProjectId(project.id)
    void runDesktopAction(() => desktopApi.openTerminal(project.path)).then((result) => {
      if (!result.ok) return
      markProjectOpened(project)
    })
  }

  const openQuickNote = (project: Project | null): void => {
    if (!project) {
      setNotice('Add a project before creating notes.')
      setLastSuccess(false)
      return
    }

    openProjectDetails(project)
    setNotice(`Notes ready for ${project.name}.`)
    setLastSuccess(true)

    window.setTimeout(() => {
      const textarea = notesTextareaRef.current
      if (!textarea) return

      textarea.focus()
      textarea.scrollIntoView({ block: 'center', inline: 'nearest' })
      const cursorPosition = textarea.value.length
      textarea.setSelectionRange(cursorPosition, cursorPosition)
    }, 0)
  }

  const openCommitDialog = (project: Project): void => {
    setSelectedProjectId(project.id)
    setCommitDialog({
      project,
      message: '',
      running: false,
      result: null
    })
  }

  const closeCommitDialog = (): void => {
    if (commitDialog?.running) return
    setCommitDialog(null)
  }

  const runCommitHelper = async (): Promise<void> => {
    if (!commitDialog) return

    const project = commitDialog.project
    const message = commitDialog.message.trim()

    setCommitDialog((current) => (current ? { ...current, running: true, result: null } : current))

    const result = await desktopApi.commitProject(project.id, message)
    setNotice(result.message ?? (result.ok ? 'Commit completed.' : 'Commit failed.'))
    setLastSuccess(result.ok)
    setCommitDialog((current) => (current ? { ...current, running: false, result } : current))
  }

  const dismissFirstLaunchWizard = (): void => {
    window.localStorage.setItem(FIRST_LAUNCH_WIZARD_STORAGE_KEY, 'true')
    setFirstLaunchWizardOpen(false)
  }

  const startFromFirstLaunchWizard = (): void => {
    dismissFirstLaunchWizard()
    openCreateForm()
  }

  const showFirstLaunchWizardFromSettings = (): void => {
    setSettingsOpen(false)
    setFirstLaunchWizardOpen(true)
  }

  const runPublish = async (project: Project): Promise<void> => {
    const confirmed = window.confirm(
      [
        'Publish this project?',
        '',
        `Project: ${project.name}`,
        `Folder: ${project.path}`,
        '',
        'This will run:',
        'git status',
        'git add .',
        'git commit',
        'git push'
      ].join('\n')
    )

    if (!confirmed) return

    const startedAt = new Date().toISOString()
    setSelectedProjectId(project.id)
    setPublishState({
      projectId: project.id,
      running: true,
      result: null
    })

    let result: DesktopActionResult

    try {
      result = await desktopApi.publishProject(project.id)
    } catch (error) {
      result = {
        ok: false,
        message: error instanceof Error ? error.message : 'Publish failed.'
      }
    }

    const endedAt = new Date().toISOString()
    const historyEntry: ProjectPublishHistoryEntry = {
      id: `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      status: result.ok ? 'success' : 'failed',
      startedAt,
      endedAt,
      message: result.message ?? (result.ok ? 'Publish completed.' : 'Publish failed.'),
      ...(result.output ? { output: result.output } : {})
    }

    const nextProjects = projectsRef.current.map((candidate) =>
      candidate.id === project.id
        ? {
            ...candidate,
            publishHistory: [historyEntry, ...candidate.publishHistory].slice(0, 20)
          }
        : candidate
    )

    saveProjectsSilently(nextProjects, 'Publish history save failed.')
    setNotice(result.message ?? (result.ok ? 'Publish completed.' : 'Publish failed.'))
    setLastSuccess(result.ok)
    setPublishState({
      projectId: project.id,
      running: false,
      result
    })
    loadGitSummary(project)
  }

  const runProject = (project: Project, taskProfile: ProjectTaskProfile): void => {
    setSelectedProjectId(project.id)

    const confirmed = window.confirm(
      `Run saved task?\n\nProject: ${project.name}\nTask: ${taskProfile.name}\nFolder: ${project.path}\nCommand: ${taskProfile.command}`
    )

    if (!confirmed) return

    void runDesktopAction(() => desktopApi.runProject(project.id, taskProfile.id)).then((result) => {
      if (!result.ok) return
      if (!/already seems/i.test(result.message ?? '')) {
        recordProjectLaunch(project)
      }
      recordProjectActivity(project, {
        type: 'project-run',
        message: `${project.name}を${taskProfile.name.toLowerCase() === 'development' ? '起動' : '実行'}`
      })
    })
  }

  const stopProject = (project: Project): void => {
    setSelectedProjectId(project.id)
    void runDesktopAction(() => desktopApi.stopProject(project.id))
  }

  const openCreateForm = (): void => {
    setEditingProjectId(null)
    setForm({
      ...emptyProjectForm,
      taskProfiles: [createDefaultTaskProfile()]
    })
    setFormOpen(true)
  }

  const openEditForm = (project: Project): void => {
    setEditingProjectId(project.id)
    setForm(formStateForProject(project))
    setFormOpen(true)
  }

  const closeForm = (): void => {
    setFormOpen(false)
    setEditingProjectId(null)
    setForm({
      ...emptyProjectForm,
      taskProfiles: [createDefaultTaskProfile()]
    })
  }

  const addTaskProfile = (): void => {
    setForm((current) => {
      const existingIds = current.taskProfiles.map((profile) => profile.id)
      const taskProfile = {
        ...createDefaultTaskProfile(),
        id: makeTaskProfileId('Task', existingIds),
        name: 'Task'
      }

      return {
        ...current,
        taskProfiles: [...current.taskProfiles, taskProfile]
      }
    })
  }

  const updateTaskProfile = (taskProfileId: string, patch: Partial<Pick<ProjectTaskProfile, 'name' | 'command'>>): void => {
    setForm((current) => ({
      ...current,
      taskProfiles: current.taskProfiles.map((profile) =>
        profile.id === taskProfileId
          ? {
              ...profile,
              ...patch
            }
          : profile
      )
    }))
  }

  const deleteTaskProfile = (taskProfileId: string): void => {
    setForm((current) => {
      if (current.taskProfiles.length <= 1) return current

      return {
        ...current,
        taskProfiles: current.taskProfiles.filter((profile) => profile.id !== taskProfileId)
      }
    })
  }

  const saveForm = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    const cleanForm = {
      ...form,
      name: form.name.trim(),
      path: form.path.trim(),
      url: form.url.trim(),
      taskProfiles: cleanTaskProfiles(form.taskProfiles)
    }

    if (!cleanForm.name || !cleanForm.path) {
      setNotice('Name and path are required.')
      setLastSuccess(false)
      return
    }

    if (cleanForm.taskProfiles.length === 0 || cleanForm.taskProfiles.some((profile) => !profile.name || !profile.command)) {
      setNotice('Every task profile needs a name and command.')
      setLastSuccess(false)
      return
    }

    const duplicateTaskName = cleanForm.taskProfiles.some((profile, index) => {
      const normalizedName = profile.name.toLowerCase()
      return cleanForm.taskProfiles.findIndex((candidate) => candidate.name.toLowerCase() === normalizedName) !== index
    })

    if (duplicateTaskName) {
      setNotice('Task profile names must be unique.')
      setLastSuccess(false)
      return
    }

    const nextProject: Project = {
      id: editingProjectId ?? makeProjectId(cleanForm.name),
      name: cleanForm.name,
      path: cleanForm.path,
      url: cleanForm.url,
      runCommand: cleanForm.taskProfiles[0].command,
      taskProfiles: cleanForm.taskProfiles,
      icon: cleanProjectIcon(cleanForm.icon),
      notes: cleanForm.notes,
      isFavorite: editingProjectId ? cleanForm.isFavorite : false,
      launchCount: editingProjectId ? cleanForm.launchCount : 0,
      lastLaunchedAt: editingProjectId ? cleanForm.lastLaunchedAt : null,
      lastOpenedAt: editingProjectId ? cleanForm.lastOpenedAt : null,
      workSessions: editingProjectId ? cleanForm.workSessions : [],
      publishHistory: editingProjectId ? cleanForm.publishHistory : [],
      type: cleanForm.type
    }

    const nextProjects = editingProjectId
      ? projects.map((project) => (project.id === editingProjectId ? nextProject : project))
      : [nextProject, ...projects]

    void persistProjects(nextProjects, editingProjectId ? 'Project updated.' : 'Project added.')
    closeForm()
  }

  const deleteProject = (project: Project): void => {
    const confirmed = window.confirm(`Delete "${project.name}" from ${APP_NAME}?`)
    if (!confirmed) return

    void persistProjects(
      projects.filter((candidate) => candidate.id !== project.id),
      'Project deleted.'
    )
  }

  const renderProjectCard = (project: Project): JSX.Element => {
    const runStatus = projectStatusFor(project.id)
    const primaryTask = primaryTaskFor(project)
    const projectIsStartingOrRunning = runStatus === 'Starting' || runStatus === 'Running'

    return (
      <article
        className={`project-card ${project.isFavorite ? 'favorite' : ''} ${selectedProjectId === project.id ? 'selected' : ''}`}
        key={project.id}
        onClick={(event) => {
          if (isInteractiveClickTarget(event.target)) return
          openProjectDetails(project)
        }}
      >
        <div className="card-header">
          <div className="card-title">
            <span className={`project-icon ${project.icon ? 'custom' : 'default'}`} aria-hidden="true">
              {displayProjectIconFor(project)}
            </span>
            <div>
              <div className="pill-row">
                <span className={`type-pill ${typeTone[project.type]}`}>{project.type}</span>
                <span className={`run-status ${statusTone[runStatus]}`}>{statusLabel[runStatus]}</span>
              </div>
              <h2>{project.name}</h2>
            </div>
          </div>
          <div className="card-actions">
            <button
              className={`favorite-button ${project.isFavorite ? 'active' : ''}`}
              type="button"
              title={project.isFavorite ? 'Unpin project' : 'Pin project'}
              aria-label={project.isFavorite ? `Unpin ${project.name}` : `Pin ${project.name}`}
              aria-pressed={project.isFavorite}
              onClick={(event) => {
                event.stopPropagation()
                toggleProjectFavorite(project)
              }}
            >
              <Star size={16} />
            </button>
            <button title="Edit project" type="button" onClick={() => openEditForm(project)}>
              <Edit3 size={16} />
            </button>
            <button title="Delete project" type="button" onClick={() => deleteProject(project)}>
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        <dl className="project-meta">
          <div>
            <dt>Path</dt>
            <dd>{project.path}</dd>
          </div>
          <div>
            <dt>URL</dt>
            <dd>{project.url || 'Not set'}</dd>
          </div>
          <div>
            <dt>Primary task</dt>
            <dd>{primaryTask.name}: {primaryTask.command}</dd>
          </div>
        </dl>

        <div className="button-grid">
          {projectIsStartingOrRunning ? (
            <button className="stop-action wide" type="button" title="Stop running task" onClick={() => stopProject(project)}>
              <Square size={16} />
              Stop
            </button>
          ) : (
            project.taskProfiles.map((taskProfile) => (
              <button
                className="run-action task-run-button"
                key={taskProfile.id}
                type="button"
                title={`Run ${taskProfile.name}`}
                onClick={() => runProject(project, taskProfile)}
              >
                <Play size={16} />
                {taskProfile.name}
              </button>
            ))
          )}
          <button type="button" title="Open folder" onClick={() => openProjectFolder(project)}>
            <FolderOpen size={16} />
            Open folder
          </button>
          <button type="button" title="Open URL" disabled={!project.url} onClick={() => openProjectUrl(project)}>
            <ExternalLink size={16} />
            Open URL
          </button>
          <button type="button" title="Open PowerShell here" onClick={() => openProjectPowerShell(project)}>
            <Terminal size={16} />
            PowerShell
          </button>
          <button
            className="dev-tools-toggle wide"
            type="button"
            aria-controls="selected-dev-tools"
            aria-pressed={selectedProjectId === project.id}
            onClick={(event) => {
              event.stopPropagation()
              showDevTools(project)
            }}
          >
            <Code2 size={16} />
            Dev Tools
          </button>
        </div>
      </article>
    )
  }

  const quickActions: QuickAction[] = [
    {
      id: 'new-project',
      label: 'New Project',
      description: 'Add a project to BuilderOS',
      icon: <Plus size={18} />,
      onClick: openCreateForm
    },
    {
      id: 'open-workspace',
      label: 'Open Workspace',
      description: quickActionProject ? quickActionProject.name : 'Select a project first',
      icon: <FolderOpen size={18} />,
      disabled: !quickActionProject,
      onClick: () => {
        if (quickActionProject) openProjectFolder(quickActionProject)
      }
    },
    {
      id: 'open-powershell',
      label: 'Open PowerShell',
      description: quickActionProject ? quickActionProject.name : 'Select a project first',
      icon: <Terminal size={18} />,
      disabled: !quickActionProject,
      onClick: () => {
        if (quickActionProject) openProjectPowerShell(quickActionProject)
      }
    },
    {
      id: 'open-terminal',
      label: 'Open Terminal',
      description: quickActionProject ? quickActionProject.name : 'Select a project first',
      icon: <Code2 size={18} />,
      disabled: !quickActionProject,
      onClick: () => {
        if (quickActionProject) openProjectTerminal(quickActionProject)
      }
    },
    {
      id: 'new-note',
      label: 'New Note',
      description: quickActionProject ? `Notes for ${quickActionProject.name}` : 'Select a project first',
      icon: <FileText size={18} />,
      disabled: !quickActionProject,
      onClick: () => openQuickNote(quickActionProject)
    }
  ]

  const nextTheme = settings.theme === 'dark' ? 'light' : 'dark'
  const projectCommandItems: CommandPaletteItem[] = projects.flatMap((project) => [
    {
      id: `project-open-${project.id}`,
      group: 'Project',
      label: `Open Project: ${project.name}`,
      description: project.path,
      icon: <MonitorPlay size={17} />,
      keywords: ['open project', project.name, project.type, project.path],
      onSelect: () => openProjectDetails(project)
    },
    {
      id: `project-folder-${project.id}`,
      group: 'Project',
      label: `Open Folder: ${project.name}`,
      description: project.path,
      icon: <FolderOpen size={17} />,
      keywords: ['open folder workspace explorer', project.name, project.type, project.path],
      onSelect: () => openProjectFolder(project)
    },
    {
      id: `project-powershell-${project.id}`,
      group: 'Project',
      label: `Open PowerShell: ${project.name}`,
      description: project.path,
      icon: <Terminal size={17} />,
      keywords: ['open powershell terminal shell', project.name, project.type, project.path],
      onSelect: () => openProjectPowerShell(project)
    }
  ])
  const favoriteCommandItems: CommandPaletteItem[] = favoriteProjects.flatMap((project) => [
    {
      id: `favorite-open-${project.id}`,
      group: 'Favorites',
      label: `Open Project: ${project.name}`,
      description: 'Favorite project',
      icon: <Star size={17} />,
      keywords: ['favorite pinned open project', project.name, project.type, project.path],
      onSelect: () => openProjectDetails(project)
    },
    {
      id: `favorite-folder-${project.id}`,
      group: 'Favorites',
      label: `Open Folder: ${project.name}`,
      description: 'Favorite project folder',
      icon: <FolderOpen size={17} />,
      keywords: ['favorite pinned open folder', project.name, project.type, project.path],
      onSelect: () => openProjectFolder(project)
    },
    {
      id: `favorite-powershell-${project.id}`,
      group: 'Favorites',
      label: `Open PowerShell: ${project.name}`,
      description: 'Favorite project PowerShell',
      icon: <Terminal size={17} />,
      keywords: ['favorite pinned open powershell terminal', project.name, project.type, project.path],
      onSelect: () => openProjectPowerShell(project)
    }
  ])
  const commandPaletteItems: CommandPaletteItem[] = [
    {
      id: 'quick-add-project',
      group: 'Quick Actions',
      label: 'Add Project',
      description: 'Create a new BuilderOS project',
      icon: <Plus size={17} />,
      keywords: ['new project create'],
      onSelect: openCreateForm
    },
    {
      id: 'quick-open-folder',
      group: 'Quick Actions',
      label: 'Open Folder',
      description: quickActionProject ? quickActionProject.name : 'Select a project first',
      icon: <FolderOpen size={17} />,
      keywords: ['open folder workspace quick action'],
      disabled: !quickActionProject,
      onSelect: () => {
        if (quickActionProject) openProjectFolder(quickActionProject)
      }
    },
    {
      id: 'quick-open-powershell',
      group: 'Quick Actions',
      label: 'Open PowerShell',
      description: quickActionProject ? quickActionProject.name : 'Select a project first',
      icon: <Terminal size={17} />,
      keywords: ['open powershell terminal shell quick action'],
      disabled: !quickActionProject,
      onSelect: () => {
        if (quickActionProject) openProjectPowerShell(quickActionProject)
      }
    },
    {
      id: 'settings-toggle-theme',
      group: 'Settings',
      label: 'Toggle Theme',
      description: `Switch to ${nextTheme === 'light' ? 'Light' : 'Dark'} Mode`,
      icon: nextTheme === 'light' ? <Sun size={17} /> : <Moon size={17} />,
      keywords: ['theme dark light appearance'],
      onSelect: () => updateTheme(nextTheme)
    },
    {
      id: 'settings-open',
      group: 'Settings',
      label: 'Open Settings',
      description: 'Open BuilderOS settings',
      icon: <Settings size={17} />,
      keywords: ['preferences options config'],
      onSelect: () => setSettingsOpen(true)
    },
    ...projectCommandItems,
    ...favoriteCommandItems
  ]
  const normalizedCommandPaletteQuery = normalizeCommandText(commandPaletteQuery)
  const visibleCommandPaletteItems = commandPaletteItems
    .filter((item) => commandMatchesQuery(item, normalizedCommandPaletteQuery))
    .slice(0, 60)
  const activeCommandPaletteItem = visibleCommandPaletteItems[commandPaletteActiveIndex] ?? null

  useEffect(() => {
    setCommandPaletteActiveIndex(0)
  }, [commandPaletteOpen, commandPaletteQuery])

  useEffect(() => {
    if (commandPaletteActiveIndex < visibleCommandPaletteItems.length) return

    setCommandPaletteActiveIndex(Math.max(0, visibleCommandPaletteItems.length - 1))
  }, [commandPaletteActiveIndex, visibleCommandPaletteItems.length])

  const runCommandPaletteItem = (item: CommandPaletteItem): void => {
    if (item.disabled) return

    closeCommandPalette()
    item.onSelect()
  }

  const handleCommandPaletteKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeCommandPalette()
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCommandPaletteActiveIndex((current) =>
        visibleCommandPaletteItems.length === 0 ? 0 : Math.min(current + 1, visibleCommandPaletteItems.length - 1)
      )
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCommandPaletteActiveIndex((current) => Math.max(current - 1, 0))
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      setCommandPaletteActiveIndex(0)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      setCommandPaletteActiveIndex(Math.max(0, visibleCommandPaletteItems.length - 1))
      return
    }

    if (event.key === 'Enter' && activeCommandPaletteItem) {
      event.preventDefault()
      runCommandPaletteItem(activeCommandPaletteItem)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">{APP_RELEASE_LABEL}</p>
          <h1>{APP_NAME}</h1>
          <p className="tagline">{APP_TAGLINE}</p>
        </div>
        <div className="topbar-actions">
          <span className="version-badge">{APP_RELEASE_LABEL}</span>
          <div className="theme-toggle-action" role="group" aria-label="Theme">
            <button
              className={settings.theme === 'dark' ? 'active' : ''}
              type="button"
              aria-pressed={settings.theme === 'dark'}
              onClick={() => updateTheme('dark')}
            >
              <Moon size={16} />
              Dark
            </button>
            <button
              className={settings.theme === 'light' ? 'active' : ''}
              type="button"
              aria-pressed={settings.theme === 'light'}
              onClick={() => updateTheme('light')}
            >
              <Sun size={16} />
              Light
            </button>
          </div>
          <button className="secondary-action settings-action" type="button" onClick={() => setSettingsOpen(true)}>
            <Settings size={17} />
            Settings
          </button>
          <button className="primary-action" type="button" onClick={openCreateForm}>
            <Plus size={18} />
            Add project
          </button>
        </div>
      </header>

      <main>
        <section className="control-strip" aria-label="Project controls">
          <div className="search-box">
            <Search size={18} />
            <input
              aria-label="Search projects"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search projects"
            />
          </div>

          <div className="favorites-control">
            <button
              className="favorites-toggle"
              type="button"
              aria-expanded={favoritesOpen}
              aria-controls="favorites-menu"
              onClick={() => setFavoritesOpen((current) => !current)}
            >
              <Star size={16} />
              Favorites {favoriteProjects.length}
            </button>

            {favoritesOpen && (
              <section className="favorites-menu" id="favorites-menu" aria-label="Favorite projects">
                <div className="favorites-menu-heading">
                  <span>Favorites</span>
                  <strong>{favoriteProjects.length}</strong>
                </div>

                {favoriteProjects.length > 0 ? (
                  <div className="favorites-list">
                    {favoriteProjects.map((project) => {
                      const primaryTask = primaryTaskFor(project)
                      const runStatus = projectStatusFor(project.id)

                      return (
                        <article className="favorite-project-row" key={project.id}>
                          <div className="favorite-project-copy">
                            <strong>{project.name}</strong>
                            <span>{project.type}</span>
                          </div>
                          <div className="favorite-project-actions">
                            <button
                              type="button"
                              title={`Run ${primaryTask.name}`}
                              disabled={runStatus === 'Running'}
                              onClick={() => {
                                setFavoritesOpen(false)
                                runProject(project, primaryTask)
                              }}
                            >
                              <Play size={14} />
                              Run
                            </button>
                            <button
                              type="button"
                              title="Open folder"
                              onClick={() => {
                                setFavoritesOpen(false)
                                openProjectFolder(project)
                              }}
                            >
                              <FolderOpen size={14} />
                              Folder
                            </button>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                ) : (
                  <p className="favorites-empty">No favorite projects yet.</p>
                )}
              </section>
            )}
          </div>

          <div className="filter-tabs" aria-label="Filter by project type">
            {filters.map((filter) => (
              <button
                key={filter}
                className={typeFilter === filter ? 'active' : ''}
                type="button"
                onClick={() => setTypeFilter(filter)}
              >
                {filter}
              </button>
            ))}
          </div>
        </section>

        <section className="quick-actions-panel" aria-label="Quick actions">
          <div className="quick-actions-heading">
            <div>
              <p className="eyebrow">Daily tools</p>
              <h2>
                <Zap size={18} />
                Quick Actions
              </h2>
            </div>
            {quickActionProject && <span>{quickActionProject.name}</span>}
          </div>

          <div className="quick-actions-grid">
            {quickActions.map((action) => (
              <button
                className="quick-action-card"
                type="button"
                key={action.id}
                disabled={action.disabled}
                onClick={action.onClick}
              >
                <span className="quick-action-icon">{action.icon}</span>
                <span className="quick-action-copy">
                  <strong>{action.label}</strong>
                  <small>{action.description}</small>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="dashboard-insights" aria-label="Dashboard insights">
          <article className="metric metric-primary insight-card">
            <span>Today</span>
            <strong>{dashboardInsights.todayProjectCount}</strong>
            <p>projects launched</p>
          </article>
          <article className="metric insight-card">
            <span>Most Used</span>
            <strong>{dashboardInsights.mostUsedProject?.name ?? 'None'}</strong>
            <p>
              {dashboardInsights.mostUsedProject
                ? `${dashboardInsights.mostUsedProject.launchCount} launches`
                : 'No launches yet'}
            </p>
          </article>
          <article className="metric insight-card">
            <span>Last Project</span>
            <strong>{dashboardInsights.lastProject?.name ?? 'None'}</strong>
            <p>{formatInsightTime(dashboardInsights.lastProject?.lastLaunchedAt ?? null)}</p>
          </article>
          <article className="metric insight-card">
            <span>Launch Count</span>
            <strong>{dashboardInsights.totalLaunchCount}</strong>
            <p>total launches</p>
          </article>
          <article className="metric insight-card">
            <span>Total Work Time</span>
            <strong>{formatWorkDuration(dashboardInsights.totalWorkTimeMs)}</strong>
            <p>all projects</p>
          </article>
        </section>

        <section className={`smart-start-card ${continueBuildingProject ? '' : 'empty'}`} aria-label="Continue Building">
          <div className="smart-start-heading">
            <div>
              <p className="eyebrow">Smart Start</p>
              <h2>Continue Building</h2>
            </div>
          </div>

          {continueBuildingProject ? (
            <div className="smart-start-content">
              <div className="smart-start-project">
                <strong>{continueBuildingProject.name}</strong>
                <span>{continueBuildingProject.type}</span>
              </div>

              <dl className="smart-start-meta">
                <div>
                  <dt>Last opened</dt>
                  <dd>{formatRelativeTime(continueBuildingProject.lastOpenedAt, timeNow)}</dd>
                </div>
                <div>
                  <dt>Next task</dt>
                  <dd>{firstNoteLineFor(continueBuildingProject)}</dd>
                </div>
              </dl>

              <button className="smart-start-action" type="button" onClick={() => openProjectDetails(continueBuildingProject)}>
                <ExternalLink size={16} />
                Open Project
              </button>
            </div>
          ) : (
            <div className="smart-start-empty">
              <p>Open a project to create your next starting point.</p>
            </div>
          )}
        </section>

        <section className="status-grid" aria-label="Project totals">
          <div className="metric metric-primary">
            <span>Total</span>
            <strong>{projects.length}</strong>
          </div>
          <div className="metric">
            <span>Task profiles</span>
            <strong>{taskProfileCount}</strong>
          </div>
          {PROJECT_TYPES.map((type) => (
            <div className="metric" key={type}>
              <span>{type}</span>
              <strong>{typeCounts[type]}</strong>
            </div>
          ))}
          {runStatuses.map((status) => (
            <div className="metric" key={status}>
              <span>{statusLabel[status]}</span>
              <strong>{statusCounts[status]}</strong>
            </div>
          ))}
        </section>

        <section className="safety-note">
          {APP_NAME} runs only saved project commands after confirmation and blocks dangerous command tokens.
        </section>

        <section className="notice-bar" data-success={lastSuccess}>
          {lastSuccess ? <Check size={16} /> : <MonitorPlay size={16} />}
          <span>{notice}</span>
        </section>

        <section className="workspace-layout" aria-label="Project workspace">
          <div className="project-list">
            {filteredProjects.length > 0 && (
              <section className="project-section" aria-label="Projects">
                <div className="project-section-heading">
                  <div>
                    <p className="eyebrow">Workspace</p>
                    <h2>Projects</h2>
                  </div>
                  <span>{filteredProjects.length}</span>
                </div>
                <section className="project-grid" aria-label="Project cards">
                  {filteredProjects.map(renderProjectCard)}
                </section>
              </section>
            )}

            {filteredProjects.length === 0 && <section className="empty-state">No projects match the current view.</section>}
          </div>

          <aside className="details-panel" aria-label="Selected project details">
            {selectedProject ? (
              <>
                <div className="details-heading">
                  <div className="details-title">
                    <span className={`project-icon large ${selectedProject.icon ? 'custom' : 'default'}`} aria-hidden="true">
                      {displayProjectIconFor(selectedProject)}
                    </span>
                    <div>
                      <p className="eyebrow">Project details</p>
                      <h2>{selectedProject.name}</h2>
                    </div>
                  </div>
                  <span className={`run-status ${statusTone[selectedProjectStatus]}`}>{statusLabel[selectedProjectStatus]}</span>
                </div>

                <dl className="details-list">
                  <div>
                    <dt>Type</dt>
                    <dd>{selectedProject.type}</dd>
                  </div>
                  <div>
                    <dt>Path</dt>
                    <dd>{selectedProject.path}</dd>
                  </div>
                  <div>
                    <dt>URL</dt>
                    <dd>{selectedProject.url || 'Not set'}</dd>
                  </div>
                  <div>
                    <dt>Task profiles</dt>
                    <dd>{selectedProject.taskProfiles.length}</dd>
                  </div>
                </dl>

                <section className="panel-section icon-section" aria-label={`Icon for ${selectedProject.name}`}>
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Identity</p>
                      <h3>Project Icon</h3>
                    </div>
                    <span className="icon-preview" aria-hidden="true">{displayProjectIconFor(selectedProject)}</span>
                  </div>

                  <div className="project-icon-editor">
                    <label>
                      Emoji
                      <input
                        value={selectedProject.icon}
                        onChange={(event) => updateProjectIcon(selectedProject.id, event.target.value)}
                        placeholder={typeIcon[selectedProject.type]}
                        maxLength={8}
                        aria-label={`Emoji icon for ${selectedProject.name}`}
                      />
                    </label>
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => updateProjectIcon(selectedProject.id, '')}
                      disabled={!selectedProject.icon}
                    >
                      Clear
                    </button>
                  </div>
                </section>

                <section className="panel-section work-time-section" aria-label={`Work time for ${selectedProject.name}`}>
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Tracker</p>
                      <h3>Work Time</h3>
                    </div>
                  </div>

                  <div className="work-time-grid">
                    <div>
                      <span>Today</span>
                      <strong>{formatWorkDuration(selectedWorkTimeSummary.todayMs)}</strong>
                    </div>
                    <div>
                      <span>This Week</span>
                      <strong>{formatWorkDuration(selectedWorkTimeSummary.weekMs)}</strong>
                    </div>
                    <div>
                      <span>Total</span>
                      <strong>{formatWorkDuration(selectedWorkTimeSummary.totalMs)}</strong>
                    </div>
                  </div>
                </section>

                <section className="panel-section task-profiles-section" aria-label={`Task profiles for ${selectedProject.name}`}>
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Tasks</p>
                      <h3>Profiles</h3>
                    </div>
                  </div>

                  <div className="task-profile-list">
                    {selectedProject.taskProfiles.map((taskProfile) => (
                      <div className="task-profile-item" key={taskProfile.id}>
                        <div className="task-profile-copy">
                          <strong>{taskProfile.name}</strong>
                          <code>{taskProfile.command}</code>
                        </div>
                        <div className="task-profile-actions">
                          <button
                            className="dev-tool-button"
                            type="button"
                            title={`Run ${taskProfile.name}`}
                            disabled={selectedProjectStatus === 'Starting' || selectedProjectStatus === 'Running'}
                            onClick={() => runProject(selectedProject, taskProfile)}
                          >
                            <Play size={15} />
                            Run
                          </button>
                          <button
                            className="dev-tool-button"
                            type="button"
                            title={`Copy ${taskProfile.name} command`}
                            onClick={() => copyCommand(`${taskProfile.name} command`, taskProfile.command)}
                          >
                            <Clipboard size={15} />
                            Copy
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="panel-section notes-section" aria-label={`Notes for ${selectedProject.name}`}>
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Project</p>
                      <h3>Notes</h3>
                    </div>
                    <span className={`notes-save-state state-${notesSaveState}`}>
                      {notesSaveState === 'saving'
                        ? 'Saving'
                        : notesSaveState === 'saved'
                          ? 'Saved'
                          : notesSaveState === 'error'
                            ? 'Error'
                            : 'Auto-save'}
                    </span>
                  </div>
                  <textarea
                    ref={notesTextareaRef}
                    className="project-notes-input"
                    aria-label={`Notes for ${selectedProject.name}`}
                    value={selectedProject.notes}
                    onChange={(event) => updateProjectNotes(selectedProject.id, event.target.value)}
                    placeholder={`Next features\nBugs\nRelease checklist\nIdeas`}
                    spellCheck
                  />
                </section>

                <section className="panel-section git-summary-section" aria-label={`Git summary for ${selectedProject.name}`}>
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Git</p>
                      <h3>Summary</h3>
                    </div>
                    <button
                      className="refresh-git-button"
                      type="button"
                      title="Refresh Git summary"
                      onClick={() => loadGitSummary(selectedProject)}
                      disabled={gitSummaryLoading}
                    >
                      <RefreshCw className={gitSummaryLoading ? 'spinning' : ''} size={15} />
                      Refresh Git
                    </button>
                  </div>

                  {gitSummaryLoading || !activeGitSummary ? (
                    <p className="git-summary-message">Loading...</p>
                  ) : !activeGitSummary.ok ? (
                    <p className="git-summary-message error">{activeGitSummary.message ?? 'Could not read Git summary.'}</p>
                  ) : !activeGitSummary.isGitRepository ? (
                    <p className="git-summary-message">Not a git repository</p>
                  ) : (
                    <dl className="git-summary-list">
                      <div>
                        <dt>Current branch</dt>
                        <dd>{activeGitSummary.branch}</dd>
                      </div>
                      <div>
                        <dt>Latest commit</dt>
                        <dd>{activeGitSummary.latestCommit}</dd>
                      </div>
                      <div>
                        <dt>Working tree status</dt>
                        <dd className="git-status-value">{activeGitSummary.workingTreeStatus}</dd>
                      </div>
                    </dl>
                  )}
                </section>

                <section className="panel-section publish-section" aria-label={`Publish ${selectedProject.name}`}>
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Release</p>
                      <h3>Publish</h3>
                    </div>
                    {latestPublish && (
                      <span className={`publish-state state-${latestPublish.status}`}>
                        {latestPublish.status === 'success' ? 'Success' : 'Failed'}
                      </span>
                    )}
                  </div>

                  <button
                    className="dev-tool-button publish-button"
                    type="button"
                    title="Publish this project"
                    disabled={selectedPublishRunning}
                    onClick={() => void runPublish(selectedProject)}
                  >
                    <GitBranch size={16} />
                    {selectedPublishRunning ? 'Publishing...' : 'Publish'}
                  </button>

                  {latestPublish && (
                    <div className={`publish-latest latest-${latestPublish.status}`}>
                      <span>Latest</span>
                      <strong>{latestPublish.message}</strong>
                      <time>{formatPublishTime(latestPublish.endedAt)}</time>
                    </div>
                  )}

                  {selectedPublishResult && (
                    <div
                      className={`publish-result ${selectedPublishResult.ok ? 'success' : 'error'}`}
                      aria-live="polite"
                    >
                      <strong>{selectedPublishResult.ok ? 'Success' : 'Failed'}</strong>
                      <p>{selectedPublishResult.message ?? (selectedPublishResult.ok ? 'Publish completed.' : 'Publish failed.')}</p>
                      {selectedPublishResult.output && <pre>{selectedPublishResult.output}</pre>}
                    </div>
                  )}
                </section>

                <section
                  aria-label={`Dev tools for ${selectedProject.name}`}
                  className="panel-section dev-tools-section"
                  id="selected-dev-tools"
                  ref={devToolsSectionRef}
                  tabIndex={-1}
                >
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Dev Tools</p>
                      <h3>{selectedProject.name}</h3>
                    </div>
                  </div>

                  <div className="dev-tools-main">
                    <button className="dev-tool-button" type="button" title="Open commit helper" onClick={() => openCommitDialog(selectedProject)}>
                      <GitBranch size={16} />
                      Commit
                    </button>
                    <button className="dev-tool-button" type="button" title="Copy ChatGPT context" onClick={() => copyChatGptContext(selectedProject)}>
                      <Clipboard size={16} />
                      Copy ChatGPT Context
                    </button>
                    <button className="dev-tool-button" type="button" title="Copy Codex prompt" onClick={() => copyCodexPrompt(selectedProject)}>
                      <Clipboard size={16} />
                      Copy Codex Prompt
                    </button>
                    <button className="dev-tool-button" type="button" title="Copy project status" onClick={() => copyProjectStatus(selectedProject)}>
                      <Clipboard size={16} />
                      Copy Status
                    </button>
                    <button className="dev-tool-button" type="button" title="Open Codex terminal" onClick={() => openCodex(selectedProject)}>
                      <Code2 size={16} />
                      Codex
                    </button>
                  </div>

                  <button
                    className="advanced-tools-toggle"
                    type="button"
                    aria-expanded={advancedToolsOpen}
                    onClick={toggleAdvancedTools}
                  >
                    <span>Advanced</span>
                    <ChevronDown className={advancedToolsOpen ? 'expanded' : ''} size={16} />
                  </button>

                  {advancedToolsOpen && (
                    <div className="advanced-tools-panel">
                      <button
                        className="dev-tool-button"
                        type="button"
                        title="Copy primary task command"
                        onClick={() => copyCommand('Primary task command', primaryTaskFor(selectedProject).command)}
                      >
                        <Clipboard size={15} />
                        Copy primary
                      </button>
                      <button
                        className="dev-tool-button"
                        type="button"
                        title="Copy cd command"
                        onClick={() => copyCommand('cd command', cdCommandFor(selectedProject))}
                      >
                        <Clipboard size={15} />
                        Copy cd
                      </button>
                      <button
                        className="dev-tool-button"
                        type="button"
                        title="Copy git status command"
                        onClick={() => copyCommand('git status command', gitStatusCommandFor(selectedProject))}
                      >
                        <Clipboard size={15} />
                        Copy git status
                      </button>
                      <button
                        className="dev-tool-button"
                        type="button"
                        title="Copy codex command"
                        onClick={() => copyCommand('Codex command', codexCommandFor(selectedProject))}
                      >
                        <Code2 size={15} />
                        Copy codex
                      </button>
                    </div>
                  )}
                </section>

                <section className="panel-section detail-logs" aria-label="Selected project logs">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Logs</p>
                      <h3>Activity</h3>
                    </div>
                  </div>

                  <div className="logs-body">
                    {selectedLogs.length > 0 ? (
                      selectedLogs.map((log) => (
                        <div className={`log-line log-${log.level}`} key={log.id}>
                          <time>{formatLogTime(log.createdAt)}</time>
                          <span>{log.message}</span>
                        </div>
                      ))
                    ) : (
                      <p className="empty-log">No logs for the selected project.</p>
                    )}
                  </div>
                </section>
              </>
            ) : (
              <div className="empty-detail">Select a project to view details.</div>
            )}
          </aside>
        </section>

        <section className="recent-activity-panel" aria-label="Recent activity">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Activity</p>
              <h2>Recent Activity</h2>
            </div>
            <span className="recent-activity-count">{recentActivities.length}/20</span>
          </div>

          <div className="recent-activity-list">
            {recentActivities.length > 0 ? (
              recentActivities.map((activity) => (
                <div className="recent-activity-item" key={activity.id}>
                  <time dateTime={activity.createdAt}>{formatActivityTime(activity.createdAt)}</time>
                  <span>{activity.message}</span>
                </div>
              ))
            ) : (
              <p className="recent-activity-empty">No recent activity yet.</p>
            )}
          </div>
        </section>

        <section className="public-release-panels" aria-label={`${APP_NAME} public release overview`}>
          <details className="about-panel">
            <summary>
              <span>
                <span className="eyebrow">About</span>
                <strong>{APP_NAME}</strong>
              </span>
              <ChevronDown size={16} />
            </summary>
            <p>
              {APP_NAME} is a personal operating system for solo developers, starting with safe project
              launching, task profiles, Git context, and local workflow control.
            </p>
          </details>

          <details className="roadmap-panel">
            <summary>
              <span>
                <span className="eyebrow">Roadmap</span>
                <strong>{APP_RELEASE_LABEL}</strong>
              </span>
              <ChevronDown size={16} />
            </summary>
            <ul className="roadmap-list">
              {roadmapItems.map((item) => (
                <li key={item}>
                  <Check size={15} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </details>
        </section>
      </main>

      {firstLaunchWizardOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="wizard-modal" role="dialog" aria-modal="true" aria-labelledby="first-launch-title">
            <div className="wizard-heading">
              <p className="eyebrow">Welcome</p>
              <h2 id="first-launch-title">Welcome to BuilderOS</h2>
              <p>{APP_TAGLINE}</p>
            </div>

            <ol className="wizard-steps">
              <li>
                <span>Step 1</span>
                <strong>Add your first project</strong>
              </li>
              <li>
                <span>Step 2</span>
                <strong>Create task profiles</strong>
              </li>
              <li>
                <span>Step 3</span>
                <strong>Launch your project</strong>
              </li>
            </ol>

            <div className="form-actions">
              <button className="secondary-action" type="button" onClick={dismissFirstLaunchWizard}>
                Skip
              </button>
              <button className="primary-action" type="button" onClick={startFromFirstLaunchWizard}>
                Get Started
              </button>
            </div>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="form-heading">
              <div>
                <p className="eyebrow">Settings</p>
                <h2 id="settings-title">BuilderOS Settings</h2>
              </div>
              <button title="Close settings" type="button" onClick={() => setSettingsOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="settings-sections">
              <section className="settings-section" aria-label="General settings">
                <div className="settings-section-heading">
                  <div>
                    <p className="eyebrow">General</p>
                    <h3>App Preferences</h3>
                  </div>
                </div>

                <div className="settings-field-grid">
                  <label className="settings-field">
                    Theme
                    <select
                      value={settings.theme}
                      onChange={(event) =>
                        updateTheme(event.target.value as BuilderSettings['theme'])
                      }
                    >
                      <option value="dark">Dark</option>
                      <option value="light">Light</option>
                    </select>
                  </label>

                  <label className="settings-field" onClick={showLanguageComingSoon}>
                    Language
                    <select
                      value="en"
                      disabled
                      aria-describedby="language-coming-soon"
                      onClick={showLanguageComingSoon}
                    >
                      <option value="en">English</option>
                    </select>
                    <small className="settings-helper" id="language-coming-soon">
                      {LANGUAGE_COMING_SOON_MESSAGE}
                    </small>
                  </label>
                </div>

                <div className="settings-toggle-list">
                  <label className="settings-toggle">
                    <input
                      checked={settings.autoSave}
                      type="checkbox"
                      onChange={(event) => updateSettings({ autoSave: event.target.checked })}
                    />
                    <span>
                      <strong>Auto Save</strong>
                      <small>{settings.autoSave ? 'On' : 'Off'}</small>
                    </span>
                  </label>

                  <label className="settings-toggle">
                    <input
                      checked={settings.startWithWindows}
                      type="checkbox"
                      onChange={(event) => updateSettings({ startWithWindows: event.target.checked })}
                    />
                    <span>
                      <strong>Start with Windows</strong>
                      <small>Placeholder</small>
                    </span>
                  </label>
                </div>
              </section>

              <section className="settings-section" aria-label="Workspace settings">
                <div className="settings-section-heading">
                  <div>
                    <p className="eyebrow">Workspace</p>
                    <h3>Project Defaults</h3>
                  </div>
                </div>

                <label className="settings-field">
                  Default Project Folder
                  <input
                    value={settings.defaultProjectFolder}
                    onChange={(event) => updateSettings({ defaultProjectFolder: event.target.value })}
                    placeholder="C:/Users/you/Documents"
                  />
                </label>

                <div className="settings-field-grid">
                  <label className="settings-field">
                    Default Terminal
                    <select
                      value={settings.defaultTerminal}
                      onChange={(event) =>
                        updateSettings({ defaultTerminal: event.target.value as BuilderSettings['defaultTerminal'] })
                      }
                    >
                      <option value="powershell">PowerShell</option>
                      <option value="windows-terminal">Windows Terminal</option>
                      <option value="system">System Default</option>
                    </select>
                  </label>

                  <label className="settings-field">
                    Default Editor
                    <select
                      value={settings.defaultEditor}
                      onChange={(event) =>
                        updateSettings({ defaultEditor: event.target.value as BuilderSettings['defaultEditor'] })
                      }
                    >
                      <option value="system">System Default</option>
                      <option value="vscode">VS Code</option>
                      <option value="cursor">Cursor</option>
                    </select>
                  </label>
                </div>
              </section>

              <section className="settings-section" aria-label="Data settings">
                <div className="settings-section-heading">
                  <div>
                    <p className="eyebrow">Data</p>
                    <h3>Backup and Reset</h3>
                  </div>
                </div>

                <div className="settings-action-grid">
                  <button
                    className="secondary-action"
                    disabled={dataAction !== null}
                    type="button"
                    onClick={() => void exportData()}
                  >
                    <Download size={16} />
                    {dataAction === 'export' ? 'Exporting...' : 'Export Data'}
                  </button>

                  <button
                    className="secondary-action"
                    disabled={dataAction !== null}
                    type="button"
                    onClick={() => void importData()}
                  >
                    <Upload size={16} />
                    {dataAction === 'import' ? 'Importing...' : 'Import Data'}
                  </button>

                  <button
                    className="secondary-action danger-action"
                    disabled={dataAction !== null}
                    type="button"
                    onClick={() => void resetData()}
                  >
                    <Trash2 size={16} />
                    {dataAction === 'reset' ? 'Resetting...' : 'Reset BuilderOS'}
                  </button>
                </div>
              </section>

              <section className="settings-section" aria-label="About BuilderOS">
                <div className="settings-section-heading">
                  <div>
                    <p className="eyebrow">About</p>
                    <h3>BuilderOS Alpha</h3>
                  </div>
                </div>

                <dl className="settings-meta-list">
                  <div>
                    <dt>BuilderOS Version</dt>
                    <dd>{APP_VERSION}</dd>
                  </div>
                  <div>
                    <dt>Build Number</dt>
                    <dd>{APP_BUILD_NUMBER}</dd>
                  </div>
                </dl>

                <div className="settings-action-grid two">
                  <button className="secondary-action" type="button" onClick={openGitHubRepository}>
                    <Github size={16} />
                    GitHub Repository
                  </button>

                  <button className="secondary-action" type="button" onClick={checkForUpdates}>
                    <RefreshCw size={16} />
                    Check for Updates
                  </button>
                </div>
              </section>

              <div className="settings-row">
                <div>
                  <p className="eyebrow">First Launch</p>
                  <h3>First Launch Wizard</h3>
                  <p>Review the onboarding steps for adding, profiling, and launching projects.</p>
                </div>
                <button className="secondary-action" type="button" onClick={showFirstLaunchWizardFromSettings}>
                  Show Wizard
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {formOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="project-form" onSubmit={saveForm}>
            <div className="form-heading">
              <div>
                <p className="eyebrow">{editingProjectId ? 'Edit project' : 'New project'}</p>
                <h2>{editingProjectId ? 'Update project' : 'Add project'}</h2>
              </div>
              <button title="Close form" type="button" onClick={closeForm}>
                <X size={18} />
              </button>
            </div>

            <label>
              Name
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
            </label>

            <label>
              Folder path
              <input value={form.path} onChange={(event) => setForm({ ...form, path: event.target.value })} required />
            </label>

            <label>
              URL
              <input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} />
            </label>

            <section className="form-task-profiles" aria-label="Task profiles">
              <div className="form-section-heading">
                <div>
                  <p className="eyebrow">Task profiles</p>
                  <h3>Commands</h3>
                </div>
                <button className="secondary-action compact-action" type="button" onClick={addTaskProfile}>
                  <Plus size={16} />
                  Add task
                </button>
              </div>

              <div className="task-profile-editor-list">
                {form.taskProfiles.map((taskProfile, index) => (
                  <div className="task-profile-editor" key={taskProfile.id}>
                    <label>
                      Name
                      <input
                        value={taskProfile.name}
                        onChange={(event) => updateTaskProfile(taskProfile.id, { name: event.target.value })}
                        placeholder={index === 0 ? 'Development' : 'Build'}
                        required
                      />
                    </label>
                    <label>
                      Command
                      <input
                        value={taskProfile.command}
                        onChange={(event) => updateTaskProfile(taskProfile.id, { command: event.target.value })}
                        placeholder={index === 0 ? 'npm run dev' : 'npm run build'}
                        required
                      />
                    </label>
                    <button
                      className="task-delete-button"
                      title="Delete task profile"
                      type="button"
                      onClick={() => deleteTaskProfile(taskProfile.id)}
                      disabled={form.taskProfiles.length <= 1}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <label>
              Type
              <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as ProjectType })}>
                {PROJECT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>

            <div className="form-actions">
              <button className="secondary-action" type="button" onClick={closeForm}>
                Cancel
              </button>
              <button className="primary-action" type="submit">
                <Check size={18} />
                Save project
              </button>
            </div>
          </form>
        </div>
      )}

      {commitDialog && (
        <div className="modal-backdrop" role="presentation">
          <div className="commit-modal" role="dialog" aria-modal="true" aria-label="Git commit helper">
            <div className="form-heading">
              <div>
                <p className="eyebrow">Git commit helper</p>
                <h2>{commitDialog.project.name}</h2>
              </div>
              <button title="Close commit helper" type="button" onClick={closeCommitDialog} disabled={commitDialog.running}>
                <X size={18} />
              </button>
            </div>

            <div className="commit-path">
              <span>Path</span>
              <code>{commitDialog.project.path}</code>
            </div>

            <label>
              Commit message
              <input
                value={commitDialog.message}
                onChange={(event) =>
                  setCommitDialog((current) => (current ? { ...current, message: event.target.value } : current))
                }
                disabled={commitDialog.running}
                maxLength={200}
              />
            </label>

            <div className="commit-command-preview">
              <span>Commands</span>
              <pre>{`git status\ngit add .\ngit commit -m "${commitDialog.message.trim() || '[message]'}"\ngit log --oneline -1`}</pre>
            </div>

            {commitDialog.result && (
              <div className={commitDialog.result.ok ? 'commit-output success' : 'commit-output error'}>
                <strong>{commitDialog.result.message ?? (commitDialog.result.ok ? 'Commit completed.' : 'Commit failed.')}</strong>
                {commitDialog.result.output && <pre>{commitDialog.result.output}</pre>}
              </div>
            )}

            <div className="form-actions">
              <button className="secondary-action" type="button" onClick={closeCommitDialog} disabled={commitDialog.running}>
                Cancel
              </button>
              <button
                className="primary-action"
                type="button"
                onClick={() => void runCommitHelper()}
                disabled={commitDialog.running || !commitDialog.message.trim()}
              >
                <GitBranch size={18} />
                Confirm commit
              </button>
            </div>
          </div>
        </div>
      )}

      {commandPaletteOpen && (
        <div
          className="command-palette-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCommandPalette()
          }}
        >
          <section
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-labelledby="command-palette-title"
            onKeyDown={handleCommandPaletteKeyDown}
          >
            <div className="command-palette-search">
              <Search size={18} />
              <input
                ref={commandPaletteInputRef}
                value={commandPaletteQuery}
                aria-label="Search commands"
                aria-controls="command-palette-results"
                aria-activedescendant={activeCommandPaletteItem ? `command-palette-option-${activeCommandPaletteItem.id}` : undefined}
                onChange={(event) => setCommandPaletteQuery(event.target.value)}
                placeholder="Search commands, projects, settings"
              />
            </div>

            <div className="command-palette-heading">
              <div>
                <p className="eyebrow">Command Palette</p>
                <h2 id="command-palette-title">BuilderOS Commands</h2>
              </div>
              <span>{visibleCommandPaletteItems.length}</span>
            </div>

            <div className="command-palette-list" id="command-palette-results" role="listbox" aria-label="Command results">
              {visibleCommandPaletteItems.length > 0 ? (
                visibleCommandPaletteItems.map((item, index) => (
                  <button
                    className={`command-palette-item ${index === commandPaletteActiveIndex ? 'active' : ''}`}
                    id={`command-palette-option-${item.id}`}
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={index === commandPaletteActiveIndex}
                    disabled={item.disabled}
                    onMouseEnter={() => setCommandPaletteActiveIndex(index)}
                    onClick={() => runCommandPaletteItem(item)}
                  >
                    <span className="command-palette-icon">{item.icon}</span>
                    <span className="command-palette-copy">
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                    <span className="command-palette-group">{item.group}</span>
                  </button>
                ))
              ) : (
                <p className="command-palette-empty">No commands found.</p>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
