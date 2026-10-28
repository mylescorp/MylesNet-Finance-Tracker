import ConvexClientProvider from "@/components/ConvexClientProvider";
import PwaAuthStateReporter from "@/components/PwaAuthStateReporter";
import { AppShell } from "@/components/AppShell";
import { ReactNode } from "react";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <ConvexClientProvider><PwaAuthStateReporter /><AppShell>{children}</AppShell></ConvexClientProvider>;
}
