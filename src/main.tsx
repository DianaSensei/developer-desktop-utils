import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';

// DEV ONLY: wipe all persisted app state on each `npm run tauri:dev` launch so
// features can be tested from a clean slate. Stripped from production builds
// (import.meta.env.DEV is false), and skipped on the web dev server.
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
if (import.meta.env.DEV && isTauri) {
  try { localStorage.clear(); } catch { /* ignore */ }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
