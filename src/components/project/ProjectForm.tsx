import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCreateProject, useUpdateProject, useDeleteProject } from '@/hooks/useProjects'
import type { ExistingProjectPreview, Project } from '@/hooks/useProjects'
import { useToast } from '@/components/shared/useToast'
import { ArrowLeft, HardDrive, Trash2, CheckCircle2, XCircle, CircleDot, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FolderPicker } from '@/components/project/FolderPicker'
import { EmojiPickerSection, ColorPickerSection } from './AppearancePickers'
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { DeleteWorktreesDialog } from './DeleteWorktreesDialog'

interface ProjectFormProps {
  onClose: () => void
  onBack?: () => void
  project?: Project
}

interface GitCheckResponse {
  isGit: boolean
  status: 'none' | 'checking' | 'valid' | 'invalid'
  message?: string
  performanceWarning?: string | null
  scope?: 'root' | 'subfolder'
  repoRoot?: string
  hasLoopTroopState?: boolean
  existingProject?: ExistingProjectPreview | null
}

function formatRelativeTime(dateStr: string) {
  const date = new Date(dateStr)
  const diffInSeconds = Math.floor((Date.now() - date.getTime()) / 1000)
  
  if (diffInSeconds < 60) return 'Just now'
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutes ago`
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`
  const days = Math.floor(diffInSeconds / 86400)
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`
  if (days < 365) return `${Math.floor(days / 30)} months ago`
  return `${Math.floor(days / 365)} years ago`
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
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false)
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false)
  const [gitInfo, setGitInfo] = useState<GitCheckResponse>({ isGit: false, status: 'none' })
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false)
  const [isWorktreesDialogOpen, setIsWorktreesDialogOpen] = useState(false)
  const restorePrefillKeyRef = useRef<string | null>(null)
  const closeView = onBack ?? onClose
  const restoreMode = !isEditing && gitInfo.hasLoopTroopState === true && !!gitInfo.existingProject
  const gitStatus = gitInfo.status
  const gitMessage = gitInfo.message ?? ''

  useEffect(() => {
    if (!folder.trim()) {
      setGitInfo({ isGit: false, status: 'none' })
      restorePrefillKeyRef.current = null
      return
    }
    let cancelled = false
    setGitInfo({
      isGit: false,
      status: 'checking',
      message: 'Checking repository...',
    })
    const timer = setTimeout(() => {
      fetch(`/api/projects/check-git?path=${encodeURIComponent(folder)}`)
        .then(r => r.json())
        .then((data: GitCheckResponse) => {
          if (cancelled) return
          setGitInfo(data)
        })
        .catch(() => {
          if (cancelled) return
          setGitInfo({
            isGit: false,
            status: 'invalid',
            message: 'Git check failed. Verify the absolute folder path and try again.',
          })
        })
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [folder])

  useEffect(() => {
    if (isEditing || !restoreMode || !gitInfo.existingProject || !gitInfo.repoRoot) return
    if (restorePrefillKeyRef.current === gitInfo.repoRoot) return

    setName(gitInfo.existingProject.name)
    setShortname(gitInfo.existingProject.shortname)
    setIcon(gitInfo.existingProject.icon ?? '📁')
    setColor(gitInfo.existingProject.color ?? '#3b82f6')
    restorePrefillKeyRef.current = gitInfo.repoRoot
  }, [gitInfo.existingProject, gitInfo.repoRoot, isEditing, restoreMode])

  const handleBrowseFolder = () => {
    setIsFolderPickerOpen(true)
  }

  const handleFolderSelected = (path: string) => {
    setFolder(path)
    setIsFolderPickerOpen(false)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isEditing) {
      updateProject.mutate(
        { id: project.id, name, icon, color },
        {
          onSuccess: () => {
            addToast('success', 'Project updated.')
            closeView()
          },
        },
      )
    } else {
      createProject.mutate(
        { name, shortname, folderPath: folder, icon, color },
        {
          onSuccess: () => {
            addToast('success', restoreMode ? 'Project restored from existing LoopTroop data.' : 'Project created.')
            closeView()
          },
        },
      )
    }
  }

  const handleDelete = () => {
    if (!project) return
    if (!confirm('Are you sure you want to delete this project? This will remove its local .looptroop state from the repo and cannot be undone.')) return
    deleteProject.mutate(project.id, {
      onSuccess: () => {
        addToast('success', 'Project deleted and local LoopTroop state removed.')
        closeView()
      },
      onError: (err) => {
        const message = (err as Error)?.message || 'Failed to delete project'
        addToast('error', message, 5000)
      },
    })
  }

  // Show error in toast when mutation fails
  useEffect(() => {
    const err = createProject.error || updateProject.error
    if (err) {
      const message = (err as Error)?.message || 'Failed to save project'
      addToast('error', message, 5000)
    }
  }, [createProject.error, updateProject.error, addToast])

  const isBusy = createProject.isPending || updateProject.isPending || deleteProject.isPending

  return (
    <>
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
              {isEditing || restoreMode ? (
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
              {restoreMode && (
                <p className="mt-1 text-xs text-muted-foreground">Restored from existing project data and kept immutable.</p>
              )}
            </div>
          </div>
          <div>
            <label className="text-sm font-medium block mb-2">Appearance</label>
            <div className="flex items-center gap-4">
              <EmojiPickerSection
                icon={icon}
                isIconPickerOpen={isIconPickerOpen}
                onIconOpenChange={setIsIconPickerOpen}
                onIconChange={setIcon}
              />

              <ColorPickerSection
                color={color}
                isColorPickerOpen={isColorPickerOpen}
                onColorOpenChange={setIsColorPickerOpen}
                onColorChange={setColor}
              />

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
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium block mb-1">Project Folder</label>
                <span className="text-sm text-muted-foreground font-mono">{folder}</span>
              </div>
              <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Project Created</label>
                  <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span 
                                                          className="text-sm font-medium cursor-help"
                                                        >
                                                          {formatRelativeTime(project.createdAt)}
                                                        </span>
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs text-center text-balance">{new Date(project.createdAt).toLocaleString()}</TooltipContent>
                                      </Tooltip>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Last Update</label>
                  <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span 
                                                          className="text-sm font-medium cursor-help"
                                                        >
                                                          {formatRelativeTime(project.updatedAt)}
                                                          {project.latestActivityTicketExternalId && (
                                                            <span className="ml-1 text-muted-foreground font-normal">
                                                              ({project.latestActivityTicketExternalId})
                                                            </span>
                                                          )}
                                                        </span>
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs text-center text-balance">{`${new Date(project.updatedAt).toLocaleString()}${project.latestActivityTicketExternalId ? ` - Ticket ${project.latestActivityTicketExternalId}` : ''}`}</TooltipContent>
                                      </Tooltip>
                </div>
              </div>
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
                    placeholder="Choose a folder or type a path"
                    autoComplete="off"
                    required
                  />
                  <Button type="button" variant="outline" onClick={handleBrowseFolder}>
                    Browse...
                  </Button>
                </div>
                {gitMessage && !restoreMode && (
                  <p className={cn(
                    'text-xs',
                    gitStatus === 'valid' ? 'text-green-600 dark:text-green-400' : gitStatus === 'invalid' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
                  )}>
                    {gitMessage}
                  </p>
                )}
              </div>
              {gitInfo.performanceWarning && (
                <div className="rounded-lg border border-amber-300/70 bg-amber-50/70 p-4 text-sm dark:border-amber-700/60 dark:bg-amber-950/20">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <div>
                      <p className="font-medium text-amber-900 dark:text-amber-100">WSL mounted-drive warning</p>
                      <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-200/80">
                        {gitInfo.performanceWarning}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          {restoreMode && gitInfo.existingProject && (
            <div className="rounded-lg border border-amber-300/70 bg-amber-50/70 p-4 text-sm dark:border-amber-700/60 dark:bg-amber-950/20">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0 space-y-3">
                  <div>
                    <p className="font-medium text-amber-900 dark:text-amber-100">Existing LoopTroop project detected</p>
                    <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-200/80">
                      This folder already contains LoopTroop state. Attaching it will restore the existing tickets and workflow data from disk.
                    </p>
                    {gitInfo.scope === 'subfolder' && gitInfo.repoRoot && (
                      <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-200/80">
                        Repository root: <span className="font-mono">{gitInfo.repoRoot}</span>
                      </p>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-100">Restored from existing project data</p>
                      <ul className="mt-1 space-y-1 text-xs text-amber-800 dark:text-amber-200/90">
                        <li>Short name: <span className="font-mono">{gitInfo.existingProject.shortname}</span></li>
                        <li>Ticket counter: <span className="font-mono">{gitInfo.existingProject.ticketCounter}</span></li>
                        <li>Existing tickets: {gitInfo.existingProject.ticketCount}</li>
                        <li>Ticket workflow and artifact state</li>
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-100">Updated from your current form</p>
                      <ul className="mt-1 space-y-1 text-xs text-amber-800 dark:text-amber-200/90">
                        <li>Name: {name}</li>
                        <li>Icon: {icon?.startsWith('data:') ? 'Custom image' : icon}</li>
                        <li>Color: <span className="font-mono">{color}</span></li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <div className="flex justify-between gap-2">
        {isEditing && (
          <div className="flex gap-2">
            <Button type="button" variant="destructive" onClick={handleDelete} disabled={isBusy}>
              <Trash2 className="h-4 w-4 mr-1" />
              Delete Project
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsWorktreesDialogOpen(true)}
              disabled={isBusy}
            >
              <HardDrive className="h-4 w-4 mr-1" />
              Free Disk Space
            </Button>
          </div>
        )}
        <div className="flex gap-2 ml-auto">
          <Button type="button" variant="outline" onClick={closeView}>Cancel</Button>
          <Button type="submit" disabled={isBusy || (!isEditing && gitStatus !== 'valid')}>
            {isEditing ? 'Save Changes' : restoreMode ? 'Restore Project' : 'Create Project'}
          </Button>
        </div>
      </div>
    </form>

    <FolderPicker
      open={isFolderPickerOpen}
      onClose={() => setIsFolderPickerOpen(false)}
      onSelect={handleFolderSelected}
      initialPath={folder}
    />

    {isEditing && project && (
      <DeleteWorktreesDialog
        open={isWorktreesDialogOpen}
        onClose={() => setIsWorktreesDialogOpen(false)}
        projectId={project.id}
        projectName={project.name}
      />
    )}
    </>
  )
}
