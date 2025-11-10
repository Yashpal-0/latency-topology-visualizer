// Home route simply mounts the latency visualiser. Keeping this file lean avoids client bundle churn.
import ExchangeMap from "@/components/ExchangeMap";

export default function Home() {
  // The entire experience lives inside the ExchangeMap component.
  return (
    <main className="min-h-screen w-full bg-slate-950 text-slate-100">
      <ExchangeMap />
    </main>
  );
}
