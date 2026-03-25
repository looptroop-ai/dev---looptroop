export type RefinementChangeType = 'modified' | 'added' | 'removed'

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
}
