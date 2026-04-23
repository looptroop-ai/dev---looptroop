import { describe, expect, it } from 'vitest'
import { buildRuntimeStatus, isWslRuntime } from './runtime'

describe('runtime WSL helpers', () => {
  it('detects WSL from platform and environment signals', () => {
    expect(isWslRuntime('linux', { WSL_DISTRO_NAME: 'Ubuntu' }, '6.6.87.2-microsoft-standard-WSL2')).toBe(true)
    expect(isWslRuntime('linux', {}, '6.6.87.2-microsoft-standard-WSL2')).toBe(true)
    expect(isWslRuntime('linux', {}, '6.8.0-generic')).toBe(false)
    expect(isWslRuntime('win32', { WSL_DISTRO_NAME: 'Ubuntu' }, '10.0.26100')).toBe(false)
  })

  it('adds an app-path warning only for WSL app roots on Windows-mounted drives', () => {
    expect(buildRuntimeStatus({
      appRoot: '/mnt/d/LoopTroop',
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
      kernelRelease: '6.6.87.2-microsoft-standard-WSL2',
    }).appPathWarning).toContain('/mnt/d/LoopTroop')

    expect(buildRuntimeStatus({
      appRoot: '/home/liviu/LoopTroop',
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
      kernelRelease: '6.6.87.2-microsoft-standard-WSL2',
    }).appPathWarning).toBeNull()

    expect(buildRuntimeStatus({
      appRoot: '/mnt/d/LoopTroop',
      platform: 'linux',
      env: {},
      kernelRelease: '6.8.0-generic',
    }).appPathWarning).toBeNull()
  })
})
