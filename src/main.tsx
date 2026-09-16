import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthProvider, useAuth } from './lib/auth';
import { AuthGate } from './components/AuthGate';
import { PricingPage } from './components/PricingPage';
import { navigate, pageFor, takeAfterSignIn, useLocation } from './lib/route';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element is missing from index.html.');

/**
 * Two pages. The plans page is public — a visitor can see the prices before
 * making an account — and the studio stays behind the sign-in gate.
 */
function Root() {
  const { pathname, search } = useLocation();
  const { session } = useAuth();

  // Someone sent from the plans page to sign in goes back there afterwards.
  useEffect(() => {
    if (!session) return;
    const next = takeAfterSignIn();
    if (next) navigate(next);
  }, [session]);

  if (pageFor(pathname) === 'pricing') return <PricingPage search={search} />;
  return (
    <AuthGate>
      <App />
    </AuthGate>
  );
}

createRoot(container).render(
  <StrictMode>
    <AuthProvider>
      <Root />
    </AuthProvider>
  </StrictMode>,
);
