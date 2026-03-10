import React from 'react'
import ReactDOM from 'react-dom/client'
import '@carrot-kpi/switzer-font/400.css'
import '@carrot-kpi/switzer-font/500.css'
import '@carrot-kpi/switzer-font/600.css'
import '@carrot-kpi/switzer-font/700.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
import './index.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
