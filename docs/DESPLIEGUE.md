# Despliegue en un servidor con HTTPS

Esta guía deja LogisticaSPA funcionando en un servidor propio, con un dominio y HTTPS automático. Es lo que hace falta para que el **micrófono**
y las **notificaciones con la pestaña cerrada** funcionen fuera de `localhost` (los navegadores solo los permiten en páginas seguras).

> Estado de verificación: la combinación `docker-compose.yml` + `docker-compose.https.yml` se probó en un equipo con Docker (certificado local
> de Caddy): inicio de sesión de dos roles, cookies `Secure`, HSTS, service worker, política de contenido sin bloqueos, notificaciones
> habilitadas, chat en vivo y redirección de HTTP a HTTPS. **No** se probó todavía con un dominio real ni con Let's Encrypt: eso depende de
> tu DNS y de tus puertos, y se comprueba con la lista del paso 7.

## 1. Qué necesitas

| Qué | Detalle |
|---|---|
| Un servidor | Linux con Docker y Docker Compose v2.24 o superior (`docker compose version`). 1 GB de memoria alcanza; 2 GB con holgura. |
| Un dominio | Por ejemplo `logistica.miempresa.com`, con un registro **A** apuntando a la IP del servidor. |
| Puertos abiertos | **80 y 443** hacia internet (Let's Encrypt usa el 80 para validar y Caddy redirige a HTTPS). |
| Supabase | El proyecto con las migraciones aplicadas (paso 2) y sus claves. |
| Claves de IA | Al menos una (Gemini, Groq, Cerebras u OpenRouter). Los planes gratuitos tienen límites de uso. |

## 2. Base de datos (Supabase)

Ejecuta **en orden numérico** todos los archivos de `migrations/` en el editor SQL de Supabase. Todos son idempotentes (se pueden repetir).
Con la CLI de Supabase, ya con sesión iniciada y el proyecto enlazado:

```bash
npx supabase db query --remote=<ref-del-proyecto> --yes -f migrations/023_push_subscriptions.sql
```

La migración `023_push_subscriptions.sql` es la de los avisos con la pestaña cerrada; sin ella esa función queda apagada (el resto funciona).

## 3. Claves de las notificaciones (VAPID)

Genera un par **propio para producción**; la privada no se comparte ni se sube al repositorio:

```bash
npx web-push generate-vapid-keys
```

Copia la pública y la privada al `.env` (paso 4). Si las cambias más adelante, las personas que ya activaron los avisos tendrán que volver a activarlos.

## 4. Variables de entorno

En la carpeta `LogisticaSPABackend`, copia `.env.example` a `.env` y completa:

```
# Base de datos y autenticación
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...        # clave de servicio: solo en el servidor
SUPABASE_ANON_KEY=...

# Asistente de IA (al menos una)
LLM_PROVIDER=gemini
GEMINI_API_KEY=...
GROQ_API_KEY=...
CEREBRAS_API_KEY=...
OPENROUTER_API_KEY=...
LLM_POOL=gemini,groq,cerebras,openrouter

# Notificaciones con la pestaña cerrada
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:tu-correo@tu-dominio

# HTTPS (lee docker-compose.https.yml)
DOMAIN=logistica.miempresa.com
PUBLIC_URL=https://logistica.miempresa.com
```

Cosas que **no** debes poner en producción: `NODE_ENV=development` (el compose ya fija `production`), claves de prueba, ni `AUTH_ALLOW_USER_METADATA_ROLE=true`.
El captcha (Turnstile) es opcional: sin `TURNSTILE_SECRET_KEY` y `TURNSTILE_SITE_KEY` queda desactivado; para activarlo, ambos van en el `.env`.

## 5. Arrancar

```bash
cd LogisticaSPABackend
docker compose -f docker-compose.yml -f docker-compose.https.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.https.yml ps      # los tres contenedores en «healthy» o «Up»
```

En el primer arranque Caddy pide el certificado a Let's Encrypt (unos segundos). Los certificados se guardan en el volumen `caddy_data`:
**no lo borres**, porque Let's Encrypt limita cuántas veces se puede pedir un certificado para el mismo dominio.

Los repositorios del backend y del frontend deben estar lado a lado (`RepositoriosSPA/LogisticaSPABackend` y `RepositoriosSPA/LogisticaSPAFrontend`), porque el compose construye el frontend desde la carpeta vecina.

## 6. Qué cambia con HTTPS (y por qué)

- **Solo Caddy recibe tráfico de fuera.** El frontend (nginx) y el backend quedan en la red interna de Docker.
- **Cookies `Secure`**: la sesión viaja únicamente por HTTPS (`COOKIE_SECURE=true`).
- **`TRUST_PROXY=2`**: hay dos proxies delante del backend (Caddy y nginx). Con un número menor, todas las personas parecerían venir de la misma IP
  y los límites de intentos por IP se compartirían entre todos.
- **nginx reenvía el protocolo real** (`X-Forwarded-Proto`), de modo que el backend sabe que la conexión fue segura y envía la cabecera de transporte seguro (HSTS).
- **Política de contenido (CSP)** del frontend: viene en `nginx.conf` (fuente en `src/security/csp.js`). Su `connect-src` solo permite el propio origen
  y los dos servicios de mapas. Como la API se sirve por el mismo origen (`/api`), no hay que agregar nada. Si pones el backend en **otro dominio**,
  agrégalo a `connect-src` y usa `COOKIE_SAMESITE=none`.

## 7. Comprobaciones después de desplegar

1. `https://TU-DOMINIO/` carga y el candado es válido; `http://TU-DOMINIO/` redirige a HTTPS.
2. Iniciar sesión con cada rol. En las herramientas del navegador, las cookies `sb_access` y `sb_refresh` deben decir **Secure** y **HttpOnly**.
3. Abrir Logi: el botón **«Con la pestaña cerrada»** debe aparecer (si no aparece, faltan las claves VAPID o la migración 023).
4. Activarlo y pulsar **«Enviar prueba»**: en pocos segundos debe llegar una notificación aunque cambies de pestaña. En un **celular**, cierra la pestaña y repite.
5. Preguntarle algo al asistente: la respuesta debe ir apareciendo en vivo (si llega de golpe al final, algún proxy está acumulando la respuesta).
6. El micrófono del chat de voz debe pedir permiso (solo funciona en HTTPS).
7. `curl -I https://TU-DOMINIO/` debe mostrar `Content-Security-Policy`, `X-Frame-Options` y `Permissions-Policy`;
   `curl -I https://TU-DOMINIO/api/ai-agent/alerts` debe responder `401` (sin sesión) con `Strict-Transport-Security`.

## 8. Operación

| Tarea | Comando |
|---|---|
| Ver registros | `docker compose -f docker-compose.yml -f docker-compose.https.yml logs -f backend` |
| Actualizar el código | `git pull` en los dos repositorios y repetir el comando de arranque (con `--build`) |
| Reiniciar | `docker compose -f docker-compose.yml -f docker-compose.https.yml restart` |
| Detener | `docker compose -f docker-compose.yml -f docker-compose.https.yml down` (no borra los certificados) |
| Datos de demostración | `node --env-file=.env scripts/seed-demo.mjs` (y `--remove` para quitarlos). Solo para demostraciones, nunca en producción con datos reales |

Copias de seguridad: los datos están en Supabase (usa sus copias automáticas o `pg_dump`). El servidor solo guarda los certificados de Caddy (`caddy_data`) y, en memoria, las propuestas de acción pendientes (se pierden al reiniciar: el usuario las pide de nuevo).

## 9. Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| `port is already allocated` al arrancar | El puerto lo ocupa otro programa (el 8080 es muy común). Cambia el puerto del host: sin HTTPS, `FRONTEND_PORT=18080`; con HTTPS, `HTTP_PORT` y `HTTPS_PORT`. |
| Caddy no consigue el certificado | El DNS aún no apunta al servidor, o el 80/443 están cerrados (cortafuegos del proveedor). Revisa `docker logs logistica-caddy`. |
| «too many requests» de login para todos | `TRUST_PROXY` mal calculado: con Caddy + nginx debe ser **2**. |
| Falta el botón «Con la pestaña cerrada» | Sin claves `VAPID_*`, sin la migración 023, o el navegador no admite notificaciones (iPhone solo con la aplicación instalada en la pantalla de inicio). |
| El asistente responde «muchas consultas» | Límite del plan gratuito del proveedor de IA. Espera un minuto o agrega más proveedores a `LLM_POOL`. |
| La página carga pero no hay datos | Revisa `docker compose ... logs backend`: casi siempre es una clave de Supabase incorrecta. |
