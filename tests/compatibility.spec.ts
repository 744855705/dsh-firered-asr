/** The packed manifest must pass the dsh 0.2.2-rc.3 precheck and contain no runtime or weights. */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import semver from 'semver'
import { expect, it } from 'vitest'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  engines: { dsh: string }
  dependencies?: Record<string, string>
  files: string[]
  dsh: { bundle: { patch: string } }
}
const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const runtimeFiles = readdirSync(fileURLToPath(new URL('../runtime', import.meta.url)))

it('accepts dsh 0.2.2-rc.1 through 0.5.0', () => {
  expect(manifest.engines.dsh).toBeTypeOf('string')
  expect(semver.satisfies('0.2.2-rc.1', manifest.engines.dsh, { includePrerelease: true })).toBe(true)
  expect(semver.satisfies('0.2.2-rc.3', manifest.engines.dsh, { includePrerelease: true })).toBe(true)
  expect(semver.satisfies('0.5.0', manifest.engines.dsh, { includePrerelease: true })).toBe(true)
  expect(semver.satisfies('0.5.0-rc.1', manifest.engines.dsh, { includePrerelease: true })).toBe(true)
  expect(semver.satisfies('0.5.1', manifest.engines.dsh, { includePrerelease: true })).toBe(false)
  expect(manifest.dependencies?.['@deepseek-ai/dsh']).toBeUndefined()
  expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
})

it('ships no workspace protocol and no model weights', () => {
  expect(JSON.stringify(manifest)).not.toContain('workspace:')
  expect(manifest.files).toEqual(expect.arrayContaining(['lib/**/*.js', 'runtime/assets.json', 'cordis.patch.yml', 'locale/*.json', 'icon.svg']))
  expect(runtimeFiles.some(name => /\.(onnx|tar\.bz2)$/.test(name))).toBe(false)
})

it('ships localized display metadata and an original SVG icon', () => {
  for (const locale of ['en', 'zh']) {
    const meta = JSON.parse(readFileSync(new URL(`../locale/${locale}.json`, import.meta.url), 'utf8')).meta
    expect(meta.title).toBeTypeOf('string')
    expect(meta.title.length).toBeGreaterThan(0)
    expect(meta.description).toBeTypeOf('string')
    expect(meta.description.length).toBeGreaterThan(0)
  }
  const icon = readFileSync(new URL('../icon.svg', import.meta.url))
  expect(icon.toString('utf8')).toMatch(/^<svg\s/u)
  expect(icon.byteLength).toBeLessThan(256 * 1024)
})

it('inserts exactly one provider row and no official voice-input rows', () => {
  expect(patch).toContain('- id: firered-asr')
  expect(patch).not.toMatch(/^\s*- id: (speech-to-text|api-speech-to-text|ui-voice-input)\s*$/mu)
  expect((patch.match(/^\s*- id: /gmu) ?? []).length).toBe(1)
})
