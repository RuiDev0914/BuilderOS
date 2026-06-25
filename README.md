# BuilderOS

A focused desktop command center for solo developers who want to launch, organize, and return to their projects faster.

---

## Screenshots

> Screenshots coming soon.

| Dashboard | Command Palette | Light Mode |
| --- | --- | --- |
| `docs/screenshots/dashboard.png` | `docs/screenshots/command-palette.png` | `docs/screenshots/light-mode.png` |

---

## Features

### Project Management

Keep local projects in one place with names, paths, project types, task profiles, notes, launch history, and favorite status.

### Quick Actions

Run common actions from the dashboard, including adding a project, opening a workspace folder, opening PowerShell, opening a terminal, and jumping into notes.

### Smart Start

Resume the project you were last working on without searching through folders or remembering what was open yesterday.

### Command Palette

Press `Ctrl + K` or `Ctrl + Shift + P` to search and run BuilderOS commands from the keyboard.

Available commands include:

- Open Project
- Open Folder
- Open PowerShell
- Toggle Theme
- Open Settings
- Add Project

### Favorites

Pin important projects and access them quickly from the dashboard or command palette.

### Project Notes

Store lightweight project notes directly in BuilderOS so context stays close to the workspace.

### Work Time Tracker

Track active work sessions and total time spent across your projects.

### Theme Toggle

Switch between polished Dark and Light modes. Theme selection is saved locally and restored after restart.

### Settings

Manage app preferences, project defaults, data import/export, reset tools, and app metadata from a dedicated settings panel.

### Tutorial

Use the first-launch tutorial to learn the basic flow: add a project, create task profiles, and start launching work from BuilderOS.

---

## Installation

BuilderOS is currently built for Windows.

### Windows

1. Download the latest `BuilderOS.exe` or `BuilderOS-<version>-portable.exe` from the release package.
2. Move it to a stable folder, such as `C:\Tools\BuilderOS`.
3. Run the app.
4. If Windows SmartScreen appears, choose to run the app only if you trust the build source.

### Portable Version

The portable build does not require installation.

1. Download `BuilderOS-<version>-portable.exe`.
2. Place it anywhere on your machine.
3. Launch it directly.
4. Optionally create a desktop shortcut to the portable exe.

BuilderOS stores local app data in Electron's user data folder for the app.

---

## Usage

### Add Project

Click `Add project`, enter the project name and folder path, then save it. You can also add task profiles for common commands.

### Open Project

Select a project card to view details, notes, work time, Git context, logs, and developer tools.

### Use Ctrl + K

Press `Ctrl + K` to open the Command Palette. Search for a project or command, then press `Enter` to run it.

### Favorites

Mark frequently used projects as favorites to keep them available from the dashboard and command palette.

### Theme

Use the header theme toggle or the Settings panel to switch between Dark and Light modes.

---

## Roadmap

- Deeper Git workflow automation
- Richer project tutorials and onboarding
- Screenshot and asset management
- Project templates
- Task history and command analytics
- Backup and sync options
- More keyboard-first workflows

---

## Why BuilderOS?

BuilderOS exists to help solo developers move faster with less friction.

Personal projects often spread across folders, terminals, notes, commands, and half-remembered context. BuilderOS brings those daily actions into one focused desktop app so you can open the right project, run the right command, and continue where you left off.

It was built for one purpose:

> To help individual developers organize and move through daily development faster.

---

## Tech Stack

- Electron
- React
- TypeScript
- Vite

---

## License

MIT
