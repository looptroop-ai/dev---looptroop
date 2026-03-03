import { useState } from 'react'
import { Plus, Pencil, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useProjects } from '@/hooks/useProjects'
import type { Project } from '@/hooks/useProjects'
import { ProjectForm } from './ProjectForm'

type View = { mode: 'list' } | { mode: 'create' } | { mode: 'edit'; project: Project }

interface ProjectsPanelProps {
  onClose: () => void
}

export function ProjectsPanel({ onClose }: ProjectsPanelProps) {
  const { data: projects, isLoading } = useProjects()
  const [view, setView] = useState<View>({ mode: 'list' })

  if (view.mode === 'create') {
    return (
      <ProjectForm
        onClose={onClose}
        onBack={() => setView({ mode: 'list' })}
      />
    )
  }

  if (view.mode === 'edit') {
    return (
      <ProjectForm
        onClose={onClose}
        onBack={() => setView({ mode: 'list' })}
        project={view.project}
      />
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {projects?.length ?? 0} project{projects?.length === 1 ? '' : 's'}
        </p>
        <Button size="sm" onClick={() => setView({ mode: 'create' })}>
          <Plus className="h-4 w-4 mr-1" />
          Create New Project
        </Button>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && projects?.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No projects yet. Create your first project to get started.
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {projects?.map(project => (
          <Card key={project.id}>
            <CardContent className="flex items-center gap-4 py-4">
              {project.icon?.startsWith('data:') ? <img src={project.icon} className="h-7 w-7 rounded" alt="" /> : <span className="text-2xl">{project.icon}</span>}
              <div
                className="h-8 w-1 rounded-full shrink-0"
                style={{ backgroundColor: project.color }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{project.name}</span>
                  <Badge variant="secondary" className="text-xs shrink-0">
                    {project.shortname}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground font-mono truncate">
                  {project.folderPath}
                </p>
              </div>
              <Badge variant="outline" className="shrink-0">
                {project.ticketCounter} ticket{project.ticketCounter === 1 ? '' : 's'}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setView({ mode: 'edit', project })}
              >
                <Pencil className="h-4 w-4 mr-1" />
                Edit
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
