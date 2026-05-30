import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { MemoryPageClient } from "@/components/memory/MemoryPageClient";
import { getUserMemorySnapshot } from "@/lib/memory/conversation-memory";

export default async function MemoryPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const snapshot = await getUserMemorySnapshot(userId);

  return <MemoryPageClient snapshot={snapshot} />;
}
