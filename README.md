# Typwriter

**A DeepSeek Harness (DSH) plugin that turns the editor into a Typst / LaTeX paper-writing workbench — with a DSH agent living in the sidebar.**

Typwriter is a **fork of [Texpile](https://github.com/texpile/texpile)** (AGPL-3.0). The editing
surface — visual editor, source editor, Typst live preview, IntelliSense, PDF pane — is Texpile's.
What this fork adds is the part that makes it work **inside a web host** and **with an agent**:

- a browser bridge that replaces Texpile's Electron preload (`window.texpileNative` and friends)
  with an HTTP/SSE transport,
- an **Agent Client Protocol (ACP)** client that runs **DeepSeek Harness** as the in-editor agent,
- a right-hand **agent pane** next to the PDF pane,
- a few editor-layout additions (three-column layout, per-pane close),
- Simplified Chinese as the default UI language.

> This project is **not affiliated with, endorsed by, or published by the Texpile project**.
> The name "Texpile" and the Texpile logo are their trademarks; this fork ships **its own name and
> original artwork** and does not use theirs. See [`NOTICE`](NOTICE).

---

## Repository layout

| Path | What it is |
|---|---|
| `apps/`, `packages/`, `electron/`, `branding/` | the Texpile monorepo, patched (see below) |
| `scripts/patches.mjs` | **the audited patch list** — every change to upstream code, with anchors |
| `scripts/check-svelte.mjs` | fast structural check of all `.svelte` files (~1 s) |
| `PATCHING.md` | how to change upstream code without breaking everything |
| `plugin/dsh-typwriter/` | the DSH plugin: host routes, bridge shim, ACP client, left-sidebar entry |
| `docs/` | design and acceptance notes (Chinese) |

## What we changed in Texpile

Run `node scripts/patches.mjs --list` for the machine-readable version. In short:

1. **Host bridge** — `window.texpileNative` / `texpileTypst` / `texpileTerminal` / `texpileAcp` /
   `texpileAgent` are re-implemented over HTTP + SSE in `plugin/dsh-typwriter/src/browser/shim.js`,
   so the renderer runs in a normal browser instead of Electron.
2. **`texfile://` → HTTP** — raw bytes (images, PDF) are served from `/typwriter/api/file?path=…`.
3. **Agent** — `dsh` added as an ACP preset; the panel is a right-side pane; refine runs a one-shot
   ACP session.
4. **Layout** — a third-column layout (`columns3`), and an empty pane can be closed from its corner.
5. **i18n / branding** — default locale `zh-Hans`; product name, wordmark and icons replaced.

## Build

```bash
pnpm install                       # Node >= 24, pnpm >= 9
pnpm run preflight                 # patch anchors + svelte structure (≈1 s)
pnpm --filter texpile-editor exec vite build --outDir dist-typwriter --base /typwriter/app/
```

Copy `apps/texpile-editor/dist-typwriter/` to `plugin/dsh-typwriter/app/`, then install the plugin
into a DSH profile (see `plugin/dsh-typwriter/package.json` → `dsh`).

### Toolchain

The plugin needs `typst` and `tinymist` **on `PATH` or in `plugin/dsh-typwriter/bin/`**. They are
**not** committed (52 MB + 64 MB). Get them from:

- <https://github.com/typst/typst/releases>
- <https://github.com/Myriad-Dreamin/tinymist/releases>

Verified with `typst 0.15.1` and `tinymist v0.15.12`.

## Configuration

The plugin keeps its settings in `$DSH_HOME/typwriter/state.json`:

| Key | Meaning |
|---|---|
| `agentPanel` | which agent the panel runs (`dsh`) |
| `refineAgents` | which agent Refine runs |
| `agentWorkspaceMode` | `paper` (default) = the open paper folder; `custom` = a fixed folder |
| `agentWorkspacePath` | that folder, when `custom` |
| `agentInheritHostPlugins` | whether the agent process inherits the host DSH plugin set |
| `agentPresetName` / `agentPresetSkills` / `agentPresetPlugins` | reserved for future presets |

## Known limitations

- The agent pane is a fixed 420 px; it cannot be resized by dragging yet.
- Table dividers in the three-column layout are equal thirds — dragging only works for two columns.
- No file watcher: external edits are not picked up until the file is reopened.
- macOS app icon is not provided in this fork (`electron/icon.icns` was removed with the upstream artwork).
- The agent is a separate `dsh --profile acp` process; it does **not** load this plugin's tools
  (no paper-aware `typst_*` tools yet) — it edits files through DSH's generic file/shell tools.

## Licence

**AGPL-3.0** — see [`LICENSE`](LICENSE). This is a derivative work of Texpile, so the same licence
applies to our changes. If you run a modified version as a network service, AGPL §13 requires you to
offer its users the corresponding source.
