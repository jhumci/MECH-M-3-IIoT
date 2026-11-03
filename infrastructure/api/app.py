"""Read-only, bounded access to the local measurement archive."""
from contextlib import closing, contextmanager
from datetime import datetime
import math
import os
from pathlib import Path
import sqlite3
import time
from typing import Annotated
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Query

app = FastAPI(title='IIoT Measurement API', version='1.0.0')
DB_PATH = os.getenv('DB_PATH', '/measurements/measurements.sqlite')
MAX_SERIES = 64
MAX_POINTS = 32000
# Only units that can be displayed consistently on the two chart axes.
SUPPORTED = "((metric='temperature' AND unit IN ('°C','K')) OR (metric='humidity' AND unit='%'))"


@contextmanager
def database():
    try:
        uri = Path(DB_PATH).resolve().as_uri() + '?mode=ro'
        with closing(sqlite3.connect(uri, uri=True, timeout=3)) as db:
            db.row_factory = sqlite3.Row
            db.execute('PRAGMA query_only=ON')
            deadline = time.monotonic() + 10
            db.set_progress_handler(lambda: int(time.monotonic() > deadline), 10000)
            yield db
    except sqlite3.Error:
        raise HTTPException(503, 'Das Messdatenarchiv ist momentan nicht verfügbar. Bitte erneut versuchen.') from None


@app.get('/api/health')
def health():
    with database() as db:
        db.execute('SELECT id FROM readings LIMIT 1').fetchone()
    return {'status': 'ok'}


@app.get('/api/config')
def config():
    url = os.getenv('GRAFANA_URL', 'http://localhost:3000/d/iiot-overview')
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.username or parsed.password:
        raise HTTPException(503, 'GRAFANA_URL ist nicht gültig konfiguriert.')
    return {'grafana_url': url}


@app.get('/api/metadata')
def metadata():
    with database() as db:
        rows = db.execute(f'SELECT DISTINCT group_name,sensor_id,metric FROM readings WHERE {SUPPORTED} ORDER BY group_name,sensor_id,metric').fetchall()
    return {'sensors': [dict(row) for row in rows]}


@app.get('/api/readings')
def readings(
    start: Annotated[datetime, Query(alias='from')],
    end: Annotated[datetime, Query(alias='to')],
    groups: Annotated[list[str] | None, Query(max_length=64)] = None,
    sensors: Annotated[list[str] | None, Query(max_length=128)] = None,
    interval: Annotated[int, Query(ge=0, le=31536000)] = 0,
):
    if start.utcoffset() is None or end.utcoffset() is None:
        raise HTTPException(422, 'Zeitangaben müssen eine Zeitzone enthalten.')
    begin, finish = start.timestamp(), end.timestamp()
    if not math.isfinite(begin) or not math.isfinite(finish) or finish <= begin:
        raise HTTPException(422, 'Das Ende muss nach dem Beginn liegen.')
    span = finish - begin
    if interval == 0:
        steps = (1, 5, 10, 30, 60, 300, 900, 3600, 21600, 86400, 604800, 2592000)
        interval = next((step for step in steps if step >= span / 500), math.ceil(span / 500))
    if span / interval > 2000:
        raise HTTPException(422, 'Bitte einen kürzeren Zeitraum oder eine gröbere bzw. automatische Auflösung wählen.')
    where = f'time>=? AND time<? AND {SUPPORTED}'
    params: list = [begin, finish]
    for column, values in [('group_name', groups), ('sensor_id', sensors)]:
        if values:
            if any(not value or len(value) > 256 for value in values):
                raise HTTPException(422, 'Ungültiger Gruppen- oder Sensorfilter.')
            where += f" AND {column} IN ({','.join('?' for _ in values)})"
            params.extend(values)
    with database() as db:
        series = db.execute(f'''SELECT DISTINCT group_name,sensor_id,metric FROM readings
            WHERE {where} LIMIT ?''', [*params, MAX_SERIES + 1]).fetchall()
        if len(series) > MAX_SERIES:
            raise HTTPException(422, 'Zu viele Messreihen. Bitte weniger Gruppen oder Sensoren auswählen.')
        rows = db.execute(f'''SELECT group_name,sensor_id,metric,
            CAST(time / ? AS INTEGER) * ? AS bucket,
            AVG(CASE WHEN metric='temperature' AND unit='K' THEN value-273.15 ELSE value END) AS mean,
            MIN(CASE WHEN metric='temperature' AND unit='K' THEN value-273.15 ELSE value END) AS minimum,
            MAX(CASE WHEN metric='temperature' AND unit='K' THEN value-273.15 ELSE value END) AS maximum,
            COUNT(*) AS samples,
            SUM(CASE WHEN time_source='received' THEN 1 ELSE 0 END) AS received_samples
            FROM readings WHERE {where}
            GROUP BY group_name,sensor_id,metric,bucket
            ORDER BY group_name,sensor_id,metric,bucket LIMIT ?''',
            [interval, interval, *params, MAX_POINTS + 1]).fetchall()
    if len(rows) > MAX_POINTS:
        raise HTTPException(422, 'Zu viele Datenpunkte. Bitte Filter eingrenzen oder die Auflösung erhöhen.')
    result = {}
    for row in rows:
        key = (row['group_name'], row['sensor_id'], row['metric'])
        item = result.setdefault(key, {'group': key[0], 'sensor': key[1], 'metric': key[2],
            'unit': '°C' if key[2] == 'temperature' else '%', 'points': []})
        item['points'].append({'time': row['bucket'] * 1000, 'mean': row['mean'],
            'min': row['minimum'], 'max': row['maximum'], 'count': row['samples'],
            'received_count': row['received_samples']})
    return {'from': begin * 1000, 'to': finish * 1000, 'interval_seconds': interval, 'series': list(result.values())}
