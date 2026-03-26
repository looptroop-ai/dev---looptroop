export type RefinementChangeType = 'modified' | 'added' | 'removed'
export type RefinementChangeAttributionStatus =
  | 'inspired'
  | 'model_unattributed'
  | 'synthesized_unattributed'
  | 'invalid_unattributed'

export interface RefinementChangeItem {
  id: string
  label: string
  detail?: string
}

export interface RefinementChangeInspiration {
  draftIndex: number
  memberId: string
  item: RefinementChangeItem
}

export interface RefinementChange {
  type: RefinementChangeType
  itemType?: string
  before?: RefinementChangeItem | null
  after?: RefinementChangeItem | null
  inspiration?: RefinementChangeInspiration | null
  attributionStatus?: RefinementChangeAttributionStatus
}
