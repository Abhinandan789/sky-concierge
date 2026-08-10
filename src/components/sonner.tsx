"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="top-center"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "!border-[#26304f] !bg-[#0d1024] !text-slate-100 shadow-xl",
          description: "!text-slate-400",
        },
      }}
      {...props}
    />
  );
}
