# Plataforma Logística Asistida por IA - Backend

Este repositorio contiene el código fuente del backend para el sistema de Gestión Logística Asistida por Inteligencia Artificial.

## Arquitectura del Sistema

La arquitectura de este sistema ha sido diseñada siguiendo los principios fundamentales de Domain-Driven Design (DDD) y estructurada bajo el patrón arquitectónico de Monolito Modular (Modular Monolith).

Esta decisión estratégica asegura el bajo acoplamiento y la alta cohesión, permitiendo mantener la simplicidad operativa de un servidor unificado Node.js (con el framework Express), mientras establece las bases formales para escalar de manera orgánica a un modelo de Microservicios conforme crezcan las necesidades operativas de la plataforma.

### Justificación del Monolito Modular
A diferencia de las arquitecturas clásicas organizadas por capas técnicas (rutas consolidadas, controladores consolidados), la organización del código fuente se efectúa en torno a Dominios de Negocio (Bounded Contexts).

Cada módulo encapsula exclusivamente sus propias definiciones de ruta, controladores, lógica de servicio y su límite transaccional de base de datos. Se establecen fronteras lógicas estrictas que impiden a un módulo consultar la capa de acceso a datos que pertenece a un módulo distinto.

---

## Patrones de Dominio (DDD Subdomains)

Como resultado del análisis del dominio logístico, la plataforma consta de cinco Bounded Contexts principales, clasificados según el modelo de subdominios estratégicos de DDD:

### 1. Core Domain (Dominio Principal)
Sección central del negocio, encargada de proveer la ventaja competitiva de la organización.
*   **Logistics (Logística)**: Gestiona la recepción de mercancías, creación de guías de remisión (waybills) y la formulación de rutas óptimas para el despacho de carga.
*   **Tracking (Rastreo Inmutable)**: Gestiona la ingesta de telemetría y geolocalización, consolidando un registro asíncrono e irrepudiable sobre los cambios de estado operativos y trazabilidad de la cadena de frío.
*   **AI Agent (Asistente Inteligente)**: Constituye el principal diferenciador cognitivo de la plataforma. Módulo compuesto por un agente LLM configurado desde LangChain para la inferencia, procesamiento del lenguaje natural y orquestación de lecturas operativas cruzadas.

### 2. Supporting Subdomain (Dominio de Soporte)
Servicios auxiliares requeridos para sostener la operación, si bien con reglas que presentan menor grado de especificidad y complejidad algorítmica.
*   **Fleet (Flota)**: Administración del catálogo físico de la organización, que incluye la gestión centralizada del ciclo de vida y disponibilidad tanto de vehículos logísticos como de sus respectivos conductores.

### 3. Generic Subdomain (Dominio Genérico)
Sistemas transversales resueltos por terceros bajo estándares probados de la industria.
*   **IAM (Identity & Access Management)**: Delegación integral en Supabase Auth de las políticas de seguridad, ciclo de vida de identidades, emisión de tokens y control de acceso basado en roles (RBAC).

---

## Separación Estratégica de Comunicación Inter-Módulos

Para evitar que los módulos terminen fuertemente acoplados (código espagueti), hemos definido dos reglas estrictas para la comunicación entre ellos. Esta separación se inspira conceptualmente en el patrón CQRS: separamos las operaciones de "solo lectura" de las operaciones de "escritura/alteración", sin requerir forzosamente el nivel extremo de bases de datos duplicadas.

Esta estrategia garantiza que, si el día de mañana migramos a Microservicios, la red no colapse por asíncronía innecesaria y el sistema sea tolerante a fallos.

### 1. Consultas Síncronas (Solo Lecturas)
Cuando un módulo necesita pedir un dato a otro módulo para mostrarlo inmediatamente al usuario, puede consultar directamente sus servicios públicos.
*   **En el Monolito**: Usamos llamadas directas en memoria a la capa de servicio (ej. `const driver = await FleetService.getActiveDriver(id)`).
*   **En Microservicios**: Estas llamadas se convertirán en peticiones directas rápidas (HTTP REST o RPC) entre servidores. Hacer esto síncrono es vital para no dejar al usuario final esperando en la interfaz mientras se resuelve una cola compleja.

