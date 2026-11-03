import { afterNextRender, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChartTimeRange, MeasurementChart, seriesColor } from './measurement-chart';
import { MeasurementResponse, SensorOption } from './models';

@Component({
  selector: 'app-measurements', standalone: true,
  imports: [FormsModule, MeasurementChart, DatePipe, DecimalPipe],
  templateUrl: './measurements.html',
})
export class Measurements {
  readonly color = seriesColor;
  readonly filtersOpen = signal(false);
  private readonly http = inject(HttpClient);
  private readonly destroy = inject(DestroyRef);
  readonly metadata = signal<SensorOption[]>([]);
  readonly groups = computed(() => [...new Set(this.metadata().map(s => s.group_name))]);
  readonly sensorOptions = computed(() => [...new Set(this.metadata()
    .filter(s => this.selectedGroups().length === 0 || this.selectedGroups().includes(s.group_name))
    .map(s => s.sensor_id))]);
  readonly selectedGroups = signal<string[]>([]);
  selectedSensors: string[] = [];
  preset = '3600';
  from = '';
  to = '';
  resolution = 0;
  refreshSeconds = 10;
  showRange = false;
  readonly response = signal<MeasurementResponse | null>(null);
  readonly viewRange = signal<ChartTimeRange | null>(null);
  private latestResult?: { data: MeasurementResponse; updatedAt: Date; description: string };

  selectRange(range: ChartTimeRange) { this.viewRange.set(range); }

  resetView() {
    this.viewRange.set(null);
    if (this.latestResult) this.displayResult(this.latestResult);
  }

  private displayResult(result: { data: MeasurementResponse; updatedAt: Date; description: string }) {
    this.response.set(result.data);
    this.updatedAt.set(result.updatedAt);
    this.appliedDescription = result.description;
  }

  readonly loading = signal(false);
  readonly error = signal('');
  readonly metadataError = signal('');
  readonly grafanaUrl = signal('');
  readonly updatedAt = signal<Date | null>(null);
  readonly temperature = computed(() => this.response()?.series.filter(s => s.metric === 'temperature') ?? []);
  readonly humidity = computed(() => this.response()?.series.filter(s => s.metric === 'humidity') ?? []);
  readonly sampleCount = computed(() => this.response()?.series.reduce((n, s) => n + s.points.reduce((a, p) => a + p.count, 0), 0) ?? 0);
  readonly usesReceivedTime = computed(() => this.response()?.series.some(s => s.points.some(p => p.received_count > 0)) ?? false);
  appliedDescription = '';
  private applied: { preset: string; from: string; to: string; groups: string[]; sensors: string[]; resolution: number } | null = null;
  private timer?: ReturnType<typeof setInterval>;

  constructor() {
    afterNextRender(() => {
      this.loadMetadata();
      this.http.get<{ grafana_url: string }>('/api/config').pipe(takeUntilDestroyed(this.destroy))
        .subscribe({ next: config => {
          try {
            const url = new URL(config.grafana_url);
            if (url.protocol === 'http:' || url.protocol === 'https:') this.grafanaUrl.set(url.href);
          } catch { /* A broken link should not be rendered. */ }
        }, error: () => { /* The dashboard remains usable if the Grafana link is unavailable. */ } });
      this.apply();
      this.setRefresh();
    });
    this.destroy.onDestroy(() => clearInterval(this.timer));
  }

  loadMetadata() {
    this.metadataError.set('');
    this.http.get<{ sensors: SensorOption[] }>('/api/metadata').pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: data => this.metadata.set(data.sensors),
      error: () => this.metadataError.set('Gruppen und Sensoren konnten nicht geladen werden.'),
    });
  }

  toggleGroup(group: string, checked: boolean) {
    this.selectedGroups.update(groups => checked ? [...groups, group] : groups.filter(value => value !== group));
    this.selectedSensors = this.selectedSensors.filter(s => this.sensorOptions().includes(s));
  }

  toggleSensor(sensor: string, checked: boolean) {
    this.selectedSensors = checked ? [...this.selectedSensors, sensor] : this.selectedSensors.filter(value => value !== sensor);
  }

  setRefresh() {
    clearInterval(this.timer);
    if (this.refreshSeconds > 0) this.timer = setInterval(() => {
      if (!document.hidden && !this.loading() && this.applied) this.fetch();
    }, this.refreshSeconds * 1000);
  }

  apply() {
    if (this.loading()) return;
    if (this.preset === 'custom') {
      if (!this.from || !this.to || !Number.isFinite(new Date(this.from).getTime()) || !Number.isFinite(new Date(this.to).getTime()) || new Date(this.from) >= new Date(this.to)) {
        this.error.set('Bitte einen gültigen Beginn und ein späteres Ende auswählen.');
        return;
      }
    }
    this.resetView();
    this.applied = { preset: this.preset, from: this.from, to: this.to,
      groups: [...this.selectedGroups()], sensors: [...this.selectedSensors], resolution: this.resolution };
    this.fetch();
  }

  reset() {
    this.preset = '3600'; this.selectedGroups.set([]); this.selectedSensors = [];
    this.resolution = 0; this.from = ''; this.to = ''; this.apply();
  }

  refresh() {
    if (!this.loading()) { this.loadMetadata(); this.fetch(); }
  }

  private fetch() {
    const filter = this.applied;
    if (!filter || this.loading()) return;
    const finish = filter.preset === 'custom' ? new Date(filter.to) : new Date();
    const begin = filter.preset === 'custom' ? new Date(filter.from) : new Date(finish.getTime() - Number(filter.preset) * 1000);
    let params = new HttpParams().set('from', begin.toISOString()).set('to', finish.toISOString()).set('interval', filter.resolution);
    for (const group of filter.groups) params = params.append('groups', group);
    for (const sensor of filter.sensors) params = params.append('sensors', sensor);
    this.loading.set(true); this.error.set('');
    this.http.get<MeasurementResponse>('/api/readings', { params }).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: data => {
        const description = `${begin.toLocaleString('de-AT')} – ${finish.toLocaleString('de-AT')} · ${filter.groups.length ? filter.groups.join(', ') : 'Alle Gruppen'}${filter.sensors.length ? ' · ' + filter.sensors.join(', ') : ''}`;
        this.latestResult = { data, updatedAt: new Date(), description };
        if (!this.viewRange()) this.displayResult(this.latestResult);
        this.loading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        const detail = error.error?.detail;
        this.error.set(typeof detail === 'string' ? detail : 'Messdaten konnten nicht geladen werden. Bitte Docker-Dienste und Verbindung prüfen.');
        this.loading.set(false);
      },
    });
  }
}
