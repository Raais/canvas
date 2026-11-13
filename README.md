# canvas

**Implemented by Cursor Grok 4.7.**

canvas is a local-first spatial notebook and moodboard. Arrange plain-text notes, images, undirected links, and rigid clusters on an infinite, zoomable canvas. The board lives in this browser. There is no account, backend, or upload server.

This release adds graph links, rigid clusters, tension-only physics, undo/redo, a dark canvas, and a live world-space coordinate readout. Project archives and ZIP export are not available yet.

## What you can do

- Create text notes and embedded or linked images.
- Draw an undirected link by dragging from one handle to another. A new link remembers its rest length and does not pull until it is stretched.
- Group notes from a selection or with the Frame tool. Groups stay flat, move as one body, and keep their children at the same world position when grouped or ungrouped.
- Undo and redo recent edits until the page reloads. History is not stored in IndexedDB.
- Read the cursor and the selected object in world coordinates.

## Known limitations

- Groups cannot contain other groups.
- Physics is a weak tension-only tether. It does not run a force-directed layout, and links inside one group do not move that group.
- Deleting a group frame keeps the notes. Delete contents is the separate action that removes the notes too.
- Undo cannot survive a reload. Image bytes for an undone deletion stay available only while that history entry does.
- There is no ZIP export, project reset, or storage dashboard yet.

## Requirements

- [Bun](https://bun.sh) 1.3 or newer
- A current desktop browser. Chromium and Safari on macOS are the primary targets.

## Local development

```sh
bun install
bun run dev
```

Vite serves the app under `/canvas/`, the same path GitHub Pages uses.

```sh
bun run typecheck
bun test
bun run build
```

## Persistence

Notes, image bytes, positions, dimensions, and the viewport are stored in IndexedDB in a database named `raais-canvas-db`. GitHub Pages sites on `raais.github.io` share one origin, so the database name is specific to this app.

`localStorage` is not used.

Browser storage can be cleared by the browser or by site-data controls. This version cannot export a board yet. Do not treat the stored board as a permanent archive.

An image pasted or dropped as a file is stored as the original bytes. An image that arrives only as an `http` or `https` link stays a link. canvas does not download it. That picture can disappear later if the remote host changes or refuses to be displayed. A broken link stays on the board so the URL is not thrown away.

If a save fails, the open board stays on screen and the toolbar reports the failure. canvas does not claim the board was stored.

The application itself is a static site. Opening it requires the page to load. After that, the stored board does not contact an application server.

## Deployment

Production: [https://raais.github.io/canvas/](https://raais.github.io/canvas/)

Pushes to `main` install with `bun ci`, build the Vite app, and deploy `dist` to GitHub Pages with GitHub Actions. The production base path is `/canvas/`.
