import { getModelDisplayName } from '@/components/shared/modelBadgeUtils'
import { ModelBadge } from '@/components/shared/ModelBadge'
import {
  getCouncilStatusEmoji,
  getCouncilStatusLabel,
  type CouncilMemberArtifactChip,
} from './councilArtifacts'

export interface ArtifactListProps {
  memberArtifacts: CouncilMemberArtifactChip[]
  compactInterviewArtifacts: boolean
  /** Smaller card size that still shows the status label (Drafting / Timed Out / Done). */
  compact?: boolean
  onSelectMember: (key: string) => void
}

export function ArtifactList({ memberArtifacts, compactInterviewArtifacts, compact, onSelectMember }: ArtifactListProps) {
  return (
    <>
      {memberArtifacts.map((artifact: CouncilMemberArtifactChip) => {
        const detailTone = artifact.outcome === 'failed' || artifact.outcome === 'invalid_output'
          ? 'text-red-400'
          : artifact.outcome === 'timed_out'
            ? 'text-amber-400'
            : 'text-blue-400'
        const cardClass = compact
          ? 'min-w-[85px] max-w-[110px] px-2 py-1 h-auto flex-none items-start gap-1 rounded-md'
          : compactInterviewArtifacts
            ? 'min-w-[150px] max-w-[220px] px-3 py-2 h-auto flex-none items-start gap-2'
            : 'min-w-[220px] flex-1 px-3 py-2 h-auto items-start gap-2'
        const showStatus = !compactInterviewArtifacts
        const nameClass = compact ? 'text-[9px] font-medium truncate' : 'text-xs font-medium truncate'
        const subClass = compact ? 'text-[8px] opacity-80 mt-0.5 truncate' : 'text-[10px] opacity-80 mt-0.5 truncate'
        const detailClass = compact ? `text-[8px] mt-0.5 truncate ${detailTone}` : `text-[10px] mt-0.5 truncate ${detailTone}`
        return (
          <ModelBadge
            key={artifact.key}
            modelId={artifact.modelId}
            active={Boolean(artifact.isWinner)}
            onClick={() => onSelectMember(artifact.key)}
            className={cardClass}
          >
            <div className="min-w-0 text-left flex-1">
              <div className={nameClass}>{getModelDisplayName(artifact.modelId)}</div>
              {showStatus && (
                <div className={subClass}>
                  {getCouncilStatusEmoji(artifact.outcome, artifact.action)} {getCouncilStatusLabel(artifact.outcome, artifact.action)}
                </div>
              )}
              {artifact.detail && <div className={detailClass}>{artifact.detail}</div>}
            </div>
          </ModelBadge>
        )
      })}
    </>
  )
}
