import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCreateProject, useUpdateProject, useDeleteProject } from '@/hooks/useProjects'
import type { Project } from '@/hooks/useProjects'
import { useToast } from '@/components/shared/Toast'
import { ArrowLeft, Search, X, Upload, Trash2, CheckCircle2, XCircle, CircleDot } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DropdownPicker } from '@/components/shared/DropdownPicker'

const FAVORITE_EMOJIS = ['😀', '📁', '🔧', '🎨', '🐱', '❤️', '✈️', '🎮', '🌲', '🔥']

const EMOJI_CATEGORIES = [
  { name: 'Smileys', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤗','🤭','🫢','🫣','🤫','🤔'] },
  { name: 'Animals', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🦄','🐝','🐕','🐈','🐙','🦋','🐳'] },
  { name: 'Food & Drink', emojis: ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥝','🍅','🥑','🍆','🌽','🥕','🧄','🧅','🥔','🍠','🌶️','🥒','🥬','🥦','🧈','🍕','☕','🍔','🎂','🍿','🥤','🍩','🧁','🌮'] },
  { name: 'Nature', emojis: ['🌸','🌺','🌻','🌹','🌷','🌼','🌵','🌲','🌳','🌴','🍀','🍁','🍂','🍃','🌾','🌱','🪴','🎍','🪸','🍄','🪨','🌍','🌎','🌏','🌕','🌙','⭐','🌟','💫','✨','🌊','🔥','🌿','🌈','☀️'] },
  { name: 'Objects', emojis: ['📦','💻','🖥️','⌨️','🖱️','⚙️','🔧','🛠️','🔌','📡','🔬','🧪','🔭','📱','💾','💿','📀','🎥','📷','📸','🔑','🔒','🗝️','🧰','📐','📎','🖊️','✏️','🔗','📌','📁','📂','📋','📝','📄','📑','🗂️','💼','🎒'] },
  { name: 'Tech & Science', emojis: ['🔩','🔨','📊','📈','📉','🧮','🧬','🔎','🔍','💡','⚡','📧','✉️','📮','📯','💬','💭','📢','📣','🛰️'] },
  { name: 'Transport', emojis: ['🚀','✈️','🚁','🚂','🚗','🛸','⛵','🏎️','🚧'] },
  { name: 'Symbols', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','💯','✅','❌','⭕','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⬜','🔶','🔷','🔺','🔻','💠','🏁','💎','🏆','🎖️','🏅','👑','💰','💳'] },
  { name: 'Activities', emojis: ['⚽','🏀','🏈','⚾','🎾','🏐','🏉','🎱','🏓','🏸','🥅','🏒','🏑','🥊','🎮','🎯','🎳','🎸','🎹','🎺','🎻','🪘','🎨','🎬','🎤','🎧','📚','🎭','🃏','♟️','🏋️','🧗','🏄','🎲','🎵'] },
  { name: 'Health', emojis: ['🏥','💊','🩺','🩹','❤️‍🩹','🧠','👁️','💉','🦷','🫀'] },
]

const PROJECT_COLORS = [
  { name: 'Ocean Blue', value: '#0ea5e9' },
  { name: 'Royal Blue', value: '#3b82f6' },
  { name: 'Sapphire', value: '#2563eb' },
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Fuchsia', value: '#d946ef' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Rose', value: '#f43f5e' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Lime', value: '#84cc16' },
  { name: 'Slate', value: '#64748b' },
]

interface ProjectFormProps {
  onClose: () => void
  onBack?: () => void
  project?: Project
}

export function ProjectForm({ onClose, onBack, project }: ProjectFormProps) {
  const createProject = useCreateProject()
  const updateProject = useUpdateProject()
  const deleteProject = useDeleteProject()
  const { addToast } = useToast()
  const isEditing = !!project
  const [name, setName] = useState(project?.name ?? '')
  const [shortname, setShortname] = useState(project?.shortname ?? '')
  const [folder, setFolder] = useState(project?.folderPath ?? '')
  const [icon, setIcon] = useState(project?.icon ?? '📦')
  const [color, setColor] = useState(project?.color ?? '#3b82f6')
  const [iconOpen, setIconOpen] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)
  const [emojiSearch, setEmojiSearch] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const selectedColor = PROJECT_COLORS.find(c => c.value === color)
  const [gitStatus, setGitStatus] = useState<'none' | 'checking' | 'valid' | 'invalid'>('none')
  const supportsDirectoryPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window

  useEffect(() => {
    if (!folder.trim()) {
      setGitStatus('none')
      return
    }
    setGitStatus('checking')
    const timer = setTimeout(() => {
      fetch(`/api/projects/check-git?path=${encodeURIComponent(folder)}`)
        .then(r => r.json())
        .then(data => setGitStatus(data.isGit ? 'valid' : 'invalid'))
        .catch(() => setGitStatus('invalid'))
    }, 500)
    return () => clearTimeout(timer)
  }, [folder])

  const handleBrowseFolder = async () => {
    if (!supportsDirectoryPicker) return
    try {
      const directoryPickerWindow = window as Window & {
        showDirectoryPicker?: () => Promise<{ name: string }>
      }
      const directoryHandle = await directoryPickerWindow.showDirectoryPicker?.()
      if (!directoryHandle) return
      setFolder(directoryHandle.name)
    } catch {
      // User cancelled picker.
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isEditing) {
      updateProject.mutate({ id: project.id, name, icon, color }, { onSuccess: onBack ?? onClose })
    } else {
      createProject.mutate({ name, shortname, folderPath: folder, icon, color }, { onSuccess: onBack ?? onClose })
    }
  }

  const handleDelete = () => {
    if (!project) return
    if (!confirm('Are you sure you want to delete this project? This cannot be undone.')) return
    deleteProject.mutate(project.id, {
      onSuccess: () => (onBack ?? onClose)(),
      onError: (err) => {
        const message = (err as any)?.message || 'Failed to delete project'
        addToast('error', message, 5000)
      },
    })
  }

  // Show error in toast when mutation fails
  useEffect(() => {
    const err = createProject.error || updateProject.error
    if (err) {
      const message = (err as any)?.message || 'Failed to save project'
      addToast('error', message, 5000)
    }
  }, [createProject.error, updateProject.error, addToast])

  const isBusy = createProject.isPending || updateProject.isPending || deleteProject.isPending

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto space-y-6">
      {onBack && (
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to list
        </Button>
      )}
      <Card>
        <CardHeader><CardTitle className="text-sm">Project Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor="project-name" className="text-sm font-medium block mb-1">Project Name</label>
              <input
                id="project-name"
                name="projectName"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                autoComplete="off"
                required
              />
            </div>
            <div className="w-32">
              <label htmlFor="project-shortname" className="text-sm font-medium block mb-1">Short Name</label>
              {isEditing ? (
                <span className="inline-block px-3 py-2 text-sm font-mono text-muted-foreground uppercase">{shortname}</span>
              ) : (
                <input
                  id="project-shortname"
                  name="projectShortname"
                  type="text"
                  value={shortname}
                  onChange={e => setShortname(e.target.value.toUpperCase().slice(0, 5))}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm uppercase"
                  autoComplete="off"
                  minLength={3}
                  maxLength={5}
                  required
                />
              )}
            </div>
          </div>
          <div>
            <label className="text-sm font-medium block mb-2">Appearance</label>
            <div className="flex items-center gap-4">
              {/* Icon Dropdown */}
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Icon</span>
                <DropdownPicker
                  open={iconOpen}
                  onOpenChange={setIconOpen}
                  trigger={
                    <button
                      type="button"
                      className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span className="text-2xl leading-none">{icon?.startsWith('data:') ? <img src={icon} className="h-6 w-6 rounded" alt="icon" /> : icon}</span>
                      <span className="text-muted-foreground text-xs">Change</span>
                      <svg className="h-3.5 w-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                  }
                >
                  <div className="w-80">
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

                    <div className="max-h-[350px] overflow-y-auto">
                      {emojiSearch ? (
                        /* Filtered flat results */
                        <div className="grid grid-cols-8 gap-1">
                          {EMOJI_CATEGORIES.flatMap(c => c.emojis)
                            .filter(e => e.includes(emojiSearch))
                            .map(emoji => (
                              <button
                                key={emoji}
                                type="button"
                                className={cn(
                                  'rounded-md p-1.5 text-xl transition hover:scale-110 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                                  icon === emoji && 'ring-2 ring-primary bg-muted/70',
                                )}
                                onClick={() => { setIcon(emoji); setIconOpen(false); setEmojiSearch('') }}
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
                                  icon === emoji && 'ring-2 ring-primary bg-muted/70',
                                )}
                                onClick={() => { setIcon(emoji); setIconOpen(false) }}
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
                                      icon === emoji && 'ring-2 ring-primary bg-muted/70',
                                    )}
                                    onClick={() => { setIcon(emoji); setIconOpen(false) }}
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

                    {/* Upload button */}
                    <div className="border-t pt-2 mt-2 flex justify-end">
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
                              let w = img.width, h = img.height
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
                              setIcon(canvas.toDataURL('image/png'))
                              setIconOpen(false)
                            }
                            img.src = reader.result as string
                          }
                          reader.readAsDataURL(file)
                        }}
                      />
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 border-2 border-border rounded-md px-3 py-1.5 text-sm font-medium hover:bg-muted transition"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload className="h-4 w-4" />
                        Upload
                      </button>
                    </div>
                  </div>
                </DropdownPicker>
              </div>

              {/* Color Dropdown */}
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Color</span>
                <DropdownPicker
                  open={colorOpen}
                  onOpenChange={setColorOpen}
                  trigger={
                    <button
                      type="button"
                      className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span className="h-5 w-5 rounded-full border border-background shadow-sm" style={{ backgroundColor: color }} />
                      <span className="text-muted-foreground text-xs">{selectedColor?.name ?? 'Custom'}</span>
                      <svg className="h-3.5 w-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                  }
                >
                  <div className="w-64">
                    <div className="grid grid-cols-4 gap-2">
                      {PROJECT_COLORS.map(c => (
                        <button
                          key={c.value}
                          type="button"
                          className="group flex flex-col items-center gap-1 rounded-lg p-1 transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          onClick={() => { setColor(c.value); setColorOpen(false) }}
                          title={c.name}
                        >
                          <span
                            className={cn(
                              'flex h-9 w-9 items-center justify-center rounded-full border border-background shadow-sm transition-transform group-hover:scale-110',
                              color === c.value && 'ring-2 ring-primary ring-offset-1',
                            )}
                            style={{ backgroundColor: c.value }}
                          >
                            {color === c.value && <span className="text-xs font-bold text-white">✓</span>}
                          </span>
                          <span className="text-[10px] leading-tight text-muted-foreground text-center">{c.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </DropdownPicker>
              </div>

              {/* Preview */}
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Preview</span>
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-xl shadow"
                  style={{ backgroundColor: color + '22', border: `2px solid ${color}` }}
                >
                  {icon?.startsWith('data:') ? <img src={icon} className="h-5 w-5 rounded" alt="icon" /> : icon}
                </div>
              </div>
            </div>
          </div>
          {isEditing ? (
            <div>
              <label className="text-sm font-medium block mb-1">Project Folder</label>
              <span className="text-sm text-muted-foreground font-mono">{folder}</span>
            </div>
          ) : (
            <div>
              <label htmlFor="project-folder" className="text-sm font-medium block mb-1">Project Folder <span className="text-muted-foreground font-normal">(must be git-initialized{' '}
                {gitStatus === 'none' && <CircleDot className="inline h-4 w-4 text-orange-500 align-text-bottom" />}
                {gitStatus === 'checking' && <CircleDot className="inline h-4 w-4 text-orange-500 animate-pulse align-text-bottom" />}
                {gitStatus === 'valid' && <CheckCircle2 className="inline h-4 w-4 text-green-500 align-text-bottom" />}
                {gitStatus === 'invalid' && <XCircle className="inline h-4 w-4 text-red-500 align-text-bottom" />}
                )</span></label>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    id="project-folder"
                    name="projectFolder"
                    type="text"
                    value={folder}
                    onChange={e => setFolder(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                    placeholder={supportsDirectoryPicker ? 'Choose a folder or type a path' : '/path/to/project'}
                    autoComplete="off"
                    required
                  />
                  {supportsDirectoryPicker && (
                    <Button type="button" variant="outline" onClick={handleBrowseFolder}>
                      Browse...
                    </Button>
                  )}
                </div>
                {!supportsDirectoryPicker && (
                  <p className="text-xs text-muted-foreground">
                    Directory picker is not supported in this browser, so please type the path manually.
                  </p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <div className="flex justify-between gap-2">
        {isEditing && (
          <Button type="button" variant="destructive" onClick={handleDelete} disabled={isBusy}>
            <Trash2 className="h-4 w-4 mr-1" />
            Delete Project
          </Button>
        )}
        <div className="flex gap-2 ml-auto">
          <Button type="button" variant="outline" onClick={onBack ?? onClose}>Cancel</Button>
          <Button type="submit" disabled={isBusy}>{isEditing ? 'Save Changes' : 'Create Project'}</Button>
        </div>
      </div>
    </form>
  )
}
