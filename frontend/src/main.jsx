import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { ClerkProvider } from '@clerk/clerk-react'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

const root = ReactDOM.createRoot(document.getElementById('root'));

if (!PUBLISHABLE_KEY || PUBLISHABLE_KEY === 'pk_test_placeholder') {
  root.render(
    <React.StrictMode>
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-100 font-sans">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center shadow-2xl">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-orange-500/10">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="32" height="32">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white mb-2">Clerk Setup Required</h1>
          <p className="text-slate-400 text-sm mb-6 leading-relaxed">
            Codexis now uses Clerk for authentication. To run the app, please add your Clerk Publishable Key to <code className="bg-slate-950 px-1.5 py-0.5 rounded text-amber-400 font-mono text-xs">frontend/.env</code>.
          </p>
          <div className="bg-slate-950 p-4 rounded-xl text-left font-mono text-xs text-slate-400 border border-slate-800 mb-6">
            <span className="text-slate-600"># frontend/.env</span>
            <br />
            VITE_CLERK_PUBLISHABLE_KEY="<span className="text-amber-400">your_publishable_key</span>"
          </div>
          <p className="text-xs text-slate-500">
            Once configured, restart your Vite dev server.
          </p>
        </div>
      </div>
    </React.StrictMode>
  );
} else {
  root.render(
    <React.StrictMode>
      <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
        <App />
      </ClerkProvider>
    </React.StrictMode>
  );
}

