import { useState } from 'react'

export function WelcomeDisclaimer() {
  const [show, setShow] = useState(() => !localStorage.getItem('looptroop-welcome-seen'))

  const dismiss = () => {
    localStorage.setItem('looptroop-welcome-seen', 'true')
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#1a1a1a] text-white rounded-2xl shadow-xl max-w-md w-full mx-4 p-6">
        <h2 className="text-xl font-bold mb-3">Welcome to LoopTroop</h2>

        <p className="text-sm text-gray-300 mb-4">
          LoopTroop runs long AI-driven planning and execution workflows.
        </p>

        <div className="space-y-3 mb-4 text-sm text-gray-300">
          <p>
            🔮 <span className="font-bold">Interview phase</span> may take{' '}
            <span className="font-bold">1+ hour</span> depending on project complexity and council
            size.
          </p>
          <p>
            🔮 <span className="font-bold">Execution phase</span> may take{' '}
            <span className="font-bold">10+ hours</span> for large tickets with many beads.
          </p>
        </div>

        <p className="text-sm text-gray-400 mb-5">
          Ensure your machine won't sleep during execution and has at least 4 GB RAM and 15 GB free
          space.
        </p>

        <button
          onClick={dismiss}
          className="w-full bg-white text-black rounded-lg py-2.5 font-medium hover:bg-gray-100 transition-colors"
        >
          Got it, let's go!
        </button>
      </div>
    </div>
  )
}
