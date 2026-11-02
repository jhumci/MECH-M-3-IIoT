import { Component } from '@angular/core';
import { Dashboard } from './frontend/dashboard';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [Dashboard],
  templateUrl: './app.html',
})
export class App {}