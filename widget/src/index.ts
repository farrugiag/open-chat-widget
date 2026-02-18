type WidgetConfig = {
  apiUrl: string;
  apiKey: string;
  title: string;
  welcomeMessage: string;
  inputPlaceholder: string;
  position: "left" | "right";
  accentColor: string;
};

type StreamEvent =
  | { type: "start"; conversationId: string }
  | { type: "token"; token: string }
  | { type: "done"; message: string; conversationId: string }
  | { type: "error"; error: string };

const ROOT_ID = "os-chat-widget-root";
const SESSION_STORAGE_KEY = "os-chatbot-session-id";

function resolveScriptElement(): HTMLScriptElement | null {
  if (document.currentScript instanceof HTMLScriptElement) {
    return document.currentScript;
  }

  const scripts = Array.from(document.getElementsByTagName("script"));
  return scripts.reverse().find((script) => script.src.includes("chat-widget.js")) ?? null;
}

function readConfig(script: HTMLScriptElement | null): WidgetConfig | null {
  if (!script) {
    return null;
  }

  const apiUrl = script.dataset.apiUrl?.trim();
  const apiKey = script.dataset.apiKey?.trim();

  if (!apiUrl || !apiKey) {
    return null;
  }

  const position = script.dataset.position === "left" ? "left" : "right";

  return {
    apiUrl,
    apiKey,
    title: script.dataset.title?.trim() || "Assistant",
    welcomeMessage:
      script.dataset.welcomeMessage?.trim() || "Hi! Ask me anything and I will help you out.",
    inputPlaceholder: script.dataset.inputPlaceholder?.trim() || "Type your message...",
    position,
    accentColor: script.dataset.accentColor?.trim() || "#0ea5e9"
  };
}

function getOrCreateSessionId(): string {
  const existing = localStorage.getItem(SESSION_STORAGE_KEY);

  if (existing) {
    return existing;
  }

  const generated =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  localStorage.setItem(SESSION_STORAGE_KEY, generated);
  return generated;
}

function createStyles(accentColor: string): string {
  return `
    #${ROOT_ID} {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999999;
      font-family: "IBM Plex Sans", "Helvetica Neue", sans-serif;
      color: #0f172a;
    }

    #${ROOT_ID}[data-position="left"] {
      right: auto;
      left: 24px;
    }

    #${ROOT_ID} * {
      box-sizing: border-box;
      font-family: inherit;
    }

    #${ROOT_ID} .osw-toggle {
      border: none;
      width: 62px;
      height: 62px;
      border-radius: 18px;
      background: linear-gradient(130deg, ${accentColor}, #1e293b);
      color: #f8fafc;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.3);
      transition: transform 0.2s ease;
    }

    #${ROOT_ID} .osw-toggle:hover {
      transform: translateY(-2px);
    }

    #${ROOT_ID} .osw-panel {
      width: min(360px, calc(100vw - 24px));
      height: 520px;
      max-height: calc(100vh - 120px);
      background: radial-gradient(circle at top right, #f0f9ff 0%, #ffffff 40%);
      border: 1px solid #dbeafe;
      border-radius: 22px;
      box-shadow: 0 18px 50px rgba(15, 23, 42, 0.16);
      margin-bottom: 12px;
      display: none;
      overflow: hidden;
      transform-origin: bottom right;
      animation: osw-fade-in 160ms ease;
    }

    #${ROOT_ID}[data-open="true"] .osw-panel {
      display: flex;
      flex-direction: column;
    }

    #${ROOT_ID} .osw-header {
      background: linear-gradient(130deg, ${accentColor}, #1e3a8a);
      color: #ffffff;
      padding: 16px;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.2px;
    }

    #${ROOT_ID} .osw-messages {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: linear-gradient(0deg, #ffffff, #f8fafc);
    }

    #${ROOT_ID} .osw-message {
      max-width: 85%;
      border-radius: 14px;
      padding: 10px 12px;
      font-size: 14px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
    }

    #${ROOT_ID} .osw-message-user {
      align-self: flex-end;
      background: #0f172a;
      color: #f8fafc;
      border-bottom-right-radius: 6px;
    }

    #${ROOT_ID} .osw-message-assistant {
      align-self: flex-start;
      background: #e0f2fe;
      color: #0c4a6e;
      border-bottom-left-radius: 6px;
    }

    #${ROOT_ID} .osw-input-wrap {
      border-top: 1px solid #e2e8f0;
      padding: 10px;
      background: #ffffff;
    }

    #${ROOT_ID} .osw-form {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
    }

    #${ROOT_ID} .osw-input {
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      padding: 10px 12px;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s ease;
    }

    #${ROOT_ID} .osw-input:focus {
      border-color: ${accentColor};
    }

    #${ROOT_ID} .osw-send {
      border: none;
      border-radius: 12px;
      padding: 0 14px;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
      background: #0f172a;
      color: #f8fafc;
    }

    #${ROOT_ID} .osw-send:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    @keyframes osw-fade-in {
      from {
        opacity: 0;
        transform: translateY(8px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @media (max-width: 640px) {
      #${ROOT_ID} {
        right: 12px;
        left: 12px;
        bottom: 12px;
      }

      #${ROOT_ID}[data-position="left"] {
        left: 12px;
      }

      #${ROOT_ID} .osw-panel {
        width: 100%;
        height: min(72vh, 560px);
      }
    }
  `;
}

