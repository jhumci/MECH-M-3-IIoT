import { Routes } from '@angular/router';
import { Dashboard } from './frontend/dashboard';

export const routes: Routes = [
  { path: '', component: Dashboard },
  { path: 'messdaten', loadComponent: () => import('./measurements/measurements').then(m => m.Measurements) },
  { path: '**', redirectTo: '' },
];
