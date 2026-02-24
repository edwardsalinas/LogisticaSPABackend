import urllib.request
import urllib.parse
import zlib
import base64
import os

diagrams = {
    "C4_Context_Logistica.png": """@startuml
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Context.puml

LAYOUT_WITH_LEGEND()
title Diagrama de Contexto (Nivel 1) - Plataforma Logística Asistida por IA

Person(cliente, "Cliente / Remitente", "Cliente final que rastrea encomiendas y hace consultas.")
Person(operador, "Transportista / Operador", "Chofer que actualiza estados de entrega en campo.")
Person(admin, "Despachador / Administrador", "Asigna rutas, choferes y supervisa la flota.")

System(plataforma, "Plataforma Logística", "Provee rastreo, gestión de fletes y asistencia conversacional inteligente.", $tags="monolith")
System_Ext(llm, "API LLM", "Motor de IA para procesamiento de lenguaje natural (OpenAI/Anthropic).")

Rel(cliente, plataforma, "Rastrea paquetes mediante chat NLP", "HTTPS/WSS")
Rel(operador, plataforma, "Confirma entregas (PoD)", "HTTPS")
Rel(admin, plataforma, "Gestiona rutas y operativa", "HTTPS")
Rel(plataforma, llm, "Delega intenciones y genera respuestas", "API REST")
@enduml""",

    "C4_Container_Logistica.png": """@startuml
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml

LAYOUT_WITH_LEGEND()
title Diagrama de Contenedores (Nivel 2) - Plataforma Logística

Person(cliente, "Cliente", "Consulta estados")
Person(operador, "Transportista", "Actualiza entregas")
Person(admin, "Despachador", "Gestiona rutas")

System_Boundary(c1, "Plataforma Logística") {
    Container(spa, "Single Page Application", "React, Tailwind", "Interfaz web PWA para escritorio y móvil.")
    Container(api, "API Application (Monolito Modular)", "Node.js, Express", "Maneja lógica core logística, RBAC y agente LLM.")
    ContainerDb(db, "Base de Datos Relacional", "Supabase (PostgreSQL)", "Almacena entidades, guías, rutas, logs y embeddings.")
}

System_Ext(llm, "API Inteligencia Artificial", "Modelo de Lenguaje (LLM)")

Rel(cliente, spa, "Visita portal de rastreo", "HTTPS")
Rel(operador, spa, "Usa vista móvil PWA", "HTTPS")
Rel(admin, spa, "Usa dashboard", "HTTPS")

Rel(spa, api, "Llamadas a API REST / Websockets", "JSON/HTTPS")
Rel(api, db, "Lee y escribe datos operacionales", "TCP/IP")
Rel(api, llm, "Envía prompts y herramientas de BD", "REST/HTTPS")
@enduml""",

    "C4_Component_Logistica.png": """@startuml
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Component.puml

LAYOUT_WITH_LEGEND()
title Diagrama de Componentes (Nivel 3) - API Application (Backend)

Container(spa, "SPA (React)", "Frontend Aplicación Web")
ContainerDb(db, "Supabase (PostgreSQL)", "Almacenamiento Persistente")
System_Ext(llm, "API Externa LLM", "Servicio IA")

Container_Boundary(api, "API Application") {
    Component(auth_mw, "Middleware Seguridad", "JWT/RBAC", "Valida sesión y roles")
    Component(logistics_svc, "Core Logístico (CRUD)", "Services", "Gestión de Rutas, Vehículos y Guías (Paquetes)")
    Component(tracking_svc, "Motor de Trazabilidad", "Services", "Registra hitos de movimiento de forma inmutable")
    Component(agent_ai, "Agente Conversacional", "LangChain.js", "Traductor de NLP a SQL Tools con memoria y contexto")
    
    Rel(auth_mw, logistics_svc, "Autoriza acceso", "Internal")
    Rel(auth_mw, tracking_svc, "Autoriza acceso", "Internal")
    Rel(logistics_svc, tracking_svc, "Dispara eventos logísticos", "Internal")
    Rel(agent_ai, tracking_svc, "Lee logs de ruta", "Solo Lectura")
}

Rel(spa, auth_mw, "Peticiones HTTP con JWT")
Rel(spa, agent_ai, "Socket.io / Chat REST")
Rel(logistics_svc, db, "ORM Queries (Lectura/Escritura)")
Rel(tracking_svc, db, "Insert Log Operations")
Rel(agent_ai, llm, "LangChain chains e Inferencia")
@enduml""",

    "C4_Code_Logistica.png": """@startuml
skinparam style strictuml
hide empty members
title Diagrama de Código (Nivel 4) - Flujo del Agente IA y Tracking

class package_routes {
  + POST /api/packages
  + PATCH /api/packages/:id/status
}

class TrackingService {
  + logEvent(packageId, newStatus, userId)
  + getTrackingHistory(trackingCode)
}

class AgentService {
  - llmProvider
  - toolsRegistry
  + handleQuery(userMessage, sessionId)
  - runChain(context)
}

class SQLDatabaseTool {
  + execute(queryStr)
}

package_routes -> TrackingService : "invoke"
AgentService -> SQLDatabaseTool : "uses"
SQLDatabaseTool ..> TrackingService : "queries data via view"

note right of AgentService
El Agente LangChain
orquesta la cadena.
end note
@enduml""",

    "ER_Diagram_Logistica_Pro.png": """@startuml
skinparam linetype ortho
skinparam roundcorner 5
skinparam class {
    BackgroundColor #F9F9FC
    BorderColor #2C3E50
    ArrowColor #2C3E50
    HeaderBackgroundColor #D1E8E2
}
hide circle

title "Diagrama Entidad-Relación (ER) - Plataforma Logística"

entity "auth_users" as users {
  * user_id : uuid <<PK>>
  --
  email : varchar
  role : enum
}

entity "transport_routes" as routes {
  * route_id : uuid <<PK>>
  --
  dispatcher_id : uuid <<FK>>
  driver_id : uuid <<FK>>
  status : varchar
  departure_time : timestamp
}

entity "packages" as packages {
  * package_id : uuid <<PK>>
  --
  tracking_number : varchar <<UNIQUE>>
  route_id : uuid <<FK>> 
  weight_kg : numeric
  current_status : varchar
}

entity "tracking_logs" as tracking_logs {
  * log_id : uuid <<PK>>
  --
  package_id : uuid <<FK>>
  updated_by : uuid <<FK>>
  status_from : varchar
  status_to : varchar
  recorded_at : timestamp
  gps_geo : point
}

users ||..o{ routes : "despacha/conduce"
users ||..o{ tracking_logs : "registra hito"
routes ||..o{ packages : "contiene n paquetes"
packages ||..|{ tracking_logs : "historial estados"
@enduml"""
}

import string

def plantuml_encode(plantuml_text):
    zlibbed_str = zlib.compress(plantuml_text.encode('utf-8'))
    compressed_string = zlibbed_str[2:-4]
    plantuml_alphabet = string.digits + string.ascii_uppercase + string.ascii_lowercase + '-_'
    base64_alphabet   = string.ascii_uppercase + string.ascii_lowercase + string.digits + '+/'
    b64_to_plantuml = str.maketrans(base64_alphabet, plantuml_alphabet)
    return base64.b64encode(compressed_string).decode('utf-8').translate(b64_to_plantuml)

def generate_diagrams():
    for filename, puml in diagrams.items():
        print(f"Generando {filename}...")
        encoded = plantuml_encode(puml)
        url = f"http://www.plantuml.com/plantuml/png/{encoded}"
        
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        try:
            with urllib.request.urlopen(req) as res, open(filename, 'wb') as f:
                f.write(res.read())
            print(f"[OK] {filename}")
        except Exception as e:
            print(f"[FALLO] {filename} - {e}")

if __name__ == "__main__":
    generate_diagrams()
