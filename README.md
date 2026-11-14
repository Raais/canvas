# canvas

**Implemented by Cursor Grok 4.7.**

canvas is a local-first spatial notebook and moodboard. Arrange plain-text notes, code notes, images, undirected links, and rigid clusters on an infinite, zoomable canvas. The board lives in this browser. There is no account, backend, or upload server.

A new board opens on Dither Atlas renderer v3: the finalized Earth-like terrain, adaptive dithering, a subdued ink strength, and the Void Mask on with a hard cutoff at zero. The seed comes from the title. Existing boards keep the background they already saved, including Dots, Grid, Cross, Blank, and Atlas v1 or v2. Project → Canvas background still changes the open board. Use new Atlas look upgrades a stored v1 or v2 selection to v3 and keeps the current seed. Renaming a project recalculates the saved seed and leaves the renderer version unchanged. The generated pixels are not stored; a ZIP archive keeps the seed and renderer version, and a device without WebGL2 falls back to Dots without changing the saved choice. Tune Atlas stays available for v1, v2, and v3. Its slider values are temporary and are not written into the board or a ZIP. There is no animation loop. The procedural shader loads only when Atlas is the selected background. Group frames can use a translucent Slate, Sage, Sand, or Rose tint. Checklists still live in the Markdown source, and highlighting stays display-only.

## What you can do

- Copy and paste selected notes and groups with the system clipboard. External text and screenshots still paste as new notes.
- Switch a note between text and code. Clearly fenced code is recognized when it is pasted.
- Lock an image to its ratio, or stretch it to the frame.
- Drag a group from its title or from empty space inside the frame. Dragging a note inside the frame moves only that note.
- Choose dark or light for the open board. The choice is saved with the board and restored from a ZIP archive. A new board starts dark. The operating system does not change it.
- Flip an image horizontally or vertically. The original image bytes stay unchanged. Rotation is not supported.
- Draw an undirected link by dragging from one handle to another. A new link remembers its rest length and does not pull until it is stretched. Select one link to give it a short label, or to draw it solid, dashed, or as a red string. The label and style do not change the tether.
- Press Cmd+K or Ctrl+K, or the search icon, to find note text and group labels and jump to them. Search stays in this browser and is not saved.
- Save the current camera as a named view and return to it later. Views are part of the board, and they stay put when a note edit is undone.
- Group notes from a selection or with the Frame tool. Groups stay flat, move as one body, and keep their children at the same world position when grouped or ungrouped.
- Undo and redo recent edits until the page reloads. History is not stored in IndexedDB.
- Read the cursor and the selected object in world coordinates.
- Export the open board as a `.canvas.zip` archive, start a blank board, or import an archive in place of the current one.
- See an approximate size for canvas data, plus the browser's estimate for this whole origin.

## Storage

Notes, image bytes, positions, dimensions, links, groups, and the viewport are stored in IndexedDB in a database named `raais-canvas-db`. Saves are automatic. If a save fails, the open board stays on screen and the toolbar reports the failure.

`localStorage` is not used. A board's appearance is part of the document, not a separate site setting. GitHub Pages sites on `raais.github.io` share one origin, so the browser quota shown in the project menu is not exclusive to canvas.

The browser can still delete site data. An exported archive is the copy to keep. canvas does not upload the board anywhere. External image links are recorded as URLs only; their bytes are not included.

Boards are document schema 6. A ZIP archive is still format 1, and a copied selection is still clipboard format 1. Labels, link styles, and saved views travel with the board JSON. There is no remote search service.

One tab owns writing, using a browser lock named `raais-canvas-active-board-v1` when the browser provides it. Other tabs can pan, zoom, search, recall saved views, and inspect, but they do not save. If a tab has open edits when it loses the board, it keeps them in memory and offers **Download recovery ZIP**. Reload asks before discarding those edits. IndexedDB still refuses a stale revision. Embedded images must be 64 MiB or smaller, and a backup must stay within 256 MiB including the manifest. The project menu warns when a board is near or past that limit. Copying a note out of a group pastes it in world coordinates. Escape finishes a note edit and cancels a group rename. Delete contents asks before removing a group and its children. Checklists toggle for unordered, ordered, nested, and quoted tasks.

## Known limitations

- Groups cannot contain other groups.
- Physics is a weak tension-only tether. It does not run a force-directed layout, and links inside one group do not move that group.
- Deleting a group frame keeps the notes. Delete contents is the separate action that removes the notes too.
- Undo cannot survive a reload, an import, or a new board.
- There is no cloud backup, account, or multi-project library.
- Dither Atlas is static and grayscale. Renderer v3 is the look for newly enabled Atlas, with the Void Mask on. Renderers v1 and v2 remain available for older projects. The tuning lab is part of the app, but its adjustments are not stored. Very large world coordinates lose some GPU precision. Discrete zoom steps can pop between pixel sizes.
- The procedural background loads when the open board uses Atlas. Dots, Grid, Cross, and Blank boards do not start WebGL. A new board starts on Atlas v3. An older board keeps its saved background.

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
