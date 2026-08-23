import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthProvider } from './lib/auth';
import { AuthGate } from './components/AuthGate';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element is missing from index.html.');

createRoot(container).render(
  <StrictMode>
    <AuthProvider>
      {/* The studio is the app's only page; the gate decides whether this
          visitor is looking at it or at the sign-in form. */}
      <AuthGate>
        <App />
      </AuthGate>
    </AuthProvider>
  </StrictMode>,
);
