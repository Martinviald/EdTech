# Setup de SSO institucional (H1.7)

Este documento explica cómo obtener las credenciales OAuth de Google Workspace y Microsoft 365 que requiere `apps/web` cuando `AUTH_MODE=sso`.

> Para desarrollo local lo natural es trabajar con `AUTH_MODE=mock` y saltarse este setup. Solo es necesario seguir estos pasos cuando se quiera probar el flujo SSO real (staging, demo a clientes, o validación de integración).

---

## 1. Google Cloud Console

1. Entrar a https://console.cloud.google.com/ y crear un proyecto nuevo: **"SOE EdTech Dev"** (o reutilizar uno existente).
2. **APIs & Services → OAuth consent screen:**
   - User type: `External`.
   - App name: `Sistema Operativo Educativo`.
   - Support email: el del responsable técnico.
   - Scopes: `email`, `profile`, `openid` (sin scopes sensibles).
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID:**
   - Application type: `Web application`.
   - Name: `SOE Web — Dev`.
   - Authorized JavaScript origins: `http://localhost:3000`.
   - Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google`.
4. Copiar el `Client ID` y `Client Secret` al `.env`:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```

Para staging y producción se crean clients separados con sus propios redirect URIs (`https://<staging-host>/api/auth/callback/google`, etc).

---

## 2. Microsoft Entra ID (ex Azure AD)

1. Entrar a https://portal.azure.com/ → **Microsoft Entra ID → App registrations → New registration**.
2. Configurar:
   - Name: `SOE EdTech Dev`.
   - Supported account types: `Accounts in any organizational directory (Any Microsoft Entra ID tenant — Multitenant)`.
   - Redirect URI: tipo `Web`, valor `http://localhost:3000/api/auth/callback/microsoft-entra-id`.
3. Una vez creada, en **Overview** copiar:
   - `Application (client) ID` → `MICROSOFT_CLIENT_ID`.
4. En **Certificates & secrets → Client secrets → New client secret**, generar y copiar el secret (solo se muestra una vez):
   - `MICROSOFT_CLIENT_SECRET`.
5. **API permissions:** asegurarse que están delegated y aceptados:
   - `User.Read`, `openid`, `email`, `profile`.
6. `MICROSOFT_TENANT_ID=common` (porque es multi-tenant).

---

## 3. Pre-requisito: lista blanca

El SSO solo permite ingresar a emails que ya estén en `org_memberships`. Para probar:

1. Correr `pnpm --filter @soe/db db:seed` — inserta el Colegio Demo y tres usuarios de prueba (`admin.demo`, `director.demo`, `profesor.demo` en `@colegiodemo.cl`).
2. Si quieres probar el SSO real con tu cuenta personal, edita el seed temporalmente (o inserta una fila directa a `users` + `org_memberships`) usando tu email real.
3. Cualquier email no whitelist será rechazado y redirigido a `/auth/error?error=EmailNotWhitelisted`.

---

## 4. Versionado y notas

- Auth.js v5 está en beta. La versión está pineada exacta en `apps/web/package.json` (`next-auth: "5.0.0-beta.25"`). Antes de upgradear, revisar el CHANGELOG: https://github.com/nextauthjs/next-auth/releases
- El provider de Microsoft se llama `microsoft-entra-id` (NO `azure-ad`, que está deprecado). El callback URL contiene ese nombre.
- Si Auth.js v5 emite warnings de variables deprecadas (`NEXTAUTH_SECRET` → `AUTH_SECRET`), renombrar en `.env`. No es bloqueante.
