# LogisticaSPA — Backend

## Descripción

API REST para la gestión logística de bienes (paquetería/encomiendas) y servicios (transporte/fletes), construida como un Monolito Modular en Node.js. Integra un Agente Conversacional de Inteligencia Artificial (LangChain.js + OpenAI) que permite consultar el estado de envíos y rutas en lenguaje natural. Soporta tracking GPS en tiempo real, trazabilidad inmutable y generación automática de rutas desde cronogramas.

## Objetivo general

- Construir una API RESTful segura bajo una arquitectura de Monolito Modular que centralice la lógica logística y la integración con el motor de Inteligencia Artificial.

## Objetivos específicos (medibles)

- Implementar 6 módulos de dominio independientes (IAM, Logistics, Fleet, Tracking, Statistics, AI-Agent) con patrón Controller-Service-Schema.
- Exponer 30+ endpoints REST documentados con Swagger/OpenAPI.
- Integrar un Agente ReAct (LangChain.js) con 2 herramientas de consulta SQL de solo-lectura.
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
- Agente conversacional IA con LangChain.js (ReAct Agent + GPT-4o-mini)
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
- **IA**: LangChain.js + @langchain/openai + @langchain/langgraph
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
    ├── /api/statistics → Statistics Module (dashboard, public stats)
    └── /api/ai-agent   → AI Agent Module   (LangChain ReAct → OpenAI)
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
LLM_PROVIDER=openai
LLM_MODEL_NAME=gpt-4o-mini
OPENAI_API_KEY=sk-...
```

## Equipo y roles

- **Edward Salinas**: Full Stack Developer — Arquitectura, Backend, Frontend, IA
- **Estiven Salinas**: Full Stack Developer — Frontend, UI/UX, Testing, Despliegue
