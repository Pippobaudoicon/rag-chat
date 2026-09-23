import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SignIn, SignUp } from "@clerk/nextjs";
import { cn } from "@/lib/utils";

const ENTER =
  "animate-in fade-in slide-in-from-bottom-4 duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] fill-mode-both motion-reduce:animate-none";

// Shared look for Clerk's bordered controls, matching the app's Input /
// outline Button. Clerk draws borders with box-shadow and overlays its buttons
// with a gradient pseudo-element, hence shadow-none and the after/before resets.
const FIELD =
  "box-border rounded-lg border border-input bg-input/30 shadow-none transition-colors";
const OUTLINE_BUTTON = cn(
  FIELD,
  "h-10 text-sm font-medium text-foreground hover:bg-input/50 after:hidden before:hidden"
);
const LINK = "font-medium text-foreground underline-offset-4 hover:underline hover:text-foreground";

// Clerk still runs every step (Google, password, email code, reset, sign-up
// verification, captcha); we restyle each piece so it reads as our own form.
// Classes win over Clerk's styles because of `cssLayerName: "clerk"` on
// ClerkProvider + the layer order at the top of globals.css. Copy lives in the
// `localization` prop on ClerkProvider (root layout).
const appearance = {
  variables: {
    colorPrimary: "var(--primary)",
    colorPrimaryForeground: "var(--primary-foreground)",
    colorForeground: "var(--foreground)",
    colorMutedForeground: "var(--muted-foreground)",
    colorMuted: "var(--muted)",
    colorNeutral: "var(--foreground)",
    colorBackground: "var(--background)",
    colorInput: "transparent",
    colorInputForeground: "var(--foreground)",
    colorBorder: "var(--border)",
    colorRing: "var(--ring)",
    colorDanger: "var(--destructive)",
    borderRadius: "var(--radius)",
    fontSize: "0.875rem",
  },
  elements: {
    rootBox: "w-full",
    // Clerk clips the card (overflow hidden) and tucks the footer under it with
    // a negative margin; undo both so borders, the "Last used" badge and the
    // footer link render in full.
    cardBox: "w-full max-w-none overflow-visible rounded-none border-0 bg-transparent shadow-none",
    card: "m-0 gap-6 overflow-visible border-0 bg-transparent p-0 shadow-none",
    logoBox: "hidden",
    header: "items-start gap-2 text-left",
    // One size for both pages: at 5xl "Create your account." wraps and sign-up
    // no longer fits a laptop viewport without scrolling.
    headerTitle: "font-serif text-4xl font-medium tracking-tight text-foreground",
    headerSubtitle: "text-sm text-muted-foreground",
    socialButtonsBlockButton: OUTLINE_BUTTON,
    socialButtonsBlockButtonText: "text-sm font-medium",
    alternativeMethodsBlockButton: OUTLINE_BUTTON,
    dividerLine: "bg-border",
    dividerText: "text-[11px] uppercase tracking-wider text-muted-foreground",
    formFieldLabel: "text-xs font-medium text-muted-foreground",
    formFieldInput: cn(
      FIELD,
      "h-10 px-3 text-base text-foreground placeholder:text-muted-foreground focus:border-foreground/20 focus:ring-3 focus:ring-foreground/6 md:text-sm"
    ),
    formFieldInputShowPasswordButton: "text-muted-foreground hover:text-foreground",
    otpCodeFieldInput: cn(FIELD, "text-foreground focus:border-foreground/20"),
    identityPreview: cn(FIELD, "px-3 py-2"),
    identityPreviewText: "text-foreground",
    identityPreviewEditButton: "text-muted-foreground hover:text-foreground",
    formButtonPrimary:
      "h-10 rounded-lg bg-primary text-sm font-medium normal-case text-primary-foreground shadow-none transition-colors hover:bg-primary/85 after:hidden before:hidden",
    formFieldAction: LINK,
    formResendCodeLink: LINK,
    backLink: "text-muted-foreground hover:text-foreground",
    footer: "mt-4 border-0 bg-transparent bg-none p-0 [&>*]:bg-transparent",
    footerAction: "p-0",
    footerActionText: "text-sm text-muted-foreground",
    footerActionLink: cn(LINK, "text-sm"),
  },
};

// Clerk only takes `localization` on ClerkProvider, so the root layout passes
// this; it overrides Clerk's default English copy for the start screens.
export const authLocalization = {
  signIn: {
    start: {
      title: "Welcome back.",
      subtitle: "Sign in to pick up your conversations where you left off.",
      actionText: "New to ChatLDS?",
      actionLink: "Create an account",
    },
  },
  signUp: {
    start: {
      title: "Create your account.",
      subtitle: "Keep your chats and continue on any device.",
      actionText: "Already have an account?",
      actionLink: "Sign in",
    },
  },
};

