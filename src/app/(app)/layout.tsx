import { Sidebar } from "@/components/Sidebar";
import { AppGate } from "@/components/AppGate";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppGate>
      <div className="min-h-screen lg:pl-72">
        <Sidebar />
        <main className="px-4 pt-20 pb-6 sm:px-6 lg:px-8 lg:pt-8 lg:pb-8">
          {children}
        </main>
      </div>
    </AppGate>
  );
}
