import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCreateTicket } from '@/hooks/useTickets'
import { useProjects } from '@/hooks/useProjects'
import { DropdownPicker } from '@/components/shared/DropdownPicker'
import { LoadingText } from '@/components/ui/LoadingText'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TicketFormProps {
  onClose: () => void
}

export function TicketForm({ onClose }: TicketFormProps) {
  const createTicket = useCreateTicket()
  const { data: projects = [] } = useProjects()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState(3)
  const [projectId, setProjectId] = useState<number | ''>('')
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)

  const selectedProject = projects.find(p => p.id === projectId) ?? projects[0]
  const effectiveProjectId = selectedProject?.id ?? ''

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!effectiveProjectId) return
    createTicket.mutate(
      { projectId: effectiveProjectId, title, description: description || undefined, priority },
      { onSuccess: onClose },
    )
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Ticket Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1" title="Project where the ticket will run">
              Project
            </label>
            <DropdownPicker
              open={projectPickerOpen}
              onOpenChange={setProjectPickerOpen}
              trigger={
                <button
                  type="button"
                  className={cn(
                    'w-full flex items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm',
                    projectPickerOpen && 'ring-2 ring-primary/30',
                  )}
                  title="Choose project"
                >
                  {selectedProject ? (
                    <span className="flex items-center gap-2 min-w-0 text-left overflow-hidden">
                      <span className="shrink-0 flex items-center">
                        {selectedProject.icon?.startsWith('data:')
                          ? <img src={selectedProject.icon} className="h-5 w-5 rounded block" alt="" />
                          : <span>{selectedProject.icon}</span>}
                      </span>
                      <span className="truncate">{selectedProject.name} ({selectedProject.shortname})</span>
                    </span>
                  ) : (
                    <span className="truncate text-left text-muted-foreground">Select a project...</span>
                  )}
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              }
            >
              <div className="w-[420px] max-w-[calc(100vw-48px)]">
                <div className="rounded-md border border-input overflow-hidden">
                  {projects.length === 0 && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No projects available</div>
                  )}
                  {projects.map((p, idx) => {
                    const selected = effectiveProjectId === p.id
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors',
                          idx !== projects.length - 1 && 'border-b border-input',
                          selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                        )}
                        onClick={() => {
                          setProjectId(p.id)
                          setProjectPickerOpen(false)
                        }}
                        title={`Use project ${p.name}`}
                      >
                        <span className="shrink-0 flex items-center">
                          {p.icon?.startsWith('data:')
                            ? <img src={p.icon} className="h-5 w-5 rounded block" alt="" />
                            : <span>{p.icon}</span>}
                        </span>
                        <span className="truncate flex-1">{p.name} ({p.shortname})</span>
                        {selected && <Check className="h-4 w-4 text-primary" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            </DropdownPicker>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1" title="Short summary of the requested work">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Brief summary of the work"
              required
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-1" title="Detailed implementation request">
              Description
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[100px]"
              placeholder="Describe what you want to build..."
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-1" title="Ticket urgency and processing order">
              Priority
            </label>
            <select
              value={priority}
              onChange={e => setPriority(Number(e.target.value))}
              className="w-48 rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value={1}>1 — Very High</option>
              <option value={2}>2 — High</option>
              <option value={3}>3 — Normal</option>
              <option value={4}>4 — Low</option>
              <option value={5}>5 — Very Low</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose} title="Close without creating ticket">
          Cancel
        </Button>
        <Button type="submit" disabled={createTicket.isPending || !effectiveProjectId} title="Create ticket in selected project">
          {createTicket.isPending ? <LoadingText text="Creating" /> : 'Create Ticket'}
        </Button>
      </div>
    </form>
  )
}
