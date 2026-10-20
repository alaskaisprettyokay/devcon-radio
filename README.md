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

- Devcon artwork, self-hosted Poppins, responsive player and queue.
- In-page YouTube, Spotify, and SoundCloud embeds, loaded only after Play.
- Event-driven next-track playback, with protection against stale player callbacks.
- Link metadata discovery and manual fallback; duplicate detection and a two-track-per-name limit.
- A shared chat room with moderation tools (see below). Without a room server the page falls back to a browser-only preview chat.
- Playlist download and compatibility with earlier demo local saves.
- Devcon logo links to the official event website without closing the music page.

## Prototype boundaries

**Track contributions are stored in your browser, not shared between visitors.** Chat is shared only when the room server below is running; otherwise the page shows a labeled example conversation that stays in your browser. A name-based contribution cap is a UI rule, not authentication.

Spotify may supply only a preview without the appropriate account/session. YouTube can reject embedding or require sign-in. Provider and browser restrictions still apply even after pressing Play. Bandcamp links are accepted but play at their source. Metadata availability varies; Spotify oEmbed can omit the artist. The known seed tracks have artist metadata; otherwise the page uses what the provider exposes.

No audio files are hosted by this project. It embeds the original providers. Opening a provider loads that provider’s scripts and privacy policies; metadata lookup uses Spotify oEmbed or noembed.com. No analytics is included.

## Chat and moderation

`npm run dev` starts the page **and** a small room server (Node 22, no extra packages). Visitors share one live chat. Organizers moderate from `/mod`.

```sh
CHAT_MOD_TOKEN='choose-a-long-random-token' CHAT_DATA_DIR=./chat-data npm run dev
```

Open `http://127.0.0.1:4173/mod` and enter the token. If `CHAT_MOD_TOKEN` is not set, the server prints a random one for that run only. Without a token the moderator endpoints stay closed.

**What visitors get:** messages appear for everyone within a few seconds, with clear notices when chat is paused, slow mode is on, or they have been muted or banned. Each message from someone else has a **Report** link.

**What happens automatically**

- Rate limit per browser (5 messages per 15 seconds) and per network address (60 per minute), duplicate-message and character-spam checks, 500-character limit.
- Messages with **links, invite links, or wallet-scam phrases** (seed phrase, airdrop, giveaway, “DM me”) are **held for a moderator**. The sender sees them marked as waiting; nobody else does.
- A short starter blocklist refuses abusive phrases outright, including spaced-out spellings. Add your own terms, one per line, with `CHAT_BLOCKLIST=./blocklist.txt`.
- Three reports from different browsers hold a message for review.

**What moderators can do** (`/mod`): approve or delete held messages, delete any message, mute a browser for 10 minutes, ban a browser (removes its messages), restore someone, pause all chat, and set slow mode. Every moderator action is appended to `mod-log.jsonl` in `CHAT_DATA_DIR`.

**Environment**

| Variable            | Purpose                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CHAT_MOD_TOKEN`    | Moderator token. Required for `/mod`.                                                                                                              |
| `CHAT_DATA_DIR`     | Directory for `chat.json` and `mod-log.jsonl`. Without it chat lives in memory and is lost on restart.                                             |
| `CHAT_BLOCKLIST`    | Optional file of extra blocked phrases.                                                                                                            |
| `TRUST_PROXY=1`     | Read the visitor address from `X-Forwarded-For`. Set it only behind a proxy you control.                                                           |
| `CHAT_ALLOW_ORIGIN` | Allow a page on another origin to call the room API (static page plus separate server). Set the page’s `<meta name="chat-api">` to the server URL. |
| `HOST`, `PORT`      | Listen address (default `127.0.0.1:4173`).                                                                                                         |

**Limits to be aware of**

- There are no accounts. A visitor is a random id kept in their browser, so a banned person can return by clearing site data. Mute, slow mode, per-network rate limits and pausing chat are the backstops; for a hostile crowd, add sign-in before relying on bans.
- Word filters are a starter list, not a moderation service. Human moderators are expected for the event.
- One server process holds the room. It is built for a conference-sized crowd, not horizontal scaling.
- Chat text is not sent to any third-party service.

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

Shared track contributions, participant identity (sign-in), an agreed Spotify integration, device/browser playback testing. These are not implemented yet. Open an issue or pull request to coordinate changes.

## Deploy

**With live chat:** run `npm start` on a small server behind an HTTPS reverse proxy (set `HOST`, `PORT`, `CHAT_MOD_TOKEN`, `CHAT_DATA_DIR`, and `TRUST_PROXY=1`). It serves the page, the room API and `/mod` from one process. Keep `/mod` and `/api/mod/` behind the token (or an extra access rule if you prefer). Do not deploy `node_modules`, tests, or test output.

**Static only:** serve `index.html`, `style.css`, `app.js`, and `assets/` from any HTTPS host. The page runs the browser-only preview chat. Relative asset paths support a subdirectory.

## License and credits

Original code and documentation: **[MIT](LICENSE)**. Poppins uses the SIL Open Font License. Devcon brand graphics and third-party track artwork are **not** relicensed under MIT; see [third-party notices](THIRD_PARTY_NOTICES.md). This repository does not imply official Devcon endorsement.
