import { useState } from 'react'
import { Moon, Sun, Settings, FolderOpen, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

interface AppShellProps {
  children: React.ReactNode
  onOpenProfile?: () => void
  onOpenProject?: () => void
  onOpenTicket?: () => void
  isModalOpen?: boolean
}

export function AppShell({ children, onOpenProfile, onOpenProject, onOpenTicket, isModalOpen = false }: AppShellProps) {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      return document.documentElement.classList.contains('dark')
    }
    return false
  })

  const toggleTheme = () => {
    setIsDark(!isDark)
    document.documentElement.classList.toggle('dark', !isDark)
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-border bg-background/95 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-2">
          <img src="/trans-logo.png" alt="LoopTroop" className="h-7" />
          <span className="text-lg font-bold tracking-tight" style={{ fontFamily: "'Georgia', 'Times New Roman', serif", fontStyle: 'italic' }}>LoopTroop</span>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onOpenTicket}
                disabled={isModalOpen}
                className="flex items-center gap-1 rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium hover:bg-foreground/90 disabled:opacity-50 dark:bg-foreground dark:text-background dark:hover:bg-foreground/80"
              >
                <Plus className="h-4 w-4" />
                New Ticket
              </button>
            </TooltipTrigger>
            <TooltipContent>Create new ticket</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={onOpenProject} disabled={isModalOpen}>
                <FolderOpen className="h-4 w-4 mr-1" />
                Projects
              </Button>
            </TooltipTrigger>
            <TooltipContent>Projects</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={onOpenProfile} disabled={isModalOpen}>
                <Settings className="h-4 w-4 mr-1" />
                Configuration
              </Button>
            </TooltipTrigger>
            <TooltipContent>Configuration</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
                {isDark ? <Sun className="h-4 w-4 text-amber-400" fill="currentColor" /> : <Moon className="h-4 w-4 text-blue-300" fill="currentColor" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Toggle dark/light mode</TooltipContent>
          </Tooltip>
        </div>
      </header>
      <Separator />
      <main className="flex-1">
        {children}
      </main>
    </div>
  )
}