function BrandMark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* White silhouette of the logo: the teal/purple original disappears on dark surfaces. */}
      <Image
        src="/icons/logo-no-bg.png"
        alt=""
        width={28}
        height={28}
        className="brightness-0 invert"
      />
      <span className="text-base font-semibold tracking-[-0.025em]">ChatLDS</span>
    </div>
  );
}

// Deterministic 0..1 per index so server and client render the same durations.
const jitter = (i: number) => {
  const v = Math.sin(i + 1) * 10_000;
  return v - Math.floor(v);
};

// Adapted from hirael login-03's FloatingPaths, with CSS dash animation instead
// of the motion library, stroked in the logo's teal→purple.
function FlowingLines() {
  const paths = [1, -1].flatMap((position) =>
    Array.from({ length: 36 }, (_, i) => ({
      key: `${position}-${i}`,
      i,
      d: `M-${380 - i * 5 * position} -${189 + i * 6}C-${380 - i * 5 * position} -${189 + i * 6} -${312 - i * 5 * position} ${216 - i * 6} ${152 - i * 5 * position} ${343 - i * 6}C${616 - i * 5 * position} ${470 - i * 6} ${684 - i * 5 * position} ${875 - i * 6} ${684 - i * 5 * position} ${875 - i * 6}`,
    }))
  );
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      fill="none"
      viewBox="0 0 696 316"
    >
      <defs>
        <linearGradient id="auth-lines" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(0.68 0.09 230)" />
          <stop offset="100%" stopColor="oklch(0.62 0.16 315)" />
        </linearGradient>
      </defs>
      {paths.map(({ key, i, d }) => (
        <path
          key={key}
          d={d}
          pathLength={1}
          stroke="url(#auth-lines)"
          strokeOpacity={0.1 + i * 0.03}
          strokeWidth={0.5 + i * 0.03}
          strokeDasharray="0.4 0.6"
          className="opacity-60 motion-safe:animate-[auth-line-flow_linear_infinite]"
          style={{ animationDuration: `${20 + jitter(i) * 10}s` }}
        />
      ))}
    </svg>
  );
}

export function AuthShell({ mode }: { mode: "sign-in" | "sign-up" }) {
  // <html>/<body> are overflow-hidden for the app shell, so the auth page
  // scrolls inside its own viewport-height container (long sign-up on phones).
  return (
    <main className="h-dvh overflow-y-auto">
      <section className="relative flex min-h-full flex-col bg-background lg:grid lg:grid-cols-2">
        <aside className="relative hidden flex-col overflow-hidden border-e border-border bg-card p-10 lg:flex">
          <FlowingLines />
          <div
            aria-hidden
            className="absolute inset-0 bg-linear-to-b from-transparent via-transparent to-background"
          />
          <BrandMark className={cn(ENTER, "relative z-10")} />
          <figure
            style={{ animationDelay: "240ms" }}
            className={cn(ENTER, "relative z-10 mt-auto flex flex-col gap-3")}
          >
            <blockquote className="font-serif text-2xl leading-[1.25] tracking-tight md:text-3xl">
              Seek ye out of the best books words of wisdom; seek learning,{" "}
              <span className="italic">even by study and also by faith</span>.
            </blockquote>
            <figcaption className="text-xs uppercase tracking-wide text-muted-foreground">
              Doctrine and Covenants 88:118
            </figcaption>
          </figure>
        </aside>

        <div className="relative flex flex-1 flex-col justify-center px-6 pt-[max(2.5rem,env(safe-area-inset-top))] pb-10 sm:px-8 lg:py-8">
          <div className="relative z-10 mx-auto w-full space-y-5 sm:max-w-sm">
            <BrandMark className={cn(ENTER, "lg:hidden")} />
            {mode === "sign-in" ? (
              <SignIn appearance={appearance} />
            ) : (
              <SignUp appearance={appearance} />
            )}
            {/* Guests chat quota-limited without an account; the proxy moves
                their chats over if they sign up later (src/proxy.ts). */}
            <div className="space-y-1 border-t border-border pt-4">
              <Link
                href="/chat"
                className="group flex h-10 w-full items-center justify-center gap-1.5 rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Continue as a guest
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
              </Link>
              <p className="text-center text-xs text-muted-foreground">
                No account needed. Your chats come with you if you sign up later.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              By continuing, you acknowledge the{" "}
              <Link href="/privacy-policy" className={LINK}>
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
