import { gateway, experimental_getRealtimeToolDefinitions } from "ai";
import { getViewer, isGuestId } from "@/lib/auth/guest";
import { getSessionEntitlements } from "@/lib/billing/entitlements";
import { getChatRateLimiter, rateLimitedResponse } from "@/lib/chat/rate-limit";
import { REALTIME_MODEL, REALTIME_VOICE_ENABLED, voiceSessionConfig } from "@/lib/realtime/config";
import { voiceTools } from "@/lib/realtime/voice";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!REALTIME_VOICE_ENABLED) return new Response("Not Found", { status: 404 });

  const { userId, has } = await getViewer();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (isGuestId(userId)) return new Response("Voice requires an account", { status: 403 });

  // Each session start counts once against the chat limit.
  const entitlements = getSessionEntitlements(userId, (plan) => has({ plan }));
  const limitChatRequest = getChatRateLimiter(entitlements);
  if (limitChatRequest) {
    const result = await limitChatRequest(req, userId);
    if (!result.success) return rateLimitedResponse(result, entitlements);
  }

  const tools = await experimental_getRealtimeToolDefinitions({ tools: voiceTools });
  const token = await gateway.experimental_realtime.getToken({
    model: REALTIME_MODEL,
    sessionConfig: { ...voiceSessionConfig, tools },
  });
  return Response.json({ ...token, tools });
}
