# Devcon Radio

A lightweight music queue and chat prototype for Devcon, built by Subcult. Paste a song link, contribute two tracks, and listen in the page.

**[Try the demo](https://player.subcult.music/demos/devcon-playlist/)**

## Run locally

Requires Node.js 22 or newer. No accounts, API keys, install step, or build step needed to run the app.

```sh
git clone https://github.com/alaskaisprettyokay/devcon-radio.git
cd devcon-radio
npm run dev
```

Open **http://127.0.0.1:4173**. Set `PORT` to choose another local port.

## What’s included

- Devcon artwork, self-hosted Inter, responsive player and queue.
- In-page YouTube, Spotify, and SoundCloud embeds, loaded only after Play.
- Event-driven next-track playback, with protection against stale player callbacks.
- Link metadata discovery and manual fallback; duplicate detection and a two-track-per-name limit.
- A separate chat window with ordinary messages, Enter-to-send, and local history.
- Playlist download and compatibility with earlier demo local saves.
- Devcon logo links to the official event website without closing the music page.

## Prototype boundaries

**Chat and track contributions are stored in your browser, not shared between visitors.** The example conversation is fictional and labeled. A name-based contribution cap is a UI rule, not authentication.

Spotify may supply only a preview without the appropriate account/session. YouTube can reject embedding or require sign-in. Provider and browser restrictions still apply even after pressing Play. Bandcamp links are accepted but play at their source. Metadata availability varies; Spotify oEmbed can omit the artist. The known seed tracks have artist metadata; otherwise the page uses what the provider exposes.

No audio files are hosted by this project. It embeds the original providers. Opening a provider loads that provider’s scripts and privacy policies; metadata lookup uses Spotify oEmbed or noembed.com. No analytics or backend is included.

## Contribute

For frontend edits, change `index.html`, `style.css`, or `app.js` and refresh. Styles and player logic are plain CSS/JavaScript; there is no application framework or build tool.

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm test
npm run format:check
```

On Linux CI, use `npx playwright install --with-deps chromium` to install required system libraries too. Tests run a temporary local server and write screenshots/results to `.test-results/`.

Browser tests cover responsive layout, chat persistence, escaped text, track submissions, duplicate detection, metadata fallback, contribution limits, export, logo link, URL migration, and player lifecycle/auto-next. Provider APIs and metadata responses are **fixtures** in this suite so CI doesn’t depend on third-party playback or sign-in. Real streaming needs a separate check in your browser.

### Useful next work

Shared persistence and participant identity; moderation; an agreed Spotify integration; device/browser playback testing. These are not implemented yet. Open an issue or pull request to coordinate changes.

## Deploy

Serve `index.html`, `style.css`, `app.js`, and `assets/` from any HTTPS static host. Relative asset paths support a subdirectory. Do not deploy `node_modules`, tests, or test output. The included loopback-only server is for local development, not production hosting.

## License and credits

Original code and documentation: **[MIT](LICENSE)**. Inter uses the SIL Open Font License. Devcon brand graphics and third-party track artwork are **not** relicensed under MIT; see [third-party notices](THIRD_PARTY_NOTICES.md). This repository does not imply official Devcon endorsement.
