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
  onSelectMember: (key: string) => void
}

export function ArtifactList({ memberArtifacts, compactInterviewArtifacts, onSelectMember }: ArtifactListProps) {
  return (
    <>
      {memberArtifacts.map((artifact: CouncilMemberArtifactChip) => {
        const detailTone = artifact.outcome === 'failed' || artifact.outcome === 'invalid_output'
          ? 'text-red-400'
          : artifact.outcome === 'timed_out'
            ? 'text-amber-400'
            : 'text-blue-400'
        return (
          <ModelBadge
            key={artifact.key}
            modelId={artifact.modelId}
            active={Boolean(artifact.isWinner)}
            onClick={() => onSelectMember(artifact.key)}
            className={compactInterviewArtifacts
              ? 'min-w-[150px] max-w-[220px] px-3 py-2 h-auto flex-none items-start gap-2'
              : 'min-w-[220px] flex-1 px-3 py-2 h-auto items-start gap-2'}
          >
            <div className="min-w-0 text-left flex-1">
              <div className="text-xs font-medium truncate">{getModelDisplayName(artifact.modelId)}</div>
              {!compactInterviewArtifacts && (
                <div className="text-[10px] opacity-80 mt-0.5">
                  {getCouncilStatusEmoji(artifact.outcome, artifact.action)} {getCouncilStatusLabel(artifact.outcome, artifact.action)}
                </div>
              )}
              {artifact.detail && <div className={`text-[10px] mt-0.5 ${detailTone}`}>{artifact.detail}</div>}
            </div>
          </ModelBadge>
        )
      })}
    </>
  )
}
