"use client";

import { useRouter } from "next/navigation";
import { type ComponentPropsWithoutRef, type FormEvent, useState } from "react";

type RefreshingActionResult = void | {
  success?: boolean;
  ok?: boolean;
  message?: string;
};

type RefreshingAction = (formData: FormData) => Promise<RefreshingActionResult> | RefreshingActionResult;

type RefreshingActionFormProps = Omit<ComponentPropsWithoutRef<"form">, "action" | "onSubmit"> & {
  action: RefreshingAction;
  confirmMessage?: string;
};

export function RefreshingActionForm({
  action,
  children,
  confirmMessage,
  className,
  ...formProps
}: RefreshingActionFormProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const form = event.currentTarget;
    if (confirmMessage && !window.confirm(confirmMessage)) return;

    setPending(true);
    setError(null);
    try {
      const result = await action(new FormData(form));
      if (isFailedActionResult(result)) {
        setError(result.message || "Action failed. Refresh and try again.");
        return;
      }
      router.refresh();
      window.location.reload();
    } catch (caught) {
      if (isNextRedirectError(caught)) throw caught;
      setError(caught instanceof Error ? caught.message : "Action failed. Refresh and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form {...formProps} className={className} onSubmit={onSubmit} aria-busy={pending}>
      {children}
      {error ? <p className="mt-2 text-xs text-red-700" role="alert">{error}</p> : null}
    </form>
  );
}

function isFailedActionResult(result: RefreshingActionResult): result is { message?: string } {
  if (typeof result !== "object" || result === null) return false;
  if ("success" in result && result.success === false) return true;
  if ("ok" in result && result.ok === false) return true;
  return false;
}

function isNextRedirectError(error: unknown) {
  if (typeof error !== "object" || error === null || !("digest" in error)) return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}
