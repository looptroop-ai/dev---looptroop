export function getFillDrawerAvailableHeight(parentEl: HTMLElement, rootEl: HTMLElement): number | null {
  const parentHeight = parentEl.clientHeight || parentEl.getBoundingClientRect().height
  const siblingsHeight = Array.from(parentEl.children).reduce((sum, child) => {
    if (child === rootEl) return sum
    return sum + child.getBoundingClientRect().height
  }, 0)
  const nextHeight = Math.floor(parentHeight - siblingsHeight)

  return nextHeight > 0 ? nextHeight : null
}

export interface StickyFillNaturalHeight {
  phase: string
  height: number
}

export function resolveStickyFillNaturalHeight(
  current: StickyFillNaturalHeight | null,
  phase: string,
  nextHeight: number,
): StickyFillNaturalHeight {
  if (!current || current.phase !== phase) {
    return { phase, height: nextHeight }
  }

  return {
    phase,
    height: Math.max(current.height, nextHeight),
  }
}
