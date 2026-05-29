import {
  Check,
  Clipboard,
  Code2,
  Edit3,
  ExternalLink,
  FolderOpen,
  MonitorPlay,
  Plus,
  Search,
  Terminal,
  Trash2,
  X
} from 'lucide-react'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { DEFAULT_PROJECTS, PROJECT_TYPES, Project, ProjectType } from '@shared/projects'
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

const typeTone: Record<ProjectType, string> = {
  'Web app': 'tone-cyan',
  Game: 'tone-violet',
  Tool: 'tone-emerald'
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

export function App(): JSX.Element {
  const [projects, setProjects] = useState<Project[]>(DEFAULT_PROJECTS)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<FilterType>('All')
  const [formOpen, setFormOpen] = useState(false)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [form, setForm] = useState<ProjectFormState>(emptyProjectForm)
  const [notice, setNotice] = useState<string>('Ready')
  const [lastSuccess, setLastSuccess] = useState(false)

  useEffect(() => {
    desktopApi
      .getProjects()
      .then(setProjects)
      .catch(() => setNotice('Could not load local projects.'))
  }, [])

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
          <p className="eyebrow">Windows Desktop Command Center</p>
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
        </section>

        <section className="safety-note">
          v1ではコマンドを自動実行しません。PowerShellを開いて、コピーしたコマンドを自分で貼って実行してください。
        </section>

        <section className="notice-bar" data-success={lastSuccess}>
          {lastSuccess ? <Check size={16} /> : <MonitorPlay size={16} />}
          <span>{notice}</span>
        </section>

        <section className="project-grid" aria-label="Projects">
          {filteredProjects.map((project) => (
            <article className="project-card" key={project.id}>
              <div className="card-header">
                <div>
                  <span className={`type-pill ${typeTone[project.type]}`}>{project.type}</span>
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
          ))}
        </section>

        {filteredProjects.length === 0 && <section className="empty-state">No projects match the current view.</section>}
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
