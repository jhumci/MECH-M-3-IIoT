import { afterNextRender, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild } from '@angular/core';
import { Chart, LineController, LineElement, PointElement, LinearScale, Tooltip, Filler, ChartDataset } from 'chart.js';
import { MeasurementSeries } from './models';

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip, Filler);

export function seriesColor(group: string, sensor: string): string {
  let hash = 0;
  for (const character of `${group}/${sensor}`) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360}, 65%, 40%)`;
}

@Component({
  selector: 'app-measurement-chart',
  standalone: true,
  template: `<div class="relative h-80"><canvas #canvas role="img" [attr.aria-label]="label">{{ label }}</canvas></div>`,
})
export class MeasurementChart implements OnChanges, OnDestroy {
  @ViewChild('canvas') canvas!: ElementRef<HTMLCanvasElement>;
  @Input() series: MeasurementSeries[] = [];
  @Input() showRange = false;
  @Input() interval = 1;
  @Input() label = '';
  @Input() unit = '';
  @Input() from = 0;
  @Input() to = 0;
  private chart?: Chart<'line', { x: number; y: number | null }[]>;
  private ready = false;

  constructor() {
    afterNextRender(() => { this.ready = true; this.render(); });
  }

  ngOnChanges() { if (this.ready) this.render(); }
  ngOnDestroy() { this.chart?.destroy(); }

  private render() {
    this.chart?.destroy();
    const datasets: ChartDataset<'line', { x: number; y: number | null }[]>[] = [];
    for (const s of this.series) {
      let hash = 0;
      for (const character of `${s.group}/${s.sensor}`) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
      const hue = Math.abs(hash) % 360;
      const color = seriesColor(s.group, s.sensor);
      const points = (field: 'mean' | 'min' | 'max') => {
        const result: { x: number; y: number | null }[] = [];
        for (let i = 0; i < s.points.length; i++) {
          const point = s.points[i];
          const previous = s.points[i - 1];
          if (previous && point.time - previous.time > this.interval * 1500) {
            result.push({ x: previous.time + this.interval * 1000, y: null });
          }
          result.push({ x: point.time, y: point[field] });
        }
        return result;
      };
      if (this.showRange) {
        datasets.push({ label: `${s.group} / ${s.sensor} · Minimum`, data: points('min'), borderWidth: 0,
          pointRadius: 0, fill: false, borderColor: color });
        datasets.push({ label: `${s.group} / ${s.sensor} · Maximum`, data: points('max'), borderWidth: 0,
          pointRadius: 0, fill: '-1', backgroundColor: `hsla(${hue}, 65%, 40%, 0.14)`, borderColor: color });
      }
      datasets.push({ label: `${s.group} / ${s.sensor}`, data: points('mean'), borderColor: color,
        backgroundColor: color, borderWidth: 2, pointRadius: s.points.length === 1 ? 4 : 0,
        pointHitRadius: 10, spanGaps: false, fill: false });
    }
    this.chart = new Chart<'line', { x: number; y: number | null }[]>(this.canvas.nativeElement, {
      type: 'line', data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
        interaction: { mode: 'nearest', intersect: false },
        scales: {
          x: { type: 'linear', min: this.from, max: this.to, ticks: { maxTicksLimit: 6,
            callback: value => new Date(Number(value)).toLocaleString('de-AT', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) },
            title: { display: true, text: 'Zeit (lokal)' } },
          y: { title: { display: true, text: this.unit } },
        },
        plugins: { tooltip: { callbacks: {
          title: items => items.length ? new Date(items[0].parsed.x ?? 0).toLocaleString('de-AT') : '',
          label: item => `${item.dataset.label}: ${item.parsed.y?.toLocaleString('de-AT', { maximumFractionDigits: 2 })} ${this.unit}`,
        } } },
      },
    });
  }
}
