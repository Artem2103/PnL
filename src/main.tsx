import { lazy, StrictMode, Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthProvider, useAuth } from './lib/auth';
import { AuthGate } from './components/AuthGate';
import { PricingPage } from './components/PricingPage';
import { HomePage } from './components/HomePage';
import { PLANS_ENABLED } from './lib/billing';
import { navigate, pageFor, takeAfterSignIn, useLocation } from './lib/route';
import { applySiteTheme } from './lib/siteTheme';
import './styles/global.css';

const CommunityPage = lazy(() =>
  import('./community/CommunityPage').then((module) => ({ default: module.CommunityPage })),
);

applySiteTheme();

const container = document.getElementById('root');
if (!container) throw new Error('Root element is missing from index.html.');

/**
 * Four pages. The front page, the plans page and the community are public — a
 * stranger can read what this is before making an account — and the editor sits
 * behind the sign-in gate. Acting in the community asks for an account then.
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

  const page = pageFor(pathname);
  // With plans off, an old link to /pricing lands on the front page.
  if (page === 'home' || (page === 'pricing' && !PLANS_ENABLED)) return <HomePage />;
  if (page === 'pricing') return <PricingPage search={search} />;
  if (page === 'community') {
    return (
      <Suspense fallback={null}>
        <CommunityPage />
      </Suspense>
    );
  }
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
