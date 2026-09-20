const RELAY_URL =
  process.env.JEV_RELAY_URL ??
  "https://jev-language-typesafe-relay.nolane-file.workers.dev";
const ORIGIN = "https://nolane-x.github.io";
const MAX_REQUESTS = 18;

if (process.env.JEV_ALLOW_LIVE !== "1") {
  throw new Error("Live conversation-ranker stress evaluation is disabled.");
}
if (Number(process.env.JEV_LIVE_MAX_REQUESTS ?? MAX_REQUESTS) !== MAX_REQUESTS) {
  throw new Error(`Conversation-ranker stress is hard-limited to ${MAX_REQUESTS} requests.`);
}

const apiKey = process.env.TYPESAFE_API_KEY;
if (!apiKey) {
  throw new Error("TYPESAFE_API_KEY is not available in this runtime.");
}
if (!/^https:\/\/[a-z0-9.-]+\.workers\.dev$/iu.test(RELAY_URL)) {
  throw new Error("JEV_RELAY_URL must be an HTTPS workers.dev origin.");
}

type StressCase = {
  id: string;
  language: string;
  category:
    | "naturalness"
    | "correction"
    | "register"
    | "uncertainty"
    | "code-switch"
    | "unknown-term"
    | "anti-template";
  context: string;
  optionA: string;
  optionB: string;
  expected: "option_a" | "option_b";
  instruction: string;
};

