import { Link } from "wouter";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center p-4 text-center bg-background">
      <div className="bg-muted p-4 rounded-full mb-6 text-primary">
        <FileQuestion className="h-12 w-12" />
      </div>
      <h1 className="text-4xl font-bold tracking-tight mb-2">Page Not Found</h1>
      <p className="text-muted-foreground max-w-md mb-8 text-lg">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Link href="/">
        <Button size="lg">Return to Dashboard</Button>
      </Link>
    </div>
  );
}
