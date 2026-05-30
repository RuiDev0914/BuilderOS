import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const packageJsonPath = join(scriptDirectory, '..', 'package.json')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))

const outputDirectory = packageJson.build?.directories?.output ?? 'release'
const productName = packageJson.build?.productName ?? packageJson.name
const releaseDirectory = join(scriptDirectory, '..', outputDirectory)
const versionedPortableExe = join(releaseDirectory, `${productName}-${packageJson.version}-portable.exe`)
const stablePortableExe = join(releaseDirectory, `${productName}.exe`)

if (!existsSync(versionedPortableExe)) {
  throw new Error(`Versioned portable exe was not found: ${versionedPortableExe}`)
}

mkdirSync(releaseDirectory, { recursive: true })
copyFileSync(versionedPortableExe, stablePortableExe)

console.log(`Updated stable shortcut target: ${stablePortableExe}`)
