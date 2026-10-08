"use strict";
const $ = (s) => document.querySelector(s);
const STORE = "subcult-devcon-playlist-v2";
const CHAT_STORE = "devcon-room-chat-v1";
const NAME_STORE = "devcon-display-name";
const SEEDS = [
  {
    name: "Subcult",
    artist: "Yaeji",
    title: "Raingurl",
    url: "https://www.youtube.com/watch?v=_3T8KznhThQ",
    art: "assets/yaeji.webp",
    createdAt: "2026-10-07T11:20:00.000Z",
  },
  {
    name: "Subcult",
    artist: "Charanjit Singh",
    title: "Raga Bhairav",
    url: "https://www.youtube.com/watch?v=BN8M2irJVJA",
    art: "assets/charanjit.webp",
    createdAt: "2026-10-07T11:21:00.000Z",
  },
  {
    name: "Subcult",
    artist: "Ritviz",
    title: "Udd Gaye",
    url: "https://open.spotify.com/track/5ZsAhuQ24mWHiduaxJqnhW",
    art: "assets/ritviz.webp",
    createdAt: "2026-10-07T11:22:00.000Z",
  },
];
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
function source(value) {
  try {
    const u = new URL(value);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (
      [
        "youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtu.be",
      ].includes(host)
    ) {
      const id =
        host === "youtu.be"
          ? u.pathname.split("/")[1]
          : u.searchParams.get("v") ||
            u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1];
      if (!/^[\w-]{11}$/.test(id || "")) return null;
      return {
        provider: "youtube",
        label: "YouTube",
        id,
        url: `https://www.youtube.com/watch?v=${id}`,
      };
    }
    if (host === "open.spotify.com") {
      const match = u.pathname.match(
        /^\/(?:intl-[^/]+\/)?track\/([a-zA-Z0-9]{22})(?:\/|$)/,
      );
      if (!match) return null;
      const id =
        match[1] === "0sdav1a7jmfGZg1VMnU3Qk"
          ? "5ZsAhuQ24mWHiduaxJqnhW"
          : match[1];
      return {
        provider: "spotify",
        label: "Spotify",
        id,
        url: `https://open.spotify.com/track/${id}`,
      };
    }
    if (
      host === "soundcloud.com" &&
      u.pathname.split("/").filter(Boolean).length >= 2
    )
      return { provider: "soundcloud", label: "SoundCloud", url: u.href };
    if (host.endsWith(".bandcamp.com") && /\/(track|album)\//.test(u.pathname))
      return { provider: "bandcamp", label: "Bandcamp", url: u.href };
    return null;
  } catch {
    return null;
  }
}
function normalize(t) {
  if (!t || typeof t.url !== "string" || !source(t.url)) return null;
  const s = source(t.url),
    seed = SEEDS.find((x) => source(x.url).url === s.url);
  return {
    ...t,
    name: String(t.name || "Guest"),
    title: String(t.title || seed?.title || "Untitled"),
    artist: String(t.artist || seed?.artist || ""),
    url: s.url,
    art: seed?.art || safeArt(t.art),
    createdAt: String(t.createdAt || ""),
  };
}
function safeArt(url) {
  try {
    return new URL(url, location.href).protocol === "https:" ||
      String(url).startsWith("assets/")
      ? url
      : "";
  } catch {
    return "";
  }
}
function art(t) {
  return (
    safeArt(t.art) ||
    (source(t.url)?.provider === "youtube"
      ? `https://i.ytimg.com/vi/${source(t.url).id}/mqdefault.jpg`
      : "assets/devcon8-bg.webp")
  );
}
const imageHtml = (t, cls = "") =>
  `<img class="${cls}" src="${esc(art(t))}" alt="" width="52" height="52" loading="lazy">`;