function parseJsonLine(line: string): StreamEvent | null {
  try {
    return JSON.parse(line) as StreamEvent;
  } catch {
    return null;
  }
}

function bootstrapWidget() {
  if (document.getElementById(ROOT_ID)) {
    return;
  }

  const script = resolveScriptElement();
  const config = readConfig(script);

  if (!config) {
    console.error("[os-chat-widget] Missing required data-api-url or data-api-key attributes.");
    return;
  }

  const sessionId = getOrCreateSessionId();

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.dataset.open = "false";
  root.dataset.position = config.position;

  const style = document.createElement("style");
  style.textContent = createStyles(config.accentColor);

  const panel = document.createElement("div");
  panel.className = "osw-panel";

  const header = document.createElement("div");
  header.className = "osw-header";
  header.textContent = config.title;

  const messages = document.createElement("div");
  messages.className = "osw-messages";

  const inputWrap = document.createElement("div");
  inputWrap.className = "osw-input-wrap";

  const form = document.createElement("form");
  form.className = "osw-form";

  const input = document.createElement("input");
  input.className = "osw-input";
  input.type = "text";
  input.placeholder = config.inputPlaceholder;
  input.required = true;

  const sendButton = document.createElement("button");
  sendButton.className = "osw-send";
  sendButton.type = "submit";
  sendButton.textContent = "Send";

  const toggleButton = document.createElement("button");
  toggleButton.className = "osw-toggle";
  toggleButton.type = "button";
  toggleButton.textContent = "AI";

  form.append(input, sendButton);
  inputWrap.append(form);
  panel.append(header, messages, inputWrap);
  root.append(style, panel, toggleButton);
  document.body.append(root);

  function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
  }

  function addMessage(role: "user" | "assistant", text: string): HTMLDivElement {
    const message = document.createElement("div");
    message.className = `osw-message ${role === "user" ? "osw-message-user" : "osw-message-assistant"}`;
    message.textContent = text;
    messages.append(message);
    scrollToBottom();
    return message;
  }

  addMessage("assistant", config.welcomeMessage);

  async function submitMessage(rawText: string) {
    addMessage("user", rawText);
    const assistantMessageEl = addMessage("assistant", "Thinking...");

    sendButton.disabled = true;
    input.disabled = true;

    try {
      const response = await fetch(config.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-widget-api-key": config.apiKey
        },
        body: JSON.stringify({
          sessionId,
          message: rawText
        })
      });

      if (!response.ok || !response.body) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assembled = "";

      const processLine = (line: string) => {
        const payload = parseJsonLine(line);

        if (!payload) {
          return;
        }

        if (payload.type === "token") {
          assembled += payload.token;
          assistantMessageEl.textContent = assembled;
          scrollToBottom();
        }

        if (payload.type === "done") {
          assistantMessageEl.textContent = payload.message;
          assembled = payload.message;
          scrollToBottom();
        }

        if (payload.type === "error") {
          assistantMessageEl.textContent = payload.error;
          scrollToBottom();
        }
      };

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const newlineIndex = buffer.indexOf("\n");

          if (newlineIndex === -1) {
            break;
          }

          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (!line) {
            continue;
          }

          processLine(line);
        }
      }

      const trailing = buffer.trim();
      if (trailing) {
        processLine(trailing);
      }

      if (!assistantMessageEl.textContent) {
        assistantMessageEl.textContent = "I could not generate a response right now.";
      }
    } catch (error) {
      console.error("[os-chat-widget] Failed to send message", error);
      assistantMessageEl.textContent = "Something went wrong. Please try again.";
    } finally {
      sendButton.disabled = false;
      input.disabled = false;
      input.focus();
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const rawText = input.value.trim();
    if (!rawText) {
      return;
    }

    input.value = "";
    await submitMessage(rawText);
  });

  toggleButton.addEventListener("click", () => {
    const isOpen = root.dataset.open === "true";
    root.dataset.open = isOpen ? "false" : "true";

    if (!isOpen) {
      input.focus();
      scrollToBottom();
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrapWidget);
} else {
  bootstrapWidget();
}
