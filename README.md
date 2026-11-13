# canvas

**Implemented by Cursor Grok 4.7.**

canvas is a local-first spatial notebook and moodboard. Arrange plain-text notes, images, undirected links, and rigid clusters on an infinite, zoomable canvas. The board lives in this browser. There is no account, backend, or upload server.

This release adds graph links, rigid clusters, tension-only physics, undo/redo, a dark canvas, world-space coordinates, and ZIP project archives.

## What you can do

- Create text notes and embedded or linked images.
- Draw an undirected link by dragging from one handle to another. A new link remembers its rest length and does not pull until it is stretched.
- Group notes from a selection or with the Frame tool. Groups stay flat, move as one body, and keep their children at the same world position when grouped or ungrouped.
- Undo and redo recent edits until the page reloads. History is not stored in IndexedDB.
- Read the cursor and the selected object in world coordinates.
- Export the open board as a `.canvas.zip` archive, start a blank board, or import an archive in place of the current one.
- See an approximate size for canvas data, plus the browser's estimate for this whole origin.

## Storage

Notes, image bytes, positions, dimensions, links, groups, and the viewport are stored in IndexedDB in a database named `raais-canvas-db`. Saves are automatic. If a save fails, the open board stays on screen and the toolbar reports the failure.

`localStorage` is not used. GitHub Pages sites on `raais.github.io` share one origin, so the browser quota shown in the project menu is not exclusive to canvas.

The browser can still delete site data. An exported archive is the copy to keep. canvas does not upload the board anywhere. External image links are recorded as URLs only; their bytes are not included.

A second tab becomes read-only when another tab already has the board open. A save is refused if the stored board identity or revision changed since this tab last saved, so an older tab cannot silently replace a newer project.

## Known limitations

- Groups cannot contain other groups.
- Physics is a weak tension-only tether. It does not run a force-directed layout, and links inside one group do not move that group.
- Deleting a group frame keeps the notes. Delete contents is the separate action that removes the notes too.
- Undo cannot survive a reload, an import, or a new board.
- There is no cloud backup, account, or multi-project library.

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

Browser storage can be cleared by the browser or by site-data controls. Export a `.canvas.zip` archive if you need a copy you can keep. Do not treat the stored board as a permanent archive by itself.

An image pasted or dropped as a file is stored as the original bytes. An image that arrives only as an `http` or `https` link stays a link. canvas does not download it. That picture can disappear later if the remote host changes or refuses to be displayed. A broken link stays on the board so the URL is not thrown away.

If a save fails, the open board stays on screen and the toolbar reports the failure. canvas does not claim the board was stored.

The application itself is a static site. Opening it requires the page to load. After that, the stored board does not contact an application server.

## Deployment

Production: [https://raais.github.io/canvas/](https://raais.github.io/canvas/)

Pushes to `main` install with `bun ci`, build the Vite app, and deploy `dist` to GitHub Pages with GitHub Actions. The production base path is `/canvas/`.
