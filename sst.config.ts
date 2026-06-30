/// <reference path="./.sst/platform/config.d.ts" />

/**
 * Infraestructura AWS de EdTech (dev, optimizado para costo).
 *
 *   Frontend (Next.js)  -> CloudFront + Lambda (OpenNext)        [sst.aws.Nextjs]
 *   Backend  (NestJS)   -> App Runner desde imagen en ECR        [aws.apprunner.* crudo]
 *   BDD      (Postgres) -> RDS t4g.micro Single-AZ               [sst.aws.Postgres]
 *   Archivos            -> S3                                     [sst.aws.Bucket]
 *
 * App Runner mata el ALB de Fargate (~$16/mes) y trae su propio HTTPS. Llega al RDS
 * privado por un VPC connector; en runtime la demo F1 (dashboards) no necesita salir
 * a internet, así que la VPC NO lleva NAT. Costo idle ~$22-26/mes.
 *
 * ── Deploy en DOS fases (App Runner exige la imagen en ECR antes de crearse) ──
 *   Fase 1:  npx sst deploy --stage production
 *            -> VPC, RDS, S3, ECR, roles IAM, VPC connector. (sin App Runner ni front)
 *   (build + push de la imagen del backend a ECR; provisionar BDD con tunnel)
 *   Fase 2:  SST_BACKEND_READY=1 npx sst deploy --stage production
 *            -> App Runner + frontend (con API_URL real).
 *
 * Luego el CI/CD mantiene todo: push a main -> el backend rebuildea la imagen a ECR
 * (App Runner auto-deploya) y el frontend corre `sst deploy`.
 * Runbook completo: docs/deploy/aws-sst-nivel1.md
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
    // Gate de la fase 2: App Runner + front solo se crean con la imagen ya en ECR.
    const backendReady = process.env.SST_BACKEND_READY === "1";

    // ── Secretos (set con: npx sst secret set <Nombre> <valor> --stage <stage>) ──
    const authSecret = new sst.Secret("AuthSecret"); // == NEXTAUTH_SECRET, idéntico en web y api
    const internalApiSecret = new sst.Secret("InternalApiSecret");
    const soeAppPassword = new sst.Secret("SoeAppPassword"); // rol RLS soe_app (runtime API)
    const dbMasterPassword = new sst.Secret("DbMasterPassword"); // master RDS (admin: migrate/seed)
    const llmProvider = new sst.Secret("LlmProvider", "gemini");
    const geminiApiKey = new sst.Secret("GeminiApiKey", "");
    const anthropicApiKey = new sst.Secret("AnthropicApiKey", "");
    const authMode = new sst.Secret("AuthMode", "mock"); // 'mock' (demo) | 'sso'
    const googleClientId = new sst.Secret("GoogleClientId", "");
    const googleClientSecret = new sst.Secret("GoogleClientSecret", "");

    // ── Red: VPC con bastion (para `sst tunnel`). SIN NAT. ──
    const vpc = new sst.aws.Vpc("Vpc", { bastion: true });

    // ── BDD: RDS Postgres t4g.micro Single-AZ ──
    // master user (soe_admin) = rol ADMIN -> DATABASE_ADMIN_URL (migrate/seed, desde laptop/CI).
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
    // APP: rol soe_app (sin BYPASSRLS) -> runtime de la API, sujeto a RLS (§5.2).
    // soe_app se crea post-deploy con `pnpm --filter @soe/db db:provision-roles`.
    const databaseAppUrl = $interpolate`postgresql://soe_app:${soeAppPassword.value}@${db.host}:${db.port}/${db.database}`;

    // ── S3 para hojas de respuesta (presigned URLs) ──
    const uploads = new sst.aws.Bucket("Uploads");

    // ── ECR: repo de la imagen del backend (nombre explícito, lo usa el CI) ──
    const apiRepo = new aws.ecr.Repository("ApiRepo", {
      name: `edtech-api-${$app.stage}`,
      forceDelete: true, // permite `sst remove` aunque haya imágenes
      imageScanningConfiguration: { scanOnPush: true },
    });

    // ── IAM: rol de acceso a ECR (pull) ──
    const accessRole = new aws.iam.Role("ApiEcrAccessRole", {
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: "build.apprunner.amazonaws.com" },
            Action: "sts:AssumeRole",
          },
        ],
      }),
    });
    new aws.iam.RolePolicyAttachment("ApiEcrAccessAttach", {
      role: accessRole.name,
      policyArn:
        "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess",
    });

    // ── IAM: rol de instancia (la API firma presigned URLs de S3) ──
    const instanceRole = new aws.iam.Role("ApiInstanceRole", {
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: "tasks.apprunner.amazonaws.com" },
            Action: "sts:AssumeRole",
          },
        ],
      }),
    });
    new aws.iam.RolePolicy("ApiInstanceS3Policy", {
      role: instanceRole.id,
      policy: $interpolate`{
        "Version": "2012-10-17",
        "Statement": [{
          "Effect": "Allow",
          "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
          "Resource": "${uploads.arn}/*"
        }]
      }`,
    });

    // ── VPC connector: App Runner -> RDS (subredes privadas + SG de la VPC) ──
    // NOTA: usa el SG por defecto de la VPC, que el RDS de SST acepta como inbound.
    // Si la API no logra conectar al RDS, agregar un ingress 5432 desde este SG.
    const vpcConnector = new aws.apprunner.VpcConnector("ApiVpcConnector", {
      vpcConnectorName: `edtech-api-${$app.stage}`,
      subnets: vpc.privateSubnets,
      securityGroups: vpc.securityGroups,
    });

    // ── Fase 1: solo infra base. App Runner + front se crean en la fase 2. ──
    if (!backendReady) {
      return {
        phase: "1 — infra base lista",
        ecrRepo: apiRepo.repositoryUrl,
        dbHost: db.host,
        bucket: uploads.name,
        next: "Push imagen a ECR + provisionar BDD, luego: SST_BACKEND_READY=1 sst deploy",
      };
    }

    // ── Backend: App Runner desde la imagen :latest en ECR ──
    const api = new aws.apprunner.Service("Api", {
      serviceName: `edtech-api-${$app.stage}`,
      sourceConfiguration: {
        autoDeploymentsEnabled: true, // el CI pushea :latest -> redeploy automático
        authenticationConfiguration: { accessRoleArn: accessRole.arn },
        imageRepository: {
          imageRepositoryType: "ECR",
          imageIdentifier: $interpolate`${apiRepo.repositoryUrl}:latest`,
          imageConfiguration: {
            port: "4000",
            runtimeEnvironmentVariables: {
              NODE_ENV: "production",
              API_PORT: "4000",
              // soe_app -> RLS activo (§11). El admin NO va al runtime (least privilege).
              DATABASE_URL: databaseAppUrl,
              AUTH_SECRET: authSecret.value,
              INTERNAL_API_SECRET: internalApiSecret.value,
              LLM_PROVIDER: llmProvider.value,
              GEMINI_API_KEY: geminiApiKey.value,
              ANTHROPIC_API_KEY: anthropicApiKey.value,
              AWS_S3_BUCKET: uploads.name,
              // web->api es server-side (Lambda OpenNext -> App Runner), CORS no aplica.
              CORS_ORIGIN: "*",
            },
          },
        },
      },
      instanceConfiguration: {
        cpu: "0.25 vCPU",
        memory: "0.5 GB",
        instanceRoleArn: instanceRole.arn,
      },
      networkConfiguration: {
        egressConfiguration: { egressType: "VPC", vpcConnectorArn: vpcConnector.arn },
      },
    });

    const apiUrl = $interpolate`https://${api.serviceUrl}`;

    // ── Frontend: Next.js en CloudFront + Lambda (OpenNext) ──
    const web = new sst.aws.Nextjs("Web", {
      path: "apps/web",
      link: [uploads],
      server: { architecture: "arm64" },
      environment: {
        API_URL: apiUrl, // fetch server-side desde Next -> App Runner
        AUTH_SECRET: authSecret.value, // DEBE == AUTH_SECRET del API
        AUTH_TRUST_HOST: "true", // next-auth v5 infiere host -> evita NEXTAUTH_URL
        INTERNAL_API_SECRET: internalApiSecret.value,
        AUTH_MODE: authMode.value,
        GOOGLE_CLIENT_ID: googleClientId.value,
        GOOGLE_CLIENT_SECRET: googleClientSecret.value,
      },
    });

    return {
      phase: "2 — completa",
      web: web.url,
      api: apiUrl,
      ecrRepo: apiRepo.repositoryUrl,
      dbHost: db.host,
      bucket: uploads.name,
    };
  },
});
