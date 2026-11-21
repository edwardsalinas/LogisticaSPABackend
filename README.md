# LogisticaSPA — Backend

## Descripción

API REST para la gestión logística de bienes (paquetería/encomiendas) y servicios (transporte/fletes), construida como un Monolito Modular en Node.js. Integra un Agente Conversacional de Inteligencia Artificial (LangChain.js + Gemini) que permite consultar el estado de envíos y rutas en lenguaje natural. Soporta tracking GPS en tiempo real, trazabilidad inmutable y generación automática de rutas desde cronogramas.

## Objetivo general

- Construir una API RESTful segura bajo una arquitectura de Monolito Modular que centralice la lógica logística y la integración con el motor de Inteligencia Artificial.

## Objetivos específicos (medibles)

- Implementar 6 módulos de dominio independientes (IAM, Logistics, Fleet, Tracking, Statistics, AI-Agent) con patrón Controller-Service-Schema.
- Exponer 30+ endpoints REST documentados con Swagger/OpenAPI.
- Integrar un Agente ReAct (LangChain.js) con 9 herramientas de consulta de solo lectura y control de acceso por rol: paquete por código (ubicación aproximada, ETA, conductor y vehículo), búsqueda por nombre, mis paquetes, resumen de la operación, qué atender, agenda del conductor, flota, ruta y listado de rutas. Cada rol recibe solo las herramientas que puede usar, y la respuesta de `POST /api/ai-agent/chat` incluye `attachments` (datos estructurados para dibujar tarjetas en el chat).
- Implementar validación de datos con Zod en todos los endpoints transaccionales.
- Configurar un scheduler automático que proyecte rutas a 30 días basándose en cronogramas activos.
- Gestionar 17 migraciones SQL para la evolución controlada del esquema de base de datos.
- Configurar pruebas automatizadas con Vitest y pipeline CI/CD con GitHub Actions.

## Alcance (qué incluye / qué NO incluye)

**Incluye:**
- Autenticación JWT via Supabase Auth con middleware de validación
- Control de acceso basado en roles (RBAC): admin, driver, logistics_operator, client
- CRUD completo de rutas, paquetes, vehículos, conductores y cronogramas
- Sistema de tracking GPS con trips, pings y detección de checkpoints (geofencing Haversine)
- Agente conversacional IA con LangChain.js (ReAct Agent + Gemini)
- Estadísticas públicas y protegidas para dashboards
- Documentación interactiva Swagger en `/api-docs`
- Scheduler de tareas automáticas (proyección de rutas cada 24h)

**No incluye (por ahora):**
- Pasarelas de pago
- Facturación electrónica (SIN Bolivia)
- Notificaciones push
- Integración con sistemas GPS físicos (telemáticos)

## Stack tecnológico

- **Runtime**: Node.js 20+
- **Framework**: Express 5
- **Base de datos**: PostgreSQL (Supabase)
- **Autenticación**: Supabase Auth (JWT)
- **Validación**: Zod
- **IA**: LangChain.js + @langchain/openai (cliente compatible con Gemini, Qwen y OpenAI) + @langchain/langgraph
- **Documentación**: swagger-jsdoc + swagger-ui-express
- **Testing**: Vitest
- **CI/CD**: GitHub Actions
- **Control de versiones**: Git + GitHub (Git Flow + Conventional Commits)

## Arquitectura (resumen simple)

```
Frontend (React SPA)
    │
    ▼  HTTPS/REST + JWT
Express Server (app.js)
    │
    ├── /api/iam        → IAM Module        (login, profile)
    ├── /api/logistics  → Logistics Module  (routes, packages, checkpoints)
    ├── /api/fleet      → Fleet Module      (vehicles, drivers, schedules)
    ├── /api/tracking   → Tracking Module   (GPS pings, trips, geofencing)
    ├── /api/statistics → Statistics Module (dashboard, analytics, public stats)
    └── /api/ai-agent   → AI Agent Module   (LangChain ReAct → Gemini)
                              │
                              ▼
                    Supabase (PostgreSQL + Auth + Realtime)
```

## Endpoints core (priorizados)

**IAM:**
1. `POST /api/iam/login` — Iniciar sesión
2. `GET /api/iam/profile` — Perfil del usuario autenticado

