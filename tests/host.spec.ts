/** Locate the running DSH CLI from explicit fallback roots. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { findDshCli } from '../src/host.ts'

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
