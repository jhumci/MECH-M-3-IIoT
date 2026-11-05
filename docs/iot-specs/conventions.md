# MQTT & Daten-Konventionen

## Topics
- Struktur: `iiot/group/{nachname1-nachname2-nachname3}/sensor/temperature/state`
- Nur Kleinbuchstaben und `/` als Trenner
- Beispiel: `iiot/group/mustermann-meier-schmidt/sensor/temperature/state`
- Gerätestatus: `iiot/group/{nachname1-nachname2-nachname3}/status` (retained, Last Will = `{"status": "offline"}`)

## Payload
- Standardformat: JSON
- Zeitstempel immer in **UTC, ISO8601** (`2025-08-28T10:00:00Z`)
- Einheit als String (z. B. `"°C"`)
- Statuswerte: `ok`, `error`, `offline`
- Auch Statusnachrichten sind JSON, kein reiner Text. Das gilt ebenso für den Last Will. Pflichtfeld ist `status`, `timestamp` und `sensor_id` sind optional (siehe `asyncapi.yaml`): `{"status": "ok"}`

## Endpunkt

- Host: `158.180.44.197` (privater Kurs-Broker)
- Port: 1883
- Username: `bobm`
- Password: In Vorlesung erfragen
- SSL/TLS: False
- Client-ID: Nach eigener Konfiguration
- MQTT-Version: 5.0

# REST-API Konventionen

- Endpunkte sind **unverschlüsselt (HTTP)** erreichbar.
- Standard-Port: `80`
- Basis-URL: `http://<deviceIp>/`

## Endpunkte
### `/config`
- **GET**: Gibt aktuelle Konfiguration zurück.
- **POST**: Ändert das Sendeintervall. Die `device_id` darf nicht über POST geändert werden.

### `/status`
- **GET**: Gibt den aktuellen Gerätestatus zurück.

### Beispiel `GET /config` Response
Die Feldnamen entsprechen den Schlüsseln in `settings.toml`.
```json
{
  "device_id": "yourmuesli-innsbruck-01",
  "reading_interval_seconds": 60
}
```

### Beispiel `GET /status` Response
`last_telemetry` und `last_humidity_percent` sind `null`, solange noch kein Wert vorliegt.
```json
{
  "device_id": "yourmuesli-innsbruck-01",
  "uptime_seconds": 150,
  "wifi_connected": true,
  "mqtt_connected": true,
  "last_telemetry": {
    "timestamp": "2026-11-03T14:17:02Z",
    "value": 22.8,
    "unit": "°C"
  },
  "last_humidity_percent": 61
}
```

Das verbindliche Schema steht in `openapi.yaml`. Weitere Felder dürfen ergänzt werden.
