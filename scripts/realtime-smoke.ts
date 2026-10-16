// Realtime voice smoke test: REALTIME_MODEL=<id> pnpm run realtime:smoke
// Mints a Gateway token, opens the WebSocket through the model codec, asks a
// question that forces semantic_search, answers the tool call with the same
// handler as POST /api/realtime/tool, and prints the transcript.
import { gateway, experimental_getRealtimeToolDefinitions } from "ai";
import { REALTIME_MODEL, voiceSessionConfig } from "@/lib/realtime/config";
import { runVoiceSemanticSearch, voiceTools } from "@/lib/realtime/voice";

const QUESTION = "What does Alma 32 teach about faith and a seed?";

async function main() {
  // getToken rejects Vercel OIDC tokens (403); it needs a Gateway API key.
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error("AI_GATEWAY_API_KEY is missing from .env.local (realtime client secrets need a Gateway API key, not OIDC)");
  }
  const tools = await experimental_getRealtimeToolDefinitions({ tools: voiceTools });
  const config = { ...voiceSessionConfig, outputModalities: ["text" as const], tools };
  const model = gateway.experimental_realtime(REALTIME_MODEL);
  const token = await gateway.experimental_realtime.getToken({
    model: REALTIME_MODEL,
    sessionConfig: config,
  });
  const { url, protocols } = model.getWebSocketConfig!(token);
  const ws = new WebSocket(url, protocols);
  const send = async (event: Parameters<typeof model.serializeClientEvent>[0]) =>
    ws.send(JSON.stringify(await model.serializeClientEvent(event)));
  const parse = model.createServerEventParser?.() ?? ((raw: unknown) => model.parseServerEvent(raw));

  let toolCalls = 0;
  let outputsSent = 0;
  let toolResponseDone = false; // the function-calling response has finished
  let followUpRequested = false;
  let transcript = "";
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 60_000);
    ws.onerror = () => reject(new Error("websocket error"));
    ws.onopen = () => {
      console.log(`[${REALTIME_MODEL}] connected`);
      // Mirrors the hook: session-update on open, question once the session is ready.
      void send({ type: "session-update", config });
    };
    let asked = false;
    // The follow-up answer needs both the finished tool-calling response and the tool output.
    const maybeFollowUp = async () => {
      if (followUpRequested || !toolResponseDone || outputsSent < toolCalls) return;
      followUpRequested = true;
      await send({ type: "response-create" });
    };
    const handle = async (message: MessageEvent) => {
      const raw = JSON.parse(String(message.data));
      const healthCheck = model.getHealthCheckResponse?.(raw);
      if (healthCheck) return ws.send(JSON.stringify(healthCheck));
      for (const event of [parse(raw)].flat()) {
        if (event.type === "error") reject(new Error(event.message));
        if ((event.type === "session-updated" || event.type === "session-created") && !asked) {
          asked = true;
          console.log(`USER: ${QUESTION}`);
          await send({ type: "conversation-item-create", item: { type: "text-message", role: "user", text: QUESTION } });
          await send({ type: "response-create" });
        }
        if (event.type === "function-call-arguments-done") {
          toolCalls++;
          console.log(`TOOL CALL: ${event.name}(${event.arguments})`);
          const result = await runVoiceSemanticSearch(JSON.parse(event.arguments));
          console.log(`TOOL RESULT: ${result.results.length} results, first: ${result.results[0]?.reference}`);
          await send({
            type: "conversation-item-create",
            item: { type: "function-call-output", callId: event.callId, name: event.name, output: JSON.stringify(result) },
          });
          outputsSent++;
          await maybeFollowUp();
        }
        if (event.type === "audio-transcript-done" || event.type === "text-done") {
          const text = event.type === "text-done" ? event.text : event.transcript;
          if (text && followUpRequested) {
            transcript = text;
            console.log(`ASSISTANT: ${text}`);
          }
        }
        if (event.type === "response-done") {
          if (toolCalls > 0 && !toolResponseDone) {
            toolResponseDone = true;
            await maybeFollowUp();
          } else if (followUpRequested && transcript) {
            clearTimeout(timer);
            resolve();
          }
        }
      }
    };
    ws.onmessage = (message) => handle(message).catch(reject);
  });
  await done.finally(() => ws.close());
  console.log(`done: ${toolCalls} tool call(s)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
