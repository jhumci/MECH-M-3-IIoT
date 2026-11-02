import { Routes } from '@angular/router';
import { Dashboard } from './frontend/dashboard';

export const routes: Routes = [
  { path: '', component: Dashboard },
  { path: '**', redirectTo: '' },
];