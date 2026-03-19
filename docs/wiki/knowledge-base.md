# Base de Conocimiento: Plataforma Logistica Asistida por IA

Este documento contiene toda la informacion necesaria para que un agente de IA (Antigravity u otro) pueda implementar cualquier feature del backlog de manera autonoma y consistente con las decisiones arquitectonicas ya tomadas.

---

## 1. Contexto del Proyecto

**Repositorio**: https://github.com/edwardsalinas/LogisticaSPABackend  
**Stack tecnologico**: Node.js + Express + Supabase (PostgreSQL + Auth) + LangChain  
**Patron arquitectonico**: Monolito Modular basado en Domain-Driven Design (DDD)  
**Directorio de trabajo**: `c:\Users\estiven.salinas\Desktop\maestria\especialidad\backend`

---

## 2. Arquitectura: Monolito Modular con DDD

### 2.1 Bounded Contexts (Modulos)

El sistema se divide en 5 modulos aislados. Cada modulo encapsula sus propias rutas, controladores y servicios. Un modulo NO puede importar controladores ni modelos de otro modulo; solo puede importar el archivo `*.service.js` de otro modulo.

| Modulo | Tipo DDD | Carpeta | Entidades DB Propias | Responsabilidad |
|--------|----------|---------|---------------------|-----------------|
| IAM | Generic | `src/modules/iam/` | `auth_users` | Autenticación, RBAC, Middlewares de Seguridad (requireAuth, requireRole) |
| Fleet | Supporting | `src/modules/fleet/` | `vehicles` | CRUD de vehiculos y choferes, disponibilidad |
| Logistics | Core | `src/modules/logistics/` | `packages`, `transport_routes` | Recepcion de paquetes, waybills, creacion de rutas, despacho |
| Tracking | Core | `src/modules/tracking/` | `tracking_logs` | Ingesta GPS, cambios de estado, registro inmutable |
| AI Agent | Core | `src/modules/ai-agent/` | `chat_sessions`, `chat_messages` | Agente LLM con LangChain, orquestacion de consultas |

### 2.2 Estructura de archivos por modulo

Cada modulo sigue esta convencion de archivos:

```
src/modules/<nombre>/
  <nombre>.routes.js       # Definicion de endpoints Express (Router)
  <nombre>.controller.js   # Logica HTTP (req/res), validacion con Zod
  <nombre>.service.js      # Logica de negocio, acceso a Supabase, interfaz publica
```

Ejemplo para Fleet:
```
src/modules/fleet/
  fleet.routes.js
  fleet.controller.js
  fleet.service.js
```

### 2.3 Codigo compartido

```
src/shared/
  config/       # Cliente Supabase, variables de entorno (dotenv)
  utils/        # EventBus (singleton), Logger, helpers genericos
  errors/       # Clases de error personalizadas
```

> [!NOTE]
> Los middlewares de seguridad (Auth/RBAC) residen en el módulo **IAM** para asegurar el encapsulamiento del Bounded Context.

### 2.4 Archivos raiz

```
src/app.js      # Configuracion de Express (cors, json, inyeccion de rutas)
src/server.js   # Entry point: crea servidor HTTP y escucha en PORT
```

---

## 3. Reglas de Comunicacion Inter-Modulos

Estas reglas son OBLIGATORIAS y no deben violarse bajo ningun escenario:

### 3.1 Lecturas (Queries): Llamadas sincronas in-process

Cuando el Modulo A necesita LEER datos del Modulo B para armar una respuesta HTTP:

```javascript
// CORRECTO: importar solo el Service
const FleetService = require('../fleet/fleet.service');
const driver = await FleetService.getActiveDriver(driverId);
```

```javascript
// INCORRECTO: importar el controlador o hacer queries directas a tablas ajenas
const FleetController = require('../fleet/fleet.controller'); // PROHIBIDO
const { data } = await supabase.from('vehicles').select('*');  // PROHIBIDO desde otro modulo
```

### 3.2 Mutaciones (Commands): Eventos asincronos via EventBus

Cuando el Modulo A realiza un cambio de estado que AFECTA al Modulo B, debe emitir un evento. Nunca invocar funciones de escritura de otro modulo directamente.

