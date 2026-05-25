import Link from "next/link";

type LegalPageLayoutProps = {
  accent: "emerald" | "sky";
  activePage: "privacy";
  eyebrow: string;
  title: string;
  description: string;
  sidebar?: React.ReactNode;
  children: React.ReactNode;
};

const accentStyles = {
  emerald: {
    selection: "selection:bg-emerald-500/30",
    focus: "focus-visible:ring-emerald-500",
    badge:
      "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
    link:
      "text-emerald-300 decoration-emerald-500/50 hover:text-emerald-200",
    glow: "from-zinc-900 via-emerald-950/20 to-transparent",
  },
  sky: {
    selection: "selection:bg-sky-500/30",
    focus: "focus-visible:ring-sky-500",
    badge: "border-sky-400/20 bg-sky-400/10 text-sky-300",
    link: "text-sky-300 decoration-sky-500/50 hover:text-sky-200",
    glow: "from-zinc-900 via-sky-950/20 to-transparent",
  },
};

function LegalNav({
  activePage,
  focusClass,
}: {
  activePage: LegalPageLayoutProps["activePage"];
  focusClass: string;
}) {
  const navLinkClass =
    "rounded-md px-3 py-2 text-sm font-medium text-zinc-300 transition hover:bg-white/10 hover:text-white";
  const activeClass = "bg-white text-zinc-950 hover:bg-white hover:text-zinc-950";

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-zinc-950/80 backdrop-blur-xl">
      <nav
        className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-6"
        aria-label="Primary navigation"
      >
        <Link
          href="/"
          className={`group inline-flex items-center gap-3 rounded-lg outline-none transition focus-visible:ring-2 ${focusClass} focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950`}
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-white text-sm font-semibold text-zinc-950 shadow-sm transition group-hover:scale-[1.03]">
            C
          </span>
          <span className="text-sm font-semibold tracking-tight text-white">
            ChatLDS
          </span>
        </Link>
      </nav>
    </header>
  );
}

function LegalFooter() {
  return (
    <footer className="border-t border-white/10 bg-zinc-950/80">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 text-sm text-zinc-400 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>&copy; 2026 ChatLDS. All rights reserved.</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/privacy-policy" className="transition hover:text-white">
            Privacy Policy
          </Link>
          <a
            href="mailto:support@tommasolopiparo.com"
            className="transition hover:text-white"
          >
            Contact
          </a>
        </div>
      </div>
    </footer>
  );
}

export function LegalPageLayout({
  accent,
  activePage,
  eyebrow,
  title,
  description,
  sidebar,
  children,
}: LegalPageLayoutProps) {
  const styles = accentStyles[accent];

  return (
    <div
      className={`h-dvh overflow-y-auto bg-zinc-950 text-zinc-50 ${styles.selection}`}
    >
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[linear-gradient(to_right,rgba(250,250,250,0.055)_1px,transparent_1px),linear-gradient(to_bottom,rgba(250,250,250,0.055)_1px,transparent_1px)] bg-[size:48px_48px]" />
      <div
        className={`pointer-events-none fixed inset-x-0 top-0 -z-10 h-72 bg-gradient-to-b ${styles.glow}`}
      />

      <LegalNav activePage={activePage} focusClass={styles.focus} />

      <main>
        <section className="mx-auto max-w-6xl px-5 pb-10 pt-14 sm:px-6 sm:pb-14 sm:pt-20">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_2.1fr] lg:items-start">
            <aside className="lg:sticky lg:top-24">
              <p
                className={`mb-4 inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${styles.badge}`}
              >
                {eyebrow}
              </p>
              <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                {title}
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-zinc-300">
                {description}
              </p>
              {sidebar}
            </aside>

            {children}
          </div>
        </section>
      </main>

      <LegalFooter />
    </div>
  );
}

export function LegalMailLink({
  accent,
  children = "support@tommasolopiparo.com",
}: {
  accent: LegalPageLayoutProps["accent"];
  children?: React.ReactNode;
}) {
  return (
    <a
      className={`font-medium underline underline-offset-4 transition ${accentStyles[accent].link}`}
      href="mailto:support@tommasolopiparo.com"
    >
      {children}
    </a>
  );
}
