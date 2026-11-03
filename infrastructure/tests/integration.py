"""Isolated Docker smoke test. Run from repository root; no course broker traffic."""
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request
import urllib.parse
from datetime import datetime, timezone
import base64

ENV = dict(os.environ, MQTT_HOST='broker', MQTT_TOPICS='iiot/group/#',
           MQTT_TLS='false', MQTT_CLIENT_ID='', GRAFANA_ADMIN_USER='admin',
           GRAFANA_ADMIN_PASSWORD='iiot-integration-test')
BASE = ['docker', 'compose', '-p', 'iiot-test', '-f', 'compose.yaml', '-f', 'infrastructure/tests/compose.test.yaml']


def compose(*args):
    return subprocess.check_output(BASE + list(args), env=ENV, text=True).strip()


def request(path, data=None):
    req = urllib.request.Request('http://localhost:3300' + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={'Authorization': 'Basic ' + base64.b64encode(b'admin:iiot-integration-test').decode(),
                 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.load(response)


def query(sql, query_type='table'):
    response = request('/api/ds/query', {'from':str(int((time.time()-3600)*1000)),
        'to':str(int((time.time()+60)*1000)), 'queries':[{
        'refId':'A', 'datasource':{'type':'frser-sqlite-datasource','uid':'iiot-sqlite'},
        'rawQueryText':sql, 'queryText':sql, 'queryType':query_type, 'timeColumns':['time'] if query_type == 'time series' else []}]})
    result = response['results']['A']
    assert not result.get('error'), result
    return result['frames'][0]['data']['values']


def count():
    return int(compose('exec','-T','collector','python','-c',
        "import sqlite3; print(sqlite3.connect('/data/measurements.sqlite').execute('SELECT COUNT(*) FROM messages').fetchone()[0])"))


if __name__ == '__main__':
    compose('up','-d','--build','--wait','--wait-timeout','180')
    print('Containers healthy')
    before = count()
    # Eight groups, 100 messages each: burst above the expected rate.
    for group in range(8):
        compose('exec','-T','broker','sh','-c',
            "yes '{\"sensorId\":\"esp-%s\",\"timestamp\":1234,\"temperature\":22.5,\"humidity\":50}' | head -n 100 | mosquitto_pub -h localhost -q 1 -t iiot/group/test-%s/sensor/temperature/state -l" % (group,group))
    deadline = time.monotonic()+60
    while count() < before+800 and time.monotonic()<deadline:
        time.sleep(1)
    assert count() == before+800, (before, count())
    assert query('SELECT COUNT(*) FROM messages')[0][0] == before+800
    assert query('SELECT COUNT(*) FROM readings')[0][0] >= 1600
    dashboard = request('/api/dashboards/uid/iiot-overview')['dashboard']
    assert dashboard['title'] == 'IIoT Übersicht'
    for panel in dashboard['panels']:
        sql = panel['targets'][0]['rawQueryText'].replace('${group:sqlstring}', "'test-0'").replace('$__interval_ms', '1000')
        query(sql, 'time series' if panel['type'] == 'timeseries' else 'table')
    with urllib.request.urlopen('http://localhost:3301/messdaten', timeout=15) as response:
        assert '<app-root>' in response.read().decode()
    api_params = urllib.parse.urlencode({'from': datetime.fromtimestamp(time.time()-3600, timezone.utc).isoformat(),
        'to':datetime.fromtimestamp(time.time()+60, timezone.utc).isoformat(), 'groups':'test-0', 'sensors':'esp-0', 'interval':60})
    with urllib.request.urlopen('http://localhost:3301/api/readings?' + api_params, timeout=15) as response:
        result = json.load(response)
        assert len(result['series']) == 2
        assert all(s['group'] == 'test-0' for s in result['series'])
        assert all(p['min'] <= p['mean'] <= p['max'] for s in result['series'] for p in s['points'])
    with urllib.request.urlopen('http://localhost:3301/api/config', timeout=15) as response:
        assert json.load(response)['grafana_url'].startswith('http://localhost:3300/')
    print('800 MQTT messages archived; Grafana datasource and dashboard verified')
    compose('restart','collector')
    compose('up','-d','--no-deps','--wait','collector')
    assert count() == before+800
    assert query('SELECT COUNT(*) FROM messages')[0][0] == before+800
    stamp = str(time.time_ns())
    backup = '/backups/test-' + stamp + '.sqlite'
    compose('exec','-T','collector','python','collector.py','--backup',backup)
    result = compose('exec','-T','collector','python','-c',
        f"import sqlite3; d=sqlite3.connect('{backup}'); print(d.execute('PRAGMA integrity_check').fetchone()[0]); print(d.execute('SELECT COUNT(*) FROM messages').fetchone()[0])")
    assert result == f'ok\n{before+800}', result
    compose('stop','website','api','collector','grafana')
    compose('run','--rm','--no-deps','collector','python','collector.py','--restore',backup)
    compose('start','collector','grafana','api','website')
    assert count() == before+800
    compose('stop','broker')
    time.sleep(7)
    assert request('/api/health')['database'] == 'ok'
    compose('start','broker')
    time.sleep(8)
    compose('exec','-T','broker','mosquitto_pub','-h','localhost','-q','1','-t',
            'iiot/group/test-0/sensor/temperature/state','-m','{"value":23,"unit":"°C"}')
    time.sleep(2)
    assert count() == before+801
    assert query('SELECT COUNT(*) FROM messages')[0][0] == before+801
    print('Persistence, backup/restore, broker outage and reconnect verified')
    compose('stop')
    print('Test containers stopped; test volumes preserved for inspection')
