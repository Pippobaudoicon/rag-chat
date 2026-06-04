import { auth } from "@clerk/nextjs/server";
import {
  getUserPreferences,
  setDefaultResponseStyle,
} from "@/lib/db/user-settings";
import { badRequestFromZod, userSettingsSchema } from "@/lib/api/validation";

export const runtime = "nodejs";

// GET /api/settings — the current user's persistent preferences.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const prefs = await getUserPreferences(userId);
  return Response.json(prefs, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

// PUT /api/settings — update the user's default response style.
export async function PUT(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const parsed = userSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequestFromZod(parsed.error);

  await setDefaultResponseStyle(userId, parsed.data.defaultResponseStyle);
  return Response.json({ defaultResponseStyle: parsed.data.defaultResponseStyle });
}