const cases: StressCase[] = [
  {
    id: "vi-peer-naturalness",
    language: "vi",
    category: "naturalness",
    context: "Hai lập trình viên cùng nhóm đang nói chuyện thân thiện sau khi kiểm tra một lỗi.",
    optionA: "Mình kiểm tra rồi, hiện chưa thấy lỗi nào nhé.",
    optionB: "Tôi đã tiến hành sự kiểm tra và tại thời điểm hiện tại chưa quan sát thấy lỗi nào.",
    expected: "option_a",
    instruction: "Chọn câu tự nhiên hơn trong chat giữa hai đồng nghiệp Việt Nam, giữ nguyên ý là đã kiểm tra và chưa thấy lỗi.",
  },
  {
    id: "vi-correction-ack",
    language: "vi",
    category: "correction",
    context: "Người dùng vừa sửa lại: “Không, ý mình là bản mobile chứ không phải bản web.”",
    optionA: "À đúng rồi, mình hiểu nhầm. Mình sẽ xem bản mobile nhé.",
    optionB: "Mình sẽ tiếp tục kiểm tra bản web như vừa nói.",
    expected: "option_a",
    instruction: "Chọn câu đáp xử lý đúng lời sửa của người dùng và tự nhiên trong tiếng Việt.",
  },
  {
    id: "vi-teacher-register",
    language: "vi",
    category: "register",
    context: "Một học sinh đang trả lời thầy giáo và muốn nói rằng đã hiểu yêu cầu.",
    optionA: "Dạ, em hiểu rồi ạ. Em sẽ sửa lại phần đó.",
    optionB: "Ừ, mình hiểu rồi nhé, để mình sửa.",
    expected: "option_a",
    instruction: "Chọn câu có cách xưng hô và mức độ lịch sự phù hợp nhất với ngữ cảnh học sinh nói với thầy.",
  },
  {
    id: "vi-uncertainty",
    language: "vi",
    category: "uncertainty",
    context: "Chỉ mới kiểm tra log một phần, chưa có đủ bằng chứng xác định nguyên nhân lỗi.",
    optionA: "Mình chưa thể chắc nguyên nhân, nhưng log hiện tại đang nghiêng về lỗi kết nối.",
    optionB: "Chắc chắn 100% đây là lỗi kết nối.",
    expected: "option_a",
    instruction: "Chọn câu tự nhiên đồng thời giữ đúng mức độ không chắc chắn của bằng chứng.",
  },
  {
    id: "vi-dev-code-switch",
    language: "vi",
    category: "code-switch",
    context: "Nhóm dev Việt Nam thường dùng các từ deploy, fix và refresh trong chat nội bộ.",
    optionA: "Mình deploy bản fix rồi, bạn refresh lại trang thử nhé.",
    optionB: "Mình đã deployment hóa fix, bạn hãy refresh hóa page để thử nghiệm nhé.",
    expected: "option_a",
    instruction: "Chọn câu code-switch tự nhiên hơn theo cách dev Việt Nam thường nói.",
  },
  {
    id: "vi-opaque-term",
    language: "vi",
    category: "unknown-term",
    context: "Tên kỹ thuật chính xác cần giữ nguyên là “Nolane QX-380”.",
    optionA: "Mình sẽ giữ nguyên tên Nolane QX-380 trong tài liệu.",
    optionB: "Mình sẽ đổi tên thành Nolan QX 830 cho dễ đọc.",
    expected: "option_a",
    instruction: "Chọn câu vừa tự nhiên vừa bảo toàn chính xác thuật ngữ lạ được cung cấp.",
  },
  {
    id: "en-peer-naturalness",
    language: "en",
    category: "naturalness",
    context: "Two developers are casually discussing a bug after one of them checked the logs.",
    optionA: "I checked the logs, and I don't see the error anymore.",
    optionB: "I have performed an inspection of the logs and currently do not observe the error.",
    expected: "option_a",
    instruction: "Choose the more natural conversational English reply while preserving the same meaning.",
  },
  {
    id: "en-correction-ack",
    language: "en",
    category: "correction",
    context: "The user corrected the assistant: “No, I meant the staging server, not production.”",
    optionA: "Got it — I mixed those up. I'll check staging instead.",
    optionB: "I'll keep checking production as planned.",
    expected: "option_a",
    instruction: "Choose the reply that naturally acknowledges and applies the user's correction.",
  },
  {
    id: "en-uncertainty",
    language: "en",
    category: "uncertainty",
    context: "Only partial evidence is available and there are two plausible causes.",
    optionA: "I'm not certain yet, but the current evidence points more toward a timeout.",
    optionB: "It's definitely a timeout. There is no other possibility.",
    expected: "option_a",
    instruction: "Choose the reply that sounds natural and preserves the actual uncertainty.",
  },
  {
    id: "en-anti-template",
    language: "en",
    category: "anti-template",
    context: "The user asks a short technical follow-up: “And on Windows?”",
    optionA: "On Windows, use the same command in PowerShell.",
    optionB: "Certainly! I'd be happy to help you with that. On Windows, you can use the same command in PowerShell.",
    expected: "option_a",
    instruction: "Choose the less canned and more context-appropriate reply for a short technical follow-up.",
  },
  {
    id: "zh-naturalness",
    language: "zh-Hans",
    category: "naturalness",
    context: "两个开发者在群里简短讨论刚检查过的问题。",
    optionA: "我看过了，目前没发现问题。",
    optionB: "我已经实施了检查行为，并在当前时间点没有观察到问题。",
    expected: "option_a",
    instruction: "选择更自然、简洁、像中文母语者技术聊天的回复。",
  },
  {
    id: "zh-correction",
    language: "zh-Hans",
    category: "correction",
    context: "用户刚纠正说：“不是安卓，是 iOS 版本。”",
    optionA: "明白，我刚才弄错了。我改看 iOS 版本。",
    optionB: "好的，我继续检查安卓版本。",
    expected: "option_a",
    instruction: "选择能自然接受并应用用户纠正的回复。",
  },
  {
    id: "ja-register",
    language: "ja",
    category: "register",
    context: "職場で、後輩が先輩に確認結果を丁寧に伝える。",
    optionA: "確認しました。今のところ問題は見つかっていません。",
    optionB: "見たよ。今んとこ問題ないっぽい。",
    expected: "option_a",
    instruction: "職場の先輩に対する返答として、自然で適切な丁寧さの文を選んでください。",
  },
  {
    id: "ja-casual",
    language: "ja",
    category: "naturalness",
    context: "親しい友人同士で、リンクを確認したことを短く伝える。",
    optionA: "見たよ。リンク、ちゃんと開けた。",
    optionB: "リンクを確認いたしました。正常に開くことが可能でございました。",
    expected: "option_a",
    instruction: "親しい友人との会話として自然な文を選んでください。",
  },
  {
    id: "es-naturalness",
    language: "es",
    category: "naturalness",
    context: "Dos desarrolladores hablan de forma informal después de revisar un error.",
    optionA: "Ya lo revisé; por ahora no veo ningún error.",
    optionB: "He efectuado la realización de la revisión y no visualizo errores en el momento presente.",
    expected: "option_a",
    instruction: "Elige la respuesta más natural e idiomática en un chat técnico informal.",
  },
  {
    id: "es-correction",
    language: "es",
    category: "correction",
    context: "El usuario acaba de corregir: “No, me refería a la API nueva, no a la antigua.”",
    optionA: "Entendido, confundí las dos. Reviso la API nueva.",
    optionB: "Perfecto, sigo revisando la API antigua.",
    expected: "option_a",
    instruction: "Elige la respuesta que reconoce y aplica correctamente la corrección.",
  },
  {
    id: "vi-en-contextual-code-switch",
    language: "vi-en",
    category: "code-switch",
    context: "Chat nhóm dev Việt Nam; các thuật ngữ rollback và production được dùng thường xuyên.",
    optionA: "Nếu production vẫn lỗi thì mình rollback bản này trước nhé.",
    optionB: "Nếu môi trường production vẫn lỗi thì mình thực hiện sự rollback hóa phiên bản này nhé.",
    expected: "option_a",
    instruction: "Chọn câu code-switch tự nhiên hơn nhưng vẫn giữ đúng ý kỹ thuật.",
  },
  {
    id: "vi-en-unknown-project-name",
    language: "vi-en",
    category: "unknown-term",
    context: "Tên module chính xác là “JEV-Lattice-X7”; không được sửa chính tả hay dịch tên.",
    optionA: "Mình sẽ giữ nguyên JEV-Lattice-X7 trong log và tài liệu.",
    optionB: "Mình sẽ đổi thành JEV Lattice 7 để câu trông tự nhiên hơn.",
    expected: "option_a",
    instruction: "Chọn câu tự nhiên nhưng bảo toàn tuyệt đối tên module lạ.",
  },
];

