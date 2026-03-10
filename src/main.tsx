import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { installDevApiGuard } from './lib/devApi'
import { UIProvider } from './context/UIContext'
import { TooltipProvider } from './components/ui/tooltip'
import App from './App'
import './index.css'

installDevApiGuard()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <UIProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </UIProvider>
    </QueryClientProvider>
  </StrictMode>,
)
