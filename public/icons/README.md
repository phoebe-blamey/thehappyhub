# PeaBe icons — swapping the placeholder for the real logo

The current `peabe.svg` is a hand-built recreation of the pink "pb" pebble.
It works everywhere SVG renders (browsers, Android PWA install, favicon),
but iOS Safari prefers a PNG for the home-screen icon.

When Phoebe sends the real logo file (Canva export → PNG, transparent
background recommended), drop them in here:

| File | Size | Purpose |
|---|---|---|
| `peabe-512.png`  | 512×512  | PWA install on Android, large display |
| `peabe-256.png`  | 256×256  | Generic large favicon |
| `peabe-180.png`  | 180×180  | Apple touch icon (iOS Home Screen) |
| `peabe-192.png`  | 192×192  | PWA install on Chrome |

Then in `public/index.html` head, switch the favicon + apple-touch-icon
links from `.svg` to `.png` and update `manifest.webmanifest` to add the
PNG entries. The SVG stays as a fallback.

Phoebe's brand palette (already in `styles.css`):

| Token | Hex | Usage |
|---|---|---|
| `--bubblegum` | `#F0A3C7` | Main pink (the pebble face) |
| `--magenta` | `#C9266B` | Shadow, accent text |
| `--hot-pink` | `#EC2C8A` | CTAs, links |
| `--sunshine` | `#FBF219` | Celebrations, badges |
| `--marshmallow` | `#FDEFF5` | Page backgrounds |

Canva file: <https://canva.link/3zwozfv648f8yk8> (auth-walled — needs
Phoebe's account to download).
