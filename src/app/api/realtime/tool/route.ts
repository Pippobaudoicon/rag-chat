import { ZodError } from "zod";
import { getViewer, isGuestId } from "@/lib/auth/guest";
import { REALTIME_VOICE_ENABLED } from "@/lib/realtime/config";
import { runVoiceSemanticSearch } from "@/lib/realtime/voice";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!REALTIME_VOICE_ENABLED) return new Response("Not Found", { status: 404 });

  const { userId } = await getViewer();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (isGuestId(userId)) return new Response("Voice requires an account", { status: 403 });

  try {
    return Response.json(await runVoiceSemanticSearch(await req.json().catch(() => null)));
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "Invalid input" }, { status: 400 });
    throw error;
  }
}
