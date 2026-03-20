import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  fallback?: ReactNode
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught rendering error:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-xs text-destructive">
          <p className="font-medium">Something went wrong rendering this content.</p>
          {this.state.error && (
            <pre className="mt-2 whitespace-pre-wrap text-[10px] opacity-70">{this.state.error.message}</pre>
          )}
        </div>
      )
    }
    return this.props.children
  }
}
