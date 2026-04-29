import { auth } from "@clerk/nextjs/server";
import {
  getUserMemorySnapshot,
  refreshUserMemory,
} from "@/lib/memory/conversation-memory";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function GET() {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const snapshot = await getUserMemorySnapshot(userId);

  return Response.json(snapshot, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";
  const result = await refreshUserMemory(userId, {
    force,
    forcePeriods: force,
  });
  const snapshot = await getUserMemorySnapshot(userId);

  return Response.json(
    { result, snapshot },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
