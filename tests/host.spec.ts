/** Locate the running DSH CLI from explicit fallback roots. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { electronInstallRoots, findDshCli } from '../src/host.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

it('finds the DSH CLI from an argv-style directory and from a checkout root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-firered-host-'))
  roots.push(root)
  const cli = join(root, 'apps', 'cli')
  await mkdir(join(root, 'vendor', 'loader'), { recursive: true })
  await mkdir(join(cli, 'lib'), { recursive: true })
  await writeFile(join(cli, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh' }))
  expect(findDshCli([join(cli, 'lib')])).toBe(cli)
  expect(findDshCli([root])).toBe(cli)
  expect(() => findDshCli([join(tmpdir(), 'dsh-firered-no-install')])).toThrow('Unable to locate the running DSH installation')
})

it('accepts an Electron runtime root that resolves the official bundle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-firered-electron-'))
  roots.push(root)
  const runtime = join(root, 'resources', 'app.asar', 'dsh')
  const bundle = join(runtime, 'node_modules', '@deepseek-ai', 'dsh-experimental-voice-input-bundle')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-desktop-runtime' }))
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-experimental-voice-input-bundle' }))
  expect(findDshCli([runtime])).toBe(runtime)
})

it('keeps a deeper CLI directory ahead of an ancestor that resolves the official bundle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-firered-web-priority-'))
  roots.push(root)
  const bundle = join(root, 'node_modules', '@deepseek-ai', 'dsh-experimental-voice-input-bundle')
  const cli = join(root, 'deep', 'cli')
  await mkdir(bundle, { recursive: true })
  await mkdir(join(cli, 'lib'), { recursive: true })
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-experimental-voice-input-bundle' }))
  await writeFile(join(cli, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh' }))
  expect(findDshCli([join(cli, 'lib')])).toBe(cli)
})

it('derives Electron resource roots and deduplicates the executable-relative spelling', () => {
  const executableDir = resolve('app-dir')
  const resources = join(executableDir, 'resources')
  const executable = join(executableDir, 'DeepSeek Harness.exe')
  expect(electronInstallRoots(resources, executable)).toEqual([
    join(resources, 'app.asar', 'dsh'), join(resources, 'app', 'dsh'),
  ])
  expect(electronInstallRoots(undefined, executable)).toEqual([
    join(executableDir, 'resources', 'app.asar', 'dsh'), join(executableDir, 'resources', 'app', 'dsh'),
  ])
})
