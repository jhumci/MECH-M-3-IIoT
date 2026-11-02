import json
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
import collector
from collector import connect_db, store


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.tmp.name) / 'test.sqlite')
        self.db = connect_db(self.path)

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def test_existing_esp_and_specification(self):
        store(self.db, 'iiot/group/a/sensor/temperature/state', json.dumps(
            dict(sensorId='esp', timestamp=1234, temperature=22.5, humidity=50)).encode(), received=100)
        store(self.db, 'iiot/group/b/sensor/temperature/state', json.dumps(
            dict(sensor_id='spec', timestamp='2026-11-02T10:00:00Z', value=21, unit='°C')).encode())
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM readings').fetchone()[0], 3)
        self.assertEqual(self.db.execute('SELECT time,time_source FROM readings ORDER BY id LIMIT 1').fetchone(), (100, 'received'))
        self.assertEqual(self.db.execute('SELECT time_source FROM readings WHERE sensor_id="spec"').fetchone()[0], 'device')

    def test_plain_status_and_metadata_are_archived(self):
        for payload in (b'offline', b'"ok"', b'{"sensorId":"esp","unit":"C"}'):
            store(self.db, 'iiot/group/a/status', payload)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM messages').fetchone()[0], 3)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM messages WHERE parse_error IS NOT NULL').fetchone()[0], 0)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM readings').fetchone()[0], 0)

    def test_bad_payload_is_preserved(self):
        for payload in [b'\xff', b'not json', b'{"value":NaN}', b'{"value":true}']:
            store(self.db, 'iiot/group/a/sensor/temperature/state', payload)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM messages WHERE parse_error IS NOT NULL').fetchone()[0], 4)
        self.assertEqual(self.db.execute('SELECT payload FROM messages LIMIT 1').fetchone()[0], b'\xff')

    def test_readonly_concurrent_reader_and_restore(self):
        with sqlite3.connect(f'file:{self.path}?mode=ro', uri=True) as reader:
            for i in range(1000):
                store(self.db, 'iiot/group/a/sensor/temperature/state', b'{"temperature":22}')
                self.assertEqual(reader.execute('SELECT COUNT(*) FROM messages').fetchone()[0], i + 1)
        with sqlite3.connect(str(Path(self.tmp.name)/'backup.sqlite')) as backup:
            self.db.backup(backup)
            self.assertEqual(backup.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            self.assertEqual(backup.execute('SELECT COUNT(*) FROM messages').fetchone()[0], 1000)

    def test_backup_restore_and_reject_invalid_source(self):
        original_path = collector.DB
        collector.DB = self.path
        try:
            store(self.db, 'iiot/group/a/sensor/temperature/state', b'{"temperature":22}')
            saved = str(Path(self.tmp.name) / 'saved.sqlite')
            collector.backup(saved)
            store(self.db, 'iiot/group/a/sensor/temperature/state', b'{"temperature":23}')
            self.db.close()
            collector.restore(saved)
            self.db = connect_db(self.path)
            self.assertEqual(self.db.execute('SELECT COUNT(*) FROM messages').fetchone()[0], 1)
            invalid = str(Path(self.tmp.name) / 'invalid.sqlite')
            with sqlite3.connect(invalid) as db:
                db.execute('CREATE TABLE unrelated(value)')
            with self.assertRaises(RuntimeError):
                collector.restore(invalid)
            self.assertEqual(self.db.execute('SELECT COUNT(*) FROM messages').fetchone()[0], 1)
        finally:
            collector.DB = original_path


if __name__ == '__main__':
    unittest.main()
