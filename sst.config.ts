/// <reference path="./.sst/platform/config.d.ts" />

/**
 * Infraestructura AWS de EdTech (dev, optimizado para costo).
 *
 *   Frontend (Next.js)  -> CloudFront + Lambda (OpenNext)        [sst.aws.Nextjs]
 *   Backend  (NestJS)   -> App Runner desde imagen en ECR        [aws.apprunner.* crudo]
 *   Visión OMR (E22)    -> App Runner desde imagen en ECR        [aws.apprunner.* crudo]
 *   BDD      (Postgres) -> RDS t4g.micro Single-AZ               [sst.aws.Postgres]
 *   Archivos            -> S3                                     [sst.aws.Bucket]
 *
 * App Runner mata el ALB de Fargate (~$16/mes) y trae su propio HTTPS. Llega al RDS
 * privado por un VPC connector; en runtime la demo F1 (dashboards) no necesita salir
 * a internet, así que la VPC NO lleva NAT. Costo idle ~$22-26/mes.
 *
 * ── Deploy: `sst deploy` a secas es COMPLETO y seguro (App Runner + front + todo). ──
 * Solo el BOOTSTRAP inicial de un stage nuevo usa un flag, porque App Runner exige la
 * imagen ya en ECR para poder crearse:
 *   Bootstrap (stage nuevo, 1 sola vez):
 *     SST_BOOTSTRAP=1 npx sst deploy --stage production
 *            -> solo infra base: VPC, RDS, S3, ECR (api + omr), roles IAM, VPC connector
 *               (sin App Runner ni front)
 *   (build + push de LAS DOS imágenes a ECR — backend y OMR; provisionar BDD con tunnel)
 *   Deploy normal (default, siempre después):
 *     npx sst deploy --stage production
 *            -> App Runner (api + omr) + frontend (con API_URL real) + reconcilia el resto.
 *
 * ⚠️ Son DOS imágenes, no una. Los dos servicios de App Runner se crean apuntando a
 * `:latest` en su ECR, y App Runner exige que la imagen ya exista para poder crearse:
 * si sólo se pushea la del backend, el servicio Omr falla con CREATE_FAILED. El
 * workflow .github/workflows/deploy-omr.yml publica la del OMR (y sabe hacerlo a mano
 * con workflow_dispatch, que es como se resuelve el huevo y la gallina del bootstrap).
 *
 * ⚠️ NO hay un `sst deploy` "destructivo": sin flag deploya TODO. El flag es el que hace el
 * deploy PARCIAL (solo base) y es solo para arrancar un stage nuevo. (Antes era al revés:
 * `sst deploy` sin flag borraba App Runner + front — footgun que tiró abajo demo una vez.)
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
    // Gate de bootstrap: por default `sst deploy` crea TODO (App Runner + front). Solo el
    // arranque de un stage nuevo usa SST_BOOTSTRAP=1 para crear la infra base primero,
    // porque App Runner exige la imagen ya en ECR para poder crearse.
    const bootstrapOnly = process.env.SST_BOOTSTRAP === "1";

    // ── Secretos (set con: npx sst secret set <Nombre> <valor> --stage <stage>) ──
    const authSecret = new sst.Secret("AuthSecret"); // == NEXTAUTH_SECRET, idéntico en web y api
    const internalApiSecret = new sst.Secret("InternalApiSecret");
    const omrServiceToken = new sst.Secret("OmrServiceToken"); // header X-OMR-Token backend→servicio OMR
    const soeAppPassword = new sst.Secret("SoeAppPassword"); // rol RLS soe_app (runtime API)
    const dbMasterPassword = new sst.Secret("DbMasterPassword"); // master RDS (admin: migrate/seed)
    const llmProvider = new sst.Secret("LlmProvider", "gemini");
    const geminiApiKey = new sst.Secret("GeminiApiKey", "");
    const anthropicApiKey = new sst.Secret("AnthropicApiKey", "");
    const authMode = new sst.Secret("AuthMode", "mock"); // 'mock' (demo) | 'sso'
    const googleClientId = new sst.Secret("GoogleClientId", "");
    const googleClientSecret = new sst.Secret("GoogleClientSecret", "");

    // ── Servidor MCP analítico (docs/propuesta-mcp-analitico.md) ──
    // Defaults seguros: con McpEnabled="false" el endpoint /mcp responde 404 (apagado).
    // Encender = setear los 4 secrets (WorkOS + URI canónica) y McpEnabled="true", luego redeploy.
    const mcpEnabled = new sst.Secret("McpEnabled", "false");
    const mcpCanonicalUri = new sst.Secret("McpCanonicalUri", ""); // https://<api>/mcp (== resource indicator en WorkOS)
    const workosIssuer = new sst.Secret("WorkosIssuer", ""); // AuthKit issuer
    const workosJwksUrl = new sst.Secret("WorkosJwksUrl", ""); // jwks_uri del issuer

    // ── Red: VPC con bastion (para `sst tunnel`) + NAT ec2 (fck-nat, ~$3-4/mes). ──
    // El NAT da salida a internet a las subredes privadas. App Runner enruta TODO su
    // egress por la VPC (lo necesita para el RDS privado); el asistente E21 llama a la
    // API de Gemini en runtime → sin NAT esas llamadas mueren con `fetch failed`.
    const vpc = new sst.aws.Vpc("Vpc", { bastion: true, nat: "ec2" });

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
    // `cors: false` desactiva la regla que gestiona el componente (su default es
    // `allowOrigins: ["*"]`). El CORS real se declara más abajo, después de `web`, para
    // poder acotarlo al origen del frontend: ver el bloque "CORS del bucket".
    const uploads = new sst.aws.Bucket("Uploads", { cors: false });

    // ── ECR: repo de la imagen del backend (nombre explícito, lo usa el CI) ──
    const apiRepo = new aws.ecr.Repository("ApiRepo", {
      name: `edtech-api-${$app.stage}`,
      forceDelete: true, // permite `sst remove` aunque haya imágenes
      imageScanningConfiguration: { scanOnPush: true },
    });

    // ── ECR: repo de la imagen del servicio de visión OMR (services/omr) ──
    // Dockerfile listo en services/omr/ (uvicorn, puerto 8090). Igual que el
    // backend: la imagen se buildea/pushea fuera de SST antes de la fase 2.
    const omrRepo = new aws.ecr.Repository("OmrRepo", {
      name: `edtech-omr-${$app.stage}`,
      forceDelete: true,
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

    // ── Bootstrap (SST_BOOTSTRAP=1): solo infra base. Sin el flag se crea TODO. ──
    if (bootstrapOnly) {
      return {
        phase: "bootstrap — infra base lista",
        ecrRepo: apiRepo.repositoryUrl,
        ecrOmrRepo: omrRepo.repositoryUrl,
        dbHost: db.host,
        bucket: uploads.name,
        next: "Push imágenes (api + omr) a ECR + provisionar BDD, luego (sin flag): npx sst deploy",
      };
    }

    // ── Servicio de visión OMR: App Runner desde la imagen :latest en ECR ──
    // Stateless y sin BDD ni credenciales: recibe LayoutSpec + imagen, devuelve
    // marcas (E22). No necesita egress a la VPC ni rol de instancia — sí ingress
    // privado (ver más abajo).
    //
    // ── Presupuestos de tiempo (los tres tienen que ser coherentes) ──
    // Medido por página: peor caso ~1,3 s, y una página que entra al camino de
    // reintento paga 420-500 ms típicos (peor caso medido 1258 ms) → ~2,6 s de
    // techo por página en la máquina de desarrollo.
    //
    // El backend manda UN archivo fuente por llamada, y un PDF de curso son ~30
    // páginas: una sola request puede cargar las 30 (apps/api/.../sheet-scan.service.ts
    // no parte el PDF en tandas).
    //
    //   servicio (OMR_PAGE_TIMEOUT_S): 8 s por página, contra el default 20 s del
    //     código. 20 s era un presupuesto pensado para una página suelta y acá es
    //     peligroso: una página que se cuelga se come 20 s del presupuesto TOTAL del
    //     cliente, así que con 6 páginas colgadas se cae el lote entero. Con 8 s
    //     entran 13. Y 8 s sigue siendo ~3x el techo medido (2,6 s), margen de sobra
    //     para que el vCPU de App Runner (más lento que la laptop) no haga que una
    //     página SANA se pase — importante porque una página que se pasa NO falla:
    //     se omite del ScanResult en silencio (pipeline.py), que es la peor falla
    //     posible acá.
    //   cliente (OMR_READ_TIMEOUT_S): 110 s. Hasta ahora no se inyectaba y quedaba en
    //     el default 120 s del código; se baja apenas para que el que corte sea el
    //     cliente, con su error tipado, y no el borde de App Runner con un corte opaco.
    //
    // ⚠️ DEUDA CONOCIDA: 30 páginas x 8 s = 240 s de peor caso teórico, por encima de
    // los 110 s del cliente. El lote típico (~30 x 2 s ≈ 60 s) entra cómodo, pero el
    // arreglo estructural es que el backend parta el PDF en tandas de ~10 páginas y
    // persista por tanda; hoy si el cliente corta se pierde TODO el lote, porque
    // persistPage recién corre cuando read() resuelve. Fuera del alcance de esta PR.
    const omrPageTimeoutS = "8";
    const omrReadTimeoutS = "110";

    // Escalado: por default App Runner manda hasta 100 requests concurrentes a la MISMA
    // instancia. Acá cada request es CPU-bound sobre 1 vCPU y procesa las páginas en
    // serie, así que apilar requests en una instancia sólo las encola hasta que todas
    // se pasan de tiempo. maxConcurrency: 1 hace que App Runner escale a lo ANCHO
    // (instancia nueva) en vez de encolar.
    const omrScaling = new aws.apprunner.AutoScalingConfigurationVersion("OmrScaling", {
      autoScalingConfigurationName: `edtech-omr-${$app.stage}`,
      maxConcurrency: 1,
      minSize: 1, // 1 instancia caliente: el arranque carga OpenCV, no conviene pagarlo por lote
      maxSize: 4, // techo de costo; 4 lotes de curso en paralelo
    });

    const omr = new aws.apprunner.Service("Omr", {
      serviceName: `edtech-omr-${$app.stage}`,
      autoScalingConfigurationArn: omrScaling.arn,
      sourceConfiguration: {
        autoDeploymentsEnabled: true,
        authenticationConfiguration: { accessRoleArn: accessRole.arn },
        imageRepository: {
          imageRepositoryType: "ECR",
          imageIdentifier: $interpolate`${omrRepo.repositoryUrl}:latest`,
          imageConfiguration: {
            port: "8090",
            runtimeEnvironmentVariables: {
              OMR_SERVICE_TOKEN: omrServiceToken.value,
              OMR_PAGE_TIMEOUT_S: omrPageTimeoutS,
            },
          },
        },
      },
      instanceConfiguration: {
        // Rectifica y clasifica imágenes página a página: CPU-bound.
        cpu: "1 vCPU",
        memory: "2 GB",
      },
      networkConfiguration: {
        // Sin URL pública: sólo se llega por el VPC endpoint de más abajo.
        ingressConfiguration: { isPubliclyAccessible: false },
      },
      healthCheckConfiguration: {
        // HTTP contra /health, no TCP: con TCP un proceso vivo pero con la app rota
        // (OpenCV que no carga, contrato inválido) pasa el check igual y recibe
        // tráfico. /health sólo responde si la app importó y montó las rutas.
        protocol: "HTTP",
        path: "/health",
        interval: 10,
        // 10 s (no 5): el chequeo compite con una página en proceso sobre 1 vCPU.
        timeout: 10,
        healthyThreshold: 1,
        // 10 x 10 s = 100 s de gracia. El arranque importa OpenCV (~2-5 s), pero el
        // umbral también manda en runtime y no conviene matar la instancia por un
        // chequeo lento mientras hay un lote corriendo.
        unhealthyThreshold: 10,
      },
    });

    // ── Ingress privado del OMR (PrivateLink) ──
    // El servicio deja de tener URL pública: sólo se alcanza desde esta VPC, que es
    // donde vive el egress del API. El token X-OMR-Token NO se reemplaza — sigue
    // exigido por el servicio: defensa en profundidad, la red es la primera capa.
    //
    // El SG por defecto de la VPC (vpc.securityGroups, el que ya usa el VPC connector
    // del API) admite todo el tráfico originado dentro del CIDR de la VPC, así que el
    // API llega al endpoint por 443 sin reglas extra.
    const omrEndpoint = new aws.ec2.VpcEndpoint("OmrVpcEndpoint", {
      vpcId: vpc.id,
      // Región fijada en `providers` arriba.
      serviceName: "com.amazonaws.us-east-1.apprunner.requests",
      vpcEndpointType: "Interface",
      subnetIds: vpc.privateSubnets, // >= 2 AZs, como recomienda App Runner
      securityGroupIds: vpc.securityGroups,
      // privateDnsEnabled queda en false (default): el dominio que devuelve el ingress
      // connection es un *.awsapprunner.com que ya resuelve a las IPs privadas del
      // endpoint desde adentro de la VPC, y el certificado TLS corresponde a ese
      // nombre. No hace falta una zona privada de Route 53.
      tags: { Name: `edtech-omr-${$app.stage}` },
    });

    const omrIngress = new aws.apprunner.VpcIngressConnection("OmrVpcIngress", {
      name: `edtech-omr-${$app.stage}`,
      serviceArn: omr.arn,
      ingressVpcConfiguration: {
        vpcId: vpc.id,
        vpcEndpointId: omrEndpoint.id,
      },
    });

    // ⚠️ La URL del OMR es la del ingress connection, NO `omr.serviceUrl`: con el
    // servicio privado, serviceUrl deja de resolver. Es la que consume el backend por
    // OMR_SERVICE_URL.
    const omrUrl = $interpolate`https://${omrIngress.domainName}`;

    // ── Backend: App Runner desde la imagen :latest en ECR ──
    const api = new aws.apprunner.Service("Api", {
      serviceName: `edtech-api-${$app.stage}-v2`,
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
              // E22: el backend habla con el servicio de visión OMR por HTTP.
              // El egress del API sale por el VPC connector, que es justo lo que le
              // permite alcanzar el endpoint privado del OMR.
              OMR_SERVICE_URL: omrUrl,
              OMR_SERVICE_TOKEN: omrServiceToken.value,
              // Ver "Presupuestos de tiempo" en el bloque del OMR.
              OMR_READ_TIMEOUT_S: omrReadTimeoutS,
              // web->api es server-side (Lambda OpenNext -> App Runner), CORS no aplica.
              CORS_ORIGIN: "*",
              // MCP analítico: apagado por default; se enciende seteando los secrets.
              MCP_ENABLED: mcpEnabled.value,
              MCP_CANONICAL_URI: mcpCanonicalUri.value,
              WORKOS_ISSUER: workosIssuer.value,
              WORKOS_JWKS_URL: workosJwksUrl.value,
            },
          },
        },
      },
      instanceConfiguration: {
        // 1 vCPU / 2 GB: la API NestJS carga ~40 módulos + SDKs de IA al arrancar;
        // con 0.25 vCPU el boot excedía la ventana del health check → CREATE_FAILED.
        cpu: "1 vCPU",
        memory: "2 GB",
        instanceRoleArn: instanceRole.arn,
      },
      networkConfiguration: {
        egressConfiguration: { egressType: "VPC", vpcConnectorArn: vpcConnector.arn },
      },
      // Health check tolerante: da tiempo a que el boot bindee el puerto 4000.
      healthCheckConfiguration: {
        protocol: "TCP",
        interval: 10,
        timeout: 5,
        healthyThreshold: 1,
        unhealthyThreshold: 10,
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

    // ── CORS del bucket: sólo el origen real del frontend del stage ──
    // La captura remota sube la foto DIRECTO desde el navegador del teléfono con una
    // presigned URL (PUT). Sin CORS el navegador bloquea la petición ANTES de enviarla:
    // no queda rastro en ningún log del servidor y la persona sólo ve "fallo de red".
    // Ya costó un buen rato diagnosticarlo una vez en local.
    //
    // Esto no habilita algo que faltaba — lo ACOTA. El default del componente es
    // `allowOrigins: ["*"]`, o sea cualquier página de internet podía usar una
    // presigned URL filtrada desde el navegador de la víctima; por eso arriba va
    // `cors: false`, para que la regla del componente no compita con esta.
    //
    // Va como recurso aparte y DESPUÉS de `web` a propósito: el origen es `web.url`,
    // que no existe hasta que CloudFront está creado, y `web` ya depende del bucket
    // (`link: [uploads]`). Declararlo dentro del `new sst.aws.Bucket` cerraría el ciclo
    // bucket → web → bucket; como recurso separado la cadena queda uploads → web →
    // cors, sin ciclo.
    new aws.s3.BucketCorsConfiguration("UploadsCors", {
      bucket: uploads.name,
      corsRules: [
        {
          // web.url viene con "/" final; Origin nunca lo lleva y S3 compara literal.
          allowedOrigins: [web.url.apply((url) => url.replace(/\/+$/, ""))],
          // El presign firma sólo `host` (lo demás va en query params X-Amz-*), así
          // que el navegador manda un único header propio: Content-Type.
          allowedHeaders: ["content-type"],
          // PUT sube la foto; GET/HEAD leen desde el navegador lo ya subido.
          allowedMethods: ["PUT", "GET", "HEAD"],
          exposeHeaders: ["ETag"],
          // Cachea el preflight. Con el default (0 s) cada archivo paga un OPTIONS
          // extra, que en el 4G de un teléfono es un round-trip por foto.
          maxAgeSeconds: 3600,
        },
      ],
    });

    return {
      phase: "completa",
      web: web.url,
      api: apiUrl,
      omr: omrUrl,
      ecrRepo: apiRepo.repositoryUrl,
      ecrOmrRepo: omrRepo.repositoryUrl,
      dbHost: db.host,
      bucket: uploads.name,
    };
  },
});
