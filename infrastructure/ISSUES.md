# Offene Punkte: Grafana/SQLite-Stack (Review vom 02.11.2026)

Review von Commit `a7473ba` („feat: add grafana und db (sqlite)“) gegen die
Aufgabenstellung in `docs/Termin_3_Cloud.qmd` und unseren Gruppenplan.
Issues sind im Fork deaktiviert, daher diese Liste. Erledigte Punkte bitte
abhaken bzw. im Commit referenzieren (z.B. `fix(cloud): … (ISSUES #3)`).

**Was bleibt, wie es ist:** Roharchiv `messages` mit Originalbytes und
`parse_error`, QoS-1-Ack erst nach dem Commit, Akzeptanz des Formats
unserer Firmware (`temperature`/`humidity`), Container-Härtung,
Backup/Restore und Integrationstest. Das ist alles stärker als unser Plan.

Die Befunde unten wurden mit `normalize()` und den Payloads aus dem
Broker-Mitschnitt vom 02.11. nachgeprüft. Der Docker-Integrationstest wurde
im Review **nicht** ausgeführt.

---

## #1 Status aus `iiot/group/+/status` speichern (bewertungsrelevant: *sehr gut*)

**Problem:** Status-Nachrichten landen nur im Roharchiv. `normalize()` gibt
für `b'ok'` und `{"sensor_id": "...", "status": "ok"}` nur `[]` zurück.
`b'OK'` (Großbuchstaben) wird sogar als Parse-Fehler archiviert. Eine
Auswertung des Status gibt es nicht.

**Vorschlag:** Tabelle `devices` (eine Zeile pro Gruppe):

```sql
CREATE TABLE IF NOT EXISTS devices (
    group_name        TEXT PRIMARY KEY,
    status            TEXT NOT NULL DEFAULT 'unknown',  -- ok | error | offline | unknown
    status_updated_at REAL,                             -- Empfangszeit der letzten Statusnachricht
    last_seen         REAL,                             -- Empfangszeit des letzten Messwerts
    last_value        REAL,
    unit              TEXT
);
```

Status-Parsing: UTF-8 dekodieren (Fehler → `unknown`). Zuerst als JSON
lesen: Bei einem Objekt zählt das Feld `status`, ein String bleibt der
String. Sonst den Rohtext nehmen. Danach `strip().lower()`. Was nicht in
`{ok, error, offline}` liegt, wird `unknown`. Ein leerer Payload (gelöschtes
retained Topic) wird ignoriert. Beim Speichern eines Messwerts per Upsert
`last_seen`, `last_value` und `unit` aktualisieren. Das alte Schema
(`user_version` 1) muss dabei migriert werden.

**Akzeptanz:**
- [ ] Unit-Tests für `ok`, ` OFFLINE\n`, `"error"`, JSON mit `status`, Metadaten-JSON ohne `status` (→ `unknown`), `\xff`, leeren Payload
- [ ] Status vor dem ersten Messwert legt eine Zeile mit `last_seen = NULL` an
- [ ] Ein Messwert überschreibt den Status nicht und umgekehrt

## #2 Dashboard: Sensorübersicht und Anzahl Sensoren (bewertungsrelevant: *sehr gut*)

**Problem:** Die Aufgabe verlangt eine „Übersicht über die verbundenen
Sensoren (z.B. Anzahl der Sensoren, letzte Verbindung, Status)“.
„Letzte Messwerte im gewählten Zeitraum“ deckt das nicht ab: Ein Sensor,
der länger nichts gesendet hat, verschwindet aus der Tabelle, statt als
inaktiv angezeigt zu werden.

