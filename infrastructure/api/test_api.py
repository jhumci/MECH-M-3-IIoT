from datetime import datetime, timezone
from pathlib import Path
import sqlite3
import tempfile
import unittest

from fastapi.testclient import TestClient
import app as api


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.original = api.DB_PATH
        api.DB_PATH = str(Path(self.temp.name) / 'data.sqlite')
        self.db = sqlite3.connect(api.DB_PATH)
        self.db.execute('CREATE TABLE readings(id INTEGER PRIMARY KEY, time REAL, time_source TEXT, group_name TEXT, sensor_id TEXT, metric TEXT, value REAL, unit TEXT)')
        base = datetime(2026, 11, 2, tzinfo=timezone.utc).timestamp()
        self.begin = base
        values = [
            (base, 'device', 'a', 'sensor-1', 'temperature', 20, '°C'),
            (base + 1, 'received', 'a', 'sensor-1', 'temperature', 295.15, 'K'),
            (base + 1, 'device', 'a', 'sensor-1', 'humidity', 50, '%'),
            (base + 1, 'device', 'b', 'sensor-2', 'temperature', 99, '°C'),
            (base + 10, 'device', 'a', 'sensor-1', 'temperature', 30, '°C'),
            (base + 1, 'device', 'a', 'sensor-1', 'temperature', 999, 'unknown'),
        ]
        self.db.executemany('INSERT INTO readings(time,time_source,group_name,sensor_id,metric,value,unit) VALUES(?,?,?,?,?,?,?)', values)
        self.db.commit()
        self.client = TestClient(api.app)
        self.params = {'from': '2026-11-02T00:00:00Z', 'to': '2026-11-02T00:00:10Z', 'interval': 10}

    def tearDown(self):
        self.client.close()
        self.db.close()
        api.DB_PATH = self.original
        self.temp.cleanup()

    def test_filters_aggregation_units_and_exclusive_end(self):
        response = self.client.get('/api/readings', params={**self.params, 'groups': 'a'})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data['series']), 2)
        temp = next(s for s in data['series'] if s['metric'] == 'temperature')
        point = temp['points'][0]
        self.assertAlmostEqual(point['mean'], 21)
        self.assertAlmostEqual(point['min'], 20)
        self.assertAlmostEqual(point['max'], 22)
        self.assertEqual(point['count'], 2)
        self.assertEqual(point['received_count'], 1)
        self.assertEqual(data['from'], self.begin * 1000)

    def test_multiple_groups_sensor_filter_and_injection(self):
        data = self.client.get('/api/readings', params={**self.params, 'groups': ['a','b'], 'sensors':'sensor-2'}).json()
        self.assertEqual(len(data['series']), 1)
        self.assertEqual(data['series'][0]['group'], 'b')
        response = self.client.get('/api/readings', params={**self.params, 'groups': "a') OR 1=1 --"})
        self.assertEqual(response.json()['series'], [])
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM readings').fetchone()[0], 6)

    def test_validation_and_empty_results(self):
        for updates in [{'from':'2026-11-02T00:00:00'}, {'to':'2026-11-01T00:00:00Z'}, {'interval':-1}, {'to':'2026-12-02T00:00:00Z', 'interval':1}]:
            self.assertEqual(self.client.get('/api/readings', params={**self.params, **updates}).status_code, 422)
        self.assertEqual(self.client.get('/api/readings', params={**self.params, 'groups':'missing'}).json()['series'], [])
        self.assertEqual(self.client.get('/api/readings', params={**self.params,'interval':0}).status_code, 200)

    def test_health_metadata_and_readonly_connection(self):
        self.assertEqual(self.client.get('/api/health').status_code, 200)
        self.assertEqual(len(self.client.get('/api/metadata').json()['sensors']), 3)
        with self.assertRaises(Exception):
            with api.database() as db:
                db.execute('DELETE FROM readings')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM readings').fetchone()[0], 6)
        api.DB_PATH = str(Path(self.temp.name) / 'missing.sqlite')
        self.assertEqual(self.client.get('/api/health').status_code, 503)
        self.assertFalse(Path(api.DB_PATH).exists())


if __name__ == '__main__':
    unittest.main()
