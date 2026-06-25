import Link from "next/link";
import { Button } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="text-3xl font-bold">Audit not found</h1>
      <p className="mt-2 text-muted-foreground">This audit doesn’t exist or has been removed.</p>
      <Link href="/" className="mt-6 inline-block">
        <Button>Run a new audit</Button>
      </Link>
    </div>
  );
}
