import { nextTick, onMounted, onUnmounted, watch } from 'vue'
import { getScrollOffset, onContentUpdated, useData } from 'vitepress'

const HASH_SCROLL_RETRY_DELAYS_MS = [0, 50, 120, 250, 500, 900, 1400, 2000]
const HASH_SCROLL_SETTLE_MS = 2400

function getHashTarget(hash: string): HTMLElement | null {
  const encodedId = hash.startsWith('#') ? hash.slice(1) : hash
  if (!encodedId) return null

  try {
    return document.getElementById(decodeURIComponent(encodedId))
  } catch {
    return null
  }
}

function scrollToHashTarget() {
  const target = getHashTarget(window.location.hash)
  if (!target) return

  const targetPadding = Number.parseInt(window.getComputedStyle(target).paddingTop, 10) || 0
  const targetTop = window.scrollY + target.getBoundingClientRect().top - getScrollOffset() + targetPadding
  window.scrollTo({ left: 0, top: Math.max(0, targetTop), behavior: 'auto' })
}

export function useStableHashScroll() {
  const { hash } = useData()
  let runId = 0
  let cleanupCurrentRun: (() => void) | null = null

  function scheduleStableHashScroll() {
    if (typeof window === 'undefined' || !window.location.hash) return

    cleanupCurrentRun?.()

    const currentRunId = ++runId
    const timeoutIds: number[] = []
    let resizeObserver: ResizeObserver | null = null
    let canceled = false

    const cleanup = () => {
      if (canceled) return
      canceled = true
      for (const timeoutId of timeoutIds) {
        window.clearTimeout(timeoutId)
      }
      resizeObserver?.disconnect()
      window.removeEventListener('keydown', cleanup)
      window.removeEventListener('touchstart', cleanup)
      window.removeEventListener('wheel', cleanup)
      if (cleanupCurrentRun === cleanup) cleanupCurrentRun = null
    }

    const runScroll = () => {
      if (canceled || currentRunId !== runId) return
      scrollToHashTarget()
    }

    for (const delay of HASH_SCROLL_RETRY_DELAYS_MS) {
      timeoutIds.push(window.setTimeout(runScroll, delay))
    }
    timeoutIds.push(window.setTimeout(cleanup, HASH_SCROLL_SETTLE_MS))

    const contentRoot = document.querySelector<HTMLElement>('.VPDoc') ?? document.body
    if ('ResizeObserver' in window && contentRoot) {
      resizeObserver = new ResizeObserver(runScroll)
      resizeObserver.observe(contentRoot)
    }

    window.addEventListener('keydown', cleanup)
    window.addEventListener('touchstart', cleanup, { passive: true })
    window.addEventListener('wheel', cleanup, { passive: true })
    cleanupCurrentRun = cleanup
  }

  function scheduleAfterRender() {
    void nextTick(scheduleStableHashScroll)
  }

  onMounted(scheduleAfterRender)
  onContentUpdated(scheduleAfterRender)
  watch(hash, scheduleAfterRender)
  onUnmounted(() => cleanupCurrentRun?.())
}
