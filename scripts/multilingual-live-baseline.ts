import {
  englishLanguagePack,
} from "../packages/language-en/src/index.ts";
import {
  vietnameseLanguagePack,
} from "../packages/language-vi/src/index.ts";

const RELAY_URL =
  process.env.JEV_RELAY_URL ??
  "https://jev-language-typesafe-relay.nolane-file.workers.dev";
const ORIGIN = "https://nolane-x.github.io";
const MAX_REQUESTS = 12;

if (process.env.JEV_ALLOW_LIVE !== "1") {
  throw new Error("Live multilingual evaluation is disabled.");
}

if (Number(process.env.JEV_LIVE_MAX_REQUESTS ?? MAX_REQUESTS) !== MAX_REQUESTS) {
  throw new Error(`Multilingual live evaluation is hard-limited to ${MAX_REQUESTS} requests.`);
}

const apiKey = process.env.TYPESAFE_API_KEY;
if (!apiKey) {
  throw new Error("TYPESAFE_API_KEY is not available in this runtime.");
}

if (!/^https:\/\/[a-z0-9.-]+\.workers\.dev$/iu.test(RELAY_URL)) {
  throw new Error("JEV_RELAY_URL must be an HTTPS workers.dev origin.");
}

type NoulCase = {
  id: string;
  language: string;
  kind: "noul";
  state: Record<string, unknown>;
  instruction: string;
  expected: boolean;
};

type ChoiceCase = {
  id: string;
  language: string;
  kind: "choice";
  state: Record<string, unknown>;
  instruction: string;
  options: readonly ["option_a", "option_b"];
  expected: "option_a" | "option_b";
};

type Case = NoulCase | ChoiceCase;

const cases: Case[] = [
  {
    id: "en-meaning-preservation",
    language: "en",
    kind: "noul",
    state: {
      latest_user_message:
        "Source: You must not delete more than three files. Candidate: Deleting more than three files is not permitted.",
    },
    instruction:
      "Do the source and candidate preserve the same upper-bound restriction?",
    expected: true,
  },
  {
    id: "en-naturalness",
    language: "en",
    kind: "choice",
    state: {
      latest_user_message:
        "Choose the more natural reply in an ordinary developer chat. A: I checked it, and I don't see any errors yet. B: I performed the checking and at this present time I see no errors.",
    },
    instruction:
      "Which option sounds more natural, concise, and idiomatic in conversational English?",
    options: ["option_a", "option_b"],
    expected: "option_a",
  },
  {
    id: "vi-meaning-preservation",
    language: "vi",
    kind: "noul",
    state: {
      latest_user_message:
        "Câu gốc: Bạn không được xóa quá 3 tệp. Câu mới: Việc xóa nhiều hơn 3 tệp là không được phép.",
    },
    instruction:
      "Hai câu có giữ nguyên cùng một giới hạn tối đa về số tệp được xóa không?",
    expected: true,
  },
  {
    id: "vi-naturalness",
    language: "vi",
    kind: "choice",
    state: {
      latest_user_message:
        "Chọn câu tự nhiên hơn trong hội thoại bình thường. A: Mình kiểm tra rồi, hiện chưa thấy lỗi nào. B: Tôi đã tiến hành sự kiểm tra và tại thời điểm hiện tại không nhìn thấy lỗi nào.",
    },
    instruction:
      "Câu nào tự nhiên, gọn và giống cách người Việt nói chuyện hơn?",
    options: ["option_a", "option_b"],
    expected: "option_a",
  },
  {
    id: "zh-meaning-preservation",
    language: "zh-Hans",
    kind: "noul",
    state: {
      latest_user_message:
        "原句：不能删除超过三个文件。改写：删除三个以上的文件是不允许的。",
    },
    instruction: "这两句话是否保留了相同的“最多三个文件”限制？",
    expected: true,
  },
  {
    id: "zh-naturalness",
    language: "zh-Hans",
    kind: "choice",
    state: {
      latest_user_message:
        "请选择更自然的日常技术聊天回复。A：我检查过了，目前还没发现问题。B：我已经进行了检查行为，并且在当前时间点没有看见问题。",
    },
    instruction: "哪一个选项更自然、简洁，更像中文母语者的聊天表达？",
    options: ["option_a", "option_b"],
    expected: "option_a",
  },
  {
    id: "es-meaning-preservation",
    language: "es",
    kind: "noul",
    state: {
      latest_user_message:
        "Original: No se pueden eliminar más de tres archivos. Reformulación: Está prohibido eliminar más de tres archivos.",
    },
    instruction:
      "¿Las dos frases mantienen la misma restricción de no superar tres archivos?",
    expected: true,
  },
  {
    id: "es-naturalness",
    language: "es",
    kind: "choice",
    state: {
      latest_user_message:
        "Elige la respuesta más natural en un chat técnico. A: Ya lo revisé y por ahora no veo ningún error. B: He realizado la revisión y en el momento presente no visualizo ningún error.",
    },
    instruction:
      "¿Qué opción suena más natural, breve e idiomática en español conversacional?",
    options: ["option_a", "option_b"],
    expected: "option_a",
  },
  {
    id: "ja-meaning-preservation",
    language: "ja",
    kind: "noul",
    state: {
      latest_user_message:
        "元の文：3つを超えるファイルを削除してはいけません。言い換え：3つを超えるファイルの削除は禁止されています。",
    },
    instruction: "この2文は同じ上限の制約を保っていますか？",
    expected: true,
  },
  {
    id: "ja-naturalness",
    language: "ja",
    kind: "choice",
    state: {
      latest_user_message:
        "技術チャットでより自然な返答を選んでください。A：確認しましたが、今のところ問題は見つかっていません。B：確認という行為を実施し、現在時点において問題を視認していません。",
    },
    instruction:
      "どちらがより自然で簡潔な日本語の会話表現ですか？",
    options: ["option_a", "option_b"],
    expected: "option_a",
  },
  {
    id: "vi-multiturn-reference",
    language: "vi",
    kind: "noul",
    state: {
      latest_user_message:
        "Lan gửi báo cáo cho Mai. Sau đó Mai nói: “Tối nay mình sẽ sửa nó.” Trong câu này, “nó” có chỉ báo cáo không?",
      conversation: [
        { role: "user", text: "Lan vừa gửi báo cáo cho Mai." },
        { role: "assistant", text: "Được, mình đã ghi nhận ngữ cảnh." },
      ],
    },
    instruction:
      "Dựa đúng vào ngữ cảnh đã cho, đại từ “nó” có hợp lý nhất là chỉ “báo cáo” không?",
    expected: true,
  },
  {
    id: "vi-en-code-switch-naturalness",
    language: "vi-en",
    kind: "choice",
    state: {
      latest_user_message:
        "Trong chat của nhóm dev Việt Nam, chọn câu tự nhiên hơn khi cho phép code-switch thông dụng. A: Mình deploy bản fix rồi, bạn refresh lại trang thử nhé. B: Mình triển khai bản sửa rồi, bạn refresh hóa page để thử nghiệm nhé.",
    },
    instruction:
      "Câu nào tự nhiên hơn trong hội thoại dev Việt Nam có dùng thuật ngữ tiếng Anh thông dụng?",
    options: ["option_a", "option_b"],
    expected: "option_a",
  },
];

