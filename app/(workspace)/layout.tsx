import ConvexClientProvider from "@/components/ConvexClientProvider";
import { AppShell } from "@/components/AppShell";
import { ReactNode } from "react";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <ConvexClientProvider><AppShell>{children}</AppShell></ConvexClientProvider>;
}
