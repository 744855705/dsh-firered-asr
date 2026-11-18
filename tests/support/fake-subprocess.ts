/** Real child processes behind the DSH subprocess handle shape, so worker tests exercise POSIX exit. */
import { spawn } from 'node:child_process'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

export interface FakeSubprocess {
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle
  readonly spawned: SubprocessHandle[]
  readonly specs: SubprocessSpawnSpec[]
}

/**
 * Build a minimal subprocess service backed by `node:child_process`.
 * It supports the pipe/collect/terminate surface the provider consumes, without node-pty.
 * @returns a service object and the handles it spawned, in order.
 */
export function createFakeSubprocess(): FakeSubprocess {
  const spawned: SubprocessHandle[] = []
  const specs: SubprocessSpawnSpec[] = []
  return {
    spawned,
    specs,
    spawn(spec) {
      specs.push(spec)
      const child = spawn(spec.argv[0]!, spec.argv.slice(1), {
        cwd: spec.cwd, env: { ...process.env, ...spec.env }, stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stderr = ''
      child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-64 * 1024) })
      let exited = false
      const done = new Promise<SubprocessOutcome>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (exitCode, signal) => {
          exited = true
          resolve({ exitCode, signal })
        })
      })
      const handle: SubprocessHandle = {
        stdin: undefined,
        stdout: child.stdout ?? undefined,
        stderr: child.stderr ?? undefined,
        control: undefined,
        collected: { stderr: { readFrom: () => ({ text: stderr, nextOffset: stderr.length, lossy: false }) } },
        done,
        terminate: () => { if (!exited) child.kill('SIGTERM') },
        waitForExit: async () => { await done.catch(() => {}); return true },
      }
      spawned.push(handle)
      return handle
    },
  }
}
