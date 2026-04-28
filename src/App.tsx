import { useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { LandingPage } from './components/LandingPage';

type Route = 'landing' | 'dashboard';

export default function App() {
  const [route, setRoute] = useState<Route>('landing');

  if (route === 'dashboard') {
    return (
      <Dashboard
        onHome={() => setRoute('landing')}
        onLogout={() => setRoute('landing')}
      />
    );
  }

  return <LandingPage onEnterApp={() => setRoute('dashboard')} />;
}
