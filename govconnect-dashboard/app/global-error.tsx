"use client"

export const dynamic = "force-dynamic"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="id">
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
          <h1 className="text-2xl font-bold">Terjadi kesalahan</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Halaman mengalami gangguan. Silakan coba muat ulang atau kembali beberapa saat lagi.
          </p>
          {error?.digest ? <p className="text-xs text-muted-foreground">Ref: {error.digest}</p> : null}
          <button
            onClick={() => reset()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Coba lagi
          </button>
        </div>
      </body>
    </html>
  )
}
