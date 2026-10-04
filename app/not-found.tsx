import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold">We couldn&apos;t find that page</h1>
      <p className="max-w-md text-muted-foreground">It may have been moved, or you may not have access to it.</p>
      <Button asChild>
        <Link href="/">Go to my home page</Link>
      </Button>
    </div>
  );
}
