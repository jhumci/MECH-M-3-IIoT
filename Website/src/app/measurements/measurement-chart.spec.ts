import { ElementRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MeasurementChart } from './measurement-chart';

describe('Chart range selection', () => {
  it('maps a reverse drag to a clamped time range and ignores clicks and cancelled drags', () => {
    const component = TestBed.runInInjectionContext(() => new MeasurementChart());
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200 } as DOMRect);
    canvas.setPointerCapture = () => {};
    canvas.hasPointerCapture = () => false;
    component.canvas = new ElementRef(canvas);
    Object.assign(component, { chart: {
      width: 400, height: 200, chartArea: { left: 40, right: 380, top: 10, bottom: 170 },
      scales: { x: { getValueForPixel: (x: number) => x * 1000 } },
    } });
    const ranges: { from: number; to: number }[] = [];
    component.rangeSelected.subscribe(range => ranges.push(range));
    const pointer = (x: number) => ({ button: 0, isPrimary: true, pointerId: 1, clientX: x, clientY: 50 } as PointerEvent);
    component.startSelection(pointer(300));
    component.moveSelection(pointer(0));
    expect(component.selection()).toEqual({ left: 40, top: 10, width: 260, height: 160 });
    component.finishSelection(pointer(0));
    expect(ranges).toEqual([{ from: 40000, to: 300000 }]);
    expect(component.selection()).toBeNull();
    component.startSelection(pointer(100));
    component.finishSelection(pointer(102));
    component.startSelection(pointer(100));
    component.cancelSelection();
    component.finishSelection(pointer(200));
    expect(ranges).toHaveLength(1);
  });
});
