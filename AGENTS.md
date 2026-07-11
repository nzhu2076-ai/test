# AGENTS.md

## Cursor Cloud specific instructions

### What this is
`index.html` is the entire application: a single-file, fully client-side static web app called **VoyageEase** (an AI-themed travel planner). There is no backend, no build step, no package manager, and no lockfile. All third-party dependencies (Tailwind CSS, Google Fonts, images/icons) are loaded from CDNs at runtime, so an internet connection is needed for full styling. App state (trips, packing list) is persisted in the browser via `localStorage`.

### Running it (development)
Serve the repo root with any static file server and open `index.html`, e.g.:

```
python3 -m http.server 8000
```

Then browse to `http://localhost:8000/index.html`. Opening the file directly via `file://` also works, but serving over HTTP is preferred (PWA manifest / consistent behavior).

### Lint / test / build
There is no lint config, no automated test suite, and no build system in this repo. "Build" is a no-op — the served `index.html` is the deliverable. Verify changes manually in the browser.

### Notes / gotchas
- The new-trip form's departure field is a native `<input type="date">`. Automated tools may struggle to type into it; set it directly (e.g. `document.getElementById('new-trip-start').value='2026-08-15'`) if needed. `saveNewTrip()` validates required fields and returns early (leaving the modal open) if the date/budget/destination are missing — this is expected validation, not a bug.
- Because state lives in `localStorage`, clear site data to reset the app to a clean state.
