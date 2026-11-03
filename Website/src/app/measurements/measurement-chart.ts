import { afterNextRender, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild, output, signal } from '@angular/core';
import { Chart, LineController, LineElement, PointElement, LinearScale, Tooltip, Filler, ChartDataset } from 'chart.js';
import { MeasurementSeries } from './models';

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip, Filler);

export interface ChartTimeRange { from: number; to: number; }

export function seriesColor(group: string, sensor: string): string {
  let hash = 0;
  for (const character of `${group}/${sensor}`) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360}, 65%, 40%)`;
}

@Component({
  selector: 'app-measurement-chart',
  standalone: true,
  template: `
    <div class="mb-2 flex items-center gap-3">
      <button type="button" (click)="resetView.emit()" [disabled]="!viewRange"
        title="Ursprüngliche Ansicht wiederherstellen" aria-label="Ursprüngliche Ansicht beider Diagramme wiederherstellen"
        class="rounded border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9" />
        </svg>
      </button>
    </div>
    <div class="relative h-80">
      <canvas #canvas role="img" [attr.aria-label]="label" class="cursor-crosshair" style="touch-action: pan-y"
        (pointerdown)="startSelection($event)" (pointermove)="moveSelection($event)"
        (pointerup)="finishSelection($event)" (pointercancel)="cancelSelection()"
        (lostpointercapture)="cancelSelection()">{{ label }}</canvas>
      @if (selection(); as box) {
        <div aria-hidden="true" class="pointer-events-none absolute border border-blue-500 bg-blue-500/15"
          [style.left.px]="box.left" [style.top.px]="box.top" [style.width.px]="box.width" [style.height.px]="box.height"></div>
      }
    </div>`,
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
  @Input() viewRange: ChartTimeRange | null = null;
  readonly rangeSelected = output<ChartTimeRange>();
  readonly resetView = output<void>();
  readonly selection = signal<{ left: number; top: number; width: number; height: number } | null>(null);
  private drag?: { pointerId: number; start: number; end: number };
  private originalY?: { min: number; max: number };

  private pointerPosition(event: PointerEvent) {
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * this.chart!.width / rect.width,
      y: (event.clientY - rect.top) * this.chart!.height / rect.height };
  }

  startSelection(event: PointerEvent) {
    if (event.button !== 0 || !event.isPrimary || !this.chart) return;
    const { x, y } = this.pointerPosition(event);
    const area = this.chart.chartArea;
    if (x < area.left || x > area.right || y < area.top || y > area.bottom) return;
    this.drag = { pointerId: event.pointerId, start: x, end: x };
    this.canvas.nativeElement.setPointerCapture(event.pointerId);
    this.moveSelection(event);
  }

  moveSelection(event: PointerEvent) {
    if (!this.drag || this.drag.pointerId !== event.pointerId || !this.chart) return;
    const area = this.chart.chartArea;
    this.drag.end = Math.max(area.left, Math.min(area.right, this.pointerPosition(event).x));
    this.selection.set({ left: Math.min(this.drag.start, this.drag.end), top: area.top,
      width: Math.abs(this.drag.end - this.drag.start), height: area.bottom - area.top });
  }

  finishSelection(event: PointerEvent) {
    if (!this.drag || this.drag.pointerId !== event.pointerId || !this.chart) return;
    this.moveSelection(event);
    const { start, end } = this.drag;
    const scale = this.chart.scales['x'];
    const range = { from: scale.getValueForPixel(Math.min(start, end)) ?? NaN, to: scale.getValueForPixel(Math.max(start, end)) ?? NaN };
    this.cancelSelection();
    if (this.canvas.nativeElement.hasPointerCapture(event.pointerId)) this.canvas.nativeElement.releasePointerCapture(event.pointerId);
    if (Math.abs(end - start) >= 5 && Number.isFinite(range.from) && Number.isFinite(range.to) && range.from < range.to) {
      this.rangeSelected.emit(range);
    }
  }

  cancelSelection() { this.drag = undefined; this.selection.set(null); }

  private chart?: Chart<'line', { x: number; y: number | null }[]>;
  private ready = false;

  constructor() {
    afterNextRender(() => { this.ready = true; this.render(); });
  }

  ngOnChanges() { if (this.ready) this.render(); }
  ngOnDestroy() { this.chart?.destroy(); }

  private render() {
    this.cancelSelection();
    if (this.viewRange && !this.originalY && this.chart) {
      this.originalY = { min: this.chart.scales['y'].min, max: this.chart.scales['y'].max };
    }
    if (!this.viewRange) this.originalY = undefined;
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
          x: { type: 'linear', min: this.viewRange?.from ?? this.from, max: this.viewRange?.to ?? this.to, ticks: { maxTicksLimit: 6,
            callback: value => new Date(Number(value)).toLocaleString('de-AT', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) },
            title: { display: true, text: 'Zeit (lokal)' } },
          y: { min: this.originalY?.min, max: this.originalY?.max, title: { display: true, text: this.unit } },
        },
        plugins: { tooltip: { callbacks: {
          title: items => items.length ? new Date(items[0].parsed.x ?? 0).toLocaleString('de-AT') : '',
          label: item => `${item.dataset.label}: ${item.parsed.y?.toLocaleString('de-AT', { maximumFractionDigits: 2 })} ${this.unit}`,
        } } },
      },
    });
  }
}
