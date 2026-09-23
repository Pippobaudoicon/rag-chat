import { getViewer } from "@/lib/auth/guest";
import { ChatInterface } from "@/components/chat/ChatInterface";
import { getUserPreferences } from "@/lib/db/user-settings";

export default async function NewChatPage() {
  const { userId } = await getViewer();
  const prefs = userId ? await getUserPreferences(userId) : null;

  return (
    <ChatInterface
      initialDefaultResponseStyle={prefs?.defaultResponseStyle}
      initialOnboardingStatus={prefs?.onboardingStatus}
    />
  );
}
