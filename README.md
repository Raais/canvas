# canvas

**Implemented by Cursor Grok 4.7.**

canvas is a local-first spatial notebook and moodboard. Arrange plain-text notes, code notes, images, file attachments, undirected links, and rigid clusters on an infinite, zoomable canvas. The board lives in this browser. There is no account, backend, or upload server.

A new board opens on Dither Atlas renderer v3: the finalized Earth-like terrain, adaptive dithering, a subdued ink strength, and the Void Mask on with a hard cutoff at zero. The seed comes from the title. Existing boards keep the background they already saved, including Dots, Grid, Cross, Blank, and Atlas v1 or v2. Project → Canvas background still changes the open board. Topographic Contours is a separate choice beside Dither Atlas. It draws the same title-seeded landmass as Atlas v3, but as thin elevation lines instead of dither, and it does not replace Atlas as the default. Contours renderer v1 is the stored look. Tune Contours appears only while Contours is selected. Its sliders are temporary: Copy configuration exports the current experimental JSON, and Reset to defaults returns to the frozen v1 lines. Neither action writes the sliders into the board or a ZIP. Use new Atlas look upgrades a stored v1 or v2 selection to v3 and keeps the current seed. Renaming a project recalculates the saved seed of each stored procedural background and leaves the renderer version unchanged. The generated pixels are not stored; a ZIP archive keeps the seed and renderer version, and a device without WebGL2 falls back to Dots without changing the saved choice. Tune Atlas stays available for v1, v2, and v3. Its slider values are temporary and are not written into the board or a ZIP. There is no animation loop. Each procedural shader loads only when that background is selected. Dark and light themes both redraw the lines from the same terrain. Group frames can use a translucent Slate, Sage, Sand, or Rose tint. Checklists still live in the Markdown source, and highlighting stays display-only.

## What you can do

- Copy and paste selected notes and groups with the system clipboard. External text and screenshots still paste as new notes.
- Switch a note between text and code. Clearly fenced code is recognized when it is pasted.
- Lock an image to its ratio, or stretch it to the frame.
- Drag a group from its title or from empty space inside the frame. Dragging a note inside the frame moves only that note.
- Choose dark or light for the open board. The choice is saved with the board and restored from a ZIP archive. A new board starts dark. The operating system does not change it.
- Flip an image horizontally or vertically. The original image bytes stay unchanged. Rotate turns the picture inside its frame.
- Draw an undirected link by dragging from one handle to another. A new link remembers its rest length and does not pull until it is stretched. Select one link to give it a short label, or to draw it solid, dashed, or as a red string. The label and style do not change the tether.
- Press Cmd+K or Ctrl+K, or the search icon, to find note text, group labels, and dates. Search stays in this browser and is not saved.
- Save the current camera as a named view and return to it later. Views are part of the board, and they stay put when a note edit is undone.
- Group notes from a selection or with the Frame tool. Groups stay flat, move as one body, and keep their children at the same world position when grouped or ungrouped.
- Undo and redo recent edits until the page reloads. History is not stored in IndexedDB.
- Read the cursor and the selected object in world coordinates.
- Export the open board as a `.canvas.zip` archive, start a blank board, or import an archive in place of the current one.
- See an approximate size for canvas data, plus the browser's estimate for this whole origin.

## Storage

Notes, image bytes, positions, dimensions, links, groups, and the viewport are stored in IndexedDB in a database named `raais-canvas-db`. Saves are automatic. If a save fails, the open board stays on screen and the toolbar reports the failure.

The board itself is not stored in `localStorage`. A board's appearance is part of the document, not a separate site setting. The only `localStorage` entry is the optional image-optimization preference. GitHub Pages sites on `raais.github.io` share one origin, so the browser quota shown in the project menu is not exclusive to canvas.

The browser can still delete site data. An exported archive is the copy to keep. canvas does not upload the board anywhere. External image links are recorded as URLs only; their bytes are not included.