document.addEventListener(
  "error",
  (event) => {
    const img = event.target;
    if (img.tagName === "IMG" && !img.dataset.fallback) {
      img.dataset.fallback = "1";
      img.src = "assets/devcon8-bg.webp";
    }
  },
  true,
);
const stored = read(STORE, SEEDS);
let tracks = (Array.isArray(stored) ? stored : SEEDS)
  .map(normalize)
  .filter(Boolean);
if (!tracks.length) tracks = SEEDS.map(normalize);
let selectedUrl = tracks[0].url;
let controller = null,
  playEpoch = 0,
  adding = false,
  metaEpoch = 0,
  metaTimer;
const apiPromises = new Map(),
  metadataCache = new Map();
const savedName = read(NAME_STORE, "");
$("#name").value = typeof savedName === "string" ? savedName : "";
$("#chat-name").value = $("#name").value;
function rememberName(input, other) {
  input.addEventListener("input", () => {
    other.value = input.value;
    save(NAME_STORE, input.value);
    updateRemaining();
  });
}
rememberName($("#name"), $("#chat-name"));
rememberName($("#chat-name"), $("#name"));
function selected() {
  return tracks.find((t) => t.url === selectedUrl) || tracks[0];
}
function count(name) {
  return tracks.filter(
    (t) => t.name.trim().toLowerCase() === name.trim().toLowerCase(),
  ).length;
}
function updateRemaining() {
  const left = Math.max(0, 2 - count($("#name").value));
  $("#remaining").textContent = `${left} left`;
  $("#submit").disabled = adding || left === 0;
}
function render() {
  $("#song-count").textContent = `${tracks.length} tracks`;
  $("#tracks").innerHTML = tracks
    .map(
      (t, i) =>
        `<li class="track ${t.url === selectedUrl ? "is-selected" : ""}"><span class="track-number">${t.url === selectedUrl ? "↳" : String(i + 1).padStart(2, "0")}</span>${imageHtml(t, "track-art")}<div><strong class="track-title">${esc(t.title)}</strong><span class="track-artist">${esc(t.artist || t.name)}</span></div><span class="track-provider">${esc(source(t.url).label)}</span><button class="play-track" data-index="${i}" aria-label="Play ${esc(t.title)}" type="button">▶</button></li>`,
    )
    .join("");
  updateRemaining();
}
function showSelected() {
  const t = selected();
  $("#disc").innerHTML = imageHtml(t);
  $("#disc img").loading = "eager";
  $("#player-title").textContent = t.title;
  $("#player-artist").textContent = t.artist;
  $("#selected-source").textContent = source(t.url).label;
  $("#playback-title").textContent = [t.artist, t.title]
    .filter(Boolean)
    .join(" — ");
  render();
}
function next() {
  const index = tracks.findIndex((t) => t.url === selectedUrl);
  play((index + 1) % tracks.length);
}
function loadApi(kind) {
  if (apiPromises.has(kind)) return apiPromises.get(kind);
  const settings = {
    youtube: [
      "https://www.youtube.com/iframe_api",
      "onYouTubeIframeAPIReady",
      () => window.YT,
    ],
    spotify: [
      "https://open.spotify.com/embed/iframe-api/v1",
      "onSpotifyIframeApiReady",
    ],
    soundcloud: [
      "https://w.soundcloud.com/player/api.js",
      null,
      () => window.SC,
    ],
  };
  const [url, ready, get] = settings[kind];
  const promise = new Promise((resolve, reject) => {
    if (get?.()) {
      resolve(get());
      return;
    }
    const timer = setTimeout(
      () => reject(new Error("Player took too long to load.")),
      12000,
    );
    const done = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    if (ready) window[ready] = (api) => done(api || get());
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Player could not load."));
    };
    if (!ready) script.onload = () => done(get());
    document.head.appendChild(script);
  });
  apiPromises.set(kind, promise);
  promise.catch(() => apiPromises.delete(kind));
  return promise;
}
function playerMessage(message, t) {
  $("#playback-status").innerHTML =
    `${esc(message)} <a href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">Open ${esc(source(t.url).label)} ↗</a>`;
}
function destroyPlayer() {
  try {
    controller?.destroy?.();
  } catch {}
  controller = null;
  $("#player-frame").replaceChildren();
}
async function play(index) {
  const t = tracks[index];
  if (!t) return;
  const epoch = ++playEpoch;
  destroyPlayer();
  selectedUrl = t.url;
  showSelected();
  const s = source(t.url),
    frame = $("#player-frame");
  frame.dataset.provider = s.provider;
  frame.hidden = false;
  $("#player-poster").hidden = true;
  $("#playback-bar").hidden = false;
  $("#playback-status").textContent = "";
  let ended = false;
  const finish = () => {
    if (epoch === playEpoch && !ended) {
      ended = true;
      next();
    }
  };
  const current = () => epoch === playEpoch;
  const mount = document.createElement("div");
  mount.id = `provider-${epoch}`;
  frame.appendChild(mount);
  try {
    if (s.provider === "youtube") {
      // Load a usable embed immediately; API connection adds state and auto-next.
      mount.outerHTML = `<iframe id="provider-${epoch}" title="${esc(t.title)}" src="https://www.youtube-nocookie.com/embed/${s.id}?autoplay=1&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
      const YT = await loadApi("youtube");
      if (!current()) return;
      controller = new YT.Player(`provider-${epoch}`, {
        events: {
          onReady: (e) => {
            if (current()) e.target.playVideo();
          },
          onStateChange: (e) => {
            if (!current()) return;
            if (e.data === YT.PlayerState.ENDED) finish();
            if (e.data === YT.PlayerState.PLAYING)
              $("#playback-status").textContent = "";
          },
          onError: () => {
            if (current()) playerMessage("This video cannot play here.", t);
          },
          onAutoplayBlocked: () => {
            if (current()) playerMessage("Tap play in the video to start.", t);
          },
        },
      });
    } else if (s.provider === "spotify") {
      const api = await loadApi("spotify");
      if (!current()) return;
      api.createController(
        mount,
        { url: `${s.url}?theme=0`, width: "100%", height: 352 },
        (c) => {
          if (!current()) {
            c.destroy();
            return;
          }
          controller = c;
          let hasPlayed = false;
          c.addListener("ready", () => {
            if (current()) c.play();
          });
          c.addListener("playback_started", () => {
            if (current()) {
              hasPlayed = true;
              $("#playback-status").textContent = "";
            }
          });
          c.addListener("playback_update", (e) => {
            if (!current()) return;
            const d = e.data;
            if (!d.isPaused && !d.isBuffering) hasPlayed = true;
            if (
              hasPlayed &&
              d.duration > 0 &&
              d.position >= d.duration &&
              !d.isBuffering
            )
              finish();
          });
        },
      );
    } else if (s.provider === "soundcloud") {
      mount.outerHTML = `<iframe id="provider-${epoch}" title="${esc(t.title)}" src="https://w.soundcloud.com/player/?url=${encodeURIComponent(t.url)}&auto_play=true&hide_related=true&visual=true" allow="autoplay"></iframe>`;
      const SC = await loadApi("soundcloud");
      if (!current()) return;
      const widget = SC.Widget($(`#provider-${epoch}`));
      controller = {
        destroy: () => {
          widget.unbind(SC.Widget.Events.FINISH);
          widget.pause();
        },
      };
      widget.bind(SC.Widget.Events.FINISH, finish);
      widget.bind(SC.Widget.Events.READY, () => {
        if (current()) widget.play();
      });
    } else {
      frame.hidden = true;
      $("#player-poster").hidden = false;
      playerMessage("This source plays on Bandcamp.", t);
    }
  } catch {
    if (!current()) return;
    if (s.provider === "spotify")
      frame.innerHTML = `<iframe title="${esc(t.title)}" src="https://open.spotify.com/embed/track/${s.id}?theme=0" allow="autoplay; encrypted-media; fullscreen"></iframe>`;
    playerMessage("Use the player controls to start playback.", t);
  }
}
$("#main-play").addEventListener("click", () =>
  play(tracks.findIndex((t) => t.url === selectedUrl)),
);
$("#next").addEventListener("click", next);
$("#tracks").addEventListener("click", (e) => {
  const b = e.target.closest("[data-index]");
  if (b) {
    play(Number(b.dataset.index));
    if ($("#player").getBoundingClientRect().bottom < 0)
      $("#player").scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "start",
      });
  }
});
function splitTitle(title, author = "") {
  const clean = String(title || "")
    .replace(/\s*[\[(][^\])]*official[^\])]*[\])]\s*/gi, "")
    .replace(/\s+official\s+(music\s+)?video/gi, "")
    .trim();
  const parts = clean.split(/\s[-–—|]\s/);
  return parts.length > 1
    ? { artist: parts.shift().trim(), title: parts.join(" — ").trim() }
    : { artist: author.replace(/\s*- Topic$/, ""), title: clean };
}
async function discover(url) {
  const s = source(url);
  if (!s)
    throw new Error("Use a Spotify, YouTube, SoundCloud or Bandcamp link.");
  if (metadataCache.has(s.url)) return metadataCache.get(s.url);
  const seed = SEEDS.find((t) => t.url === s.url);
  if (seed) {
    metadataCache.set(s.url, seed);
    return seed;
  }
  const endpoint =
    s.provider === "spotify"
      ? `https://open.spotify.com/oembed?url=${encodeURIComponent(s.url)}`
      : `https://noembed.com/embed?url=${encodeURIComponent(s.url)}`;
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Metadata unavailable");
  const m = await response.json();
  if (m.error || !m.title) throw new Error("Metadata unavailable");
  const data = {
    ...splitTitle(m.title, m.author_name || ""),
    art: safeArt(m.thumbnail_url) || "",
    url: s.url,
  };
  metadataCache.set(s.url, data);
  return data;
}
function preview(meta) {
  $("#metadata-preview").innerHTML =
    `${imageHtml(meta)}<span>${esc(meta.title)}<small>${esc(meta.artist || source(meta.url).label)}</small></span>`;
}
function beginMetadata() {
  clearTimeout(metaTimer);
  const epoch = ++metaEpoch;
  $("#artist").value = "";
  $("#title").value = "";
  $("#metadata-preview").replaceChildren();
  $("#manual-fields").hidden = true;
  const url = $("#url").value.trim();
  $("#add-details").hidden = !url;
  $("#form-message").textContent = "";
  if (!url) return;
  const s = source(url);
  if (!s) {
    $("#form-message").textContent =
      "Use a Spotify, YouTube, SoundCloud or Bandcamp link.";
    return;
  }
  $("#metadata-preview").textContent = "Finding track…";
  metaTimer = setTimeout(async () => {
    try {
      const m = await discover(s.url);
      if (epoch !== metaEpoch) return;
      $("#artist").value = m.artist;
      $("#title").value = m.title;
      preview(m);
    } catch {
      if (epoch !== metaEpoch) return;
      $("#metadata-preview").textContent = "";
      $("#manual-fields").hidden = false;
      $("#form-message").textContent =
        "Couldn’t read this link. Add the title below.";
    }
  }, 250);
}
$("#url").addEventListener("input", beginMetadata);
$("#drop").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (adding) return;
  const url = $("#url").value.trim(),
    s = source(url),
    name = $("#name").value.trim();
  if (!s) {
    $("#form-message").textContent = "Use a supported song link.";
    return;
  }
  $("#add-details").hidden = false;
  if (!name) {
    $("#form-message").textContent = "Your name?";
    $("#name").focus();
    return;
  }
  if (count(name) >= 2) {
    $("#form-message").textContent = "You’ve added your two tracks.";
    return;
  }
  if (tracks.some((t) => t.url === s.url)) {
    $("#form-message").textContent = "Already in the queue.";
    return;
  }
  const epoch = metaEpoch;
  adding = true;
  updateRemaining();
  $("#form-message").textContent = "Finding track…";
  try {
    let meta;
    try {
      meta = await discover(s.url);
    } catch {
      meta = null;
    }
    if (epoch !== metaEpoch) {
      $("#form-message").textContent = "Link changed. Try again.";
      return;
    }
    const title = meta?.title || $("#title").value.trim(),
      artist = meta?.artist || $("#artist").value.trim();
    if (!title) {
      $("#manual-fields").hidden = false;
      $("#form-message").textContent =
        "Couldn’t read this link. Add the title below.";
      $("#title").focus();
      return;
    }
    const t = {
      name,
      url: s.url,
      title,
      artist,
      art: meta?.art || "",
      createdAt: new Date().toISOString(),
    };
    tracks.push(t);
    const persisted = save(STORE, tracks);
    save(NAME_STORE, name);
    $("#url").value = "";
    ++metaEpoch;
    $("#add-details").hidden = true;
    $("#metadata-preview").replaceChildren();
    $("#artist").value = "";
    $("#title").value = "";
    $("#form-message").textContent = persisted
      ? "Added to the queue."
      : "Added for this visit. Browser storage is unavailable.";
    render();
  } finally {
    adding = false;
    updateRemaining();
  }
});
$("#export").addEventListener("click", () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify({ tracks }, null, 2)], {
      type: "application/json",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "devcon-playlist.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
const DEMO_CHAT = [
  {
    name: "Maya",
    text: "Mumbai needs a soundtrack. What’s your first pick?",
    time: "12:41",
  },
  {
    name: "Dev",
    text: "This one. No warm-up needed.",
    time: "12:42",
    track: SEEDS[0].url,
  },
  { name: "Anika", text: "Charanjit Singh. Acid before acid.", time: "12:43" },
  {
    name: "Maya",
    text: "1982! That record still sounds like the future.",
    time: "12:44",
  },
];
let messages = read(CHAT_STORE, []);
if (!Array.isArray(messages)) messages = [];
messages = messages
  .filter((m) => m && typeof m.text === "string" && typeof m.name === "string")
  .slice(-100);
function renderChat() {
  $("#chat-log").innerHTML =
    '<p class="chat-day">EXAMPLE CONVERSATION</p>' +
    [...DEMO_CHAT, ...messages]
      .map((m, i) => {
        const t = SEEDS.find((t) => t.url === m.track);
        return `<article class="chat-message"><span class="avatar tone-${i % 3}" aria-hidden="true">${esc(m.name.slice(0, 1))}</span><div><div class="chat-author">${esc(m.name)} <time>${esc(m.time || "")}</time></div><p>${esc(m.text)}</p>${t ? `<button type="button" class="chat-track" data-url="${esc(t.url)}" aria-label="Play ${esc(t.title)}">${imageHtml(t)}<span><strong>${esc(t.title)}</strong><small>${esc(t.artist)}</small></span><span aria-hidden="true">▶</span></button>` : ""}</div></article>`;
      })
      .join("");
}
$("#chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("#chat-name").value.trim(),
    text = $("#chat-input").value.trim();
  if (!text || !name) return;
  messages.push({
    name,
    text,
    time: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  });
  messages = messages.slice(-100);
  const persisted = save(CHAT_STORE, messages);
  save(NAME_STORE, name);
  renderChat();
  $("#chat-input").value = "";
  $("#chat-log").scrollTop = $("#chat-log").scrollHeight;
  $("#chat-status").textContent = persisted
    ? "Messages stay in this browser."
    : "Sent for this visit. Browser storage is unavailable.";
});
$("#chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("#chat-form").requestSubmit();
  }
});
$("#chat-log").addEventListener("click", (e) => {
  const b = e.target.closest("[data-url]");
  if (b) {
    const index = tracks.findIndex((t) => t.url === b.dataset.url);
    if (index >= 0) play(index);
  }
});
showSelected();
renderChat();
