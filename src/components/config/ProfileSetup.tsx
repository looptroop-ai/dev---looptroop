import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { LoadingText } from '@/components/ui/LoadingText'
import { ModelPicker } from './ModelPicker'
import { useProfile, useCreateProfile, useUpdateProfile } from '@/hooks/useProfile'
import type { CreateProfileInput } from '@/hooks/useProfile'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/shared/Toast'
import { PROFILE_DEFAULTS } from '@server/db/defaults'
import { useQueryClient } from '@tanstack/react-query'
import { refetchOpenCodeModelsQuery } from '@/hooks/useOpenCodeModels'

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

  // Raw string state for numeric fields so users can freely type
  const numericFields = {
    perIterationTimeout: { min: 0, max: 3600, label: 'Per-Iteration Timeout', fromStore: (v: number) => String(Math.round(v / 1000)), toStore: (v: number) => v * 1000 },
    councilResponseTimeout: { min: 10, max: 3600, label: 'AI Response Timeout', fromStore: (v: number) => String(Math.round(v / 1000)), toStore: (v: number) => v * 1000 },
    maxIterations: { min: 0, max: 20, label: 'Max Iterations', fromStore: (v: number) => String(v), toStore: (v: number) => v },
    minCouncilQuorum: { min: 1, max: 4, label: 'Min Council Quorum', fromStore: (v: number) => String(v), toStore: (v: number) => v },
    interviewQuestions: { min: 0, max: 50, label: 'Max Interview Questions', fromStore: (v: number) => String(v), toStore: (v: number) => v },
    coverageFollowUpBudgetPercent: { min: 0, max: 100, label: 'Coverage Follow-Up Budget', fromStore: (v: number) => String(v), toStore: (v: number) => v },
    maxCoveragePasses: { min: 1, max: 10, label: 'Max Coverage Passes', fromStore: (v: number) => String(v), toStore: (v: number) => v },
  } as const

  const [rawNumeric, setRawNumeric] = useState<Record<string, string>>(() => ({
    perIterationTimeout: numericFields.perIterationTimeout.fromStore(formData.perIterationTimeout ?? PROFILE_DEFAULTS.perIterationTimeout),
    councilResponseTimeout: numericFields.councilResponseTimeout.fromStore(formData.councilResponseTimeout ?? PROFILE_DEFAULTS.councilResponseTimeout),
    maxIterations: String(formData.maxIterations ?? PROFILE_DEFAULTS.maxIterations),
    minCouncilQuorum: String(formData.minCouncilQuorum ?? PROFILE_DEFAULTS.minCouncilQuorum),
    interviewQuestions: String(formData.interviewQuestions ?? PROFILE_DEFAULTS.interviewQuestions),
    coverageFollowUpBudgetPercent: String(formData.coverageFollowUpBudgetPercent ?? PROFILE_DEFAULTS.coverageFollowUpBudgetPercent),
    maxCoveragePasses: String(formData.maxCoveragePasses ?? PROFILE_DEFAULTS.maxCoveragePasses),
  }))

  const getFieldError = (key: keyof typeof numericFields): string | null => {
    const raw = rawNumeric[key]
    const cfg = numericFields[key]
    if (raw === '' || raw === undefined) return `Required (${cfg.min}–${cfg.max})`
    const n = Number(raw)
    if (isNaN(n) || !Number.isInteger(n)) return `Must be a whole number (${cfg.min}–${cfg.max})`
    if (n < cfg.min) return `Minimum is ${cfg.min}`
    if (n > cfg.max) return `Maximum is ${cfg.max}`
    return null
  }

  const hasNumericErrors = (Object.keys(numericFields) as (keyof typeof numericFields)[]).some(k => getFieldError(k) !== null)

  const [councilSlots, setCouncilSlots] = useState<string[]>([])

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
    try {
      const council: string[] = profile.councilMembers ? JSON.parse(profile.councilMembers) : []
      setCouncilSlots(council.filter(id => id !== profile.mainImplementer))
    } catch {
      setCouncilSlots([])
    }
  }, [profile])

  const [openCodeConnected, setOpenCodeConnected] = useState<boolean | null>(null)

  useEffect(() => {
    fetch('/api/health/opencode')
      .then(async (res) => {
        if (!res.ok) {
          setOpenCodeConnected(false)
          return
        }

        const payload = await res.json().catch(() => null) as { status?: string } | null
        setOpenCodeConnected(payload?.status === 'ok')
      })
      .catch(() => { setOpenCodeConnected(false) })
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
    if (hasNumericErrors) return
    // Build payload with validated numeric values
    const validatedData = { ...formData }
    for (const [key, cfg] of Object.entries(numericFields)) {
      const n = Number(rawNumeric[key]);
      (validatedData as Record<string, unknown>)[key] = cfg.toStore(n)
    }
    const allCouncil = [validatedData.mainImplementer, ...councilSlots].filter(Boolean)
    const uniqueCouncil = [...new Set(allCouncil)]
    const payload: CreateProfileInput = {
      ...validatedData,
      councilMembers: JSON.stringify(uniqueCouncil),
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
              onChange={v => updateField('mainImplementer', v)}
              disabledValues={councilSlots.filter(Boolean)}
            />
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
                  <div className="flex-1">
                    <ModelPicker
                      value={slot}
                      onChange={v => {
                        setCouncilSlots(prev => prev.map((s, j) => j === i ? v : s))
                      }}
                      placeholder={`Council member ${i + 2}…`}
                      disabledValues={[formData.mainImplementer, ...councilSlots.filter((_, j) => j !== i)].filter(Boolean) as string[]}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setCouncilSlots(prev => prev.filter((_, j) => j !== i))}
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
            <div>
              <label className="text-sm font-medium block mb-1">AI Response Timeout (s)</label>
              <input
                type="number"
                value={rawNumeric.councilResponseTimeout}
                onChange={e => setRawNumeric(prev => ({ ...prev, councilResponseTimeout: e.target.value }))}
                className={cn("w-full rounded-md border bg-background px-3 py-2 text-sm", getFieldError('councilResponseTimeout') ? 'border-red-500' : 'border-input')}
              />
              {getFieldError('councilResponseTimeout') ? (
                <p className="text-xs text-red-500 mt-1">{getFieldError('councilResponseTimeout')}</p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">Wait time for council responses (10–3600s)</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Min Council Quorum</label>
              <input
                type="number"
                value={rawNumeric.minCouncilQuorum}
                onChange={e => setRawNumeric(prev => ({ ...prev, minCouncilQuorum: e.target.value }))}
                className={cn("w-full rounded-md border bg-background px-3 py-2 text-sm", getFieldError('minCouncilQuorum') ? 'border-red-500' : 'border-input')}
              />
              {getFieldError('minCouncilQuorum') ? (
                <p className="text-xs text-red-500 mt-1">{getFieldError('minCouncilQuorum')}</p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">Minimum council votes required (1–4)</p>
              )}
            </div>
          </div>
          <div className="mt-3">
            <label className="text-sm font-medium block mb-1">Max Interview Questions</label>
            <input
              type="number"
              value={rawNumeric.interviewQuestions}
              onChange={e => setRawNumeric(prev => ({ ...prev, interviewQuestions: e.target.value }))}
              className={cn("w-full rounded-md border bg-background px-3 py-2 text-sm", getFieldError('interviewQuestions') ? 'border-red-500' : 'border-input')}
            />
            {getFieldError('interviewQuestions') ? (
              <p className="text-xs text-red-500 mt-1">{getFieldError('interviewQuestions')}</p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">Maximum clarifying questions (5–50)</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <label className="text-sm font-medium block mb-1">Coverage Follow-Up Budget (%)</label>
              <input
                type="number"
                value={rawNumeric.coverageFollowUpBudgetPercent}
                onChange={e => setRawNumeric(prev => ({ ...prev, coverageFollowUpBudgetPercent: e.target.value }))}
                className={cn("w-full rounded-md border bg-background px-3 py-2 text-sm", getFieldError('coverageFollowUpBudgetPercent') ? 'border-red-500' : 'border-input')}
              />
              {getFieldError('coverageFollowUpBudgetPercent') ? (
                <p className="text-xs text-red-500 mt-1">{getFieldError('coverageFollowUpBudgetPercent')}</p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">Maximum interview follow-up budget for coverage passes (0–100%)</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Max Coverage Passes</label>
              <input
                type="number"
                value={rawNumeric.maxCoveragePasses}
                onChange={e => setRawNumeric(prev => ({ ...prev, maxCoveragePasses: e.target.value }))}
                className={cn("w-full rounded-md border bg-background px-3 py-2 text-sm", getFieldError('maxCoveragePasses') ? 'border-red-500' : 'border-input')}
              />
              {getFieldError('maxCoveragePasses') ? (
                <p className="text-xs text-red-500 mt-1">{getFieldError('maxCoveragePasses')}</p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">Total coverage executions allowed per phase (1–10)</p>
              )}
            </div>
          </div>

          <Separator />

          {/* ── Execution Phase ── */}
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Execution Phase</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium block mb-1">Max Iterations</label>
              <input
                type="number"
                value={rawNumeric.maxIterations}
                onChange={e => setRawNumeric(prev => ({ ...prev, maxIterations: e.target.value }))}
                className={cn("w-full rounded-md border bg-background px-3 py-2 text-sm", getFieldError('maxIterations') ? 'border-red-500' : 'border-input')}
              />
              {getFieldError('maxIterations') ? (
                <p className="text-xs text-red-500 mt-1">{getFieldError('maxIterations')}</p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">Maximum implementation attempts (1–20)</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Per-Iteration Timeout (s)</label>
              <input
                type="number"
                value={rawNumeric.perIterationTimeout}
                onChange={e => setRawNumeric(prev => ({ ...prev, perIterationTimeout: e.target.value }))}
                className={cn("w-full rounded-md border bg-background px-3 py-2 text-sm", getFieldError('perIterationTimeout') ? 'border-red-500' : 'border-input')}
              />
              {getFieldError('perIterationTimeout') ? (
                <p className="text-xs text-red-500 mt-1">{getFieldError('perIterationTimeout')}</p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">Timeout for each attempt (10–3600s)</p>
              )}
            </div>
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
        <Button type="submit" disabled={createProfile.isPending || updateProfile.isPending || hasNumericErrors}>
          {createProfile.isPending || updateProfile.isPending ? <LoadingText text="Saving" /> : 'Save'}
        </Button>
      </div>
    </form>
  )
}
