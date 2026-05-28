import type { Metadata } from "next";
import { LegalMailLink, LegalPageLayout } from "@/components/legal/LegalPageLayout";

export const metadata: Metadata = {
  title: "Privacy Policy | ChatLDS",
  description:
    "Read ChatLDS's Privacy Policy, including how account information is collected, used, retained, and deleted when authentication is handled through Clerk.",
  openGraph: {
    type: "website",
    title: "Privacy Policy | ChatLDS",
    description:
      "How ChatLDS handles account data, Clerk authentication, retention, deletion, and privacy requests.",
    siteName: "ChatLDS",
    url: "/privacy-policy",
  },
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPageLayout
      accent="emerald"
      activePage="privacy"
      eyebrow="Legal"
      title="Privacy Policy"
      description="This policy explains what account information ChatLDS may collect, how authentication is protected through Clerk, and how you can request deletion of your data."
      sidebar={
        <div className="mt-8 rounded-lg border border-white/10 bg-white/4 p-5 shadow-sm">
          <p className="text-sm font-semibold text-white">Last updated</p>
          <p className="mt-1 text-sm text-zinc-400">May 25, 2026</p>
        </div>
      }
    >
      <article className="rounded-lg border border-white/10 bg-zinc-900/70 p-6 shadow-xl shadow-black/30 sm:p-8 lg:p-10">
        <div className="max-w-none space-y-9">
          <p className="text-lg leading-8 text-zinc-300">
            ChatLDS is committed to handling personal information responsibly
            and transparently. We only collect information needed to operate the
            service, secure user accounts, provide support, and meet applicable
            legal obligations.
          </p>

          <section className="space-y-4" aria-labelledby="information-we-collect">
            <h2
              id="information-we-collect"
              className="text-2xl font-semibold tracking-tight text-white"
            >
              Information We Collect
            </h2>
            <p className="leading-7 text-zinc-300">
              When you create an account, sign in, or use ChatLDS, we may
              collect basic account and authentication information, including:
            </p>
            <ul className="list-disc space-y-2 pl-5 leading-7 text-zinc-300">
              <li>Name</li>
              <li>Email address</li>
              <li>Profile image or avatar</li>
              <li>
                Authentication provider information, such as whether you signed
                in with email or another supported provider
              </li>
            </ul>
          </section>

          <section className="space-y-4" aria-labelledby="how-we-use-information">
            <h2
              id="how-we-use-information"
              className="text-2xl font-semibold tracking-tight text-white"
            >
              How We Use Information
            </h2>
            <p className="leading-7 text-zinc-300">
              We use account information to provide and protect the service,
              including to:
            </p>
            <ul className="list-disc space-y-2 pl-5 leading-7 text-zinc-300">
              <li>Create and manage your account</li>
              <li>Authenticate sign-ins and maintain secure sessions</li>
              <li>
                Personalize basic account experiences, such as displaying your
                name or profile image
              </li>
              <li>Provide customer support and respond to privacy requests</li>
              <li>
                Detect, prevent, and address abuse, security incidents, or
                technical issues
              </li>
              <li>
                Comply with applicable legal, regulatory, and contractual
                obligations
              </li>
            </ul>
            <p className="leading-7 text-zinc-300">
              We do not sell user personal data or use it for unrelated
              advertising resale or brokerage.
            </p>
          </section>

          <section className="space-y-4" aria-labelledby="authentication">
            <h2
              id="authentication"
              className="text-2xl font-semibold tracking-tight text-white"
            >
              Authentication
            </h2>
            <p className="leading-7 text-zinc-300">
              Authentication for ChatLDS is handled securely through{" "}
              <strong className="font-semibold text-white">Clerk</strong>, a
              third-party authentication provider. Clerk manages identity
              workflows such as account creation, sign-in, social login,
              session management, and related security controls.
            </p>
            <p className="leading-7 text-zinc-300">
              Social sign-in methods may be available through Clerk
              connections. When you choose a social login provider, that
              provider and Clerk process the authentication request according to
              their respective terms, security practices, and privacy notices.
              ChatLDS does not directly receive or store provider passwords.
            </p>
          </section>

          <section className="space-y-4" aria-labelledby="data-retention">
            <h2
              id="data-retention"
              className="text-2xl font-semibold tracking-tight text-white"
            >
              Data Retention
            </h2>
            <p className="leading-7 text-zinc-300">
              We retain account-related information for as long as your account
              remains active or as needed to provide ChatLDS. We may also
              retain limited records where required for security, fraud
              prevention, dispute resolution, compliance with law, or legitimate
              business purposes.
            </p>
            <p className="leading-7 text-zinc-300">
              When retention is no longer necessary, we delete, anonymize, or
              otherwise minimize personal information in accordance with
              applicable privacy obligations.
            </p>
          </section>

          <section className="space-y-4" aria-labelledby="privacy-rights">
            <h2
              id="privacy-rights"
              className="text-2xl font-semibold tracking-tight text-white"
            >
              Privacy Rights and Compliance
            </h2>
            <p className="leading-7 text-zinc-300">
              Depending on your location, including if you are in the European
              Economic Area, United Kingdom, Switzerland, or another
              jurisdiction with privacy laws, you may have rights to access,
              correct, delete, restrict, or object to certain processing of your
              personal information. You may also have the right to data
              portability or to withdraw consent where processing is based on
              consent.
            </p>
            <p className="leading-7 text-zinc-300">
              We aim to handle privacy requests in line with applicable GDPR,
              consumer privacy, and data protection requirements.
            </p>
          </section>

          <section className="space-y-4" aria-labelledby="contact">
            <h2
              id="contact"
              className="text-2xl font-semibold tracking-tight text-white"
            >
              Contact
            </h2>
            <p className="leading-7 text-zinc-300">
              For privacy questions, account deletion requests, or data access
              requests, contact us at <LegalMailLink accent="emerald" />.
            </p>
          </section>
        </div>
      </article>
    </LegalPageLayout>
  );
}
