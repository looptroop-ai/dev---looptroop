import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { ModelPicker } from './ModelPicker'
import { useProfile, useCreateProfile, useUpdateProfile } from '@/hooks/useProfile'
import type { CreateProfileInput } from '@/hooks/useProfile'
import { Plus, X, Search, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { emojiMatchesSearch } from '@/lib/emojiNames'
import { DropdownPicker } from '@/components/shared/DropdownPicker'
import { PROFILE_DEFAULTS } from '@server/db/defaults'

const FAVORITE_EMOJIS = ['😀', '📁', '🔧', '🎨', '🐱', '❤️', '✈️', '🎮', '🌲', '🔥']

const EMOJI_CATEGORIES = [
  { name: 'Smileys', emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤗', '🤭', '🫢', '🫣', '🤫', '🤔'] },
  { name: 'Animals', emojis: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🦄', '🐝', '🐕', '🐈', '🐙', '🦋', '🐳'] },
  { name: 'Food & Drink', emojis: ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥝', '🍅', '🥑', '🍆', '🌽', '🥕', '🧄', '🧅', '🥔', '🍠', '🌶️', '🥒', '🥬', '🥦', '🧈', '🍕', '☕', '🍔', '🎂', '🍿', '🥤', '🍩', '🧁', '🌮'] },
  { name: 'Nature', emojis: ['🌸', '🌺', '🌻', '🌹', '🌷', '🌼', '🌵', '🌲', '🌳', '🌴', '🍀', '🍁', '🍂', '🍃', '🌾', '🌱', '🪴', '🎍', '🪸', '🍄', '🪨', '🌍', '🌎', '🌏', '🌕', '🌙', '⭐', '🌟', '💫', '✨', '🌊', '🔥', '🌿', '🌈', '☀️'] },
  { name: 'Objects', emojis: ['📦', '💻', '🖥️', '⌨️', '🖱️', '⚙️', '🔧', '🛠️', '🔌', '📡', '🔬', '🧪', '🔭', '📱', '💾', '💿', '📀', '🎥', '📷', '📸', '🔑', '🔒', '🗝️', '🧰', '📐', '📎', '🖊️', '✏️', '🔗', '📌', '📁', '📂', '📋', '📝', '📄', '📑', '🗂️', '💼', '🎒'] },
  { name: 'Tech & Science', emojis: ['🔩', '🔨', '📊', '📈', '📉', '🧮', '🧬', '🔎', '🔍', '💡', '⚡', '📧', '✉️', '📮', '📯', '💬', '💭', '📢', '📣', '🛰️'] },
  { name: 'Transport', emojis: ['🚀', '✈️', '🚁', '🚂', '🚗', '🛸', '⛵', '🏎️', '🚧'] },
  { name: 'Symbols', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '💯', '✅', '❌', '⭕', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⬜', '🔶', '🔷', '🔺', '🔻', '💠', '🏁', '💎', '🏆', '🎖️', '🏅', '👑', '💰', '💳'] },
  { name: 'Activities', emojis: ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏉', '🎱', '🏓', '🏸', '🥅', '🏒', '🏑', '🥊', '🎮', '🎯', '🎳', '🎸', '🎹', '🎺', '🎻', '🪘', '🎨', '🎬', '🎤', '🎧', '📚', '🎭', '🃏', '♟️', '🏋️', '🧗', '🏄', '🎲', '🎵'] },
  { name: 'Health', emojis: ['🏥', '💊', '🩺', '🩹', '❤️‍🩹', '🧠', '👁️', '💉', '🦷', '🫀'] },
]

interface ProfileSetupProps {
  onClose: () => void
}

export function ProfileSetup({ onClose }: ProfileSetupProps) {
  const { data: profile } = useProfile()
  const createProfile = useCreateProfile()
  const updateProfile = useUpdateProfile()

  const [formData, setFormData] = useState<CreateProfileInput>({
    username: profile?.username ?? '',
    icon: profile?.icon ?? '🧑‍💻',
    background: profile?.background ?? '',
    mainImplementer: profile?.mainImplementer ?? '',
    minCouncilQuorum: profile?.minCouncilQuorum ?? PROFILE_DEFAULTS.minCouncilQuorum,
    perIterationTimeout: profile?.perIterationTimeout ?? PROFILE_DEFAULTS.perIterationTimeout,
    councilResponseTimeout: profile?.councilResponseTimeout ?? PROFILE_DEFAULTS.councilResponseTimeout,
    interviewQuestions: profile?.interviewQuestions ?? PROFILE_DEFAULTS.interviewQuestions,
    maxIterations: profile?.maxIterations ?? PROFILE_DEFAULTS.maxIterations,
  })

  // Raw string state for numeric fields so users can freely type
  const numericFields = {
    perIterationTimeout: { min: 10, max: 3600, label: 'Per-Iteration Timeout', fromStore: (v: number) => String(Math.round(v / 1000)), toStore: (v: number) => v * 1000 },
    councilResponseTimeout: { min: 10, max: 3600, label: 'Council Response Timeout', fromStore: (v: number) => String(Math.round(v / 1000)), toStore: (v: number) => v * 1000 },
    maxIterations: { min: 1, max: 20, label: 'Max Iterations', fromStore: (v: number) => String(v), toStore: (v: number) => v },
    minCouncilQuorum: { min: 2, max: 4, label: 'Min Council Quorum', fromStore: (v: number) => String(v), toStore: (v: number) => v },
    interviewQuestions: { min: 5, max: 50, label: 'Max Interview Questions', fromStore: (v: number) => String(v), toStore: (v: number) => v },
  } as const

  const [rawNumeric, setRawNumeric] = useState<Record<string, string>>(() => ({
    perIterationTimeout: numericFields.perIterationTimeout.fromStore(formData.perIterationTimeout ?? PROFILE_DEFAULTS.perIterationTimeout),
    councilResponseTimeout: numericFields.councilResponseTimeout.fromStore(formData.councilResponseTimeout ?? PROFILE_DEFAULTS.councilResponseTimeout),
    maxIterations: String(formData.maxIterations ?? PROFILE_DEFAULTS.maxIterations),
    minCouncilQuorum: String(formData.minCouncilQuorum ?? PROFILE_DEFAULTS.minCouncilQuorum),
    interviewQuestions: String(formData.interviewQuestions ?? PROFILE_DEFAULTS.interviewQuestions),
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
  const [iconOpen, setIconOpen] = useState(false)
  const [emojiSearch, setEmojiSearch] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Sync form state when profile data loads
  useEffect(() => {
    if (!profile) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFormData({
      username: profile.username ?? '',
      icon: profile.icon ?? '🧑‍💻',
      background: profile.background ?? '',
      mainImplementer: profile.mainImplementer ?? '',
      minCouncilQuorum: profile.minCouncilQuorum ?? PROFILE_DEFAULTS.minCouncilQuorum,
      perIterationTimeout: profile.perIterationTimeout ?? PROFILE_DEFAULTS.perIterationTimeout,
      councilResponseTimeout: profile.councilResponseTimeout ?? PROFILE_DEFAULTS.councilResponseTimeout,
      interviewQuestions: profile.interviewQuestions ?? PROFILE_DEFAULTS.interviewQuestions,
      maxIterations: profile.maxIterations ?? PROFILE_DEFAULTS.maxIterations,
    })
    setRawNumeric({
      perIterationTimeout: numericFields.perIterationTimeout.fromStore(profile.perIterationTimeout ?? PROFILE_DEFAULTS.perIterationTimeout),
      councilResponseTimeout: numericFields.councilResponseTimeout.fromStore(profile.councilResponseTimeout ?? PROFILE_DEFAULTS.councilResponseTimeout),
      maxIterations: String(profile.maxIterations ?? PROFILE_DEFAULTS.maxIterations),
      minCouncilQuorum: String(profile.minCouncilQuorum ?? PROFILE_DEFAULTS.minCouncilQuorum),
      interviewQuestions: String(profile.interviewQuestions ?? PROFILE_DEFAULTS.interviewQuestions),
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
    fetch('http://localhost:4096/api/health')
      .then(res => { setOpenCodeConnected(res.ok) })
      .catch(() => { setOpenCodeConnected(false) })
  }, [])

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
    const payload = { ...validatedData, councilMembers: JSON.stringify(uniqueCouncil) }
    if (profile) {
      updateProfile.mutate(payload, { onSuccess: onClose })
    } else {
      createProfile.mutate(payload, { onSuccess: onClose })
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

          {/* ── Profile ── */}
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Profile</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium block mb-1">Username</label>
              <input
                type="text"
                value={formData.username}
                onChange={e => updateField('username', e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                required
              />
              <p className="text-xs text-muted-foreground mt-1">Your display name across the app</p>
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Icon</label>
              <DropdownPicker
                open={iconOpen}
                onOpenChange={setIconOpen}
                trigger={
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="text-2xl leading-none">{formData.icon?.startsWith('data:') ? <img src={formData.icon} className="h-6 w-6 rounded" alt="icon" /> : (formData.icon ?? '🧑‍💻')}</span>
                    <span className="text-muted-foreground text-xs">Change</span>
                    <svg className="h-3.5 w-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                }
              >
                <div className="w-80">
                  <div className="mb-2 rounded-md border border-input bg-muted/30 p-2">
                    <div className="text-xs text-muted-foreground mb-1">
                      Upload your own image or select one below.
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        const reader = new FileReader()
                        reader.onload = () => {
                          const img = new Image()
                          img.onload = () => {
                            const maxSize = 128
                            let w = img.width
                            let h = img.height
                            if (w > maxSize || h > maxSize) {
                              const ratio = Math.min(maxSize / w, maxSize / h)
                              w = Math.round(w * ratio)
                              h = Math.round(h * ratio)
                            }
                            const canvas = document.createElement('canvas')
                            canvas.width = w
                            canvas.height = h
                            const ctx = canvas.getContext('2d')!
                            ctx.drawImage(img, 0, 0, w, h)
                            updateField('icon', canvas.toDataURL('image/png'))
                            setIconOpen(false)
                          }
                          img.src = reader.result as string
                        }
                        reader.readAsDataURL(file)
                      }}
                    />
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 border border-input rounded-md px-3 py-1.5 text-sm font-medium hover:bg-muted transition"
                      onClick={() => fileInputRef.current?.click()}
                      title="Upload custom icon image"
                    >
                      <Upload className="h-4 w-4" />
                      Upload image
                    </button>
                  </div>

                  {/* Search bar */}
                  <div className="flex items-center gap-2 rounded-md border border-input bg-background px-2 py-1.5 mb-2">
                    <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <input
                      type="text"
                      value={emojiSearch}
                      onChange={e => setEmojiSearch(e.target.value)}
                      className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                      placeholder="Search or type emoji..."
                      autoComplete="off"
                    />
                    {emojiSearch && (
                      <button type="button" onClick={() => setEmojiSearch('')} className="text-muted-foreground hover:text-foreground">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="max-h-[320px] overflow-y-auto pr-1">
                    {emojiSearch ? (
                      <div className="grid grid-cols-8 gap-1">
                        {EMOJI_CATEGORIES.flatMap(c => c.emojis)
                          .filter(e => emojiMatchesSearch(e, emojiSearch))
                          .map(emoji => (
                            <button
                              key={emoji}
                              type="button"
                              className={cn(
                                'rounded-md p-1.5 text-xl transition hover:scale-110 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                                formData.icon === emoji && 'ring-2 ring-primary bg-muted/70',
                              )}
                              onClick={() => { updateField('icon', emoji); setIconOpen(false); setEmojiSearch('') }}
                              aria-label={`Select ${emoji}`}
                            >
                              {emoji}
                            </button>
                          ))}
                      </div>
                    ) : (
                      <>
                        {/* Favorites row */}
                        <div className="grid grid-cols-8 gap-1 mb-2">
                          {FAVORITE_EMOJIS.map(emoji => (
                            <button
                              key={`fav-${emoji}`}
                              type="button"
                              className={cn(
                                'rounded-md p-1.5 text-xl transition hover:scale-110 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                                formData.icon === emoji && 'ring-2 ring-primary bg-muted/70',
                              )}
                              onClick={() => { updateField('icon', emoji); setIconOpen(false) }}
                              aria-label={`Select ${emoji}`}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>

                        {/* Categories */}
                        {EMOJI_CATEGORIES.map(cat => (
                          <div key={cat.name} className="mb-2">
                            <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">{cat.name}</div>
                            <div className="grid grid-cols-8 gap-1">
                              {cat.emojis.map(emoji => (
                                <button
                                  key={emoji}
                                  type="button"
                                  className={cn(
                                    'rounded-md p-1.5 text-xl transition hover:scale-110 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                                    formData.icon === emoji && 'ring-2 ring-primary bg-muted/70',
                                  )}
                                  onClick={() => { updateField('icon', emoji); setIconOpen(false) }}
                                  aria-label={`Select ${emoji}`}
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>

                </div>
              </DropdownPicker>
              <p className="text-xs text-muted-foreground mt-1">Emoji avatar for your profile</p>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">Background</label>
            <textarea
              value={formData.background ?? ''}
              onChange={e => updateField('background', e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[100px]"
              placeholder="Your background, expertise, and coding preferences..."
            />
            <p className="text-xs text-muted-foreground mt-1">Used to personalize AI interactions</p>
          </div>

          <Separator />

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
                OpenCode server not reachable on port 4096. Start it with <code className="font-mono bg-muted-foreground/10 px-1 rounded">opencode serve</code>
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
              <label className="text-sm font-medium block mb-1">Council Response Timeout (s)</label>
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
                <p className="text-xs text-muted-foreground mt-1">Minimum council votes required (2–4)</p>
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
          {profile ? 'Update Configuration' : 'Save Configuration'}
        </Button>
      </div>
    </form>
  )
}
