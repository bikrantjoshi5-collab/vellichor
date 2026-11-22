# Vellichor Maestro E2E Flows

Run against a USB-connected Android phone or Android emulator:

```bash
maestro test .maestro/smoke-test.yaml
maestro test .maestro/sources-update.yaml
maestro test .maestro/reader-tts.yaml
```

| Flow | Validates |
|---|---|
| `smoke-test.yaml` | App boot, 4-tab navigation (Library, Updates, Sources, More), Download Queue screen |
| `sources-update.yaml` | GitHub repository import form and sync button accessibility |
| `reader-tts.yaml` | Voice Read-Aloud stays hidden by default and docks cleanly below prose when switched on |
