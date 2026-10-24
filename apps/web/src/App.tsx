import { useQuery } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api';
import { Shell } from './Shell';
import { Login, Wizard } from './pages/Auth';
import { Activity } from './pages/Activity';
import { Calendar } from './pages/Calendar';
import { Discover } from './pages/Discover';
import { Home } from './pages/Home';
import { Library } from './pages/Library';
import { Requests } from './pages/Requests';
import { Settings } from './pages/Settings';
import { System } from './pages/System';
import { Skeleton } from './ui';

export interface Me {
  configured: boolean;
  user: string | null;
  wizardDone: boolean;
}

export function App() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/api/auth/me') });

  if (me.isLoading) return <Skeleton className="m-8 h-40" />;
  if (!me.data?.configured) return <Wizard startAt="admin" />;
  if (!me.data.user) return <Login />;
  if (!me.data.wizardDone) return <Wizard startAt="storage" />;

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell user={me.data.user} />}>
          <Route index element={<Home />} />
          <Route path="descobrir" element={<Discover />} />
          <Route path="biblioteca" element={<Library />} />
          <Route path="pedidos" element={<Requests />} />
          <Route path="atividade" element={<Activity />} />
          <Route path="calendario" element={<Calendar />} />
          <Route path="definicoes" element={<Settings />} />
          <Route path="sistema" element={<System />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