Boards are document schema 12. A new ZIP archive is format 2, and older format 1 archives still import. A copied selection is still clipboard format 1. Image rotation is stored on the image note in degrees and is omitted at 0°. Text, image, and file notes may store `lastEditedAt`. Pulling force is a project setting: it is omitted while on, and stored as `physicsEnabled: false` when off. A password-protected note stores ciphertext instead of its text. Labels, link styles, saved views, and a Topographic Contours seed travel with the board JSON. Older boards migrate forward without changing their saved background or inventing dates. There is no remote search service.

One tab owns writing, using a browser lock named `raais-canvas-active-board-v1` when the browser provides it. Other tabs can pan, zoom, search, recall saved views, and inspect, but they do not save. If a tab has open edits when it loses the board, it keeps them in memory and offers **Download recovery ZIP**. Reload asks before discarding those edits. IndexedDB still refuses a stale revision. Embedded images and file attachments must be 64 MiB or smaller, and a backup must stay within 256 MiB including the manifest. The project menu warns when a board is near or past that limit. Copying a note out of a group pastes it in world coordinates. Escape finishes a note edit and cancels a group rename. Delete contents asks before removing a group and its children. Checklists toggle for unordered, ordered, nested, and quoted tasks.

## Node dates

A text note's date is the last time its text actually changed. Moving, resizing, grouping, physics, colors, presentation, and code language do not change it. An image's date is the moment that image node was added. A file attachment uses the same kind of date: the moment the file card was added. Rotation, flips, stretch, corners, and resizing leave it alone. Groups have no date. Older notes and images without a stored time show `-` until a text note is genuinely edited; an old image stays undated. The label sits outside the bottom-right of the frame, for example `2m ago | 14/11`, and refreshes about once a minute without saving. An embedded image puts its stored file size first, using the bytes kept for that asset, for example `0.3MB | 3m ago | 15/11`. A file under 0.1 MB shows `<0.1MB`. An undated embedded image with a known size shows `0.3MB | -`. An external image, or an embedded image whose asset is missing, keeps the date alone. The label still appears only while the note is hovered, selected, or focused. A copied or duplicated note gets a new time. A ZIP import keeps the times and the stored asset bytes.

## Search

Ctrl+K still ranks note titles, note text, file names, and group labels locally, including short prefixes and small typos, through MiniSearch plus a substring pass. A query that is also a date, such as `today`, `yesterday`, `last friday`, `june`, `june 2025`, `14/11`, or `2025`, lists dated text and image notes in that range and content matches underneath. `edited:yesterday` searches dates only. Groups never match a date. `may need fixing` stays a text search. Date matches can focus an image. Search is downloaded with the app and works offline.

## Node physics

Project → Node physics has **Pulling force**. It starts on, including for boards saved before schema 10. The choice is part of the board, so a ZIP keeps it and a read-only tab cannot change it. Turning it off does not move nodes or rewrite dates. While it is on, dragging still uses the same tension tether as before. Hold Shift while dragging exactly one note, image, file, or group frame to temporarily reverse the setting: on becomes a free drag, and off becomes a pull. Releasing Shift during the drag restores the project setting immediately. Dragging several selected nodes at once follows the project setting, and Shift does not reverse it. Selection, resizing, and panning do not use this override. Shift still starts a selection box on empty canvas, and Cmd or Ctrl still adds to the selection.

## File attachments

Add file, next to Add image, or drop files onto the board. A Markdown, plain-text, or recognized code file under 1 MiB becomes that kind of note and keeps its filename. A PNG, JPEG, WebP, GIF, or AVIF still becomes an image. Everything else, including PDF, ZIP, SVG, CSV, and `.env`, becomes a file card. The card can be moved, resized, linked, grouped, copied, and deleted like any other note. Download saves the original bytes. canvas does not open, preview, or edit the file.

Each attachment must be 64 MiB or smaller. Images and file attachments share the existing 256 MiB backup limit. A recognized text file larger than 1 MiB is stored as a file attachment instead of a note. File bytes are not compressed, converted, or encrypted. They are stored in this browser and included in a project export. Do not attach secrets you would not want exposed to someone holding the archive. Password-protected notes are separate: only those notes are encrypted, and a file card cannot be locked.

## Password-protected notes

