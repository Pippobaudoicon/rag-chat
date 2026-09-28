import { GoogleOneTap } from "@clerk/nextjs";
import { AppShell } from "@/components/layout/AppShell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppShell>{children}</AppShell>
      <GoogleOneTap cancelOnTapOutside={false} />
    </>
  );
}