**Logistics:**
3. `POST /api/logistics/packages` — Registrar paquete
4. `POST /api/logistics/routes` — Crear ruta de transporte
5. `POST /api/logistics/routes/:id/assign` — Asignar paquete a ruta
6. `PATCH /api/logistics/packages/:id/deliver` — Marcar entrega

**Tracking:**
7. `POST /api/tracking/trip/start` — Iniciar viaje GPS
8. `POST /api/tracking/trip/:tripId/event` — Registrar ping GPS
9. `POST /api/tracking/trip/stop` — Finalizar viaje
10. `GET /api/tracking/public/:code` — Rastreo público (sin auth)

**Fleet:**
11. `POST /api/fleet/schedules/generate` — Generar rutas desde cronogramas

**AI Agent:**
12. `POST /api/ai-agent/chat` — Consultar asistente IA

## Cómo ejecutar el proyecto (local)

1. Clonar repositorio
```bash
git clone https://github.com/edwardsalinas/LogisticaSPABackend.git
```

2. Instalar dependencias
```bash
npm install
```

3. Configurar variables de entorno
```bash
cp .env.example .env
# Editar .env con tus valores
```

4. Ejecutar migraciones (si es necesario)
```bash
# Ejecutar los archivos SQL en migrations/ en orden numérico contra Supabase
```

5. Ejecutar servidor de desarrollo
```bash
npm run dev
```

6. Ejecutar pruebas
```bash
npm test
```

7. Acceder a la documentación Swagger
```
http://localhost:3000/api-docs
```

## Variables de entorno (ejemplo)

```env
PORT=3000
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
# Modelo de IA (por defecto: Gemini, de Google, vía su endpoint compatible con OpenAI)
LLM_PROVIDER=gemini
GEMINI_API_KEY=...
# LLM_MODEL_NAME=gemini-flash-lite-latest
```

