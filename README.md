# Industrial Internet of Things (MECH-M-DUAL-3-IOT)

Unterlagen, Aufgabenstellung und Vorlagen für die synchronen Termine 1–3 der Lehrveranstaltung Industrial Internet of Things am MCI (WS 2026).

**Website:** https://jhumci.github.io/MECH-M-3-IIoT/

## Struktur

- `index.qmd`, `docs/`: Aufgabenstellung und Inhalte der Termine (Quarto)
- `docs/iot-specs/`: verbindliche Spezifikationen (`conventions.md`, `asyncapi.yaml`, `openapi.yaml`)
- `src/raspi_firmware/`: Vorlage für den Raspberry Pi Pico W (CircuitPython)
- `src/esp32_firmware/`: Vorlage für den ESP32 (PlatformIO/Arduino)
- `docs/Dokumentation.qmd`: optionaler Platz für Details Ihrer Dokumentation

Ersetzen Sie dieses README in Ihrem Fork durch Ihr eigenes, siehe [Abgabe](https://jhumci.github.io/MECH-M-3-IIoT/#abgabe).

## Dokumentation lokal bauen

```bash
pdm install
pdm run quarto preview
```

Bei jedem Push auf `main` wird die Website automatisch per GitHub Action gebaut und veröffentlicht (`.github/workflows/publish.yml`).
