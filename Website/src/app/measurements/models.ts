export interface MeasurementPoint {
  time: number;
  mean: number;
  min: number;
  max: number;
  count: number;
  received_count: number;
}

export interface MeasurementSeries {
  group: string;
  sensor: string;
  metric: 'temperature' | 'humidity';
  unit: string;
  points: MeasurementPoint[];
}

export interface MeasurementResponse {
  from: number;
  to: number;
  interval_seconds: number;
  series: MeasurementSeries[];
}

export interface SensorOption {
  group_name: string;
  sensor_id: string;
  metric: string;
}
