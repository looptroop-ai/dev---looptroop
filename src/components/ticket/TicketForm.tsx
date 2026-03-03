import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCreateTicket } from '@/hooks/useTickets'
import { useProjects } from '@/hooks/useProjects'

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!projectId) return
    createTicket.mutate(
      { projectId: Number(projectId), title, description: description || undefined, priority },
      { onSuccess: onClose },
    )
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-sm">Ticket Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1">Project</label>
            <select
              value={projectId}
              onChange={e => setProjectId(e.target.value ? Number(e.target.value) : '')}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              required
            >
              <option value="">Select a project…</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.icon?.startsWith('data:') ? '🖼️' : p.icon} {p.name} ({p.shortname})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">Title</label>
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
            <label className="text-sm font-medium block mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[100px]"
              placeholder="Describe what you want to build…"
            />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">Priority</label>
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
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={createTicket.isPending || !projectId}>
          {createTicket.isPending ? 'Creating…' : 'Create Ticket'}
        </Button>
      </div>
    </form>
  )
}
