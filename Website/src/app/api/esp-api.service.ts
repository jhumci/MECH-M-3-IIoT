import { inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { defer, Observable, throwError } from 'rxjs';
import { EspConfig } from './esp-api.models';

@Injectable({ providedIn: 'root' })
export class EspApiService {
  private readonly http = inject(HttpClient);

  private readonly storageKey = 'esp-api-base-url';
  private readonly configuredBaseUrl = signal('');
  readonly baseUrl = this.configuredBaseUrl.asReadonly();

  loadBaseUrl() {
    try {
      const savedUrl = localStorage.getItem(this.storageKey);
      if (savedUrl) this.configuredBaseUrl.set(this.normalizeUrl(savedUrl));
    } catch {
      // Ohne Browser-Speicher kann die Adresse weiterhin manuell gesetzt werden.
    }
  }

  setBaseUrl(value: string): boolean {
    const url = this.normalizeUrl(value);
    this.configuredBaseUrl.set(url);
    try {
      localStorage.setItem(this.storageKey, url);
      return true;
    } catch {
      return false;
    }
  }

  private normalizeUrl(value: string): string {
    let url: URL;
    try {
      url = new URL(value.trim());
    } catch {
      throw new Error('Bitte eine gültige API-Adresse inklusive http:// oder https:// eingeben.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('Bitte eine HTTP-/HTTPS-Adresse ohne Zugangsdaten, Suchparameter oder Fragment eingeben.');
    }
    return url.href.replace(/\/+$/, '');
  }

  private request<T>(send: (url: string) => Observable<T>) {
    return defer(() => {
      const url = this.baseUrl();
      return url ? send(url) : throwError(() => new Error('Bitte zuerst eine API-Adresse setzen.'));
    });
  }

  getStatus() {
    return this.request((url) => this.http.get<unknown>(`${url}/status`));
  }

  getInterval() {
    return this.request((url) => this.http.get<EspConfig>(`${url}/config`));
  }

  setInterval(interval: number) {
    return this.request((url) => this.http.post<EspConfig>(`${url}/config`, { reading_interval_seconds: interval }));
  }
}
