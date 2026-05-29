# Dev Launch Pad

Windows desktop app for safely managing and opening local coding projects.

Current release: v1.6

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

The Windows portable app is written to `release/` as `Dev Launch Pad-<version>-portable.exe`.
The app is unsigned, so Windows SmartScreen may show a warning the first time it is opened.

Project data is stored as `projects.json` inside Electron's user data folder for this app.