Text, Markdown, and code notes can be password protected from the note's toolbar. The password is not stored. The note's text is encrypted in this browser, and the saved board, ZIP backup, and copied selection keep only that encrypted form. A locked note can still be moved, resized, grouped, linked, and deleted with the normal Delete key. Its words are left out of Ctrl+K, including while it is unlocked. A date search can still find it, labeled Password protected. Unlocking with the password shows the note again. Lock hides it. Remove password protection, while it is unlocked, turns it back into an ordinary note. If the password is forgotten, the note cannot be recovered. A ZIP exported before the note was protected still contains the old text. Importing a protected board does not ask for passwords; the notes start locked.

## Image rotation

Select an image and choose Rotate. A slider sets any angle from −180° to 180°. −15° and +15° step from the current angle, and Reset returns to 0°. The rectangular frame, resize handles, selection outline, and connection handles stay fixed. The picture rotates and scales inside the frame so the corners stay filled, and the extra pixels are clipped. At 0° the picture looks the same as before. Horizontal and vertical flips stay independent of the angle. Existing images start at 0°. The angle is kept across reload, offline use, ZIP export, and copy and paste.

## Image optimization

Project → Image storage has **Optimize new images**. It starts off, including after an upgrade, until you turn it on. The choice is remembered in this browser only. It is not part of the board, and importing a ZIP does not change it.

When it is on, newly pasted, dropped, or selected PNG and JPEG pictures are resized so the long side is at most 2560 pixels and encoded as WebP at quality 82%. The WebP replaces the original only when it is at least 15% smaller and still fits the backup limits. Otherwise the original file is kept. The compression is lossy: photographs usually hold up, while screenshots, diagrams, and small text can look softer. Turn the setting off before adding images that need to stay sharp.

GIF, animated PNG, WebP, and AVIF files are stored unchanged, so an animation is not flattened. An ordinary PNG is still eligible. A savings note disappears after a few seconds, or sooner if it is dismissed. Images already on the board are left alone. External image links are not downloaded or recompressed. Encoding runs in a Web Worker with the browser's own WebP encoder, including while canvas is open offline after the app has been cached. A picture can still be rejected when the stored file would be over 64 MiB or the board would no longer fit in a 256 MiB archive.

## Install and offline

A current Chromium browser can install canvas from the address bar or the browser menu. Installation is optional. The page at `https://raais.github.io/canvas/` and an installed window use the same editor.

Open canvas online once and let it finish loading. After that, the app shell is stored on the device and canvas can open without a network. Notes and embedded images come from IndexedDB on this origin, not from the service worker. External image links are not downloaded, so those pictures can fail offline. The first visit still needs a network. The browser can still clear or evict site data. An installed app is not a backup, and it does not sync to another browser, profile, or device. Export a `.canvas.zip` archive when you need a copy you can keep.

A newer version shows **Update available**. Later leaves the current version running. Update now reloads only after the open note or relationship edit is finished and the board has been stored. A failed save, a recovery copy, or a tab that does not own unsaved work stays on the current version.

## Known limitations

- Groups cannot contain other groups.
- Physics is a weak tension-only tether. It does not run a force-directed layout, and links inside one group do not move that group. Project → Node physics can turn pulling off. Shift reverses that choice only while one node is dragged.
- Deleting a group frame keeps the notes. Delete contents is the separate action that removes the notes too.
- Undo cannot survive a reload, an import, or a new board.
- There is no cloud backup, account, or multi-project library.
- Dither Atlas is static and grayscale. Renderer v3 is the look for newly enabled Atlas, with the Void Mask on. Renderers v1 and v2 remain available for older projects. The tuning lab is part of the app, but its adjustments are not stored. Very large world coordinates lose some GPU precision. Discrete zoom steps can pop between pixel sizes.
- Topographic Contours is static and uses the Atlas v3 terrain field. Contours v1 fades crowded lines when zoomed far out, so a very low zoom stays sparse. The same large coordinates lose some GPU precision. The contours lab is temporary and is not stored.
- A procedural background loads only while it is selected. Dots, Grid, Cross, and Blank boards do not start WebGL. A new board starts on Atlas v3. An older board keeps its saved background.
- Offline use starts only after a successful online load. The service worker stores the app, not the board. External images are not cached. Installation does not copy the board to another browser.

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
