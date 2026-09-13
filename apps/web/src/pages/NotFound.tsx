import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui";
import { EmptyState } from "@/components/common";

export function NotFound() {
  return (
    <EmptyState
      icon={Compass}
      title="Page not found"
      description="That page isn't part of your vault."
      action={
        <Link to="/">
          <Button variant="primary">Back home</Button>
        </Link>
      }
    />
  );
}