if (cases.length !== MAX_REQUESTS) {
  throw new Error("Benchmark case count must equal the hard request budget.");
}

const requireOk = <T>(
  result: { ok: true; value: T } | { ok: false; error: Error },
): T => {
  if (!result.ok) throw result.error;
  return result.value;
};

const surfaceSources = [
  "The service deletes exactly 3 files.",
  "If deletion is prohibited, the service must not delete more than 3 files.",
  "The service must not delete more than 3 files because deletion is prohibited.",
  "According to the service, the service deletes exactly 3 files.",
] as const;

const surfaceProbes = surfaceSources.map((source) => {
  const parsed = requireOk(englishLanguagePack.parserHooks.parse(source));
  return {
    source,
    en: requireOk(englishLanguagePack.realizationHooks.realize(parsed.snapshot)),
    vi: requireOk(vietnameseLanguagePack.realizationHooks.realize(parsed.snapshot)),
  };
});

let requestsUsed = 0;
const results: Array<Record<string, unknown>> = [];

for (const testCase of cases) {
  if (requestsUsed >= MAX_REQUESTS) {
    throw new Error("Live request budget exhausted before benchmark completion.");
  }

  const questions =
    testCase.kind === "noul"
      ? {
          answer: {
            type: "noul",
            instructions: testCase.instruction,
          },
        }
      : {
          answer: {
            type: "choice",
            instructions: testCase.instruction,
            criteria: {
              option_a: null,
              option_b: null,
            },
          },
        };

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
          ...testCase.state,
          benchmark_language: testCase.language,
          note:
            "Multilingual JEV Language baseline. Judge only the supplied text and preserve uncertainty.",
        },
        questions,
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
      kind: testCase.kind,
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
    answer === null ||
    typeof answer !== "object"
  ) {
    throw new Error(`Case ${testCase.id} returned an invalid System One response shape.`);
  }

  let passed = false;
  let observed: unknown = null;

  if (testCase.kind === "noul") {
    const probability = Number(answer.noul);
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new Error(`Case ${testCase.id} returned an invalid Noul value.`);
    }
    observed = probability;
    passed = testCase.expected ? probability >= 0.7 : probability <= 0.3;
  } else {
    if (answer.type !== "choice" || typeof answer.choice !== "string") {
      throw new Error(`Case ${testCase.id} returned an invalid choice answer.`);
    }
    observed = {
      choice: answer.choice,
      confidence: Number.isFinite(answer.confidence)
        ? answer.confidence
        : null,
      probabilities:
        answer.probabilities && typeof answer.probabilities === "object"
          ? answer.probabilities
          : null,
    };
    passed = answer.choice === testCase.expected;
  }

  results.push({
    id: testCase.id,
    language: testCase.language,
    kind: testCase.kind,
    ok: true,
    passed,
    expected: testCase.expected,
    observed,
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

const languageSummary = [...new Set(cases.map((item) => item.language))].map(
  (language) => {
    const languageResults = results.filter((result) => result.language === language);
    const successfulLanguageResults = languageResults.filter(
      (result) => result.ok === true,
    );
    return {
      language,
      cases: languageResults.length,
      successful_requests: successfulLanguageResults.length,
      passed: successfulLanguageResults.filter(
        (result) => result.passed === true,
      ).length,
    };
  },
);

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
  schema: "jev-language-multilingual-live-baseline/v1",
  observed_at: new Date().toISOString(),
  source_sha: process.env.GITHUB_SHA ?? null,
  relay: RELAY_URL,
  origin: ORIGIN,
  request_budget: MAX_REQUESTS,
  requests_used: requestsUsed,
  credential_persisted: false,
  error_bodies_persisted: false,
  languages_tested: ["en", "vi", "zh-Hans", "es", "ja", "vi-en"],
  jev_language_surface_packs: ["en", "vi"],
  missing_surface_packs_for_live_languages: ["zh-Hans", "es", "ja"],
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
  language_summary: languageSummary,
  cases: results,
  deterministic_surface_probes: surfaceProbes,
};

console.log(JSON.stringify(evidence, null, 2));
