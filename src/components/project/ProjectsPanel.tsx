import { useState, useMemo } from 'react'
import { Plus, Pencil, Loader2, ArrowUp, ArrowDown, Hash, Clock, CalendarDays, Type } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useProjects } from '@/hooks/useProjects'
import type { Project } from '@/hooks/useProjects'
import { ProjectForm } from './ProjectForm'

type View = { mode: 'list' } | { mode: 'create' } | { mode: 'edit'; project: Project }

type SortOption = 'name' | 'tickets' | 'created' | 'updated'

const sortOptions: { value: SortOption; label: string; icon: React.ElementType }[] = [
  { value: 'name', label: 'Alphabetical', icon: Type },
  { value: 'tickets', label: 'Number of tickets', icon: Hash },
  { value: 'created', label: 'Project created time', icon: CalendarDays },
  { value: 'updated', label: 'Last update', icon: Clock },
]

interface ProjectsPanelProps {
  onClose: () => void
}

export function ProjectsPanel({ onClose }: ProjectsPanelProps) {
  const { data: projects, isLoading } = useProjects()
  const [view, setView] = useState<View>({ mode: 'list' })
  const [sortBy, setSortBy] = useState<SortOption>('name')
  const [isSortDescending, setIsSortDescending] = useState(false)

  const sortedProjects = useMemo(() => {
    if (!projects) return []
    const copy = [...projects]
    copy.sort((a, b) => {
      let cmp = 0
      if (sortBy === 'name') {
        cmp = a.name.localeCompare(b.name)
      } else if (sortBy === 'tickets') {
        cmp = a.ticketCounter - b.ticketCounter
      } else if (sortBy === 'created') {
        cmp = a.createdAt.localeCompare(b.createdAt)
      } else if (sortBy === 'updated') {
        cmp = a.updatedAt.localeCompare(b.updatedAt)
      }
      return isSortDescending ? -cmp : cmp
    })
    return copy
  }, [projects, sortBy, isSortDescending])

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
        <div className="flex items-center gap-6">
          <p className="text-sm text-muted-foreground whitespace-nowrap">
            {projects?.length ?? 0} project{projects?.length === 1 ? '' : 's'}
          </p>

          {!isLoading && projects && projects.length > 0 && (
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8">
                    {(() => {
                      const opt = sortOptions.find(o => o.value === sortBy)!;
                      const Icon = opt.icon;
                      return <><Icon className="h-4 w-4 mr-2" />{opt.label}</>;
                    })()}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {sortOptions.map(opt => {
                    const Icon = opt.icon
                    return (
                      <DropdownMenuItem key={opt.value} onClick={() => setSortBy(opt.value)}>
                        <Icon className="h-4 w-4 mr-2" />
                        {opt.label}
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2"
                onClick={() => setIsSortDescending(d => !d)}
                title={isSortDescending ? 'Descending' : 'Ascending'}
              >
                {isSortDescending ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
              </Button>
            </div>
          )}
        </div>

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
        {sortedProjects.map(project => (
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
