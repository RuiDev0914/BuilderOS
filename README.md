# Dev Launch Pad

Windows desktop app for safely managing and opening local coding projects.

Current release: v1.8

## Development

```powershell
npm install
npm run dev
```

## Build and package

```powershell
npm run build
npm run package:win
```

The versioned Windows portable app is written to `release/` as `Dev Launch Pad-<version>-portable.exe`.
Packaging also updates `release/Dev Launch Pad.exe` as the stable latest app copy.
Create the desktop shortcut from `release/Dev Launch Pad.exe` so the shortcut keeps working after future packages.
The app is unsigned, so Windows SmartScreen may show a warning the first time it is opened.

Project data is stored as `projects.json` inside Electron's user data folder for this app.
Dev Launch Pad may keep running in the system tray after closing the window. Use Quit from the tray menu to fully close it.
