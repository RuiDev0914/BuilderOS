import {
  Check,
  Clipboard,
  Code2,
  Edit3,
  ExternalLink,
  FolderOpen,
  MonitorPlay,
  Play,
  Plus,
  Search,
  Square,
  Terminal,
  Trash2,
  X
} from 'lucide-react'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { APP_RELEASE_LABEL } from '@shared/app'
import {
  DEFAULT_PROJECTS,
  PROJECT_TYPES,
  Project,
  ProjectLogEntry,
  ProjectRunStatus,
  ProjectType
} from '@shared/projects'
import { desktopApi } from './desktopApi'

type FilterType = 'All' | ProjectType

type ProjectFormState = Omit<Project, 'id'> & {
  id?: string
}

const emptyProjectForm: ProjectFormState = {
  name: '',
  path: '',
  url: '',
  runCommand: '',
  type: 'Tool'
}

const filters: FilterType[] = ['All', ...PROJECT_TYPES]
const runStatuses: ProjectRunStatus[] = ['Running', 'Stopped', 'Error']

const typeTone: Record<ProjectType, string> = {
  'Web app': 'tone-cyan',
  Game: 'tone-violet',
  Tool: 'tone-emerald'
}

const statusTone: Record<ProjectRunStatus, string> = {
  Stopped: 'status-stopped',
  Running: 'status-running',
  Error: 'status-error'
}

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
const formatLogTime = (createdAt: string): string => {
  const date = new Date(createdAt)
  return Number.isNaN(date.getTime())
    ? '--:--:--'
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
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
  const [notice, setNotice] = useState<string>('Ready')
  const [lastSuccess, setLastSuccess] = useState(false)

  useEffect(() => {
    let active = true

    desktopApi
      .getProjects()
      .then((loadedProjects) => {
        if (!active) return
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
    })

    return () => {
      active = false
      unsubscribe()
    }
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
      { Stopped: 0, Running: 0, Error: 0 }
    )
  }, [projects, statuses])

  const selectedProject = useMemo(() => {
    return projects.find((project) => project.id === selectedProjectId) ?? null
  }, [projects, selectedProjectId])

  const selectedProjectStatus = selectedProject ? statuses[selectedProject.id] ?? 'Stopped' : 'Stopped'
  const selectedLogs = selectedProjectId ? logsByProject[selectedProjectId] ?? [] : []
  const projectStatusFor = (projectId: string): ProjectRunStatus => statuses[projectId] ?? 'Stopped'

  const persistProjects = async (nextProjects: Project[], successMessage: string): Promise<void> => {
    const result = await desktopApi.saveProjects(nextProjects)
    if (!result.ok) {
      setNotice(result.message ?? 'Save failed.')
      setLastSuccess(false)
      return
    }

    setProjects(nextProjects)
    setNotice(successMessage)
    setLastSuccess(true)
  }

  const runDesktopAction = async (action: () => Promise<{ ok: boolean; message?: string }>): Promise<void> => {
    const result = await action()
    setNotice(result.message ?? (result.ok ? 'Done.' : 'Action failed.'))
    setLastSuccess(result.ok)
  }

  const copyCommand = (label: string, command: string): void => {
    void runDesktopAction(async () => {
      const result = await desktopApi.copyText(command)
      return result.ok ? { ok: true, message: `${label} copied.` } : result
    })
  }

  const runProject = (project: Project): void => {
    setSelectedProjectId(project.id)

    const confirmed = window.confirm(
      `Run saved command?\n\nProject: ${project.name}\nFolder: ${project.path}\nCommand: ${project.runCommand}`
    )

    if (!confirmed) return

    void runDesktopAction(() => desktopApi.runProject(project.id))
  }

  const stopProject = (project: Project): void => {
    setSelectedProjectId(project.id)
    void runDesktopAction(() => desktopApi.stopProject(project.id))
  }

  const openCreateForm = (): void => {
    setEditingProjectId(null)
    setForm(emptyProjectForm)
    setFormOpen(true)
  }

  const openEditForm = (project: Project): void => {
    setEditingProjectId(project.id)
    setForm(project)
    setFormOpen(true)
  }

  const closeForm = (): void => {
    setFormOpen(false)
    setEditingProjectId(null)
    setForm(emptyProjectForm)
  }

  const saveForm = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    const cleanForm = {
      ...form,
      name: form.name.trim(),
      path: form.path.trim(),
      url: form.url.trim(),
      runCommand: form.runCommand.trim()
    }

    if (!cleanForm.name || !cleanForm.path || !cleanForm.runCommand) {
      setNotice('Name, path, and run command are required.')
      setLastSuccess(false)
      return
    }

    const nextProject: Project = {
      id: editingProjectId ?? makeProjectId(cleanForm.name),
      name: cleanForm.name,
      path: cleanForm.path,
      url: cleanForm.url,
      runCommand: cleanForm.runCommand,
      type: cleanForm.type
    }

    const nextProjects = editingProjectId
      ? projects.map((project) => (project.id === editingProjectId ? nextProject : project))
      : [nextProject, ...projects]

    void persistProjects(nextProjects, editingProjectId ? 'Project updated.' : 'Project added.')
    closeForm()
  }

  const deleteProject = (project: Project): void => {
    const confirmed = window.confirm(`Delete "${project.name}" from Dev Launch Pad?`)
    if (!confirmed) return

    void persistProjects(
      projects.filter((candidate) => candidate.id !== project.id),
      'Project deleted.'
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Windows Desktop Command Center / {APP_RELEASE_LABEL}</p>
          <h1>Dev Launch Pad</h1>
        </div>
        <button className="primary-action" type="button" onClick={openCreateForm}>
          <Plus size={18} />
          Add project
        </button>
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

        <section className="status-grid" aria-label="Project totals">
          <div className="metric">
            <span>Total</span>
            <strong>{projects.length}</strong>
          </div>
          {PROJECT_TYPES.map((type) => (
            <div className="metric" key={type}>
              <span>{type}</span>
              <strong>{typeCounts[type]}</strong>
            </div>
          ))}
          {runStatuses.map((status) => (
            <div className="metric" key={status}>
              <span>{status}</span>
              <strong>{statusCounts[status]}</strong>
            </div>
          ))}
        </section>

        <section className="safety-note">
          {APP_RELEASE_LABEL} runs only saved project commands after confirmation and blocks dangerous command tokens.
        </section>

        <section className="notice-bar" data-success={lastSuccess}>
          {lastSuccess ? <Check size={16} /> : <MonitorPlay size={16} />}
          <span>{notice}</span>
        </section>

        <section className="project-grid" aria-label="Projects">
          {filteredProjects.map((project) => {
            const runStatus = projectStatusFor(project.id)

            return (
              <article
                className={`project-card ${selectedProjectId === project.id ? 'selected' : ''}`}
                key={project.id}
                onClick={() => setSelectedProjectId(project.id)}
              >
                <div className="card-header">
                  <div>
                    <div className="pill-row">
                      <span className={`type-pill ${typeTone[project.type]}`}>{project.type}</span>
                      <span className={`run-status ${statusTone[runStatus]}`}>{runStatus}</span>
                    </div>
                    <h2>{project.name}</h2>
                  </div>
                  <div className="card-actions">
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
                    <dt>Run</dt>
                    <dd>{project.runCommand}</dd>
                  </div>
                </dl>

                <div className="button-grid">
                  {runStatus === 'Running' ? (
                    <button className="stop-action" type="button" title="Stop saved command" onClick={() => stopProject(project)}>
                      <Square size={16} />
                      Stop
                    </button>
                  ) : (
                    <button className="run-action" type="button" title="Run saved command" onClick={() => runProject(project)}>
                      <Play size={16} />
                      Run
                    </button>
                  )}
                  <button
                    type="button"
                    title="Open folder"
                    onClick={() => void runDesktopAction(() => desktopApi.openFolder(project.path))}
                  >
                    <FolderOpen size={16} />
                    Open folder
                  </button>
                  <button
                    type="button"
                    title="Open PowerShell here"
                    onClick={() => void runDesktopAction(() => desktopApi.openPowerShell(project.path))}
                  >
                    <Terminal size={16} />
                    PowerShell
                  </button>
                  <button
                    type="button"
                    title="Open URL"
                    disabled={!project.url}
                    onClick={() => void runDesktopAction(() => desktopApi.openUrl(project.url))}
                  >
                    <ExternalLink size={16} />
                    Open URL
                  </button>
                  <button type="button" title="Copy run command" onClick={() => copyCommand('Run command', project.runCommand)}>
                    <Clipboard size={16} />
                    Copy run
                  </button>
                  <button type="button" title="Copy cd command" onClick={() => copyCommand('cd command', cdCommandFor(project))}>
                    <Clipboard size={16} />
                    Copy cd
                  </button>
                  <button
                    type="button"
                    title="Copy codex command"
                    onClick={() => copyCommand('Codex command', codexCommandFor(project))}
                  >
                    <Code2 size={16} />
                    Copy codex
                  </button>
                  <button
                    className="wide"
                    type="button"
                    title="Copy git status command"
                    onClick={() => copyCommand('git status command', gitStatusCommandFor(project))}
                  >
                    <Clipboard size={16} />
                    Copy git status
                  </button>
                </div>
              </article>
            )
          })}
        </section>

        {filteredProjects.length === 0 && <section className="empty-state">No projects match the current view.</section>}

        <section className="logs-panel" aria-label="Selected project logs">
          <div className="logs-heading">
            <div>
              <p className="eyebrow">Logs</p>
              <h2>{selectedProject ? selectedProject.name : 'Select a project'}</h2>
            </div>
            {selectedProject && (
              <span className={`run-status ${statusTone[selectedProjectStatus]}`}>{selectedProjectStatus}</span>
            )}
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
      </main>

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

            <label>
              Run command
              <input
                value={form.runCommand}
                onChange={(event) => setForm({ ...form, runCommand: event.target.value })}
                required
              />
            </label>

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
    </div>
  )
}