### 2. Eventos Asíncronos (Mutaciones y Cambios de Estado)
Cuando un módulo altera la base de datos y ese cambio debe desencadenar acciones en otros módulos (ej. "el paquete cambió a Entregado"), **tiene prohibido** invocar las funciones del otro módulo.
*   **En el Monolito**: El módulo que realiza la alteración emite el cambio a un bus interno (ej. `EventBus.emit('tracking:package_delivered')`) y da por terminada su labor. El módulo de Logística estará escuchando independientemente de fondo y procesará el cierre de la ruta.
*   **En Microservicios**: Ese bus en memoria se reemplazará por un gestor de mensajes productivo (Redis Pub/Sub, RabbitMQ o Kafka). El publicador lanzará el evento a la cola y seguirá operando felizmente, garantizando retención de datos incluso si el microservicio receptor se encuentra reiniciándose en ese segundo exacto.

---

## Estructura del Repositorio

La implementación base sobre Node.js obliga el establecimiento del siguiente esqueleto de sistema de archivos:

```text
src/
├── app.js                 # Registro de middleware global y bootstraping de Express
├── server.js              # Inicialización de puertos (HTTP) y de las instancias singleton
├── shared/                # Recursos transversales y compartidos al ecosistema

│   ├── config/            # Instanciadores, adaptadores de cliente y variables de ambiente
│   ├── middlewares/       # Validadores centralizados, interceptores HTTP
│   └── utils/             # Funciones de soporte transversales (EventBus, Logger)
└── modules/               # NÚCLEO DE LA ARQUITECTURA DISTRIBUIDA
    ├── iam/
    │   ├── iam.routes.js
    │   ├── iam.controller.js
    │   └── iam.service.js # Interfaz expuesta exclusiva (Consultas inter-proceso)
    ├── fleet/
    │   ├── fleet.routes.js
    │   ├── fleet.controller.js
    │   └── fleet.service.js
    ├── logistics/
    │   ├── logistics.routes.js
    │   ├── logistics.controller.js
    │   └── logistics.service.js
    ├── tracking/
    │   ├── tracking.routes.js
    │   ├── tracking.controller.js
    │   └── tracking.service.js
    └── ai-agent/
        ├── agent.routes.js
        ├── agent.controller.js
        └── agent.service.js
```

### Directivas Oficiales de Aislamiento:
Bajo ninguna circunstancia se admitirá la importación de entidades que no sean del tipo "Servicio" entre fronteras de módulos lógicos. Cualquier dependencia requerida a nivel controlador de un paquete ajeno será gestionada exclusivamente como un import a la API expuesta por sus servicios (Ejemplo válido: `import { TrackingService } from '../tracking/tracking.service'`).

---

## Proyección de Migración hacia Modelos Distribuidos (Microservicios)

La viabilidad técnica de aislar procesos asíncronos hacia servidores o arquitecturas serverless en forma de microservicios se encuentra resguardada gracias a la implementación descrita.

**Fases Estándares de Desconexión Estratégica:**
1. **Extracción Directa:** Traslados directos de todo el perímetro y recursos bajo las subcarpetas del Módulo a nuevos dominios y repositorios de código.
2. **Reemplazo Instrumental de Interfaces:** Intervenciones focales limitadas en la capa de servicios genéricos, modificando la captura in-process de Node.js por interfaces RPC remotas, asegurando la no alteración del núcleo de controladores.
3. **Escala y Sobrecarga Controlada:** El desprendimiento del Agente de IA está proyectado como el primer caso de uso crítico debido al requerimiento volumétrico de recursos computacionales inherentes a LLMs. El desacoplamiento previo asegura que contingencias informáticas (agotamiento de heap memory/CPU) permanezcan encapsuladas sin alterar la resolución en alta disponibilidad de los registros de flota vitales para la compañía.
