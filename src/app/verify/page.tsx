import type { Metadata } from "next";
import { MailQuestion } from "lucide-react";
import Link from "next/link";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = {
  title: "Confirm your subscription",
  robots: { index: false },
};

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  // The token is deliberately NOT consumed here. Email clients and security
  // gateways prefetch links in HTML, which would confirm the subscription
  // before the recipient ever clicks. The client form below performs the
  // confirmation via an explicit POST instead.
  if (!token) {
    return (
      <main className="mx-auto flex min-h-[80svh] max-w-md flex-col items-center justify-center px-4 text-center">
        <MailQuestion className="size-12 text-amber-300" />
        <h1 className="mt-5 text-2xl font-bold text-slate-100">
          That link didn&apos;t work
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          This confirmation link is missing its token. Try subscribing again to
          get a fresh one.
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

  return <VerifyForm token={token} />;
}
