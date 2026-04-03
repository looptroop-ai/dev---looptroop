import { describe, expect, it } from 'vitest'
import {
  classifyStartupStorageKind,
  formatStartupStorageSummary,
  formatStartupStorageVerbose,
  type StartupStorageDebugStatus,
} from './startupState'

describe('startupState helpers', () => {
  it('classifies fresh, empty existing, and restored boot states', () => {
    expect(classifyStartupStorageKind({
      dbExistedBeforeBoot: false,
      profileRestored: false,
      restoredProjectCount: 0,
    })).toBe('fresh')

    expect(classifyStartupStorageKind({
      dbExistedBeforeBoot: true,
      profileRestored: false,
      restoredProjectCount: 0,
    })).toBe('empty_existing')

    expect(classifyStartupStorageKind({
      dbExistedBeforeBoot: true,
      profileRestored: true,
      restoredProjectCount: 0,
    })).toBe('restored')

    expect(classifyStartupStorageKind({
      dbExistedBeforeBoot: true,
      profileRestored: false,
      restoredProjectCount: 2,
    })).toBe('restored')
  })

  it('formats summary lines for each startup state', () => {
    expect(formatStartupStorageSummary({
      kind: 'fresh',
      dbPath: '/tmp/looptroop/app.sqlite',
      configDir: '/tmp/looptroop',
      source: 'default',
      profileRestored: false,
      restoredProjectCount: 0,
      restoredProjects: [],
    })).toBe('State: created new local data store at /tmp/looptroop/app.sqlite')

    expect(formatStartupStorageSummary({
      kind: 'empty_existing',
      dbPath: '/tmp/looptroop/app.sqlite',
      configDir: '/tmp/looptroop',
      source: 'LOOPTROOP_CONFIG_DIR',
      profileRestored: false,
      restoredProjectCount: 0,
      restoredProjects: [],
    })).toBe(
      'State: using existing local data store at /tmp/looptroop/app.sqlite with no saved profile or projects',
    )

    expect(formatStartupStorageSummary({
      kind: 'restored',
      dbPath: '/tmp/looptroop/app.sqlite',
      configDir: '/tmp/looptroop',
      source: 'LOOPTROOP_APP_DB_PATH',
      profileRestored: true,
      restoredProjectCount: 3,
      restoredProjects: [],
    })).toBe(
      'State: restored existing local data from /tmp/looptroop/app.sqlite (profile=yes, projects=3)',
    )
  })

  it('formats the verbose detail line with restore notice metadata', () => {
    const debugStatus: StartupStorageDebugStatus = {
      kind: 'restored',
      dbPath: '/tmp/looptroop/app.sqlite',
      configDir: '/tmp/looptroop',
      source: 'LOOPTROOP_CONFIG_DIR',
      profileRestored: true,
      restoredProjectCount: 1,
      restoredProjects: [
        {
          name: 'Project A',
          shortname: 'PA',
          folderPath: '/tmp/project-a',
        },
      ],
      restoredProjectRoots: ['/tmp/project-a'],
    }

    expect(formatStartupStorageVerbose(debugStatus, null)).toBe(
      'State detail: configDir=/tmp/looptroop source=LOOPTROOP_CONFIG_DIR restoredProjects=/tmp/project-a restoreNoticeDismissed=no',
    )

    expect(formatStartupStorageVerbose(debugStatus, '2026-04-03T12:00:00.000Z')).toBe(
      'State detail: configDir=/tmp/looptroop source=LOOPTROOP_CONFIG_DIR restoredProjects=/tmp/project-a restoreNoticeDismissed=yes@2026-04-03T12:00:00.000Z',
    )
  })
})
