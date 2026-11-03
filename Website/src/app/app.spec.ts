import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { App } from './app';
import { routes } from './app.routes';

describe('App navigation', () => {
  it('offers separate device and measurement pages', async () => {
    await TestBed.configureTestingModule({
      imports: [App], providers: [provideRouter(routes), provideHttpClient()],
    }).compileComponents();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const links = [...(fixture.nativeElement as HTMLElement).querySelectorAll('nav a')];
    expect(links.map(a => a.textContent?.trim())).toEqual(['Geräte-API', 'Messdaten']);
    expect(links.map(a => a.getAttribute('href'))).toEqual(['/', '/messdaten']);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('In Grafana öffnen');
  });
});
