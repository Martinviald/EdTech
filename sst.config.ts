/// <reference path="./.sst/platform/config.d.ts" />

/**
 * Infraestructura AWS de EdTech — Nivel 1 (dev, optimizado para costo).
 *
 *   Frontend (Next.js)  -> CloudFront + Lambda (OpenNext)
 *   Backend  (NestJS)   -> ECS Fargate (ARM, 0.25 vCPU / 0.5 GB) tras ALB público
 *   BDD      (Postgres) -> RDS t4g.micro Single-AZ
 *   Archivos            -> S3
 *
 * Todo se despliega por CLI: `npx sst deploy --stage dev`.
 * Ver el runbook completo en docs/deploy/aws-sst-nivel1.md.
 *
 * Optimizaciones de costo (Nivel 1):
 *   - nat: "ec2"  -> fck-nat en t4g.nano (~$3-4/mes) en vez del NAT gestionado (~$32/mes).
 *   - Fargate ARM mínimo + RDS t4g.micro Single-AZ + sin Multi-AZ.
 *   - removal "remove" en stages no-prod -> `sst remove` borra todo sin residuos.
 */
export default $config({
  app(input) {
    return {
      name: "edtech",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: input?.stage === "production",
      home: "aws",
      providers: { aws: { region: "us-east-1" } },
    };
  },

  async run() {
    // ── Secretos (set con: npx sst secret set <Nombre> <valor> --stage <stage>) ──
    // AuthSecret == NEXTAUTH_SECRET == AUTH_SECRET: DEBE ser idéntico en web y api.
    const authSecret = new sst.Secret("AuthSecret");
    const internalApiSecret = new sst.Secret("InternalApiSecret");
    // Password del rol RLS soe_app (runtime de la API, sin BYPASSRLS).
    const soeAppPassword = new sst.Secret("SoeAppPassword");
    // Password del master user del RDS (rol admin: DDL, migrate, seed).
    const dbMasterPassword = new sst.Secret("DbMasterPassword");
    // LLM (etiquetado IA de ítems). Default gemini; setear la key del proveedor activo.
    const llmProvider = new sst.Secret("LlmProvider", "gemini");
    const geminiApiKey = new sst.Secret("GeminiApiKey", "");
    const anthropicApiKey = new sst.Secret("AnthropicApiKey", "");
    // Auth: 'mock' (dropdown del seed, ideal para la primera demo) | 'sso' (Google/MS reales).
    const authMode = new sst.Secret("AuthMode", "mock");
    const googleClientId = new sst.Secret("GoogleClientId", "");
    const googleClientSecret = new sst.Secret("GoogleClientSecret", "");

    // ── Red: VPC con NAT barato (fck-nat) + bastion para `sst tunnel` ──
    // El bastion (t4g.nano, ~$3/mes) permite correr migrate/roles desde el laptop
    // contra el RDS privado. Se puede quitar una vez que la BD está provisionada.
    const vpc = new sst.aws.Vpc("Vpc", {
      nat: "ec2",
      bastion: true,
    });

    // ── BDD: RDS Postgres t4g.micro Single-AZ ──
    // El master user (soe_admin) es el rol ADMIN -> DATABASE_ADMIN_URL.
    const db = new sst.aws.Postgres("Db", {
      vpc,
      instance: "t4g.micro",
      version: "17",
      storage: "20 GB",
      multiAz: false,
      database: "soe",
      username: "soe_admin",
      password: dbMasterPassword.value,
    });

    // ADMIN: master user, bypassa RLS -> migrate/seed.
    const databaseAdminUrl = $interpolate`postgresql://${db.username}:${db.password}@${db.host}:${db.port}/${db.database}`;
    // APP: rol soe_app, sin BYPASSRLS -> runtime de la API (sujeto a RLS).
    // El rol soe_app se crea post-deploy con `pnpm --filter @soe/db db:provision-roles`.
    const databaseAppUrl = $interpolate`postgresql://soe_app:${soeAppPassword.value}@${db.host}:${db.port}/${db.database}`;

    // ── Almacenamiento: S3 para hojas de respuesta (presigned URLs) ──
    const uploads = new sst.aws.Bucket("Uploads");

    // ── Cluster ECS para el backend ──
    const cluster = new sst.aws.Cluster("Cluster", { vpc });

    // ── Backend NestJS en Fargate (ARM, mínimo) ──
    const api = new sst.aws.Service("Api", {
      cluster,
      cpu: "0.25 vCPU",
      memory: "0.5 GB",
      architecture: "arm64",
      image: { context: ".", dockerfile: "apps/api/Dockerfile" },
      link: [uploads],
      environment: {
        NODE_ENV: "production",
        API_PORT: "4000",
        DATABASE_URL: databaseAppUrl, // soe_app -> RLS activo (regla §5.2 / §11)
        DATABASE_ADMIN_URL: databaseAdminUrl, // solo fallback; runtime NO lo usa
        AUTH_SECRET: authSecret.value,
        INTERNAL_API_SECRET: internalApiSecret.value,
        LLM_PROVIDER: llmProvider.value,
        GEMINI_API_KEY: geminiApiKey.value,
        ANTHROPIC_API_KEY: anthropicApiKey.value,
        AWS_S3_BUCKET: uploads.name,
        // Las llamadas web->api son server-side (Lambda OpenNext -> ALB), CORS no aplica.
        // Si agregas llamadas desde el browser, usa un dominio propio y setea CORS_ORIGIN.
        CORS_ORIGIN: "*",
      },
      loadBalancer: {
        public: true,
        rules: [{ listen: "80/http", forward: "4000/http" }],
      },
    });

    // ── Frontend Next.js en CloudFront + Lambda (OpenNext) ──
    const web = new sst.aws.Nextjs("Web", {
      path: "apps/web",
      link: [uploads],
      server: { architecture: "arm64" },
      environment: {
        API_URL: api.url, // fetch server-side desde Next -> ALB del API
        AUTH_SECRET: authSecret.value, // DEBE == AUTH_SECRET del API
        AUTH_TRUST_HOST: "true", // next-auth v5 infiere host -> evita fijar NEXTAUTH_URL
        INTERNAL_API_SECRET: internalApiSecret.value,
        AUTH_MODE: authMode.value,
        GOOGLE_CLIENT_ID: googleClientId.value,
        GOOGLE_CLIENT_SECRET: googleClientSecret.value,
      },
    });

    return {
      web: web.url,
      api: api.url,
      dbHost: db.host,
      bucket: uploads.name,
    };
  },
});
