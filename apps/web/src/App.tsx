import { healthResponseSchema, type HealthResponse } from "@podcraft/shared";

const sampleHealthResponse: HealthResponse = {
  status: "ok"
};

const parsedHealthResponse = healthResponseSchema.parse(sampleHealthResponse);

export function App() {
  return (
    <main className="app-shell">
      <section className="card">
        <h1>PodCraft</h1>
        <p>Monorepo bootstrap completed.</p>
        <p>Shared contract status: {parsedHealthResponse.status}</p>
      </section>
    </main>
  );
}
