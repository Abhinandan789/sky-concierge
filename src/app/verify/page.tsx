import type { Metadata } from "next";
import { CheckCircle2, MailQuestion } from "lucide-react";
import Link from "next/link";
import { getDb, verifySubscription } from "@/lib/db";

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
  const confirmed = token ? verifySubscription(getDb(), token) : false;

  return (
    <main className="mx-auto flex min-h-[80svh] max-w-md flex-col items-center justify-center px-4 text-center">
      {confirmed ? (
        <>
          <CheckCircle2 className="size-12 text-emerald-300" />
          <h1 className="mt-5 text-2xl font-bold text-slate-100">
            You&apos;re confirmed!
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            Your alerts are now active. Sit back — we&apos;ll email you when
            something worth looking at is coming your way.
          </p>
        </>
      ) : (
        <>
          <MailQuestion className="size-12 text-amber-300" />
          <h1 className="mt-5 text-2xl font-bold text-slate-100">
            That link didn&apos;t work
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            This confirmation link is invalid or has already been used. Try
            subscribing again to get a fresh one.
          </p>
        </>
      )}

      <Link
        href="/"
        className="mt-8 inline-flex items-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-6 py-3 text-sm font-semibold text-cyan-200 transition hover:border-cyan-300/70 hover:bg-cyan-400/20"
      >
        Back to tonight&apos;s sky
      </Link>
    </main>
  );
}
