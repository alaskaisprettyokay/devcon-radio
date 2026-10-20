# Devcon Radio

A lightweight music queue and chat prototype for Devcon, built by Subcult. Paste a song link, contribute two tracks, and listen in the page.

**[Try the demo](https://player.subcult.music/previews/devcon-radio-chatango/)**

## Run locally

Requires Node.js 22 or newer. No install or build step is needed to run the app. Chat is provided by a Chatango room (configured in `index.html`); the repository can also run its own chat server (see below).

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

`npm run dev` starts the page **and** a small room server (Node 22, no extra packages). Visitors share one live chat. Spam, links and scams are handled automatically; `/mod` is an optional override.

```sh
CHAT_MOD_TOKEN='choose-a-long-random-token' CHAT_DATA_DIR=./chat-data npm run dev
```

Open `http://127.0.0.1:4173/mod` and enter the token. If `CHAT_MOD_TOKEN` is not set, the server prints a random one for that run only. Without a token the moderator endpoints stay closed.

**What visitors get:** messages appear for everyone within a few seconds, with clear notices when chat is paused, slow mode is on, or they have been muted or banned. Each message from someone else has a **Report** link.

**What happens automatically (no moderator needed)**

- Rate limit per browser (5 messages per 15 seconds) and per network address (60 per minute), duplicate-message and character-spam checks, 500-character limit.
- **Links, invite links and bare domains are removed** from a message (it posts as `[link removed]`); a message that is only links is refused.
- **Wallet-scam phrases** (seed phrase, private key, airdrop, giveaway, “DM me”, free ETH) are refused outright, as are phrases on the blocklist (including spaced-out spellings). Add your own terms, one per line, with `CHAT_BLOCKLIST=./blocklist.txt`.
- **Repeat offenders are muted automatically.** Three refused messages in 10 minutes mutes the sender for 2 minutes, then 10, 30 and 60 on repeat.
- **Three reports from different browsers hide a message** (and count as a strike against its author). Hidden messages stay hidden unless an organizer restores them.

**Optional organizer controls** (`/mod`, needs the token): pause all chat, set slow mode, delete any message, mute or ban a browser, restore someone, and restore a message that was hidden by reports. The room runs without anyone using them. Every organizer action is appended to `mod-log.jsonl` in `CHAT_DATA_DIR`.

**Environment**

| Variable            | Purpose                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CHAT_MOD_TOKEN`    | Moderator token. Required for `/mod`.                                                                                                              |
| `CHAT_DATA_DIR`     | Directory for `chat.json` and `mod-log.jsonl`. Without it chat lives in memory and is lost on restart.                                             |
| `CHAT_BLOCKLIST`    | Optional file of extra blocked phrases.                                                                                                            |
| `TRUST_PROXY=1`     | Read the visitor address from `X-Forwarded-For`. Set it only behind a proxy you control.                                                           |
| `CHAT_ALLOW_ORIGIN` | Allow a page on another origin to call the room API (static page plus separate server). Set the page’s `<meta name="chat-api">` to the server URL. |
| `HOST`, `PORT`      | Listen address (default `127.0.0.1:4173`).                                                                                                         |

### Chatango (the default) and the built-in chat

**The page ships configured for the Chatango room `devcon`**, so it deploys as a plain static site with no chat server to run. To use a different room, change the room name in `<meta name="chatango-room" content="devcon" />` in `index.html`. To use the built-in room server instead, set the meta content to empty (static hosts) or run `CHATANGO_ROOM=off npm start`. To set up a Chatango room:

1. Create a free group at [chatango.com](https://chatango.com/creategroup) with an account the organizers own. Note the room name (letters, numbers and hyphens, up to 30).
2. Serve the page with the name set, either `CHATANGO_ROOM=your-room npm start`, or edit `<meta name="chatango-room" content="your-room" />` in `index.html` for a static host.
3. In the group’s admin settings, match the built-in rules: block links and rich content, switch on spam and repeat protection, add banned words, disable private messages, and set slow mode. The page only embeds the room; **these settings live in Chatango and are not enforced by this repository.**

When a room name is set (the default), the built-in room, its filters and `/mod` are not used. Chatango loads its own scripts and ads policy from `st.chatango.com`, and its styling cannot be fully controlled from this page. This path has been tested with a stubbed Chatango script only; check a real room in two browsers and on a phone before relying on it.

**Limits to be aware of**

- There are no accounts. A visitor is a random id kept in their browser, so a banned person can return by clearing site data. Mute, slow mode, per-network rate limits and pausing chat are the backstops; for a hostile crowd, add sign-in before relying on bans.
- Word filters are a starter list, not a moderation service. They catch the common event-chat abuse (links, wallet scams, flooding, slurs on the list) but not every insult. A hosted moderation API could be added as another automatic layer.
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
