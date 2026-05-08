// T-REX LAWYER chat widget. Streams from /api/chat-stream (Claude Haiku).
// Lazy-injects DOM, opens after 10s, GPU-accelerated transforms throughout.

const REVEAL_DELAY_MS = 10_000;
const STORAGE_KEY = "trex-chat-history-v1";

const SUGGESTIONS = [
  "What does T-REX LAWYER do?",
  "What's the $5 vs $12 difference?",
  "Is this legal advice?",
  "What forms do you support?",
];

const GREETING =
  "Hey! I'm the T-REX. I know I'm cute, but I take TREC contracts pretty seriously. Ask me anything about how the review works, what's free, or what you get when you pay. Just don't ask me to be your lawyer — I'm a cartoon dinosaur.";

let initialized = false;
let dom = null;
let messages = [];
let streaming = false;
let revealTimer = null;

export function initChat({ delayMs = REVEAL_DELAY_MS } = {}) {
  if (initialized) return;
  initialized = true;

  injectMarkup();
  attachEvents();
  loadHistory();

  if (revealTimer) clearTimeout(revealTimer);
  revealTimer = setTimeout(() => {
    requestAnimationFrame(() => dom.fab.classList.add("show"));
  }, delayMs);
}

function injectMarkup() {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <button class="chat-fab" id="chat-fab" aria-label="Chat with T-REX">
      <span class="fab-pulse" aria-hidden="true"></span>
      <span class="fab-avatar" aria-hidden="true"></span>
      <span class="fab-tooltip">Ask the T-REX</span>
    </button>

    <div class="chat-panel" id="chat-panel" role="dialog" aria-label="T-REX LAWYER chat">
      <div class="chat-header">
        <div class="avatar" aria-hidden="true"></div>
        <div>
          <div class="name">T-REX LAWYER</div>
          <div class="status">Online · friendly cartoon dinosaur</div>
        </div>
        <button class="close" id="chat-close" aria-label="Close chat">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 6l12 12M18 6l-12 12"/>
          </svg>
        </button>
      </div>

      <div class="chat-messages" id="chat-messages" aria-live="polite"></div>

      <div class="chat-input-row">
        <textarea
          class="chat-input"
          id="chat-input"
          rows="1"
          placeholder="Ask about TREC reviews, pricing, anything…"
          aria-label="Message"
        ></textarea>
        <button class="chat-send" id="chat-send" aria-label="Send" disabled>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14"/>
            <path d="M13 6l6 6-6 6"/>
          </svg>
        </button>
      </div>
      <div class="chat-disclaimer">
        Cartoon dinosaur, not a lawyer. For serious decisions, ask a real attorney.
      </div>
    </div>
  `;
  document.body.append(...wrap.children);

  dom = {
    fab: document.getElementById("chat-fab"),
    panel: document.getElementById("chat-panel"),
    close: document.getElementById("chat-close"),
    messages: document.getElementById("chat-messages"),
    input: document.getElementById("chat-input"),
    send: document.getElementById("chat-send"),
  };
}

function attachEvents() {
  dom.fab.addEventListener("click", openChat);
  dom.close.addEventListener("click", closeChat);

  dom.input.addEventListener("input", () => {
    dom.send.disabled = !dom.input.value.trim() || streaming;
    autosize(dom.input);
  });
  dom.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  dom.send.addEventListener("click", sendMessage);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dom.panel.classList.contains("open")) {
      closeChat();
    }
  });
}

function autosize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 96) + "px";
}

function openChat() {
  dom.panel.classList.add("open");
  dom.fab.classList.add("fab-open");
  if (messages.length === 0) {
    appendBotMessage(GREETING, /*withSuggestions*/ true);
    persistHistory();
  }
  setTimeout(() => dom.input.focus(), 350);
}

function closeChat() {
  dom.panel.classList.remove("open");
  dom.fab.classList.remove("fab-open");
}

function loadHistory() {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return;
    messages = parsed.filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string",
    );
    for (const m of messages) {
      if (m.role === "user") appendUserBubble(m.content);
      else appendBotBubble(m.content);
    }
  } catch {
    // ignore
  }
}

function persistHistory() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // ignore quota errors
  }
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    dom.messages.scrollTop = dom.messages.scrollHeight;
  });
}

function appendUserBubble(text) {
  const row = document.createElement("div");
  row.className = "chat-msg user";
  row.innerHTML = `<div class="bubble"></div>`;
  row.querySelector(".bubble").textContent = text;
  dom.messages.appendChild(row);
  scrollToBottom();
}

function appendBotBubble(text) {
  const row = document.createElement("div");
  row.className = "chat-msg bot";
  row.innerHTML = `
    <div class="bot-avatar" aria-hidden="true"></div>
    <div class="bubble"></div>
  `;
  row.querySelector(".bubble").innerHTML = renderBotText(text);
  dom.messages.appendChild(row);
  scrollToBottom();
  return row;
}

function appendBotMessage(text, withSuggestions = false) {
  appendBotBubble(text);
  if (withSuggestions) appendSuggestions();
}

function appendSuggestions() {
  const row = document.createElement("div");
  row.className = "chat-msg bot";
  row.innerHTML = `<div class="bot-avatar" aria-hidden="true" style="visibility:hidden"></div>`;
  const wrap = document.createElement("div");
  wrap.className = "chat-suggestions";
  for (const text of SUGGESTIONS) {
    const btn = document.createElement("button");
    btn.className = "chat-suggestion";
    btn.textContent = text;
    btn.addEventListener("click", () => {
      btn.parentElement.remove();
      dom.input.value = text;
      sendMessage();
    });
    wrap.appendChild(btn);
  }
  row.appendChild(wrap);
  dom.messages.appendChild(row);
  scrollToBottom();
}

function appendTypingIndicator() {
  const row = document.createElement("div");
  row.className = "chat-msg bot";
  row.id = "chat-typing-row";
  row.innerHTML = `
    <div class="bot-avatar" aria-hidden="true"></div>
    <div class="bubble">
      <div class="chat-typing"><span></span><span></span><span></span></div>
    </div>
  `;
  dom.messages.appendChild(row);
  scrollToBottom();
  return row;
}

function renderBotText(text) {
  const safe = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return safe
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(
      /\b(\/[a-z][\w-/]*)\b/g,
      '<a href="$1">$1</a>',
    );
}

async function sendMessage() {
  if (streaming) return;
  const text = dom.input.value.trim();
  if (!text) return;

  dom.input.value = "";
  autosize(dom.input);
  dom.send.disabled = true;

  appendUserBubble(text);
  messages.push({ role: "user", content: text });
  persistHistory();

  streaming = true;
  const typingRow = appendTypingIndicator();

  let botRow = null;
  let botBubble = null;
  let acc = "";

  try {
    const res = await fetch("/api/chat-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl;
      while ((nl = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let event;
          try {
            event = JSON.parse(payload);
          } catch {
            continue;
          }
          if (event.type === "delta" && event.text) {
            if (!botRow) {
              typingRow.remove();
              botRow = appendBotBubble("");
              botBubble = botRow.querySelector(".bubble");
            }
            acc += event.text;
            botBubble.innerHTML = renderBotText(acc);
            scrollToBottom();
          } else if (event.type === "error") {
            throw new Error(event.message || "stream error");
          }
        }
      }
    }
  } catch (err) {
    typingRow.remove();
    if (!botRow) {
      appendBotBubble(
        "I might be a fun dinosaur cartoon, but I have serious connection problems right now. Try again in a moment?",
      );
    }
    console.error("chat-stream error:", err);
  } finally {
    streaming = false;
    if (acc) {
      messages.push({ role: "assistant", content: acc });
      persistHistory();
    }
    dom.send.disabled = !dom.input.value.trim();
    dom.input.focus();
  }
}