```javascript
// En tracking.service.js (PUBLICADOR)
const eventBus = require('../../shared/utils/eventBus');

async function markAsDelivered(packageId) {
  // 1. Actualizar su propia tabla
  await supabase.from('tracking_logs').insert({ package_id: packageId, status: 'delivered' });

  // 2. Emitir evento (fire-and-forget)
  eventBus.publish('tracking:package_delivered', { packageId });
}
```

```javascript
// En logistics.service.js (SUSCRIPTOR)
const eventBus = require('../../shared/utils/eventBus');

// Registrar listener al iniciar el modulo
eventBus.subscribe('tracking:package_delivered', async ({ packageId }) => {
  // Logica interna para verificar si la ruta puede cerrarse
  await checkAndCloseRoute(packageId);
});
```

### 3.3 Convencion de nombres de eventos

Formato: `<modulo_origen>:<accion_en_pasado>`

Ejemplos:
- `tracking:package_delivered`
- `tracking:package_incident`
- `logistics:route_created`
- `fleet:driver_assigned`

### 3.4 EventBus existente

El singleton ya esta implementado en `src/shared/utils/eventBus.js`. Usa los metodos:
- `eventBus.publish(eventName, payload)` para emitir
- `eventBus.subscribe(eventName, listener)` para escuchar

---

## 4. Base de Datos: Supabase

### 4.1 Cliente compartido

El cliente de Supabase debe configurarse en `src/shared/config/supabase.js` usando las variables de entorno:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (para operaciones del backend)

### 4.2 Regla de aislamiento de tablas

Cada modulo solo puede hacer queries a sus tablas propietarias (ver tabla en seccion 2.1). Si necesita datos de otra tabla, debe pedirlos via el Service del modulo correspondiente.

### 4.3 Tablas principales del ER

| Tabla | Modulo propietario | Campos clave |
|-------|-------------------|--------------|
| `auth_users` | IAM | id, email, role (admin/driver/client) |
| `vehicles` | Fleet | id, plate, capacity, status, driver_id |
| `packages` | Logistics | id, waybill, origin, destination, status, route_id |
| `transport_routes` | Logistics | id, driver_id, vehicle_id, status, created_at |
| `tracking_logs` | Tracking | id, package_id, lat, lng, status, timestamp |
| `chat_sessions` | AI Agent | id, user_id, created_at |
| `chat_messages` | AI Agent | id, session_id, role, content, timestamp |

---

## 5. Branching Model: Git Flow

### 5.1 Ramas

| Rama | Proposito | Recibe PR de | Se fusiona hacia |
|------|-----------|-------------|------------------|
| `main` | Produccion estable | `release/*`, `hotfix/*` | - |
| `develop` | Integracion y QA | `feature/*`, `bugfix/*` | `release/*` |
| `feature/*` | Nuevas funcionalidades | - | `develop` |
| `bugfix/*` | Correcciones no criticas | - | `develop` |
| `hotfix/*` | Correcciones urgentes | - | `main` + `develop` |

NO se permite hacer commit directo sobre `main` ni `develop`.

### 5.2 Nomenclatura de ramas

Formato obligatorio: `tipo/<id-issue>-<descripcion-breve>`

```
feature/1-setup-base-structure
feature/4-crud-choferes-fleet
bugfix/22-corregir-validacion-jwt
```

El `id` corresponde al numero del Issue en GitHub Projects.

### 5.3 Procedimiento para implementar un feature

```bash
# 1. Actualizar develop
git checkout develop && git pull origin develop

# 2. Crear rama del feature
git checkout -b feature/<id>-<descripcion>

# 3. Desarrollar (crear archivos en src/modules/<modulo>/)
# ... escribir codigo ...

# 4. Commit con Conventional Commits
git add .
git commit -m "feat(<scope>): <descripcion>"

# 5. Push
git push -u origin feature/<id>-<descripcion>

# 6. Crear Pull Request en GitHub hacia develop
# 7. Esperar Code Review y aprobacion del usuario
# 8. NO hacer merge sin autorizacion del usuario
```

---

## 6. Conventional Commits (Enforzado por Husky)

El repositorio tiene Husky + Commitlint configurado. Si el mensaje de commit no cumple el formato, sera RECHAZADO automaticamente.

### 6.1 Formato obligatorio

```
<tipo>(<alcance>): <descripcion en minusculas sin punto final>
```

### 6.2 Tipos permitidos

