"use client";

export default function ErrorPage({
  error
}: {
  error: Error & { digest?: string };
}) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      Something went wrong: {error.message}
    </div>
  );
}

