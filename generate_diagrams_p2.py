import urllib.request
import urllib.parse
import zlib
import base64
import os

diagrams_p2 = {
    # Nivel 3: Componentes del Frontend (React SPA)
    "C4_Component_Frontend.png": """@startuml
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Component.puml

LAYOUT_WITH_LEGEND()
title Diagrama de Componentes (Nivel 3) - Single Page Application (Frontend React)

Container_Boundary(spa, "Single Page Application (React)") {
    Component(ui_shell, "UI Shell / Router", "React Router", "Maneja la navegación principal y layout layout (Sidebar, Navbar)")
    Component(auth_ctx, "Auth Provider", "React Context", "Gestiona el estado global de la sesión JWT y roles (RBAC)")
    
    Component(dashboard, "Dashboard Logístico", "React Component", "Muestra métricas clave y estado global de operaciones")
    Component(routes_mgr, "Gestor de Rutas", "React Component", "Interfaz para que Despachadores asignen guías a choferes")
    Component(driver_app, "Vista Chofer (Mobile)", "React Component", "PWA optimizada para escanear/confirmar entregas en campo")
    Component(chat_ui, "Interfaz Chat IA", "React Component", "Ventana de chat conversacional para rastreo y consultas operativas")
    
    Rel(ui_shell, auth_ctx, "Valida acceso a rutas")
    Rel(ui_shell, dashboard, "Renderiza")
    Rel(ui_shell, routes_mgr, "Renderiza")
    Rel(ui_shell, driver_app, "Renderiza")
    Rel(ui_shell, chat_ui, "Renderiza globalmente")
}

Container(api, "API Application", "Node.js", "Expone servicios REST y Websockets")

Rel(auth_ctx, api, "Login / Renovar Token", "JSON/HTTPS")
Rel(dashboard, api, "Fetch Estadísticas", "JSON/HTTPS")
Rel(routes_mgr, api, "CRUD Rutas y Asignaciones", "JSON/HTTPS")
Rel(driver_app, api, "POST Confirmación Entregas", "JSON/HTTPS")
Rel(chat_ui, api, "Streaming de texto (LangChain)", "WSS/HTTPS")
@enduml""",

    # Nivel 4: Diagrama de Clases/Código del Modulo de Rutas
    "C4_Code_Routes.png": """@startuml
skinparam style strictuml
hide empty members
title Diagrama de Código (Nivel 4) - Diseño OOP Módulo de Rutas (Backend)

package "Backend: Módulo Logística" {
    class RouteController {
      + createRoute(req, res)
      + assignPackageToRoute(req, res)
      + updateRouteStatus(req, res)
    }

    class RouteService {
      + buildRouteplan(dispatcherId, driverId, vehicleId)
      + addPackage(routeId, packageId, weight)
      + finalizeRoute(routeId)
    }
    
    interface IRouteRepository {
      + save(route: Route)
      + findActiveByDriver(driverId)
      + linkPackage(routeId, packageId)
    }

    class RouteSupabaseRepository {
      - supabaseClient
      + save(route: Route)
      + findActiveByDriver(driverId)
      + linkPackage(routeId, packageId)
    }
    
    class RouteEntity {
      + routeId: uuid
      + driverId: uuid
      + status: RouteStatus
      + totalWeight: decimal
      + validateCapacity()
    }
}

RouteController --> RouteService : "Llama a"
RouteService --> IRouteRepository : "Usa (Inyección Dependencia)"
IRouteRepository <|.. RouteSupabaseRepository : "Implementa"
RouteService --> RouteEntity : "Manipula estado"
@enduml""",

    # Nivel 4: Diagrama de Secuencia de Rastreo por IA
    "C4_Sequence_IA.png": """@startuml
skinparam style strictuml
skinparam maxMessageSize 150
title Diagrama de Secuencia (Nivel 4) - Flujo de Rastreo por IA

actor Cliente
participant "SPA (React)" as frontend
participant "AgentController" as ctrl
participant "LangChainAgent" as llm_agent
participant "PostgreSQL (Tool)" as db
participant "OpenAI API" as openai

Cliente -> frontend : Escribe: "¿Dónde está mi paquete XYZ-123?"
frontend -> ctrl : POST /api/chat {msg: "..."}
ctrl -> llm_agent : handleQuery(msg, userId)
llm_agent -> openai : generate(prompt + tools)

openai --> llm_agent : "Necesito usar herramienta 'query_tracking'"
llm_agent -> db : SELECT status, loc FROM tracking_logs WHERE tracking = 'XYZ-123'
db --> llm_agent : Resultado: {status: 'En tránsito', loc: 'Hub Norte'}

llm_agent -> openai : generate(resultado_db)
openai --> llm_agent : "Tu paquete XYZ-123 está en tránsito desde el Hub Norte."

llm_agent --> ctrl : Respuesta Final
ctrl --> frontend : {reply: "Tu paquete..."}
frontend --> Cliente : Muestra mensaje natural
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

def generate_diagrams_p2():
    for filename, puml in diagrams_p2.items():
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
    generate_diagrams_p2()