| Tipo | Uso |
|------|-----|
| `feat` | Nueva funcionalidad |
| `fix` | Correccion de bug |
| `docs` | Cambios en documentacion |
| `chore` | Mantenimiento, dependencias |
| `refactor` | Reestructuracion sin cambio funcional |
| `test` | Pruebas |
| `style` | Formato de codigo |
| `ci` | Integracion continua |
| `revert` | Revertir un commit previo |

### 6.3 Scopes obligatorios

| Scope | Cuando usarlo |
|-------|--------------|
| `core` | Archivos en la raiz de src (app.js, server.js), configuracion global |
| `shared` | Archivos en src/shared/ (middlewares, utils, config) |
| `iam` | Archivos en src/modules/iam/ |
| `fleet` | Archivos en src/modules/fleet/ |
| `logistics` | Archivos en src/modules/logistics/ |
| `tracking` | Archivos en src/modules/tracking/ |
| `ai-agent` | Archivos en src/modules/ai-agent/ |

### 6.4 Restricciones importantes en Windows

- **NO usar la letra "ñ" ni tildes** en mensajes de commit via terminal PowerShell. La codificacion de la terminal puede corromper los caracteres. Usar alternativas: "agregan" en vez de "añaden", "creacion" en vez de "creación".
- Si necesitas caracteres especiales, usar la interfaz grafica de Source Control de VSCode.

---

## 7. Backlog de User Stories Pendientes

### Fase 1: Infraestructura Base (Core Setup)

| ID | Tarea | Estado | Descripcion |
|----|-------|--------|-------------|
| T1.1 | Setup del repositorio | Completada | package.json, Express, estructura de carpetas |
| T1.2 | EventBus Singleton | Completada (sin commit) | `src/shared/utils/eventBus.js` ya existe localmente |
| T1.3 | Auth Middleware | Pendiente | Crear `src/shared/middlewares/auth.js` que verifique JWT de Supabase |

### Fase 2: Implementacion de Modulos

| ID | Tarea | Modulo | Scope | Descripcion |
|----|-------|--------|-------|-------------|
| T2.1 | CRUD Choferes y Vehiculos | Fleet | `fleet` | Crear routes, controller y service para gestionar flota |
| T2.2 | Interfaces de Lectura | Fleet | `fleet` | Exponer `FleetService.getActiveDriver(id)` para uso inter-modulo |
| T2.3 | Recepcion y Creacion de Rutas | Logistics | `logistics` | Endpoints REST para registrar paquetes y crear rutas de transporte |
| T2.4 | Suscripcion a Eventos | Logistics | `logistics` | Suscribir LogisticsService al evento `tracking:package_delivered` |
| T2.5 | Ingesta GPS y Logs | Tracking | `tracking` | Endpoint para recibir coordenadas y registrar logs inmutables |
| T2.6 | Publicador de Eventos | Tracking | `tracking` | Emitir `EventBus.emit('tracking:package_delivered')` al cambiar estado |

### Fase 3: AI Agent

| ID | Tarea | Modulo | Scope | Descripcion |
|----|-------|--------|-------|-------------|
| T3.1 | Servicio LangChain | AI Agent | `ai-agent` | Configurar Tools del agente para leer de TrackingService y LogisticsService |
| T3.2 | WebSockets | AI Agent | `ai-agent` | Exponer agente via WebSocket para streaming al frontend |

---

## 8. Dependencias ya instaladas

```json
{
  "express": "produccion",
  "cors": "produccion",
  "zod": "produccion (validacion de schemas)",
  "@supabase/supabase-js": "produccion",
  "dotenv": "produccion",
  "husky": "desarrollo",
  "@commitlint/cli": "desarrollo",
  "@commitlint/config-conventional": "desarrollo"
}
```

---

## 9. Checklist obligatorio antes de hacer push

1. Verificar que el codigo solo toca archivos dentro de `src/modules/<modulo>/` o `src/shared/`
2. Verificar que no se importan controladores ni modelos de otros modulos (solo Services)
3. Verificar que las mutaciones inter-modulo usan EventBus, no llamadas directas
4. Verificar que el mensaje de commit cumple con Conventional Commits
5. Verificar que la rama sigue la nomenclatura `feature/<id>-<descripcion>`
6. NO hacer `git push` a `main` ni a `develop` directamente
7. NO hacer merge de Pull Requests sin autorizacion explicita del usuario
8. NO usar caracteres especiales (ñ, tildes) en mensajes de commit via terminal
