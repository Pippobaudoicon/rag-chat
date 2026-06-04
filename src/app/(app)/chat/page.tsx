import { auth } from "@clerk/nextjs/server";
import { ChatInterface } from "@/components/chat/ChatInterface";
import { getUserPreferences } from "@/lib/db/user-settings";

export default async function NewChatPage() {
  const { userId } = await auth();
  const prefs = userId ? await getUserPreferences(userId) : null;

  return (
    <ChatInterface
      initialDefaultResponseStyle={prefs?.defaultResponseStyle}
    />
  );
}