if (cases.length !== MAX_REQUESTS) {
  throw new Error("Stress case count must equal the hard request budget.");
}

let requestsUsed = 0;
const results: Array<Record<string, unknown>> = [];

for (const testCase of cases) {
  if (requestsUsed >= MAX_REQUESTS) {
    throw new Error("Live request budget exhausted before stress benchmark completion.");
  }

  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    requestsUsed += 1;
    response = await fetch(`${RELAY_URL}/v1/systemone`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: ORIGIN,
      },
      body: JSON.stringify({
        model: process.env.TYPESAFE_DEFAULT_MODEL ?? "jev-latest",
        state: {
          benchmark: "conversation-ranker-live-stress-v2",
          target_language: testCase.language,
          category: testCase.category,
          dialogue_context: testCase.context,
          candidates: {
            option_a: testCase.optionA,
            option_b: testCase.optionB,
          },
        },
        questions: {
          answer: {
            type: "choice",
            instructions: testCase.instruction,
            criteria: {
              option_a: null,
              option_b: null,
            },
          },
        },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const latencyMs = Math.round(performance.now() - started);
  if (!response.ok) {
    results.push({
      id: testCase.id,
      language: testCase.language,
      category: testCase.category,
      ok: false,
      http_status: response.status,
      latency_ms: latencyMs,
      error_body_persisted: false,
    });
    if (response.status === 401 || response.status === 403) break;
    continue;
  }

  if (response.headers.get("x-jev-relay") !== "1") {
    throw new Error(`Case ${testCase.id} did not traverse the verified relay.`);
  }
  if (response.headers.get("access-control-allow-origin") !== ORIGIN) {
    throw new Error(`Case ${testCase.id} did not preserve the expected CORS origin.`);
  }

  const body = await response.json() as Record<string, any>;
  const answer = body?.answers?.answer;
  if (
    typeof body?.model !== "string" ||
    typeof body?.usage?.input_tokens !== "number" ||
    typeof body?.usage?.output_tokens !== "number" ||
    answer?.type !== "choice" ||
    typeof answer.choice !== "string"
  ) {
    throw new Error(`Case ${testCase.id} returned an invalid System One response shape.`);
  }

  const probabilities =
    answer.probabilities && typeof answer.probabilities === "object"
      ? answer.probabilities
      : null;
  const values = probabilities
    ? Object.values(probabilities)
        .map(Number)
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => b - a)
    : [];
  const margin =
    values.length >= 2 ? Number((values[0]! - values[1]!).toFixed(4)) : null;

  results.push({
    id: testCase.id,
    language: testCase.language,
    category: testCase.category,
    ok: true,
    passed: answer.choice === testCase.expected,
    expected: testCase.expected,
    observed: {
      choice: answer.choice,
      confidence:
        typeof answer.confidence === "number" ? answer.confidence : null,
      probabilities,
      margin,
    },
    model: body.model,
    usage: {
      input_tokens: body.usage.input_tokens,
      output_tokens: body.usage.output_tokens,
    },
    latency_ms: latencyMs,
    request_id: response.headers.get("x-typesafe-request-id"),
    relay_header_verified: true,
    cors_origin_verified: true,
  });
}

const successful = results.filter((result) => result.ok === true);
const passed = successful.filter((result) => result.passed === true);

const summarize = (field: "language" | "category") =>
  [...new Set(cases.map((item) => item[field]))].map((value) => {
    const subset = results.filter((result) => result[field] === value);
    const success = subset.filter((result) => result.ok === true);
    return {
      [field]: value,
      cases: subset.length,
      successful_requests: success.length,
      passed: success.filter((result) => result.passed === true).length,
    };
  });

const totalInputTokens = successful.reduce(
  (sum, result) =>
    sum + Number((result.usage as { input_tokens?: number } | undefined)?.input_tokens ?? 0),
  0,
);
const totalOutputTokens = successful.reduce(
  (sum, result) =>
    sum + Number((result.usage as { output_tokens?: number } | undefined)?.output_tokens ?? 0),
  0,
);

const evidence = {
  schema: "jev-language-conversation-ranker-live-stress/v2",
  observed_at: new Date().toISOString(),
  source_sha: process.env.GITHUB_SHA ?? null,
  relay: RELAY_URL,
  origin: ORIGIN,
  request_budget: MAX_REQUESTS,
  requests_used: requestsUsed,
  credential_persisted: false,
  error_bodies_persisted: false,
  languages_tested: [...new Set(cases.map((item) => item.language))],
  summary: {
    successful_requests: successful.length,
    passed_cases: passed.length,
    pass_rate:
      successful.length === 0
        ? 0
        : Number((passed.length / successful.length).toFixed(4)),
    input_tokens: totalInputTokens,
    output_tokens: totalOutputTokens,
  },
  language_summary: summarize("language"),
  category_summary: summarize("category"),
  cases: results,
  interpretation:
    "This benchmark measures Jev as a bounded conversational naturalness/pragmatics ranker. It does not establish unrestricted string-generation or end-to-end conversation quality.",
};

console.log(JSON.stringify(evidence, null, 2));
