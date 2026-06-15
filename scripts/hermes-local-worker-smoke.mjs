const baseUrl = (process.env.LM_STUDIO_BASE_URL || "http://localhost:1234/v1").replace(/\/$/, "");
const apiKey = process.env.LM_STUDIO_API_KEY || "lm-studio";
const model = process.env.LOCAL_MODEL || "qwen2.5-coder-7b-instruct";

const headers = {
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json"
};

async function main() {
  const modelResponse = await fetch(`${baseUrl}/models`, { headers });
  if (!modelResponse.ok) {
    throw new Error(`LM Studio models endpoint failed: HTTP ${modelResponse.status} ${await modelResponse.text()}`);
  }

  const modelsJson = await modelResponse.json();
  const loadedModels = (modelsJson.data || []).map((entry) => entry.id).filter(Boolean);
  if (!loadedModels.includes(model)) {
    throw new Error(`Expected local worker model ${model} was not loaded. Loaded models: ${loadedModels.join(", ") || "none"}`);
  }

  const chatResponse = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 80,
      messages: [
        {
          role: "system",
          content: "You are a local LM Studio worker. Reply with exactly: HERMES_LOCAL_WORKER_OK"
        },
        {
          role: "user",
          content: "Confirm the local worker path is alive."
        }
      ]
    })
  });

  if (!chatResponse.ok) {
    throw new Error(`LM Studio chat completion failed: HTTP ${chatResponse.status} ${await chatResponse.text()}`);
  }

  const chatJson = await chatResponse.json();
  const sample = chatJson.choices?.[0]?.message?.content?.trim() || "";
  if (!sample.includes("HERMES_LOCAL_WORKER_OK")) {
    throw new Error(`Unexpected local worker response: ${sample}`);
  }

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    model,
    loadedModels,
    sample
  }, null, 2));
}

main().catch((error) => {
  console.error(`Local worker smoke failed: ${error.message}`);
  process.exitCode = 1;
});
