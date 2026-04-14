import type React from 'react'
import type { ArtifactDef, CouncilOutcome } from './phaseArtifactTypes'
import {
  getCouncilStatusEmoji,
  type CouncilAction,
} from './councilArtifacts'

export interface ArtifactTypeFilterProps {
  artifacts: ArtifactDef[]
  getArtifactState: (artifact: ArtifactDef) => { outcome?: CouncilOutcome; detail?: React.ReactNode }
  action: CouncilAction
  isCompleted: boolean
  onSelect: (id: string) => void
  variant: 'prominent' | 'inline'
}

export function ArtifactTypeFilter({ artifacts, getArtifactState, action, isCompleted, onSelect, variant }: ArtifactTypeFilterProps) {
  if (artifacts.length === 0) return null

  return (
    <>
      {artifacts.map((artifact) => {
        const artifactState = getArtifactState(artifact)
        const statusEmoji = artifactState.outcome
          ? getCouncilStatusEmoji(artifactState.outcome, action)
          : isCompleted ? '✅' : getCouncilStatusEmoji(undefined, action)

        if (variant === 'prominent') {
          return (
            <button
              key={artifact.id}
              onClick={() => onSelect(artifact.id)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/50 bg-secondary px-2.5 py-1.5 text-xs text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80 whitespace-nowrap"
            >
              <span className="text-muted-foreground">{artifact.icon}</span>
              <div className="text-left">
                <span className="font-medium">{artifact.label}</span>
                {artifactState.detail && <div className="max-w-[28rem] whitespace-normal break-all text-[10px] text-blue-500">{artifactState.detail}</div>}
              </div>
              <span className="ml-auto shrink-0">{statusEmoji}</span>
            </button>
          )
        }

        return (
          <button
            key={artifact.id}
            onClick={() => onSelect(artifact.id)}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 hover:bg-accent/50 cursor-pointer transition-colors text-xs whitespace-nowrap"
          >
            <span className="text-muted-foreground">{artifact.icon}</span>
            <div className="text-left">
              <span className="font-medium">{artifact.label}</span>
              {artifactState.detail && <div className="max-w-[28rem] whitespace-normal break-all text-[10px] text-blue-500">{artifactState.detail}</div>}
            </div>
            <span className="ml-auto shrink-0">{statusEmoji}</span>
          </button>
        )
      })}
    </>
  )
}
