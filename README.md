# Industrial Internet of Things (MECH-M-DUAL-3-IOT)

Unterlagen, Aufgabenstellung und Vorlagen für die synchronen Termine 1–3 der Lehrveranstaltung Industrial Internet of Things am MCI (WS 2026).

**Website:** https://jhumci.github.io/MECH-M-3-IIoT/

## Struktur

- `index.qmd`, `docs/`: Aufgabenstellung und Inhalte der Termine (Quarto)
- `docs/iot-specs/`: verbindliche Spezifikationen (`conventions.md`, `asyncapi.yaml`, `openapi.yaml`)
- `src/raspi_firmware/`: Vorlage für den Raspberry Pi Pico W (CircuitPython)
- `src/esp32_firmware/`: Vorlage für den ESP32 (PlatformIO/Arduino)
- `Website/`: Angular-Anwendung
- `docs/Dokumentation.qmd`: Platz für Ihre eigene Dokumentation

## Gesamtes System mit Docker starten

Die Angular-Website, Messdaten-API, der MQTT-Collector und Grafana lassen sich gemeinsam starten.
Im Hauptverzeichnis `.env.example` nach `.env` kopieren und die Zugangsdaten eintragen, dann:

```bash
docker compose up -d --build
```

- Website mit den Tabs **Geräte-API** und **Messdaten**: http://localhost:4200
- Grafana: http://localhost:3000 (auch im Messdaten-Tab verlinkt)
- Stoppen: `docker compose stop`; später starten: `docker compose start`

Die Messdaten-Diagramme bieten Zeit-, Gruppen- und Sensorfilter, optionale Min-/Max-Bereiche
und eine Aktualisierung alle 5, 10 oder 30 Sekunden. Einrichtung, Konfiguration und
Datensicherung sind in [infrastructure/README.md](infrastructure/README.md) beschrieben.
Ein laufendes `ng serve` vorher beenden, damit Port 4200 frei ist.

## Angular-Anwendung lokal einrichten und starten

### 1. Node.js und npm installieren

Installieren Sie **Node.js 22 (ab Version 22.12)** von [nodejs.org](https://nodejs.org/). npm wird dabei automatisch mitinstalliert. Öffnen Sie anschließend ein neues Terminal und prüfen Sie die Installation:

```bash
node --version
npm --version
```

### 2. Angular CLI installieren

Installieren Sie die Angular CLI in der zum Projekt passenden Hauptversion 21. Damit steht der Befehl `ng` im Terminal zur Verfügung:

```bash
npm install -g @angular/cli@21
```

### 3. npm-Pakete herunterladen

Wechseln Sie vom Hauptverzeichnis dieses Repositorys in den Ordner der Angular-Anwendung und installieren Sie die Abhängigkeiten:

```bash
cd Website
npm install
```

Dadurch werden Angular und alle weiteren in `package.json` angegebenen Pakete heruntergeladen und im Ordner `node_modules` abgelegt. Dieser Schritt ist bei der ersten Einrichtung und nach Änderungen an den Abhängigkeiten nötig.

### 4. Anwendung starten

Für die Entwicklung mit automatischem Neuladen zuerst im Hauptverzeichnis die
Daten-Dienste starten und den Website-Container stoppen:

```bash
docker compose stop website
docker compose up -d collector api grafana
```

Führen Sie anschließend im Ordner `Website` folgenden Befehl aus:

```bash
ng serve -o
```

Der Entwicklungsserver startet und öffnet die Anwendung automatisch im Browser unter `http://localhost:4200/`. Änderungen am Quellcode werden automatisch neu geladen. Lassen Sie das Terminal während der Entwicklung geöffnet; mit `Strg+C` beenden Sie den Server.

Alternativ können Sie die lokal installierte Angular CLI über npm starten, auch ohne globale CLI-Installation:

```bash
npm start -- --open
```

## Dokumentation lokal bauen

```bash
pdm install
pdm run quarto preview
```

Bei jedem Push auf `main` wird die Website automatisch per GitHub Action gebaut und veröffentlicht (`.github/workflows/publish.yml`).

## Messdaten mit Docker, SQLite und Grafana archivieren

Einrichtung, Start/Stop, Konfiguration und Datensicherung stehen in
[infrastructure/README.md](infrastructure/README.md).
Die Dienste werden über `compose.yaml` gestartet; die Firmware bleibt unverändert.
