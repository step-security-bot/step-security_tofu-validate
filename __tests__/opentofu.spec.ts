import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Version, candidateVersions, loadModule, resolveVersion } from '@core'
import { releaseToken } from '../src/release-token.js'

/**
 * This action differs from the Terraform validate action in one respect: it is
 * always OpenTofu. Upstream pins that with `OPENTOFU: true` in the container's
 * `runs.env`; a JavaScript action has no such field, so it lives in the code
 * and these tests hold it there.
 */

const MAIN = readFileSync(join(__dirname, '..', 'src', 'main.ts'), 'utf8')

describe('OpenTofu is not optional', () => {
  it('is fixed in the source rather than read from the environment', () => {
    expect(MAIN).toMatch(/const OPEN_TOFU = true\b/)
    expect(MAIN).not.toMatch(/process\.env\.OPENTOFU\b/)
    expect(MAIN).not.toMatch(/process\.env\.OPENTOFU_VERSION\b/)
  })

  it('is passed to every core call that changes behaviour with it', () => {
    expect(MAIN).toContain('loadModule(inputs.path, OPEN_TOFU)')
    expect(MAIN).toContain('openTofu: OPEN_TOFU')
    // OpenTofu releases are always fetched, never behind a condition.
    expect(MAIN).toMatch(/const tofu = await getOpenTofuVersions\(/)
  })
})

/**
 * The selection the action makes, reproduced with the same core calls and a
 * fixed release list so no network is involved.
 */
describe('version selection in OpenTofu mode', () => {
  const terraform = ['1.5.7', '1.6.0', '1.9.0'].map((v) => new Version(v, 'Terraform'))
  const tofu = ['1.6.0', '1.8.3', '1.9.0'].map((v) => new Version(v, 'OpenTofu'))
  const versions = candidateVersions(terraform, tofu)

  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tofu-validate-'))
  })

  function resolve(env: Record<string, string> = {}) {
    return resolveVersion(
      { modulePath: dir, workspaceRoot: dir, openTofu: true },
      { module: loadModule(dir, true), versions, env }
    )
  }

  it('picks the newest OpenTofu release when nothing is pinned', () => {
    writeFileSync(join(dir, 'main.tf'), 'terraform {}\n')
    const result = resolve()
    expect(result?.version.product).toBe('OpenTofu')
    expect(String(result?.version)).toBe('1.9.0')
  })

  it('never offers Terraform 1.6 or later', () => {
    const terraformVersions = versions.filter((v) => v.product === 'Terraform').map(String)
    expect(terraformVersions).toEqual(['1.5.7'])
  })

  it('lets a .tofu file override the .tf file of the same name', () => {
    writeFileSync(join(dir, 'main.tf'), 'terraform {\n  required_version = "1.9.0"\n}\n')
    writeFileSync(join(dir, 'main.tofu'), 'terraform {\n  required_version = "~> 1.8.0"\n}\n')
    const result = resolve()
    expect(result?.version.product).toBe('OpenTofu')
    expect(String(result?.version)).toBe('1.8.3')
  })

  it('honours .opentofu-version', () => {
    writeFileSync(join(dir, 'main.tf'), 'terraform {}\n')
    writeFileSync(join(dir, '.opentofu-version'), '1.8.3\n')
    const result = resolve()
    expect(String(result?.version)).toBe('1.8.3')
    expect(result?.reason).toContain('.opentofu-version')
  })

  it('honours OPENTOFU_VERSION', () => {
    writeFileSync(join(dir, 'main.tf'), 'terraform {}\n')
    const result = resolve({ OPENTOFU_VERSION: '1.6.0' })
    expect(result?.version.product).toBe('OpenTofu')
    expect(String(result?.version)).toBe('1.6.0')
  })
})

describe('token for listing OpenTofu releases', () => {
  it('prefers GITHUB_DOT_COM_TOKEN', () => {
    expect(releaseToken({ GITHUB_DOT_COM_TOKEN: 'dotcom', GITHUB_TOKEN: 'gh' })).toBe('dotcom')
  })

  it('falls back to GITHUB_TOKEN on github.com', () => {
    expect(releaseToken({ GITHUB_TOKEN: 'gh' })).toBe('gh')
    expect(releaseToken({ GITHUB_TOKEN: 'gh', GITHUB_SERVER_URL: 'https://github.com/' })).toBe('gh')
  })

  it('never sends a GitHub Enterprise token to github.com', () => {
    expect(
      releaseToken({ GITHUB_TOKEN: 'ghes', GITHUB_SERVER_URL: 'https://github.example.com' })
    ).toBeUndefined()
  })

  it('uses GITHUB_DOT_COM_TOKEN on GitHub Enterprise', () => {
    expect(
      releaseToken({ GITHUB_DOT_COM_TOKEN: 'dotcom', GITHUB_SERVER_URL: 'https://github.example.com' })
    ).toBe('dotcom')
  })

  it('goes unauthenticated when there is nothing to use', () => {
    expect(releaseToken({})).toBeUndefined()
  })
})
