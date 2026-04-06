import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { LoadingText } from '@/components/ui/LoadingText'
import { ModelPicker } from './ModelPicker'
import { EffortPicker } from './EffortPicker'
import { useProfile, useCreateProfile, useUpdateProfile } from '@/hooks/useProfile'
import type { CreateProfileInput } from '@/hooks/useProfile'
import { Plus, X } from 'lucide-react'
import { useToast } from '@/components/shared/useToast'
import { PROFILE_DEFAULTS } from '@server/db/defaults'
import { useQueryClient } from '@tanstack/react-query'
import { useOpenCodeModels, refetchOpenCodeModelsQuery } from '@/hooks/useOpenCodeModels'
import { numericFields, hasNumericErrors, buildInitialRawNumeric } from './numericFieldConfig'
import { NumericField } from './profileNumericUtils'

interface ProfileSetupProps {
  onClose: () => void
}

export function ProfileSetup({ onClose }: ProfileSetupProps) {
  const { data: profile } = useProfile()
  const createProfile = useCreateProfile()
  const updateProfile = useUpdateProfile()
  const { addToast } = useToast()
  const queryClient = useQueryClient()

  const [formData, setFormData] = useState<CreateProfileInput>({
    mainImplementer: profile?.mainImplementer ?? '',
    minCouncilQuorum: profile?.minCouncilQuorum ?? PROFILE_DEFAULTS.minCouncilQuorum,
    perIterationTimeout: profile?.perIterationTimeout ?? PROFILE_DEFAULTS.perIterationTimeout,
    councilResponseTimeout: profile?.councilResponseTimeout ?? PROFILE_DEFAULTS.councilResponseTimeout,
    interviewQuestions: profile?.interviewQuestions ?? PROFILE_DEFAULTS.interviewQuestions,
    coverageFollowUpBudgetPercent: profile?.coverageFollowUpBudgetPercent ?? PROFILE_DEFAULTS.coverageFollowUpBudgetPercent,
    maxCoveragePasses: profile?.maxCoveragePasses ?? PROFILE_DEFAULTS.maxCoveragePasses,
    maxIterations: profile?.maxIterations ?? PROFILE_DEFAULTS.maxIterations,
  })

  const [rawNumeric, setRawNumeric] = useState<Record<string, string>>(() => buildInitialRawNumeric({ ...formData }))

  const hasErrors = hasNumericErrors(rawNumeric)

  const [councilSlots, setCouncilSlots] = useState<string[]>([])

  // Variant state: per-model variant selections
  const [mainVariant, setMainVariant] = useState<string | undefined>(undefined)
  const [councilVariants, setCouncilVariants] = useState<Record<string, string>>({})

  // Models data for variant info
  const { data: models } = useOpenCodeModels()
  const modelVariantMap = useMemo(() => {
    const map = new Map<string, Record<string, Record<string, unknown>>>()
    if (models) {
      for (const m of models) {
        if (m.variants && Object.keys(m.variants).length > 0) {
          map.set(m.fullId, m.variants)
        }
      }
    }
    return map
  }, [models])
  // Sync form state when profile data loads
  useEffect(() => {
    if (!profile) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFormData({
      mainImplementer: profile.mainImplementer ?? '',
      minCouncilQuorum: profile.minCouncilQuorum ?? PROFILE_DEFAULTS.minCouncilQuorum,
      perIterationTimeout: profile.perIterationTimeout ?? PROFILE_DEFAULTS.perIterationTimeout,
      councilResponseTimeout: profile.councilResponseTimeout ?? PROFILE_DEFAULTS.councilResponseTimeout,
      interviewQuestions: profile.interviewQuestions ?? PROFILE_DEFAULTS.interviewQuestions,
      coverageFollowUpBudgetPercent: profile.coverageFollowUpBudgetPercent ?? PROFILE_DEFAULTS.coverageFollowUpBudgetPercent,
      maxCoveragePasses: profile.maxCoveragePasses ?? PROFILE_DEFAULTS.maxCoveragePasses,
      maxIterations: profile.maxIterations ?? PROFILE_DEFAULTS.maxIterations,
    })
    setRawNumeric({
      perIterationTimeout: numericFields.perIterationTimeout.fromStore(profile.perIterationTimeout ?? PROFILE_DEFAULTS.perIterationTimeout),
      councilResponseTimeout: numericFields.councilResponseTimeout.fromStore(profile.councilResponseTimeout ?? PROFILE_DEFAULTS.councilResponseTimeout),
      maxIterations: String(profile.maxIterations ?? PROFILE_DEFAULTS.maxIterations),
      minCouncilQuorum: String(profile.minCouncilQuorum ?? PROFILE_DEFAULTS.minCouncilQuorum),
      interviewQuestions: String(profile.interviewQuestions ?? PROFILE_DEFAULTS.interviewQuestions),
      coverageFollowUpBudgetPercent: String(profile.coverageFollowUpBudgetPercent ?? PROFILE_DEFAULTS.coverageFollowUpBudgetPercent),
      maxCoveragePasses: String(profile.maxCoveragePasses ?? PROFILE_DEFAULTS.maxCoveragePasses),
    })
    // Restore variant state
    setMainVariant(profile.mainImplementerVariant ?? undefined)
    try {
      const parsed = profile.councilMemberVariants ? JSON.parse(profile.councilMemberVariants) : {}
      setCouncilVariants(typeof parsed === 'object' && parsed !== null ? parsed : {})
    } catch {
      setCouncilVariants({})
    }
    try {
      const council: string[] = profile.councilMembers ? JSON.parse(profile.councilMembers) : []
      setCouncilSlots(council.filter(id => id !== profile.mainImplementer))
    } catch {
      setCouncilSlots([])
    }
  }, [profile])

  const [openCodeConnected, setOpenCodeConnected] = useState<boolean | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/health/opencode', { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          setOpenCodeConnected(false)
          return
        }

        const payload = await res.json().catch(() => null) as { status?: string } | null
        setOpenCodeConnected(payload?.status === 'ok')
      })
      .catch((err) => { if (err.name !== 'AbortError') setOpenCodeConnected(false) })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (openCodeConnected !== true) return

    // The model query can race the OpenCode health check on mount.
    void refetchOpenCodeModelsQuery(queryClient)
  }, [openCodeConnected, queryClient])

  useEffect(() => {
    const err = createProfile.error || updateProfile.error
    if (!err) return

    const message = err instanceof Error ? err.message : 'Failed to save configuration'
    addToast('error', message, 5000)
  }, [createProfile.error, updateProfile.error, addToast])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (hasErrors) return
    // Build payload with validated numeric values
    const validatedData = { ...formData }
    for (const [key, cfg] of Object.entries(numericFields)) {
      const n = Number(rawNumeric[key]);
      (validatedData as Record<string, unknown>)[key] = cfg.toStore(n)
    }
    const allCouncil = [validatedData.mainImplementer, ...councilSlots].filter((x): x is string => Boolean(x))
    const uniqueCouncil = [...new Set(allCouncil)]
    // Build council member variants map (only for members with a variant set)
    const variantsMap: Record<string, string> = {}
    for (const modelId of uniqueCouncil) {
      if (modelId === validatedData.mainImplementer) continue
      const v = councilVariants[modelId]
      if (v) variantsMap[modelId] = v
    }
    const payload: CreateProfileInput = {
      ...validatedData,
      councilMembers: JSON.stringify(uniqueCouncil),
      mainImplementerVariant: mainVariant ?? '',
      councilMemberVariants: Object.keys(variantsMap).length > 0 ? JSON.stringify(variantsMap) : '',
    }
    const handleSuccess = () => {
      addToast('success', 'Configuration saved.')
      onClose()
    }
    if (profile) {
      updateProfile.mutate(payload, { onSuccess: handleSuccess })
    } else {
      createProfile.mutate(payload, { onSuccess: handleSuccess })
    }
  }

  const updateField = <K extends keyof CreateProfileInput>(key: K, value: CreateProfileInput[K]) => {
    setFormData(prev => ({ ...prev, [key]: value }))
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-sm">Configuration</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          {/* ── AI Models ── */}
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">AI Models</div>
          <div>
            <label className="text-sm font-medium block mb-1" htmlFor="main-implementer">
              Main Implementer Model
            </label>
            <ModelPicker
              value={formData.mainImplementer ?? ''}
              onChange={v => {
                updateField('mainImplementer', v)
                // Reset variant if new model doesn't support current variant
                const newVariants = modelVariantMap.get(v)
                if (!newVariants || (mainVariant && !(mainVariant in newVariants))) {
                  setMainVariant(undefined)
                }
              }}
              disabledValues={councilSlots.filter(Boolean)}
            />
            {formData.mainImplementer && (
              <div className="mt-1.5">
                <EffortPicker
                  variants={modelVariantMap.get(formData.mainImplementer)}
                  value={mainVariant}
                  onChange={setMainVariant}
                />
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Primary model used for code generation and implementation</p>
            {openCodeConnected === false && (
              <div className="mt-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                LoopTroop could not reach the configured OpenCode server. Start it with <code className="font-mono bg-muted-foreground/10 px-1 rounded">opencode serve</code> or check the backend OpenCode URL.
              </div>
            )}
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">Council Members</label>
            <p className="text-xs text-muted-foreground mb-2">
              Choose up to 4 models to form the review council. The main implementer is automatically included.
            </p>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-lg border border-input bg-muted/40 px-3 py-2.5 text-sm">
                  <span className="font-medium">{formData.mainImplementer || '(select main implementer above)'}</span>
                  <span className="ml-2 text-[10px] text-muted-foreground">MAI — auto-included</span>
                </div>
              </div>
              {councilSlots.map((slot, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex-1 space-y-1.5">
                    <ModelPicker
                      value={slot}
                      onChange={v => {
                        setCouncilSlots(prev => prev.map((s, j) => j === i ? v : s))
                        // Reset variant if new model doesn't support current variant
                        const newVariants = modelVariantMap.get(v)
                        const oldVariant = councilVariants[slot]
                        if (slot && slot !== v) {
                          setCouncilVariants(prev => {
                            const next = { ...prev }
                            delete next[slot]
                            if (oldVariant && newVariants && oldVariant in newVariants) {
                              next[v] = oldVariant
                            }
                            return next
                          })
                        }
                      }}
                      placeholder={`Council member ${i + 2}…`}
                      disabledValues={[formData.mainImplementer, ...councilSlots.filter((_, j) => j !== i)].filter(Boolean) as string[]}
                    />
                    {slot && (
                      <EffortPicker
                        variants={modelVariantMap.get(slot)}
                        value={councilVariants[slot]}
                        onChange={v => setCouncilVariants(prev => {
                          const next = { ...prev }
                          if (v) next[slot] = v
                          else delete next[slot]
                          return next
                        })}
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const removedSlot = councilSlots[i]
                      setCouncilSlots(prev => prev.filter((_, j) => j !== i))
                      if (removedSlot) {
                        setCouncilVariants(prev => {
                          const next = { ...prev }
                          delete next[removedSlot]
                          return next
                        })
                      }
                    }}
                    className="p-2 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    aria-label={`Remove council member ${i + 2}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {councilSlots.length < 3 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCouncilSlots(prev => [...prev, ''])}
                  className="gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Council Member
                </Button>
              )}
              {councilSlots.filter(Boolean).length < 1 && (
                <p className="text-xs text-amber-600">
                  Add at least 1 more council member (MAI + 1 minimum).
                </p>
              )}
            </div>
          </div>

          <Separator />

          {/* ── AI Thinking ── */}
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">AI Thinking</div>
          <div className="grid grid-cols-2 gap-3">
            <NumericField fieldKey="councilResponseTimeout" rawNumeric={rawNumeric} onChange={(k, v) => setRawNumeric(prev => ({ ...prev, [k]: v }))} hint="Wait time for council responses (10–3600s)" />
            <NumericField fieldKey="minCouncilQuorum" rawNumeric={rawNumeric} onChange={(k, v) => setRawNumeric(prev => ({ ...prev, [k]: v }))} hint="Minimum council votes required (1–4)" />
          </div>
          <div className="mt-3">
            <NumericField fieldKey="interviewQuestions" rawNumeric={rawNumeric} onChange={(k, v) => setRawNumeric(prev => ({ ...prev, [k]: v }))} hint="Maximum clarifying questions (5–50)" />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <NumericField fieldKey="coverageFollowUpBudgetPercent" rawNumeric={rawNumeric} onChange={(k, v) => setRawNumeric(prev => ({ ...prev, [k]: v }))} hint="Maximum interview follow-up budget for coverage passes (0–100%)" />
            <NumericField fieldKey="maxCoveragePasses" rawNumeric={rawNumeric} onChange={(k, v) => setRawNumeric(prev => ({ ...prev, [k]: v }))} hint="Interview coverage executions allowed before approval fallback (1–10). PRD and Beads use a fixed 3-pass loop." />
          </div>

          <Separator />

          {/* ── Execution Phase ── */}
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Execution Phase</div>
          <div className="grid grid-cols-2 gap-3">
            <NumericField fieldKey="maxIterations" rawNumeric={rawNumeric} onChange={(k, v) => setRawNumeric(prev => ({ ...prev, [k]: v }))} hint="Maximum implementation attempts (1–20)" />
            <NumericField fieldKey="perIterationTimeout" rawNumeric={rawNumeric} onChange={(k, v) => setRawNumeric(prev => ({ ...prev, [k]: v }))} hint="Timeout for each attempt (10–3600s)" />
          </div>

          {openCodeConnected !== null && (
            <>
              <Separator />
              <div className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${openCodeConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-xs text-muted-foreground">
                  {openCodeConnected ? 'OpenCode connected' : 'OpenCode not connected'}
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={createProfile.isPending || updateProfile.isPending || hasErrors}>
          {createProfile.isPending || updateProfile.isPending ? <LoadingText text="Saving" /> : 'Save'}
        </Button>
      </div>
    </form>
  )
}
