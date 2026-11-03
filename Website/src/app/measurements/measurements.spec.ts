import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Measurements } from './measurements';

const empty = { from: 0, to: 1000, interval_seconds: 1, series: [] };

describe('Measurement filters', () => {
  let fixture: ComponentFixture<Measurements>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Measurements], providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(Measurements);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/metadata').flush({ sensors: [
      { group_name: 'a', sensor_id: 'sensor-1', metric: 'temperature' },
      { group_name: 'b', sensor_id: 'sensor-2', metric: 'humidity' },
    ] });
    http.expectOne('/api/config').flush({ grafana_url: 'http://localhost:3000/d/iiot-overview' });
    http.expectOne(r => r.url === '/api/readings').flush(empty);
    fixture.componentInstance.refreshSeconds = 0;
    fixture.componentInstance.setRefresh();
    fixture.detectChanges();
  });

  afterEach(() => { http.verify(); fixture.destroy(); });

  it('applies one request with UTC range and common filters for both plots', () => {
    const c = fixture.componentInstance;
    c.toggleGroup('a', true); c.toggleSensor('sensor-1', true);
    c.preset = 'custom'; c.from = '2026-11-02T10:00'; c.to = '2026-11-02T11:00'; c.resolution = 60;
    c.apply();
    const req = http.expectOne(r => r.url === '/api/readings');
    expect(req.request.params.getAll('groups')).toEqual(['a']);
    expect(req.request.params.getAll('sensors')).toEqual(['sensor-1']);
    expect(req.request.params.get('from')).toEqual(new Date(c.from).toISOString());
    expect(req.request.params.get('interval')).toEqual('60');
    req.flush(empty);
    expect(c.loading()).toBe(false);
  });

  it('rejects invalid times and clears sensor filters when groups change', () => {
    const c = fixture.componentInstance;
    c.toggleGroup('a', true); c.toggleSensor('sensor-1', true);
    c.toggleGroup('b', true); c.toggleGroup('a', false);
    expect(c.selectedSensors).toEqual([]);
    c.preset = 'custom'; c.from = '2026-11-02T11:00'; c.to = '2026-11-02T10:00'; c.apply();
    http.expectNone(r => r.url === '/api/readings');
    expect(c.error()).toContain('gültigen Beginn');
  });

  it('keeps the last result after errors and avoids overlapping requests', () => {
    const c = fixture.componentInstance;
    c.apply(); c.apply();
    http.expectOne(r => r.url === '/api/readings').flush({ detail: 'Archiv vorübergehend nicht verfügbar.' }, { status: 503, statusText: 'Unavailable' });
    expect(c.response()).toEqual(empty);
    expect(c.error()).toContain('Archiv vorübergehend');
  });

  it('freezes the displayed snapshot while fetching and restores the latest result on Home', () => {
    const c = fixture.componentInstance;
    const displayed = c.response();
    const updatedAt = c.updatedAt();
    c.selectRange({ from: 200, to: 800 });
    c.refresh();
    http.expectOne('/api/metadata').flush({ sensors: [] });
    const latest = { ...empty, from: 100, to: 1100 };
    http.expectOne(r => r.url === '/api/readings').flush(latest);
    expect(c.response()).toBe(displayed);
    expect(c.updatedAt()).toBe(updatedAt);
    expect(c.viewRange()).toEqual({ from: 200, to: 800 });
    c.selectRange({ from: 300, to: 500 });
    expect(c.response()).toBe(displayed);
    c.resetView();
    expect(c.viewRange()).toBeNull();
    expect(c.response()).toEqual(latest);
  });

  it('returns to the full view when applying new filters', () => {
    const c = fixture.componentInstance;
    c.selectRange({ from: 200, to: 800 });
    c.apply();
    expect(c.viewRange()).toBeNull();
    http.expectOne(r => r.url === '/api/readings').flush(empty);
  });

  it('renders the Grafana link and refresh intervals only in this dashboard', () => {
    const host = fixture.nativeElement as HTMLElement;
    const link = host.querySelector<HTMLAnchorElement>('a[target="_blank"]');
    expect(link?.href).toBe('http://localhost:3000/d/iiot-overview');
    const choices = [...host.querySelectorAll<HTMLSelectElement>('select[name="refresh"] option')].map(o => o.textContent?.trim());
    expect(choices).toEqual(['Manuell', 'Alle 5 Sekunden', 'Alle 10 Sekunden', 'Alle 30 Sekunden']);
  });
});
