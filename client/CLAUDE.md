# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

YFRemote.Client is a standalone Angular 21 web app that turns a browser (typically a phone) into
a remote control for a PC. A device must first pair with the server via a one-time PIN (shown in
the server's tray menu, exchanged for a device token over `POST /pair`); once paired, it connects
over a same-origin WebSocket to a companion server process (`ws(s)://<page-origin>/ws?token=...`) and streams key
presses, hotkeys, mouse moves/clicks/scrolls as JSON messages, and the server replies with
`{ success: true }` or `{ success: false, error?: string }`.
The server lives in a sibling repo (`../../server` relative to this one, currently empty/not yet
started) — this repo only implements the client UI and protocol, it does not implement or mock a
real server beyond tests.

## Commands

```bash
npm start              # ng serve — dev server (also runnable via .claude/launch.json "yfremote-dev" on port 4301)
npm run build          # ng build — production build to dist/
npm run watch          # ng build --watch --configuration development
npm test               # ng test — runs the Vitest-based unit test suite once
```

- Run a single test file: `ng test -- src/app/remote/remote.service.spec.ts` (the unit-test builder
  forwards extra args to Vitest).
- There is no separate `vitest.config.ts`; the test runner is configured entirely through the
  `test` target (`@angular/build:unit-test`) in [angular.json](angular.json).
- There is no lint script configured and no e2e framework wired up.
- Formatting: Prettier via `.prettierrc` (single quotes, printWidth 100, Angular parser for
  `*.html`). No separate lint script is wired up — rely on `tsc`/`ng build` and editor formatting.

## Architecture

**Zoneless, standalone-component Angular.** There is no `NgModule` anywhere and `zone.js` is not a
dependency — change detection relies on signals. `src/main.ts` bootstraps the root `App` component
directly with `bootstrapApplication` using [app.config.ts](src/app/app.config.ts). Keep new
components standalone (`imports: [...]` on the `@Component` decorator) and prefer signals over
manual `ChangeDetectorRef` calls.

**Everything meaningful lives under `src/app/remote/`.** The feature has six layers:

1. **`remote.models.ts`** — shared types: `RemoteAction` (discriminated union of `key`/`hotkey`/
   `mouseMove`/`mouseClick`/`mouseScroll`), `ServerConfig`, `RemoteResponse`, `RemoteButtonConfig`,
   `RemoteIcon`.
2. **`remote.service.ts`** (`RemoteService`) — the single source of truth for connection state and
   the only thing that talks to the WebSocket. Exposes readonly signals (`config`, `status`,
   `lastError`, `mouseSensitivity`, `manuallyDisconnected`) and imperative methods
   (`connect`/`disconnect`/`reconnect`/`saveConfig`/`saveMouseSensitivity`/`sendAction`/
   `runSteps`). Owns reconnect-with-backoff logic (`RECONNECT_DELAYS_MS`) and transient-error
   display (`ERROR_VISIBLE_MS`). Every step in a multi-step macro carries a connection-local
   `requestId`; `runSteps` advances only after the matching successful server response and stops
   on rejection, disconnect, or a five-second acknowledgement timeout. Single actions remain
   fire-and-forget and use the compact existing message format. It is injected everywhere else
   that needs connection state or wants to send an action — components never touch `WebSocket`
   or `localStorage` directly.
   - The socket, page location, storage, and auto-connect-on-construct behavior are all swapped via
     `InjectionToken`s (`REMOTE_WEBSOCKET_FACTORY`, `SERVER_LOCATION`, `REMOTE_STORAGE`,
     `REMOTE_AUTO_CONNECT`) so
     tests can inject fakes (see `RemoteSocket` interface and `MockRemoteSocket` in
     [remote.service.spec.ts](src/app/remote/remote.service.spec.ts)) instead of hitting a real
     socket/`localStorage`. Follow this pattern for any other browser API a service needs to own.
   - `createSocketUrl` appends `?token=...` from `PairingService.token()` when a pairing token
     exists — the server rejects a `/ws` handshake without one. `RemoteService` injects
     `PairingService`, never the other way around (see below), so there is no DI cycle.
3. **`server-config.ts`** — pure, side-effect-free validation/parsing/normalization functions for
   host, port, and mouse sensitivity, the injectable page location, same-origin HTTP/WebSocket URL
   builders, the mouse-sensitivity `localStorage` key, and Angular reactive-form `ValidatorFn`s
   built on top of the same predicates. `RemoteService`, `PairingService`, and
   `SettingsDialogComponent` import from here so endpoint and validation logic never lives twice.
4. **The button layout is a free-form, user-editable canvas**, layered on top of the static
   button definitions:
   - `remote-actions.ts` still defines the built-in buttons (`D_PAD_ACTIONS`, `BROWSER_ACTIONS`,
     `SYSTEM_ACTIONS`, `MEDIA_ACTIONS`, flattened into `BUILT_IN_BUTTONS`), plus
     `DEFAULT_PLACEMENTS`, which reproduces today's visual arrangement as cell coordinates on a
     12-column grid. Adding a new built-in button means adding a `RemoteButtonConfig` to the
     right array *and* a `DEFAULT_PLACEMENTS` entry for it — otherwise it has no default position
     (it will still auto-place itself once, via the merge logic below).
   - `button-layout.ts` is the pure, side-effect-free module for the layout: types
     (`ButtonPlacement`, `CustomButtonDefinition`, `ButtonLayout`), the storage key
     (`yfremote.buttonLayout`), geometry helpers (`clampPlacement`, `snapPlacement`,
     `findFreeSlot`, `overlaps`), and `resolveButtonLayout`/`parseStoredButtonLayout` — the
     defensive merge that reconciles a stored layout against the built-ins of the running app
     version (unknown ids dropped, missing built-ins auto-placed unless hidden, invalid custom
     buttons dropped). Same shape as `server-config.ts`: `normalize*` + `parseStored*` with a
     safe default fallback.
   - `keyboard-keys.ts` mirrors the server's key allowlist (`WindowsInputService.VirtualKeys`) so
     a custom button's `key`/`hotkey` action is validated client-side before it can ever reach
     the server.
   - `ButtonLayoutService` (`button-layout.service.ts`) owns the layout signal and all mutations
     (`movePlacement`, `hideButton`/`restoreButton`, `addCustomButton`/`updateCustomButton`/
     `deleteCustomButton`, `resetLayout`, `setSnapToGrid`); it injects the same `REMOTE_STORAGE`
     token as `RemoteService` rather than owning a second storage token. Every mutation is
     normalized through `resolveButtonLayout` before being persisted, so the stored JSON is
     always self-consistent.
   - `ButtonCanvasComponent` renders `ButtonLayoutService.visibleButtons()` as absolutely
     positioned slots on a 12-column, fixed-row-height grid (percentage width so it scales with
     `.remote-panel`'s `min(100%, 480px)`, fixed pixel row height so touch targets stay usable).
     Dragging is hand-rolled Pointer Events (no `@angular/cdk`), following the same
     capture/rAF-batching pattern as `TouchpadComponent`. Coordinates are only rounded to whole
     cells when `snapToGrid` is on; with it off they stay fractional. Outside edit mode the
     canvas behaves exactly like the old static grids — a plain `click` sends the button's
     action.
   - `ButtonEditorDialogComponent` is the create/edit modal for custom buttons (label, one of the
     existing `RemoteIcon`s, and a key/hotkey picker built from `keyboard-keys.ts`), structured
     like `SettingsDialogComponent`.
   - `RemoteControlComponent` owns the edit-mode toggle and wires the toolbar (add/reset/snap)
     and the "hidden buttons" tray on top of `ButtonCanvasComponent`.
5. **Other UI components**, each paired with its own `.html` template (styles are mostly global,
   see below):
   - `TouchpadComponent` (`touchpad/`) — raw Pointer Events (not a library) implementing a
     laptop-trackpad UX: 1 finger drags the cursor (scaled by `remote.mouseSensitivity()`) and
     tap-clicks if it stayed within `TAP_MAX_MOVEMENT_PX`/`TAP_MAX_DURATION_MS`; 2 fingers scroll
     (vertical delta only, `SCROLL_SCALE`); 3+ fingers are ignored. Movement/scroll deltas are
     accumulated and flushed at most once per animation frame (`requestAnimationFrame`) rather than
     sent per pointer event, to avoid flooding the socket.
   - `SettingsDialogComponent` — a `ReactiveFormsModule` form for host/port/mouse sensitivity,
     validated with the shared validators from `server-config.ts`; only calls
     `RemoteService.saveConfig`/`saveMouseSensitivity` (which re-validate) and closes itself via an
     `output()` (`closed`) rather than owning any open/close state. Saving another host or port
     performs a full-page navigation instead of attempting a cross-origin socket connection.
6. **`pairing.ts`**/**`pairing.service.ts`** (`PairingService`) — the app is gated behind a
   one-time PIN pairing step: a PIN shown in the server's tray menu is exchanged for a device
   token via `POST /pair`. `PairingService` exposes `token`/`isPaired`/`lastError` signals and
   `pair(pin, deviceName, remember)`/`verify()` methods. Same shape as `server-config.ts`
   (`pairing.ts` holds pure validation helpers plus a `ValidatorFn`); reuses `RemoteService`'s
   `REMOTE_STORAGE` token directly instead of owning a second one (same pattern as
   `ButtonLayoutService`) and avoids injecting `RemoteService`, so there is no DI cycle
   (`RemoteService` injects `PairingService`, not the reverse). It derives its HTTP endpoint
   directly from the injected same-origin page location.
   Its HTTP calls go through a `PAIRING_FETCH` injection token (default
   `globalThis.fetch`) — the same swap-every-browser-API convention as the WebSocket/storage
   tokens above. "Gerät merken" (remember device) is a purely client-side choice: a remembered
   token is written to `REMOTE_STORAGE` (`yfremote.pairingToken`); an un-remembered one lives only
   in the signal and is gone after a reload. `verify()` clears a stored token only on an explicit
   `{valid:false}` from `/pair/status`, never on a network error, so a brief connectivity blip
   can't force re-pairing. `PairingGateComponent` (`pairing-gate.component.ts`, structured like
   `SettingsDialogComponent`) renders in `app.html` instead of `RemoteControlComponent` while
   `pairing.isPaired()` is false.

**Styling** is mostly centralized in [src/styles.scss](src/styles.scss) (global classes like
`.remote-panel`, `.control-button`, `.status-pill` used directly in templates); only
`touchpad.component.scss` and `button-canvas.component.scss` are component-scoped — the latter
holds only the canvas's absolute-positioning geometry (cell math via CSS custom properties), not
its visual language, which stays in the shared `.control-button` classes. When adding UI, check
`styles.scss` for an existing class before introducing component-scoped styles.

**All user-facing strings are German** (labels, aria-labels, error messages like "Keine Verbindung
zum Server."). Keep new UI text consistent with this.
