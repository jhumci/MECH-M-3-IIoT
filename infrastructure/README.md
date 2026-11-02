# Lokales MQTT-Archiv mit SQLite und Grafana

Der Python-Collector speichert die Nachrichten des bestehenden Kurs-Brokers.
Die Firmware bleibt unverändert. Jeder Rechner führt ein unabhängiges Archiv.
Es gibt keine automatische Löschung oder Synchronisation zwischen Rechnern.

## Voraussetzungen und Start

Docker Desktop mit Linux-Containern und Docker Compose ab Version 2.24.4 installieren.
Unter Windows: Settings → General → Use the WSL 2 based engine und
Settings → Resources → WSL Integration → eigene Ubuntu-Distribution aktivieren.
Docker Desktop muss während des Betriebs laufen.

Im Hauptverzeichnis:

```bash
cp .env.example .env
```

In `.env` das Kurs-MQTT-Passwort und ein eigenes `GRAFANA_ADMIN_PASSWORD`
eintragen. Keine Firmware-`.env` kopieren. Danach:

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 collector
```

Grafana: http://localhost:3000, Benutzer `admin` (konfigurierbar).
Dashboard unter **Dashboards → IIoT → IIoT Übersicht**.
Beim ersten Start benötigt die Plugin-Installation Internetzugang.
Grafana startet nach Initialisierung des Collectors, auch wenn der Broker offline ist.
Eine spätere Broker-Unterbrechung beendet Grafana nicht.

```bash
docker compose stop
# Später wieder einschalten:
docker compose start
```

Die Dienste starten nicht automatisch beim nächsten Docker-Start;
`on-failure` startet sie nur nach einem Prozessfehler neu (maximal fünfmal).
`docker compose down` entfernt Container, erhält aber Volumes.
**`docker compose down -v` löscht alle zugehörigen Daten dauerhaft.**
Gleichen Projektordner/Compose-Projektnamen weiterverwenden, um dieselben
Volumes wiederzuverwenden. Volumes sind keine Backups.

## Daten und Grenzen

`messages` archiviert Originalbytes, Topic, Empfangszeit, QoS, Retained-Flag und
Parserfehler. `readings` enthält numerische Werte für Grafana.
Unterstützt: `value` + `unit` sowie die vorhandenen Felder `temperature` und
`humidity`. Andere Formate bleiben vollständig im Roharchiv erhalten, benötigen
für Diagramme aber einen zusätzlichen Parser. Vor Einsatz alle Gruppenformate
mit repräsentativen Beispielnachrichten prüfen.

ISO8601-Zeitstempel mit Zeitzone werden als Messzeit verwendet. Numerische
Zeitstempel wie ESP32-`millis()` bleiben in den Rohdaten; das Diagramm verwendet
die Empfangszeit (`time_source=received`). Metadaten werden nicht als tatsächlicher
Online-/Offline-Status interpretiert. Die bestehende ESP32-Firmware sendet dort
Metadaten und keinen verlässlichen Last Will.

MQTT 3.1.1 wird für Kompatibilität mit der vorhandenen Firmware verwendet.
Abonnement mit QoS 1 erhöht nicht den QoS einer mit QoS 0 gesendeten Nachricht.
QoS-1-Nachrichten werden nach dem Datenbank-Commit bestätigt. MQTT kann Duplikate
liefern; diese werden bewusst archiviert. Ohne eindeutige Ereignis-ID würde
Deduplizierung möglicherweise echte Messungen löschen.
Zufällige Client-IDs verhindern gegenseitiges Trennen eurer vier Collector.
Es gibt keine dauerhafte Offline-Session: Während der Collector aus ist,
werden keine historischen Nachrichten nachgeladen. Retained-Nachrichten können
beim Start erneut eintreffen. Die unveränderte Firmware und der Kurs-Broker
ermöglichen keine Zusage einer lückenlosen Erfassung.

SQLite nutzt lokale Docker-Volumes, kurze Transaktionen, `synchronous=FULL` und
WAL-Journaling für parallele Lesezugriffe. Der Collector initialisiert die WAL- und
Shared-Memory-Dateien vor dem Start von Grafana; der Zugriff wird im Integrationstest geprüft.
Es wird ein Collector pro Datenbank betrieben. Kein Netzwerkdateisystem.
Grafana bindet das Archiv nur lesend ein; seine interne Datenbank liegt separat.
Der Port ist nur an localhost gebunden. Der vorhandene unverschlüsselte
Kurs-Broker wird unverändert verwendet; Zugangsdaten und Nachrichten sind dabei
auf dem Transportweg nicht verschlüsselt.

Acht Gruppen mit je einer Nachricht pro Sekunde ergeben bis zu 691.200
Nachrichten pro Tag (zusätzlich eine oder mehrere Messwertzeilen pro Nachricht).
Ohne Löschfrist wächst die DB dauerhaft. Speicherverbrauch regelmäßig prüfen:

```bash
docker compose exec collector python -c "import os; print(os.path.getsize('/data/measurements.sqlite'), 'Bytes')"
```

Lange Auswertungen können Schreibzugriffe verzögern. Grafana-Zeiträume begrenzen.
Die Diagramme aggregieren abhängig vom gewählten Zeitraum; Rohdaten bleiben vollständig erhalten.
Mehrere schreibende Hosts erfordern eine neue Speicherarchitektur.

## Backup und Wiederherstellung

Konsistentes Backup im separaten Backup-Volume erstellen (Dateiname muss neu sein):

```bash
docker compose exec collector python collector.py --backup /backups/archive-2026-11-02.sqlite
docker compose cp collector:/backups/archive-2026-11-02.sqlite ./archive-2026-11-02.sqlite
```

Die exportierte Datei zusätzlich auf einem anderen Datenträger sichern.
Keine laufende SQLite-Datei einfach kopieren (insbesondere nicht ohne ihre WAL-Datei). Backups werden manuell ausgelöst;
für dauerhaftes Sammeln regelmäßig wiederholen. Auch Grafana-Eigenänderungen
separat exportieren; das mitgelieferte Dashboard ist im Repository versioniert.

Zum Wiederherstellen zunächst ein aktuelles Backup erstellen. Danach beide
Dienste stoppen, die geprüfte Sicherung in den gestoppten Collector kopieren
und wieder starten:

```bash
docker compose stop
docker compose cp ./archive-2026-11-02.sqlite collector:/backups/restore.sqlite
docker compose run --rm --no-deps collector python collector.py --restore /backups/restore.sqlite
docker compose start
```

Die Wiederherstellung prüft Integrität und Schema, erzeugt die DB mit den richtigen
Dateirechten und entfernt alte WAL-/SHM-Dateien. Sie darf ausschließlich bei
beiden gestoppten Diensten ausgeführt werden und ersetzt den bisherigen DB-Stand.
Manuelle Löschung einzelner Zeiträume erst nach Backup und anhand gezielter
SQL-Transaktionen; es gibt absichtlich keinen automatischen Löschdienst.

## Prüfung und Fehlerbehebung

```bash
python3 -m unittest discover -s infrastructure/collector -v
docker compose logs --tail=100 grafana
docker compose logs --tail=100 collector
```

`unhealthy` beim Collector: Prozess und Logs prüfen. MQTT-Verbindungsfehler stehen
in den Logs. Der Healthcheck überwacht den Verarbeitungsloop; Docker startet
unhealthy Container nicht automatisch neu. Wiederverbindung erfolgt im Collector.
Bei Schreibfehlern beendet sich der Collector, statt weitere Nachrichten zu
bestätigen. Volles Volume: Speicher freigeben/erweitern und Dienst neu starten.
Grafana-Adminpasswort in `.env` gilt für die Erstinitialisierung; spätere Änderungen
müssen über Grafana erfolgen.

Isolierter Integrationstest (Test-Grafana auf Port 3300, eigener lokaler Test-Broker,
keine Kurs-Broker-Nachrichten):

```bash
python3 infrastructure/tests/integration.py
```

Der Test verwendet ausschließlich das Compose-Projekt `iiot-test` und stoppt
dessen Dienste nach Erfolg. Keine echten Daten in dieses Testprojekt schreiben.

Mit Docker prüfen: Image-Build, Plugin-Start, tatsächlicher
MQTT-Empfang, Diagramme, Container-Neustarts, Backup/Restore und Last mit den
realen Gruppenformaten. Lokale Python-Tests ersetzen diesen Integrationstest nicht.

## Verifizierter Stand (02.11.2026)

- Fünf Python-Tests erfolgreich: bestehende Formate, Textstatus/Metadaten,
  ungültige Originalnachrichten, paralleler Lesezugriff und Backup/Restore.
- Isolierter Docker-Test mit 800 QoS-1-Nachrichten aus acht Gruppen erfolgreich;
  Grafana-Datenquelle, Neustarts, Persistenz, Restore und Broker-Wiederverbindung geprüft.
- Betrieb am Kurs-Broker gestartet; echte Nachrichten und Messwerte in SQLite nachgewiesen.
- Beide Dienste healthy; Grafana-Anmeldung und alle fünf Dashboard-Abfragen geprüft.

Dies ist eine Funktions- und Lastspitzenprüfung, kein Langzeittest. Individuelle
Nachrichtenformate weiterer Gruppen bleiben zunächst im Roharchiv, sofern sie
nicht einem der oben beschriebenen Messdatenformate entsprechen.
