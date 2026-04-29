import { refreshActiveUsersMemory } from "@/lib/memory/conversation-memory";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function GET(req: Request) {
  const authHeader = req.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await refreshActiveUsersMemory();

  return Response.json(result, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
