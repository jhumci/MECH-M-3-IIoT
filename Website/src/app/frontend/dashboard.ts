import { afterNextRender, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { JsonPipe } from '@angular/common';
import { EspApiService } from '../api/esp-api.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [FormsModule, JsonPipe],
  templateUrl: './dashboard.html',
})
export class Dashboard {
  private readonly api = inject(EspApiService);
  readonly baseUrl = this.api.baseUrl;
  readonly ipBlocks = ['', '', '', ''];
  apiPort = 80;
  private apiProtocol = 'http:';
  private apiSuffix = '';
  readonly addressMessage = signal('');

  constructor() {
    afterNextRender(() => {
      this.api.loadBaseUrl();
      if (this.baseUrl()) {
        const url = new URL(this.baseUrl());
        const blocks = url.hostname.split('.');
        if (blocks.length === 4 && blocks.every((block) => /^\d{1,3}$/.test(block))) {
          this.ipBlocks.splice(0, 4, ...blocks);
          this.apiProtocol = url.protocol;
          this.apiPort = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
          this.apiSuffix = url.pathname.replace(/\/+$/, '');
        }
      }
    });
  }

  updateIpBlock(index: number, event: Event) {
    const input = event.target as HTMLInputElement;
    const value = input.value.replace(/\D/g, '').slice(0, 3);
    this.ipBlocks[index] = value;
    input.value = value;
  }

  saveApiAddress() {
    if (this.ipBlocks.some((block) => !/^\d{1,3}$/.test(block) || Number(block) > 255)) {
      this.addressMessage.set('Bitte alle vier IP-Blöcke mit einem Wert von 0 bis 255 ausfüllen.');
      return;
    }
    if (!Number.isInteger(this.apiPort) || this.apiPort < 1 || this.apiPort > 65535) {
      this.addressMessage.set('Bitte einen Port von 1 bis 65535 eingeben (Standard: 80).');
      return;
    }
    try {
      const blocks = this.ipBlocks.map((block) => String(Number(block)));
      const persisted = this.api.setBaseUrl(`${this.apiProtocol}//${blocks.join('.')}:${this.apiPort}${this.apiSuffix}`);
      this.ipBlocks.splice(0, 4, ...blocks);
      this.status.set(null);
      this.message.set('');
      this.addressMessage.set(persisted
        ? 'API-Adresse gespeichert.'
        : 'API-Adresse für diese Sitzung gesetzt. Der Browser-Speicher ist nicht verfügbar.');
    } catch (error) {
      this.addressMessage.set((error as Error).message);
    }
  }

  private hasApiAddress(): boolean {
    if (this.baseUrl()) return true;
    this.message.set('Bitte zuerst eine API-Adresse setzen.');
    return false;
  }

  readonly status = signal<unknown>(null);
  readonly message = signal('');
  interval = 5;

  getStatus() {
    if (!this.hasApiAddress()) return;
    this.message.set('Lädt …');

    this.api.getStatus().subscribe({
      next: (data) => {
        this.status.set(data);
        this.message.set('Status geladen.');
      },
      error: () => this.message.set('Status konnte nicht geladen werden.'),
    });
  }

  getInterval() {
    if (!this.hasApiAddress()) return;
    this.message.set('Lädt …');

    this.api.getInterval().subscribe({
      next: (data) => {
        const interval = data?.reading_interval_seconds;
        if (typeof interval !== 'number' || !Number.isInteger(interval) || interval < 1 || interval > 86400) {
          this.message.set('Die JSON-Antwort enthält kein gültiges reading_interval_seconds.');
          return;
        }
        this.interval = interval;
        this.message.set('Intervall geladen. Der Intervall ist: ' + interval + ' Sekunden.');
      },
      error: () => this.message.set('Intervall konnte nicht geladen werden.'),
    });
  }

  saveInterval() {
    if (!this.hasApiAddress()) return;
    if (!Number.isInteger(this.interval) || this.interval < 1 || this.interval > 86400) {
      this.message.set('Bitte eine ganze Zahl von 1 bis 86400 Sekunden eingeben.');
      return;
    }

    this.message.set('Speichert …');

    this.api.setInterval(this.interval).subscribe({
      next: () => this.message.set('Intervall gespeichert. Neuer Wert ist: ' + this.interval + ' Sekunden.'),
      error: () => this.message.set('Intervall konnte nicht gespeichert werden.'),
    });
  }
}