**Vorschlag:** (setzt #1 voraus)
- Panel **Anzahl Sensoren** (stat): `known_sensors`, `active_sensors`. Aktiv heißt Messwert in den letzten 300 s, denn die meisten Geräte haben keinen Last Will, `offline` kommt also nie an.
- Panel **Sensorübersicht** (table) aus `devices`, **ohne** Zeitfilter: `group_name, status, status_updated_at, last_seen, last_value, unit, active`. Value-Mappings: ok → grün, error/offline → rot, unknown → orange.
- `active_sensors` ist bei leerer DB `0`, nicht `NULL` (`COALESCE`/`SUM(CASE …)`).

**Akzeptanz:**
- [ ] Beide Panels laufen auf einer leeren DB ohne Fehler („No data“)
- [ ] Integrationstest prüft die neuen Panel-Queries mit

## #3 Gruppenname in Kleinbuchstaben

**Problem:** `group = parts[2]` übernimmt den Topic-Teil unverändert.
`iiot/group/Kloepfer-Brose-Hirschberg-Kal/...` und nach dem Firmware-Fix
`iiot/group/kloepfer-brose-hirschberg-kal/...` werden zwei Gruppen.
`conventions.md` verlangt Kleinbuchstaben.

**Akzeptanz:**
- [ ] `group_name` wird `.lower()` gespeichert (in `readings` und `devices`)
- [ ] Leere Gruppe (`iiot/group//...`) wird nicht als Messwert gespeichert

## #4 Zeitstempel-Regel: fehlende Zone und falsch gestellte Uhr

**Problem (nachgeprüft):**
- `"2026-11-02T12:49:17"` ohne Zeitzone → `ValueError`, die **ganze Messung** fehlt in `readings`.
- `"1970-01-01T00:00:12Z"` (Gerät ohne NTP) wird mit `time = 12.0` gespeichert, der Sensor ist im Dashboard unsichtbar.

**Vorschlag:** Ohne Zone als UTC lesen. Weicht der Gerätezeitstempel mehr als
300 s von der Empfangszeit ab, die Empfangszeit verwenden
(`time_source = 'received'`). Der Original-Zeitstempel bleibt im Roharchiv.

**Akzeptanz:**
- [ ] Tests: ohne Zone, mit Offset `+01:00`, 301 s Abweichung, 1970, `millis()`-Zahl, unlesbarer String, Feld fehlt

## #5 Toleranz bei `value` und `unit`

**Problem (nachgeprüft):**
- `{"value": "21.5"}` (numerischer String) wird abgelehnt.
- `{"value": 21.5}` ohne `unit` wird mit `unit = ''` gespeichert und fällt im Temperatur-Panel durch `unit IN ('°C','K')`.
- „Alle Messwerte im Zeitraum“ rechnet Kelvin nicht um und rundet nicht. Kelvin- und °C-Werte stehen dann in getrennten Zeilen.

**Vorschlag:** Kelvin schon beim Parsen in °C umrechnen (dann braucht kein
Panel mehr ein `CASE`). Bei `metric = 'temperature'` gilt eine fehlende
Unit als °C. Numerische Strings über `float()` akzeptieren, `bool`, `NaN`
und `inf` weiter ablehnen. Kennzahlen mit `ROUND(…, 2)`.

**Akzeptanz:**
- [ ] Tests für `"21.5"`, fehlende Unit, `K` → °C

## #6 Healthcheck meldet MQTT-Probleme nicht

**Problem:** Der Heartbeat wird auch berührt, wenn der Connect scheitert.
Bei falschem Passwort oder unerreichbarem Broker bleibt der Collector
`healthy`. Ein Nutzer sieht den Fehler nur in den Logs.

**Zielkonflikt:** Grafana hängt an `condition: service_healthy`. Prüft der
Healthcheck die Verbindung, startet Grafana ohne Broker gar nicht.

**Vorschlag:** Grafana auf `condition: service_started` umstellen (den Lesezugriff
auf die DB stellt der Collector schon vor dem MQTT-Connect sicher, siehe #7).
Der Heartbeat wird dann nur bei bestehender Verbindung berührt.

**Akzeptanz:**
- [ ] `MQTT_PASSWORD=falsch docker compose up -d` → Collector nach ca. 60 s `unhealthy`, Grafana erreichbar und zeigt die bisherigen Daten
- [ ] Log nennt den Reason Code (z.B. `Not authorized`)

## #7 WAL-Modus mit Read-only-Mount verifizieren

**Problem:** In unserem Spike (Grafana 11.6.0, Plugin 4.0.6) gab WAL zusammen mit
einem für Grafana nicht beschreibbaren Verzeichnis `attempt to write a readonly database (1544)`.
Laut Plugin-FAQ braucht WAL Schreibrecht für die `-shm`-Datei. Laut
`infrastructure/README.md` funktioniert es hier mit Grafana 13.3.0 und `mode=ro`.
Beides kann stimmen (anderes Setup). Kritisch ist aber der Fall, dass
`-shm`/`-wal` fehlen, z.B. nach `restore()`, das sie löscht, oder wenn
der Collector beendet ist.

**Akzeptanz:**
- [ ] Integrationstest: Collector stoppen, sodass er beim Schließen `-wal`/`-shm` aufräumt, und Grafana fragt danach weiter ohne Fehler ab
- [ ] Integrationstest: nach `--restore` fragt Grafana vor dem Collector-Neustart ohne Fehler ab
- [ ] Falls einer davon scheitert: `journal_mode=DELETE` statt WAL

## #8 Dokumentation in `docs/Dokumentation.qmd` (Voraussetzung für jede Stufe)

**Problem:** Die Doku steht in `infrastructure/README.md`. Die Abgabe-Doku
`docs/Dokumentation.qmd` ist weiter die leere Vorlage. Laut Aufgabe muss
die Doku auch erklären, wie man den **Mikrocontroller ins WLAN einbindet**.
Das fehlt komplett.

**Akzeptanz:**
- [ ] Gliederung der Vorlage befüllt: Zusammenfassung mit Architektur-Diagramm (ESP32 → Broker → Collector → SQLite → Grafana), Mikrocontroller-Setup (`src/esp32_firmware/.env`, `pio run -t upload`), Stack starten, Fehlerbehebung, Empfehlungen IT, Developer-Anleitung
- [ ] Fehlerbehebung enthält den Reset des Admin-Passworts: `docker compose exec grafana grafana cli admin reset-admin-password <neu>`
- [ ] `pdm run quarto render` läuft durch
- [ ] `infrastructure/README.md` entweder verlinken oder in die `.qmd` überführen (nicht doppelt pflegen)

## #9 Aufräumen

- [ ] `README.md`: Der Abschnitt zur Angular-Anwendung `Website/` gehört nicht in diesen Commit (der Ordner existiert hier nicht). In einen eigenen Branch verschieben.
- [ ] `infrastructure/README.md`: Die Begründung „MQTT 3.1.1 für Kompatibilität mit der Firmware“ stimmt nicht. Das Protokoll des Subscribers ist unabhängig vom Publisher. Entweder auf MQTT 5 (wie in `conventions.md`) umstellen oder anders begründen.
- [ ] `restart: on-failure:5`: Nach einem Neustart von Docker oder dem Rechner läuft der Stack nicht wieder an. Bewusst so lassen und dokumentieren, oder `unless-stopped`.
- [ ] `sensor_id`-Fallback auf das ganze Topic macht die Legende sehr lang. Lieber `NULL` bzw. `'-'`, Panels gruppieren nach `group_name`.
- [ ] `collector.py` aufteilen (Parsing / Speicher / MQTT / CLI), damit Parser und Dashboard-SQL getrennt testbar sind (Codequalität fließt in die Bewertung ein).
