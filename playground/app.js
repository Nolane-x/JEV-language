import {
  answerAt,
  choiceQuestion,
  extractOptions,
  isGreeting,
  noulQuestion,
  renderChoice,
  renderMeta,
  renderYesNo,
  scoreQuestion,
  validateModelsResponse,
  validateSystemOneResponse,
  yesNoLike,
} from "./runtime.js";
import {
  isBrowserNetworkFailure,
  normalizeRelayBaseUrl,
  resolveApiEndpoint,
} from "./transport.js";

const MAX_CONTEXT_TURNS = 10;
const DEFAULT_RELAY_URL = "https://jev-language-typesafe-relay.nolane-file.workers.dev";

const state = {
  apiKey: "",
  model: "jev-latest",
  transport: "public",
  relayBaseUrl: DEFAULT_RELAY_URL,
  connected: true,
  busy: false,
  turns: [],
};

const els = {
  runtimeState: document.querySelector("#runtimeState"),
  openKeyButton: document.querySelector("#openKeyButton"),
  keyButtonLabel: document.querySelector("#keyButtonLabel"),
  keyDialog: document.querySelector("#keyDialog"),
  closeKeyButton: document.querySelector("#closeKeyButton"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  apiKeyField: document.querySelector("#apiKeyField"),
  browserConsentRow: document.querySelector("#browserConsentRow"),
  modelSelect: document.querySelector("#modelSelect"),
  transportSelect: document.querySelector("#transportSelect"),
  relayUrlField: document.querySelector("#relayUrlField"),
  relayUrlInput: document.querySelector("#relayUrlInput"),
  keyPanelIntro: document.querySelector("#keyPanelIntro"),
  browserConsent: document.querySelector("#browserConsent"),
  browserConsentText: document.querySelector("#browserConsentText"),
  toggleKeyVisibility: document.querySelector("#toggleKeyVisibility"),
  connectButton: document.querySelector("#connectButton"),
  disconnectButton: document.querySelector("#disconnectButton"),
  keyPanelStatus: document.querySelector("#keyPanelStatus"),
  composerForm: document.querySelector("#composerForm"),
  composerInput: document.querySelector("#composerInput"),
  sendButton: document.querySelector("#sendButton"),
  thread: document.querySelector("#thread"),
  emptyState: document.querySelector("#emptyState"),
  chatRegion: document.querySelector("#chatRegion"),
  messageTemplate: document.querySelector("#messageTemplate"),
  promptChips: [...document.querySelectorAll("[data-prompt]")],
};

function setRuntime(kind, label) {
  els.runtimeState.dataset.state = kind;
  els.runtimeState.querySelector("span").textContent = label;
}

function setKeyStatus(message = "", kind = "") {
  els.keyPanelStatus.textContent = message;
  els.keyPanelStatus.dataset.state = kind;
}

function updateTransportUi() {
  const transport = els.transportSelect.value;
  const publicMode = transport === "public";
  const relay = transport === "relay";

  els.relayUrlField.hidden = !relay;
  els.apiKeyField.hidden = publicMode;
  els.browserConsentRow.hidden = publicMode;
  els.modelSelect.closest(".field").hidden = publicMode;

  if (publicMode) {
    els.keyPanelIntro.textContent =
      "Public Jev needs no API key. The project gateway invokes Jev through Cloudflare Workers AI and keeps provider credentials out of the browser.";
    els.connectButton.textContent = "Use public Jev";
    return;
  }

  els.keyPanelIntro.textContent = relay
    ? "Advanced BYOK mode: the key stays in this tab's JavaScript memory, while the verified relay receives it only in flight and forwards it to TypeSafe."
    : "Advanced direct mode: the key remains in this tab only, but browser CORS policy may block TypeSafe before a request reaches the provider.";
  els.browserConsentText.textContent = relay
    ? "I understand that the page runtime and the verified relay can see this API key while a request is in flight."
    : "I understand that using an API key in a browser exposes it to the page runtime and developer tools.";
  els.connectButton.textContent = "Connect";
}

function updateConnectionUi() {
  if (state.transport === "public" && state.connected) {
    els.keyButtonLabel.textContent = "Public Jev";
    els.disconnectButton.hidden = true;
    setRuntime("connected", "Jev · public gateway");
    return;
  }

  els.keyButtonLabel.textContent = state.connected ? "BYOK connected" : "Connection";
  els.disconnectButton.hidden = !state.connected;
  const connectedLabel = state.transport === "relay"
    ? `${state.model} · BYOK relay`
    : state.model;
  setRuntime(state.connected ? "connected" : "idle", state.connected ? connectedLabel : "Local shell");
}

function updateSendState() {
  const hasText = els.composerInput.value.trim().length > 0;
  els.sendButton.disabled = state.busy || !hasText;
}

function autoresize() {
  els.composerInput.style.height = "auto";
  els.composerInput.style.height = `${Math.min(els.composerInput.scrollHeight, 180)}px`;
}

function serializeDetails(details) {
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

function addMessage(role, text, { details = null, loading = false } = {}) {
  const node = els.messageTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.role = role;
  if (loading) node.dataset.loading = "true";
  const meta = node.querySelector(".message__meta");
  const body = node.querySelector(".message__body");
  const detailEl = node.querySelector(".message__details");
  meta.textContent = role === "assistant" ? "JEV Language" : "You";

  if (loading) {
    body.innerHTML = '<span class="thinking-line" aria-label="Thinking"><span></span><span></span><span></span></span>';
  } else {
    body.textContent = text;
  }

  if (details) {
    detailEl.hidden = false;
    detailEl.querySelector("pre").textContent = serializeDetails(details);
  }

  els.thread.append(node);
  els.emptyState.hidden = true;
  requestAnimationFrame(() => {
    els.chatRegion.scrollTo({ top: els.chatRegion.scrollHeight, behavior: "smooth" });
  });
  return node;
}

function replaceLoadingMessage(node, text, details = null) {
  node.dataset.loading = "false";
  node.querySelector(".message__body").textContent = text;
  const detailEl = node.querySelector(".message__details");
  if (details) {
    detailEl.hidden = false;
    detailEl.querySelector("pre").textContent = serializeDetails(details);
  }
}

function normalizedContext() {
  return state.turns.slice(-MAX_CONTEXT_TURNS).map((turn) => ({
    role: turn.role,
    text: turn.text,
  }));
}

function buildState(latest) {
  return {
    latest_user_message: latest,
    conversation: normalizedContext(),
    note: "The UI is a JEV Language experimental playground. Preserve uncertainty. Do not infer evidence that is not in the state.",
  };
}

async function callJev(questions, latest) {
  if (!state.connected || (state.transport !== "public" && !state.apiKey)) {
    throw new Error("Jev is not connected.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const started = performance.now();
  try {
    const response = await fetch(resolveApiEndpoint({
      transport: state.transport,
      relayBaseUrl: state.relayBaseUrl,
      path: "/v1/systemone",
    }), {
      method: "POST",
      mode: "cors",
      headers: {
        ...(state.transport === "public"
          ? {}
          : { Authorization: `Bearer ${state.apiKey}` }),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: state.model,
        state: buildState(latest),
        questions,
      }),
      signal: controller.signal,
    });

    const bodyText = await response.text();
    let body;
    try { body = bodyText ? JSON.parse(bodyText) : {}; } catch { body = { raw: bodyText }; }

    if (!response.ok) {
      const message = body?.error?.message || body?.message || `TypeSafe returned HTTP ${response.status}.`;
      const error = new Error(message);
      error.status = response.status;
      error.body = body;
      throw error;
    }

    const validatedBody = validateSystemOneResponse(body, questions);

    return {
      body: validatedBody,
      latencyMs: Math.round(performance.now() - started),
      requestId: response.headers.get("x-typesafe-request-id"),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function resolvePrompt(text) {
  if (isGreeting(text)) {
    return {
      text: "Hello. Give me a yes/no question or an explicit choice such as “retry or fail-fast?” and I’ll route it through Jev.",
      details: { local: true, reason: "deterministic greeting; no API quota consumed" },
    };
  }

  const options = extractOptions(text);
  if (options) {
    const result = await callJev({
      decision: choiceQuestion(
        "Choose the option that is better supported by the latest user request and conversation context. Preserve uncertainty through confidence rather than inventing facts.",
        ["option_a", "option_b"],
      ),
    }, text);
    return {
      text: renderChoice(answerAt(result.body, "decision"), options),
      details: { type: "choice", options, ...result },
    };
  }

  if (yesNoLike(text)) {
    const result = await callJev({
      answer: noulQuestion(
        "Answer the latest user's yes/no proposition. Use only the supplied conversation state and ordinary decision judgment; calibrated probability must express uncertainty.",
      ),
      posture: choiceQuestion(
        "What posture best fits the answer?",
        ["direct", "cautious", "needs_more_context"],
      ),
    }, text);
    return {
      text: renderYesNo(answerAt(result.body, "answer"), answerAt(result.body, "posture")),
      details: { type: "yes-no", ...result },
    };
  }

  const result = await callJev({
    mode: choiceQuestion("Classify the latest user message by response shape.", [
      "factual_open",
      "advice",
      "classification",
      "comparison",
      "instruction",
      "casual",
      "other",
    ]),
    answerability: scoreQuestion(
      "How safely can the current typed-decision surface answer this without a free-form string generator?",
      [
        "Not answerable without inventing an output space",
        "Partially answerable as a decision",
        "Directly answerable as a bounded decision",
      ],
    ),
    needs_clarification: noulQuestion(
      "Would an explicit yes/no proposition or explicit candidate choices materially improve answerability?",
    ),
  }, text);
  return {
    text: renderMeta(result.body),
    details: { type: "coverage-check", ...result },
  };
}

async function submitMessage(text) {
  const clean = text.trim();
  if (!clean || state.busy) return;

  if (!state.connected && !isGreeting(clean)) {
    els.apiKeyInput.value = "";
    els.keyDialog.showModal();
    setKeyStatus("Connect a key first. It will stay in this tab’s memory only.");
    return;
  }

  state.busy = true;
  updateSendState();
  setRuntime("busy", "Jev decision");
  addMessage("user", clean);
  state.turns.push({ role: "user", text: clean });
  els.composerInput.value = "";
  autoresize();

  const loading = addMessage("assistant", "", { loading: true });
  try {
    const result = await resolvePrompt(clean);
    replaceLoadingMessage(loading, result.text, result.details);
    state.turns.push({ role: "assistant", text: result.text });
    updateConnectionUi();
  } catch (error) {
    const status = error?.status;
    let message = "The request failed without a trustworthy result.";
    if (state.transport === "public") {
      if (error?.name === "AbortError") {
        message = "Jev is taking longer than expected. Please try again.";
      } else if (status === 429) {
        message = "Public Jev is busy right now. Please try again shortly.";
      } else {
        message = "Jev is temporarily unavailable. Please try again in a moment.";
      }
    } else if (error?.name === "AbortError") {
      message = "The TypeSafe request timed out. Nothing was inferred from the failed call.";
    } else if (status === 401) {
      message = "That API key was rejected by TypeSafe. Reconnect with a valid key.";
    } else if (status === 403) {
      message = "TypeSafe refused this request for the connected account.";
    } else if (status === 429) {
      message = "TypeSafe rate-limited this request. Try again after the account limit resets.";
    } else if (error?.message) {
      message = error.message;
    }

    replaceLoadingMessage(
      loading,
      message,
      state.transport === "public"
        ? null
        : {
            error: true,
            status: status ?? null,
            message: error?.message ?? String(error),
          },
    );
    setRuntime("error", "Request failed");
  } finally {
    state.busy = false;
    updateSendState();
    els.composerInput.focus();
  }
}

async function connectKey() {
  const transport = els.transportSelect.value;
  const publicMode = transport === "public";
  const key = publicMode ? "" : els.apiKeyInput.value.trim();

  if (!publicMode && !key) {
    setKeyStatus("Paste an API key first.", "error");
    return;
  }
  if (!publicMode && !els.browserConsent.checked) {
    setKeyStatus("Acknowledge the browser-side key exposure before connecting.", "error");
    return;
  }

  let relayBaseUrl = DEFAULT_RELAY_URL;
  if (transport === "relay") {
    try {
      relayBaseUrl = normalizeRelayBaseUrl(els.relayUrlInput.value);
    } catch (error) {
      setKeyStatus(error?.message || "Invalid relay URL.", "error");
      return;
    }
  }

  els.connectButton.disabled = true;
  els.connectButton.textContent = publicMode ? "Checking…" : "Checking…";
  setKeyStatus(
    publicMode
      ? "Checking public Jev…"
      : transport === "relay"
        ? "Checking the key through the verified relay…"
        : "Checking the key directly with TypeSafe…",
  );

  try {
    const response = await fetch(resolveApiEndpoint({
      transport,
      relayBaseUrl,
      path: "/v1/models",
    }), {
      method: "GET",
      mode: "cors",
      headers: {
        ...(publicMode ? {} : { Authorization: `Bearer ${key}` }),
        Accept: "application/json",
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(
        new Error(payload?.error?.message || payload?.message || `Jev returned HTTP ${response.status}.`),
        { status: response.status },
      );
    }
    const models = validateModelsResponse(payload);
    const names = models
      .map((model) => model.name)
      .filter((name) => typeof name === "string" && name.trim());
    if (names.length > 0) {
      const previous = els.modelSelect.value;
      els.modelSelect.replaceChildren(...names.map((name) => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        return option;
      }));
      els.modelSelect.value = names.includes(previous)
        ? previous
        : (names.includes("jev-latest") ? "jev-latest" : names[0]);
    }

    state.apiKey = key;
    state.model = els.modelSelect.value || "jev-latest";
    state.transport = transport;
    state.relayBaseUrl = relayBaseUrl;
    state.connected = true;
    els.apiKeyInput.value = "";
    setKeyStatus(
      publicMode
        ? "Public Jev is ready. No API key is required."
        : "Connected in memory. No browser storage was written.",
      "success",
    );
    updateConnectionUi();
    window.setTimeout(() => els.keyDialog.close(), 320);
    els.composerInput.focus();
  } catch (error) {
    state.apiKey = "";
    state.connected = state.transport === "public";
    const networkFailure = isBrowserNetworkFailure(error);
    let message;
    if (publicMode) {
      message =
        error?.status === 429
          ? "Public Jev is busy right now. Please try again shortly."
          : "Public Jev could not be reached right now. Your browser does not need an API key; please retry in a moment.";
    } else if (error?.status === 401) {
      message = "TypeSafe rejected this API key. Check that the key is valid.";
    } else if (error?.status === 403) {
      message = "TypeSafe refused this account/request.";
    } else if (networkFailure) {
      message = transport === "relay"
        ? "The BYOK relay could not be reached. Public Jev remains available without a key."
        : "Direct browser access to TypeSafe is blocked on this origin. Use Public Jev instead.";
    } else {
      message = error?.message || "Connection test failed.";
    }
    setKeyStatus(message, "error");
    updateConnectionUi();
  } finally {
    els.connectButton.disabled = false;
    els.connectButton.textContent =
      els.transportSelect.value === "public" ? "Use public Jev" : "Connect";
  }
}

function disconnectKey() {
  state.apiKey = "";
  state.transport = "public";
  state.relayBaseUrl = DEFAULT_RELAY_URL;
  state.connected = true;
  els.transportSelect.value = "public";
  updateTransportUi();
  setKeyStatus("BYOK disconnected. Public Jev is active again.", "success");
  updateConnectionUi();
}

els.openKeyButton.addEventListener("click", () => {
  els.modelSelect.value = state.model;
  els.transportSelect.value = state.transport;
  if (state.relayBaseUrl) els.relayUrlInput.value = state.relayBaseUrl;
  updateTransportUi();
  els.browserConsent.checked = false;
  setKeyStatus(
    state.transport === "public"
      ? "Public Jev is active. No API key is required."
      : state.connected
        ? "A BYOK key is connected in memory for this tab."
        : "",
  );
  els.keyDialog.showModal();
  window.setTimeout(() => els.apiKeyInput.focus(), 30);
});
els.closeKeyButton.addEventListener("click", () => setKeyStatus(""));
els.connectButton.addEventListener("click", connectKey);
els.disconnectButton.addEventListener("click", disconnectKey);
els.transportSelect.addEventListener("change", () => {
  const next = els.transportSelect.value;
  if (next === "public") {
    state.apiKey = "";
    state.transport = "public";
    state.relayBaseUrl = DEFAULT_RELAY_URL;
    state.connected = true;
    setKeyStatus("Public Jev selected. No API key is required.", "success");
    updateTransportUi();
    updateConnectionUi();
    return;
  }

  if (state.transport !== next) {
    state.apiKey = "";
    state.connected = false;
    setKeyStatus("Advanced transport selected. Connect explicitly so a key is never silently rerouted.");
  }
  updateTransportUi();
  updateConnectionUi();
});
els.modelSelect.addEventListener("change", () => {
  if (!state.connected) return;
  state.model = els.modelSelect.value;
  updateConnectionUi();
});
els.toggleKeyVisibility.addEventListener("click", () => {
  const show = els.apiKeyInput.type === "password";
  els.apiKeyInput.type = show ? "text" : "password";
  els.toggleKeyVisibility.setAttribute("aria-label", show ? "Hide API key" : "Show API key");
});

els.composerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitMessage(els.composerInput.value);
});
els.composerInput.addEventListener("input", () => {
  autoresize();
  updateSendState();
});
els.composerInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submitMessage(els.composerInput.value);
  }
});
els.promptChips.forEach((button) => {
  button.addEventListener("click", () => {
    els.composerInput.value = button.dataset.prompt || "";
    autoresize();
    updateSendState();
    els.composerInput.focus();
  });
});

els.keyDialog.addEventListener("click", (event) => {
  if (event.target === els.keyDialog) els.keyDialog.close();
});

if (new URLSearchParams(location.search).has("preview")) {
  els.emptyState.hidden = true;
  addMessage("user", "For a latency-sensitive path, should I choose retry or fail-fast?");
  addMessage("assistant", "Jev chooses fail-fast with 78% confidence. Option weights: retry 22%, fail-fast 78%.", {
    details: {
      preview: true,
      note: "Visual preview only — no TypeSafe request was made.",
      answers: { decision: { choice: "option_b", confidence: 0.78, probabilities: { option_a: 0.22, option_b: 0.78 } } },
    },
  });
}

autoresize();
els.transportSelect.value = state.transport;
els.relayUrlInput.value = state.relayBaseUrl;
updateTransportUi();
updateSendState();
updateConnectionUi();
