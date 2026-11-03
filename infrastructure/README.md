# Lokales IIoT-System mit Angular, SQLite und Grafana

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

Die vier Dienste starten gemeinsam:

| Dienst | Aufgabe / Adresse |
| --- | --- |
| `website` | Angular-Oberfläche: http://localhost:4200 |
| `api` | Python-Lese-API für das Messdatenarchiv; über `/api` der Website erreichbar |
| `collector` | MQTT empfangen und dauerhaft in SQLite speichern |
| `grafana` | Grafana: http://localhost:3000, Benutzer `admin` (konfigurierbar) |

Node.js, npm und Python müssen für diesen Docker-Betrieb nicht auf dem Rechner
installiert werden. Ein noch laufendes `ng serve` vorher mit Strg+C beenden,
da der Container denselben Port 4200 verwendet. Diese Adresse passt zur bestehenden
ESP32-CORS-Freigabe. Der Build und die erste Installation benötigen Internetzugang.

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

## Angular-Dashboard und Konfiguration

Die Website hat zwei Tabs:

- **Geräte-API:** vorhandene ESP32-Konfiguration und Statusabfrage.
- **Messdaten:** Temperatur- und Luftfeuchtigkeitsdiagramm mit gemeinsamen Filtern
  und dem Link **In Grafana öffnen**. Der Link öffnet das vorhandene Grafana-Dashboard
  in einem neuen Tab; dort gelten Grafanas eigene Filter und Anmeldung.

Im Messdaten-Tab Zeitraum, Gruppen und bei Bedarf einzelne Sensoren auswählen.
**Filter anwenden** lädt beide Diagramme mit derselben Auswahl. Keine Gruppen-
oder Sensorauswahl bedeutet alle. Zeiträume können relativ oder über Von/Bis in
lokaler Zeit eingestellt werden. Die Datenbank behält UTC-Zeitpunkte.

Die Diagramme zeigen Mittelwerte pro Intervall, optional mit einem Min-/Max-Bereich.
Die automatische Auflösung richtet sich nach dem Zeitraum; sie kann manuell gewählt
werden. Die verwendete Auflösung und der Zeitpunkt der letzten erfolgreichen Abfrage
stehen oberhalb der Diagramme. Kelvin wird in °C umgerechnet; Feuchtigkeit in %.
Unbekannte Einheiten werden nicht in diese Diagramme gemischt. Originaldaten bleiben
unverändert. Lücken werden bei fehlenden Zeitintervallen unterbrochen dargestellt.

**Aktualisierung:** manuell oder alle **5, 10 oder 30 Sekunden**; Standard 10 Sekunden.
Die automatische Aktualisierung verwendet die zuletzt angewendeten Filter und pausiert
in ausgeblendeten Browser-Tabs. Relative Zeiträume wandern mit der aktuellen Zeit,
ein eigener Von-/Bis-Zeitraum bleibt fest. **Aktualisieren** lädt außerdem die verfügbaren
Gruppen und Sensoren erneut. Bei Fehlern bleiben die letzten Daten mit Fehlermeldung sichtbar.

Optionale Einstellungen in der Hauptverzeichnis-`.env`:

```dotenv
WEBSITE_PORT=4200
API_PORT=8000
# Standard ergibt sich automatisch aus GRAFANA_PORT:
# GRAFANA_URL=http://localhost:3000/d/iiot-overview
```

Nach Änderungen: `docker compose up -d --build`. Auch Quellcodeänderungen an Angular
oder der Lese-API benötigen einen erneuten Build; `docker compose start` verwendet die
bereits gebauten Container. Ein abweichender Website-Port erfordert für direkte
ESP32-Abfragen eine dazu passende CORS-Freigabe in der Firmware.

Die Lese-API und die Website binden ihre Ports nur an `127.0.0.1`. Die API erhält
keine MQTT- oder Grafana-Passwörter und bindet das Messdatenvolume nur lesend ein.
Sie verwendet parametrisierte SQL-Abfragen, validierte Filter und begrenzte
Datenmengen/Abfragezeiten. Zu feine Auflösungen oder zu viele Messreihen werden mit
einer verständlichen Meldung abgewiesen; die Daten werden nicht still abgeschnitten.
Die API-Dokumentation ist lokal unter http://localhost:8000/docs erreichbar.

### Angular mit automatischem Neuladen entwickeln

Die Daten-Dienste starten, den Website-Container aber stoppen, bevor `ng serve`
denselben Port übernimmt:

```bash
docker compose stop website
docker compose up -d collector api grafana
cd Website
npm install
ng serve -o
```

Die Angular-Proxykonfiguration leitet `/api` an `http://localhost:8000` weiter.
Bei geändertem `API_PORT` auch `Website/proxy.conf.json` anpassen. Für den vollständigen
Docker-Betrieb `ng serve` beenden und im Hauptverzeichnis `docker compose up -d --build`
aufrufen.

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

Zum Wiederherstellen zunächst ein aktuelles Backup erstellen. Danach alle
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
allen gestoppten Diensten ausgeführt werden und ersetzt den bisherigen DB-Stand.
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

Isolierter Integrationstest (Test-Grafana auf Port 3300, Test-Website auf Port 3301, eigener lokaler Test-Broker,
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
- Collector und Grafana healthy; Grafana-Anmeldung und alle fünf Dashboard-Abfragen geprüft.

Dies ist eine Funktions- und Lastspitzenprüfung, kein Langzeittest. Individuelle
Nachrichtenformate weiterer Gruppen bleiben zunächst im Roharchiv, sofern sie
nicht einem der oben beschriebenen Messdatenformate entsprechen.
