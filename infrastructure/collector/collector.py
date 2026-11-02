"""MQTT archive: commit original bytes before acknowledging QoS 1 messages."""
import argparse
from contextlib import closing
import json
import logging
import math
import os
from pathlib import Path
import signal
import sqlite3
import time
from datetime import datetime, timezone

DB = os.getenv('DB_PATH', '/data/measurements.sqlite')
LOG = logging.getLogger('collector')


def connect_db(path=DB):
    db = sqlite3.connect(path, timeout=10)
    db.execute('PRAGMA foreign_keys=ON')
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('PRAGMA synchronous=FULL')
    version = db.execute('PRAGMA user_version').fetchone()[0]
    if version not in (0, 1):
        raise RuntimeError(f'Unsupported database schema: {version}')
    db.executescript('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY, received_at REAL NOT NULL,
            topic TEXT NOT NULL, payload BLOB NOT NULL,
            qos INTEGER NOT NULL, retained INTEGER NOT NULL,
            parse_error TEXT
        );
        CREATE TABLE IF NOT EXISTS readings (
            id INTEGER PRIMARY KEY,
            message_id INTEGER NOT NULL REFERENCES messages(id),
            time REAL NOT NULL, time_source TEXT NOT NULL,
            group_name TEXT NOT NULL, sensor_id TEXT NOT NULL,
            metric TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS readings_time ON readings(time);
        CREATE INDEX IF NOT EXISTS readings_sensor_time
            ON readings(group_name, sensor_id, metric, time);
        PRAGMA user_version=1;
    ''')
    return db


def normalize(topic, payload, received):
    if payload.strip() in (b'ok', b'error', b'offline'):
        return []  # Existing devices also publish plain-text status messages.
    data = json.loads(payload)
    if isinstance(data, str) and data in ('ok', 'error', 'offline'):
        return []
    if not isinstance(data, dict):
        raise ValueError('Expected JSON object')
    parts = topic.split('/')
    group = parts[2] if len(parts) > 2 else 'unknown'
    sensor = str(data.get('sensor_id') or data.get('sensorId') or topic)
    timestamp = received
    source = 'received'
    if isinstance(data.get('timestamp'), str):
        dt = datetime.fromisoformat(data['timestamp'].replace('Z', '+00:00'))
        if dt.utcoffset() is None:
            raise ValueError('Timestamp must contain timezone')
        timestamp, source = dt.timestamp(), 'device'
    values = []
    if 'value' in data:
        metric = parts[-2] if len(parts) > 2 else 'value'
        values.append((metric, data['value'], str(data.get('unit', ''))))
    for metric, unit in [('temperature', '°C'), ('humidity', '%')]:
        if metric in data:
            values.append((metric, data[metric], unit))
    result = []
    for metric, value, unit in values:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f'Invalid numeric value for {metric}')
        result.append((timestamp, source, group, sensor, metric, value, unit))
    return result


def store(db, topic, payload, qos=0, retained=False, received=None):
    received = time.time() if received is None else received
    error = None
    try:
        readings = normalize(topic, payload, received)
    except (ValueError, TypeError, OverflowError, UnicodeError) as exc:
        readings, error = [], str(exc)
    with db:
        mid = db.execute(
            'INSERT INTO messages(received_at,topic,payload,qos,retained,parse_error) VALUES(?,?,?,?,?,?)',
            (received, topic, payload, qos, int(retained), error)).lastrowid
        db.executemany('''INSERT INTO readings
            (message_id,time,time_source,group_name,sensor_id,metric,value,unit)
            VALUES(?,?,?,?,?,?,?,?)''', [(mid, *row) for row in readings])
    if error:
        LOG.warning('Message %s archived without readings: %s', mid, error)


def backup(destination):
    target = Path(destination)
    target.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation prevents accidental overwrite of an existing backup.
    with target.open('xb'):
        pass
    with closing(sqlite3.connect(f'file:{DB}?mode=ro', uri=True)) as source:
        with closing(sqlite3.connect(target)) as output:
            source.backup(output)
            if output.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('Backup integrity check failed')
    print(f'Backup created: {target}')


def restore(source_path):
    """Offline restore; stop collector and Grafana before running this command."""
    temporary = Path(DB + '.restore')
    if temporary.exists():
        raise RuntimeError('Previous restore file exists; inspect it before retrying')
    with closing(sqlite3.connect(f'file:{source_path}?mode=ro', uri=True)) as source:
        if source.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('Source integrity check failed')
        if source.execute('PRAGMA user_version').fetchone()[0] != 1:
            raise RuntimeError('Unsupported backup schema')
        with closing(sqlite3.connect(temporary)) as target:
            source.backup(target)
    for suffix in ('-wal', '-shm'):
        Path(DB + suffix).unlink(missing_ok=True)
    temporary.replace(DB)
    print('Restore complete; restart collector and Grafana')


def main():
    import paho.mqtt.client as mqtt
    db = connect_db()
    running = True
    connected = False
    heartbeat = Path('/tmp/collector-health')
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                         client_id=os.getenv('MQTT_CLIENT_ID', ''),
                         protocol=mqtt.MQTTv311, manual_ack=True)
    if os.getenv('MQTT_USERNAME'):
        client.username_pw_set(os.environ['MQTT_USERNAME'], os.getenv('MQTT_PASSWORD', ''))
    if os.getenv('MQTT_TLS', 'false').lower() == 'true':
        client.tls_set()
    topics = [t.strip() for t in os.getenv('MQTT_TOPICS', 'iiot/group/#').split(',') if t.strip()]
    if not topics:
        raise ValueError('MQTT_TOPICS must not be empty')

    def on_connect(c, userdata, flags, reason_code, properties):
        nonlocal connected
        connected = not reason_code.is_failure
        if connected:
            for topic in topics:
                c.subscribe(topic, qos=1)
            LOG.info('MQTT connected; subscribed to %s', topics)
        else:
            LOG.error('MQTT connection refused: %s', reason_code)

    def on_disconnect(c, userdata, flags, reason_code, properties):
        nonlocal connected
        connected = False
        LOG.warning('MQTT disconnected: %s', reason_code)

    def on_message(c, userdata, message):
        store(db, message.topic, message.payload, message.qos, message.retain)
        if message.qos:
            c.ack(message.mid, message.qos)

    def stop(*_):
        nonlocal running
        running = False

    client.on_connect, client.on_disconnect, client.on_message = on_connect, on_disconnect, on_message
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        while running:
            heartbeat.touch()
            try:
                client.connect(os.environ['MQTT_HOST'], int(os.getenv('MQTT_PORT', '1883')), 60)
                while running:
                    if client.loop(timeout=1) != mqtt.MQTT_ERR_SUCCESS:
                        break
                    heartbeat.touch()
            except OSError as exc:
                LOG.warning('MQTT unavailable: %s', exc)
            heartbeat.touch()
            for _ in range(5):
                if not running:
                    break
                time.sleep(1)
    finally:
        client.disconnect()
        db.close()
        heartbeat.unlink(missing_ok=True)


if __name__ == '__main__':
    logging.basicConfig(level=os.getenv('LOG_LEVEL', 'INFO'), format='%(asctime)s %(levelname)s %(message)s')
    parser = argparse.ArgumentParser()
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument('--backup')
    actions.add_argument('--restore')
    args = parser.parse_args()
    if args.restore:
        restore(args.restore)
    elif args.backup:
        backup(args.backup)
    else:
        main()
