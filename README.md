# Atimi — Home page with interactive integrations

Atimi's home page (template v500) with three interactive pieces built into it by Ivan Guaderrama Studio:

1. **Hero** — the animated Atimi Symbiosis logo (leaves grow in, the mark forms, leaves react to the pointer).
2. **"Accelerate your digital growth"** — the interactive eucalyptus tree. It grows once on its own; then
   visitors grow it with their hand (camera), finger, mouse or keyboard, using the "Use hand control" and
   "Use touch" buttons.
3. **Footer** — the icon band with physics (icons pile up and react to the pointer) and the jelly footer logo.

**Live preview:** https://ivanguaderrama.studio/concepts/atimi/final/

This repository is identical, file by file, to that preview (version of September 28, 2026).

## Run it locally

Use a local web server. Opening `index.html` straight from disk will not load the iframes, the
hand-tracking worker or the camera.

```bash
python3 -m http.server 8080
# then open http://localhost:8080/
```

(`npx serve .` works too.)

## What is where

| Path | What it is |
|---|---|
| `index.html` | The page (self-contained, ~13.8 MB with embedded images) plus the integration markup, styles and scripts |
| `Atimi_Home_page_v500_assets/symbiosis-v3/` | Hero logo animation, loaded in an iframe. `poster.webp` (1100×1100, transparent background) is the finished composition: it is the still shown without JavaScript, and it can be used as the hero's fallback image |
| `Atimi_Home_page_v500_assets/symbiosis-frame-v3.css` | Size and position of the hero logo inside the hero |
| `Atimi_Home_page_v500_assets/living-growth/` | The tree experience, loaded in an iframe: image frames, styles, and hand tracking |
| `Atimi_Home_page_v500_assets/living-growth-integration.js` / `.css` | Connects the page's "Use hand control" / "Use touch" buttons to the tree |
| `Atimi_Home_page_v500_assets/footer-band-poster.webp` | Still image of the footer band, shown without JavaScript |
| Footer band engine and jelly logo | Inline in `index.html` — search for `data-shape-field` and `data-spring-logo` |
| `previews/atimi-final.jpg` | Preview image |

## Before publishing on your domain

- **Remove `<meta content="noindex,nofollow" name="robots"/>`** (line 7 of `index.html`). It is there because
  the preview lives on our domain and should not compete with atimi.com in search results.
- `Atimi_Home_page_v500_assets/living-growth/index.html` has a canonical URL, Open Graph tags and structured
  data that point to the preview. The tree is loaded inside an iframe and marked `noindex`, so this does not
  affect search; you can change those URLs to yours.
- **Hand control needs HTTPS** (or `localhost`): browsers only allow camera access on secure pages.
- Keep the folder structure as it is: every path is relative to `index.html`.

## Dependencies

Loaded from the internet when the page runs:

- **matter.js 0.20.0** (MIT) from jsDelivr, with an integrity hash. It powers the footer band physics and
  is only downloaded when the visitor gets close to the footer.
- Google Fonts and the icons from iconify and other hosts belong to the original page.

Included in this repository:

- **MediaPipe Tasks Vision 0.10.35** and its hand landmark model (Apache 2.0, license in
  `living-growth/vendor/mediapipe/`). Hand tracking runs entirely in the browser: no video is recorded or
  uploaded.
- **React** (MIT) in `symbiosis-v3/vendor/`, used by the hero animation.

## Motion, accessibility and no-JavaScript

- All three pieces respect the visitor's "reduce motion" setting. Add `?animar=1` to the page URL to
  animate the hero logo, the tree and the footer logo anyway (useful for demos).
- Without JavaScript, all text is still in the HTML and the hero and footer band show still images.

## Hero performance (September 28 update)

The hero logo now does much less work per frame and looks the same:

- It stays idle while the page's loading screen is up.
- Its animation loop stops once the intro ends; only light CSS motion and the pointer reaction keep running.
- The leaf images have their colour filter baked in (45 live CSS filters fewer) and are decoded before the
  intro starts.
- The blurred data lines are drawn apart from the moving dots and numbers.

To measure the hero on a specific device, add `?diag=1` to the page URL. A small box over the logo shows
frames per second, slow frames during the intro and how long the intro actually took.

## Browser testing

Tested in Chromium (desktop and iPhone emulation) and Firefox. Safari on a real iPhone or Mac has not been
tested on our side, so please check it there before launch. The `?diag=1` numbers from Safari are the most
useful thing to send us if something still feels slow.

## Credits

Page design and content: Atimi. Interactive integrations: Ivan Guaderrama Studio.
