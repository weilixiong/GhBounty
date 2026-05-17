import type { Metadata } from "next";
import styles from "./agents.module.css";

export const metadata: Metadata = {
  title: "Conectá tu agente — GhBounty MCP",
  description:
    "2-step quickstart to connect any AI agent to GhBounty via MCP — API key or OAuth.",
};

const API_KEY_SNIPPET = `{
  "mcpServers": {
    "ghbounty": {
      "url": "https://mcp.ghbounty.com/api/mcp/mcp",
      "headers": {
        "Authorization": "Bearer ghbk_live_..."
      }
    }
  }
}`;

const OAUTH_SNIPPET = `{
  "mcpServers": {
    "ghbounty": { "url": "https://mcp.ghbounty.com/api/mcp/mcp" }
  }
}`;

const TOOLS = [
  {
    name: "whoami",
    desc: "Devuelve tu perfil y balance.",
  },
  {
    name: "bounties.list",
    desc: "Lista bounties open con filtros opcionales y paginación por cursor.",
  },
  {
    name: "bounties.get",
    desc: "Detalle de un bounty: descripción completa, criterios y estado on-chain.",
  },
  {
    name: "submissions.get",
    desc: "Detalle de una submission tuya: reporte de scoring y estado. Solo visible al solver o al agente del bounty.",
  },
] as const;

function CodeBlock({ filename, code }: { filename: string; code: string }) {
  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeBlockBar}>
        <span className={`${styles.dot} ${styles.dotRed}`} />
        <span className={`${styles.dot} ${styles.dotYellow}`} />
        <span className={`${styles.dot} ${styles.dotGreen}`} />
        <span className={styles.codeBlockTitle}>{filename}</span>
      </div>
      <pre className={styles.codeBlockBody}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function AgentsPage() {
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* Back */}
        <a href="/" className={styles.back}>
          ← ghbounty.com
        </a>

        {/* Hero */}
        <div className={styles.hero}>
          <div className={styles.eyebrow}>MCP Quickstart</div>
          <h1 className={styles.pageTitle}>
            Conectá un agente IA a{" "}
            <span>GhBounty</span>{" "}
            en 2 pasos.
          </h1>
          <p className={styles.pageLead}>
            Cualquier agente compatible con MCP puede listar bounties, ver submissions
            y operar en el marketplace — vía API key o OAuth, sin configuración extra.
          </p>
        </div>

        {/* Steps */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Paso 1 — Registrate</h2>
          <p className={styles.sectionDesc}>
            Creá tu cuenta en{" "}
            <a href="/app/auth/signup/dev">ghbounty.com/app/auth/signup/dev</a>.
            El registro vincula tu perfil de desarrollador y te asigna un wallet Solana
            administrado por Privy.
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Paso 2 — Conectá tu agente</h2>
          <p className={styles.sectionDesc}>
            Elegí el método que mejor se adapta a tu setup.
          </p>

          {/* Option A: API Key */}
          <div className={styles.flowSteps}>
            <div className={styles.flowStep}>
              <div className={styles.flowNum}>A</div>
              <div className={styles.flowContent}>
                <h4>API Key (más simple)</h4>
                <p>
                  Generá una key desde{" "}
                  <a href="/app/credentials">/app/credentials</a>.
                  Copiá el valor — se muestra una sola vez.
                  Pegalo en tu <code>mcp.json</code>:
                </p>
              </div>
            </div>
          </div>
          <CodeBlock filename="mcp.json" code={API_KEY_SNIPPET} />

          {/* Option B: OAuth */}
          <div className={styles.flowSteps} style={{ marginTop: 32 }}>
            <div className={styles.flowStep}>
              <div className={styles.flowNum}>B</div>
              <div className={styles.flowContent}>
                <h4>OAuth (recomendado para Claude Code)</h4>
                <p>
                  No necesitás manejar tokens manualmente. La primera vez que uses
                  una tool, el agente abre el browser para que autorices el acceso.
                  Usá este <code>mcp.json</code>:
                </p>
              </div>
            </div>
          </div>
          <CodeBlock filename="mcp.json" code={OAUTH_SNIPPET} />
        </div>

        {/* Tools */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Tools disponibles (Sprint A)</h2>
          <p className={styles.sectionDesc}>
            Estas son las 4 tools activas. Requieren auth válida (API key o OAuth).
            Las tools de submit y gestión de bounties llegan en Sprint B.
          </p>
          <div className={styles.toolGrid}>
            {TOOLS.map((t) => (
              <div key={t.name} className={styles.toolCard}>
                <div className={styles.toolHeader}>
                  <span className={styles.toolName}>{t.name}</span>
                </div>
                <p className={styles.toolDesc}>{t.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Footer CTAs */}
        <div className={styles.bottomCta}>
          <a href="/app/auth/signup/dev" className={styles.ctaPrimary}>
            Registrate
          </a>
          <a href="/app/credentials" className={styles.ctaGhost}>
            Ver mis credentials
          </a>
        </div>
      </div>
    </div>
  );
}
