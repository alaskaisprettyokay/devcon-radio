"use strict";
const $ = (s) => document.querySelector(s);
const KEY = "devcon-mod-token";
let token = sessionStorage.getItem(KEY) || "";
let timer = null;
let lastRev = 0;

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 2600);
}

async function call(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: {
      "x-mod-token": token,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    signOut("That token was not accepted.");
    throw new Error("unauthorized");
  }
  return res.json();
}

function who(m) {
  return `${esc(m.name)} · <span title="Anonymous device id">${esc(m.clientId.slice(0, 6))}</span>`;
}

function time(ts) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function messageRow(m, held) {
  const why = m.reasons?.length
    ? `<span class="why">Held: ${esc(m.reasons.join(", "))}</span>`
    : "";
  const reports = m.reports
    ? `<span>${m.reports} report${m.reports > 1 ? "s" : ""}</span>`
    : "";
  return `<li class="item ${held ? "held" : ""}" data-id="${m.id}" data-client="${esc(m.clientId)}">
    <div class="meta"><span>${who(m)}</span><span>${time(m.ts)}</span>${why}${reports}</div>
    <div class="text">${esc(m.text)}</div>
    <div class="actions">
      ${held ? '<button class="primary" data-act="approve">Approve</button>' : ""}
      <button class="danger" data-act="delete">Delete</button>
      <button data-act="mute">Mute 10 min</button>
      <button class="danger" data-act="ban">Ban</button>
    </div></li>`;
}

// Every value that came from a visitor (names, text, device ids) goes through
// esc() before it reaches innerHTML. The remaining strings are fixed by this
// file or by the server's own rule names.
function render(q) {
  lastRev = q.rev;
  $("#held-count").textContent = q.held.length ? `(${q.held.length})` : "";
  $("#held").innerHTML = q.held.length
    ? q.held.map((m) => messageRow(m, true)).join("")
    : '<li class="empty">Nothing waiting.</li>';
  $("#recent").innerHTML = q.recent.length
    ? q.recent.map((m) => messageRow(m, false)).join("")
    : '<li class="empty">No messages yet.</li>';
  const people = [
    ...q.mutes.map((p) => ({ ...p, kind: "Muted until " + time(p.until) })),
    ...q.bans.map((clientId) => ({ clientId, kind: "Banned" })),
  ];
  $("#people").innerHTML = people.length
    ? people
        .map(
          (p) => `<li class="item" data-client="${esc(p.clientId)}">
          <div class="meta"><span>Device ${esc(p.clientId.slice(0, 6))}</span><span>${esc(p.kind)}</span></div>
          <div class="actions"><button data-act="unmute">Restore</button></div></li>`,
        )
        .join("")
    : '<li class="empty">Nobody.</li>';
  const lock = $("#lock");
  lock.setAttribute("aria-pressed", String(q.settings.locked));
  lock.textContent = q.settings.locked
    ? "Chat paused. Tap to resume"
    : "Pause chat";
  $("#slow").value = String(q.settings.slowSeconds);
  $("#status").innerHTML = q.settings.locked
    ? '<b class="warn">Chat paused</b>'
    : "<b>Chat open</b>" +
      (q.settings.slowSeconds ? ` · slow ${q.settings.slowSeconds}s` : "");
}

async function refresh() {
  try {
    render(await call("/api/mod/queue"));
  } catch (e) {
    if (e.message !== "unauthorized")
      $("#status").textContent = "Connection lost. Retrying…";
  }
}

function signOut(message) {
  sessionStorage.removeItem(KEY);
  token = "";
  clearInterval(timer);
  $("#desk").hidden = true;
  $("#login").hidden = false;
  $("#status").textContent = message || "";
}

function open() {
  $("#login").hidden = true;
  $("#desk").hidden = false;
  refresh();
  clearInterval(timer);
  timer = setInterval(
    () => document.visibilityState === "visible" && refresh(),
    3000,
  );
}

$("#login").addEventListener("submit", async (e) => {
  e.preventDefault();
  token = $("#token").value.trim();
  $("#token").value = "";
  try {
    await call("/api/mod/queue");
    sessionStorage.setItem(KEY, token);
    open();
  } catch {
    /* signOut already explained it */
  }
});

$("#desk").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const row = btn.closest("[data-client]");
  const id = Number(row.dataset.id);
  const clientId = row.dataset.client;
  const act = btn.dataset.act;
  if (act === "ban" && !confirm("Ban this device and remove all its messages?"))
    return;
  const calls = {
    approve: ["/api/mod/approve", { id }],
    delete: ["/api/mod/delete", { id }],
    mute: ["/api/mod/mute", { clientId, minutes: 10 }],
    ban: ["/api/mod/ban", { clientId }],
    unmute: ["/api/mod/unmute", { clientId }],
  }[act];
  btn.disabled = true;
  try {
    await call(...calls);
    toast(
      {
        approve: "Approved",
        delete: "Deleted",
        mute: "Muted for 10 minutes",
        ban: "Banned",
        unmute: "Restored",
      }[act],
    );
    refresh();
  } catch {
    btn.disabled = false;
  }
});

$("#lock").addEventListener("click", async () => {
  const next = $("#lock").getAttribute("aria-pressed") !== "true";
  await call("/api/mod/settings", { locked: next });
  refresh();
});
$("#slow").addEventListener("change", async (e) => {
  await call("/api/mod/settings", { slowSeconds: Number(e.target.value) });
  refresh();
});
$("#signout").addEventListener("click", () => signOut(""));

if (token) open();
else signOut("");
