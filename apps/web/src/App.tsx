import { useEffect, useState } from "react";
import DroneSimulation from "./components/DroneSimulation";
import { Activity, ArrowUpRight, Bot, Boxes, Cloud, ShieldCheck } from "lucide-react";

type HealthResponse = {
  status: string;
  service: string;
  environment: string;
  timestamp: string;
};

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`API returned HTTP ${response.status}`);
        return (await response.json()) as HealthResponse;
      })
      .then(setHealth)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setHealthError(error instanceof Error ? error.message : "API unavailable");
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="AeroMind home">
          <span className="brand-mark"><Activity size={19} /></span>
          <span>AEROMIND</span><span className="version">ENGINEERING PREVIEW</span>
        </a>
        <div className="topbar-right"><span className="status-dot" />Prototype foundation</div>
      </header>

      <section className="hero">
        <div className="eyebrow"><span /> NEURO-SYMBOLIC DISASTER RESPONSE</div>
        <h1>Gemini proposes.<br /><em>Geometry verifies.</em></h1>
        <p className="hero-copy">
          A simulation and validation environment for AI-planned search-and-rescue missions.
          Gemini proposes mission decisions; deterministic software checks spatial and resource
          constraints before simulated execution.
        </p>
        <div className="principle"><ShieldCheck size={18} />
          No simulated movement without a current verification approval.
        </div>
      </section>

      <DroneSimulation />

      <section className="grid" aria-label="System layers">
        <article className="panel">
          <div className="icon"><Bot /></div><div className="panel-kicker">01 / MISSION INTELLIGENCE</div>
          <h2>Gemini planner</h2>
          <p>Interprets natural-language objectives and returns a structured mission proposal.</p>
          <span className="tag planned">Integration planned</span>
        </article>
        <article className="panel">
          <div className="icon"><Boxes /></div><div className="panel-kicker">02 / DETERMINISTIC ENGINE</div>
          <h2>Spatial verifier</h2>
          <p>Resolves graph routes and checks obstacle clearance, geofences and energy feasibility.</p>
          <span className="tag planned">Core engine planned</span>
        </article>
        <article className="panel">
          <div className="icon"><Cloud /></div><div className="panel-kicker">03 / DELIVERY</div>
          <h2>Cloud Run</h2>
          <p>One deployable web service with server-side Gemini credentials and live application events.</p>
          <span className="tag ready">API scaffold available</span>
        </article>
      </section>

      <section className="runtime panel">
        <div><div className="panel-kicker">RUNTIME CONNECTIVITY</div><h2>Backend health</h2>
          <p className="runtime-copy">{health
            ? `Connected to ${health.service} · ${health.environment}`
            : healthError ? `API not reachable: ${healthError}` : "Checking API health…"}</p>
        </div>
        <div className={health ? "health-pill healthy" : healthError ? "health-pill offline" : "health-pill checking"}>
          <span className="status-dot" />{health ? "API online" : healthError ? "Offline" : "Checking"}
        </div>
      </section>

      <footer>
        <span>AEROMIND / OPEN INNOVATION · AI FOR INDIA</span>
        <a href="https://github.com/PavanSiddapuram/aeromind" target="_blank" rel="noreferrer">
          Source repository <ArrowUpRight size={14} />
        </a>
      </footer>
      <p className="disclaimer">Simulation-only research prototype. Not a certified flight controller. No connection to physical aircraft.</p>
    </main>
  );
}