**Cómo obtener la clave de Gemini:** crea una API key en [Google AI Studio](https://aistudio.google.com/apikey) (inicia sesión con una cuenta de Google). La suscripción *Google AI Pro* de la app de Gemini es independiente de la API y **no** incluye cuota de API. Sin facturación se usa el nivel gratuito (con límites bajos de peticiones; Google puede usar esos datos para mejorar sus productos, por lo que no conviene enviar datos reales de clientes); para más cuota se activa la facturación en Google Cloud (pago por uso). Los modelos disponibles y sus límites cambian: consulta la lista vigente en AI Studio y fija `LLM_MODEL_NAME` si quieres un modelo concreto.

Alternativas: `LLM_PROVIDER=qwen` con `LLM_API_KEY` (Alibaba Cloud) o un modelo local con `LLM_BASE_URL`.

Para usar OpenAI: `LLM_PROVIDER=openai` y `OPENAI_API_KEY=sk-...`.

La lista completa de variables (CORS, cookies, rate limiting, captcha, proxy) está documentada en `.env.example`.

## Seguridad

| Capa | Implementación |
|---|---|
| Identidad | **Supabase Auth** gestiona usuarios, contraseñas y emisión de JWT. El backend no almacena credenciales: solo valida el token (`requireAuth`) y aplica roles (`requireRole`). |
| Sesión | El JWT viaja en cookies **httpOnly** (`sb_access`, `sb_refresh`), no accesibles desde JavaScript. Endpoints: `POST /api/iam/login`, `/refresh`, `/logout`. El header `Authorization: Bearer` sigue aceptándose para clientes de API (Postman, scripts). |
| CSRF | Con sesión por cookie, las peticiones que modifican datos exigen el header `X-Requested-With: XMLHttpRequest`. |
| CORS | Lista de orígenes permitidos (`CORS_ORIGIN`) con `credentials: true`. |
| Rate limiting | `express-rate-limit` por IP: API general (600 / 15 min), login (10 fallidos / 15 min), rastreo público (20 / min) y chat IA (15 / min). Detrás de un proxy configurar `TRUST_PROXY`. |
| Captcha | Cloudflare Turnstile en `POST /api/iam/login` y `GET /api/tracking/public/:code` (header `x-captcha-token`). Se activa definiendo `TURNSTILE_SECRET_KEY`. |
| Roles | El rol se lee de `app_metadata.role` (solo escribible por el servidor). `user_metadata` lo puede editar el propio usuario, por lo que solo se admite como respaldo de transición (`AUTH_ALLOW_USER_METADATA_ROLE`). Migración: `node --env-file=.env scripts/migrate-roles-to-app-metadata.js` (usa `--dry-run` para simular) y luego `AUTH_ALLOW_USER_METADATA_ROLE=false`. |
| Propiedad de los datos | Un cliente solo consulta el seguimiento de sus propios paquetes (REST y asistente de IA). El conductor solo opera sus viajes. |
| Datos públicos | El rastreo público enmascara los nombres del remitente y del destinatario. |
| Asistente de IA | Herramientas de solo lectura con control de acceso por rol, mensaje acotado a 1000 caracteres, historial limitado y tope de pasos del agente. |
| Validación | Esquemas Zod en los endpoints de escritura principales. |

> Contra DDoS volumétrico, el rate limiting de la aplicación no es suficiente: en producción se recomienda un CDN/WAF delante (por ejemplo Cloudflare).

## Pruebas

```bash
npm test      # pruebas unitarias y de seguridad (node:test), sin red ni base de datos
```

Cubren cookies de sesión, resolución de roles, CSRF, captcha, rate limiting, CORS, control de acceso de las herramientas del agente de IA, marcas de tiempo del modo offline y estadísticas. Las funciones SQL de `migrations/018` y `019` se prueban contra un PostgreSQL real en memoria (PGlite): atomicidad, protección frente a inyección SQL y permisos. `tests/integration/full-flow.test.js` es un script manual que requiere el servidor y Supabase en ejecución. El CI (`.github/workflows/ci.yml`) ejecuta `npm test` en cada push.

## Rutas: operaciones atómicas

Crear, editar y eliminar una ruta toca varias tablas. La migración `019_route_atomic_operations.sql` define funciones SQL que las ejecutan en una sola transacción (todo o nada), y el backend las invoca con `supabase.rpc()`. Si las funciones aún no están instaladas, usa el flujo secuencial anterior y lo avisa en el log. Ver `migrations/README.md` para el orden de aplicación.

## Tracking sin conexión (cola offline)

El conductor puede perder señal durante el viaje. El frontend guarda cada lectura GPS en el dispositivo (IndexedDB) con su `timestamp` real y la envía luego en lote:

- `POST /api/tracking/trip/:tripId/event` acepta un `timestamp` ISO 8601 opcional.
- `POST /api/tracking/trip/:tripId/events/batch` recibe hasta 200 puntos, los procesa en orden cronológico y responde `{ processed, total, arrived }`. Si falla a mitad de lote, `processed` indica cuántos se registraron.
- El viaje debe pertenecer al conductor autenticado.

## Despliegue con Docker Compose

`docker-compose.yml` levanta el **backend** (Node.js) y el **frontend** (nginx sirviendo la SPA y haciendo de proxy de `/api`, de modo que la cookie de sesión funciona sin CORS). La base de datos y la autenticación las provee Supabase Cloud.

Requiere ambos repositorios clonados lado a lado:

```
RepositoriosSPA/
  LogisticaSPABackend/     <- aquí está docker-compose.yml
  LogisticaSPAFrontend/
```

```bash
cp .env.example .env        # completar SUPABASE_*, LLM_API_KEY, TURNSTILE_* (opcional)
docker compose up --build
```

| Servicio | URL |
|---|---|
| Frontend | http://localhost:8080 |
| API (vía nginx) | http://localhost:8080/api |
| Swagger | http://localhost:8080/api-docs |
| Healthcheck del backend | `/health` |

Si el puerto 8080 está ocupado: `FRONTEND_PORT=18080 docker compose up --build`.

En producción con HTTPS: `COOKIE_SECURE=true` y `CORS_ORIGIN` con el dominio real. Si el frontend y la API están en sitios distintos, usar `COOKIE_SAMESITE=none`.

## Equipo y roles

- **Edward Salinas**: Full Stack Developer — Arquitectura, Backend, Frontend, IA
- **Estiven Salinas**: Full Stack Developer — Frontend, UI/UX, Testing, Despliegue
