import type { Metadata } from "next";
import { MoonStar } from "lucide-react";
import Link from "next/link";
import { UnsubscribeForm } from "./unsubscribe-form";

export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false },
};

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  // The token is deliberately NOT consumed here: email security scanners
  // prefetch visible links, which would unsubscribe the user before they ever
  // visit. The client form below performs the opt-out via an explicit POST.
  if (!token) {
    return (
      <main className="mx-auto flex min-h-[80svh] max-w-md flex-col items-center justify-center px-4 text-center">
        <MoonStar className="size-12 text-slate-300" />
        <h1 className="mt-5 text-2xl font-bold text-slate-100">
          You&apos;re not subscribed
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          This link doesn&apos;t carry an unsubscribe token, so there&apos;s
          nothing to turn off. You can browse the sky and resubscribe anytime.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex items-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-6 py-3 text-sm font-semibold text-cyan-200 transition hover:border-cyan-300/70 hover:bg-cyan-400/20"
        >
          Back to tonight&apos;s sky
        </Link>
      </main>
    );
  }

  return <UnsubscribeForm token={token} />;
}
