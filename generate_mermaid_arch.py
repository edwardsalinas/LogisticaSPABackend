import urllib.request
import urllib.parse
import json
import base64

diagrams_mermaid = {
    "C4_Context_Logistica_Mermaid.png": """
C4Context
    title Diagrama de Contexto (Nivel 1) - Plataforma Logistica Asistida por IA
    
    Person(cliente, "Cliente / Remitente", "Cliente final que rastrea encomiendas y hace consultas.")
    Person(operador, "Transportista", "Chofer que actualiza estados de entrega en campo.")
    Person(admin, "Despachador", "Asigna rutas, choferes y supervisa la flota.")
    
    System(plataforma, "Plataforma Logistica", "Provee rastreo, gestion de fletes y asistencia conversacional.")
    System_Ext(llm, "API LLM", "Motor de IA (OpenAI/Anthropic).")
    
    Rel(cliente, plataforma, "Rastrea paquetes (NLP)", "HTTPS/WSS")
    Rel(operador, plataforma, "Confirma entregas (PoD)", "HTTPS")
    Rel(admin, plataforma, "Gestiona rutas", "HTTPS")
    Rel(plataforma, llm, "Genera respuestas NLP", "REST")
""",

    "C4_Container_Logistica_Mermaid.png": """
C4Container
    title Diagrama de Contenedores (Nivel 2) - Plataforma Logistica
    
    Person(cliente, "Cliente", "Consulta estados")
    Person(operador, "Transportista", "Actualiza entregas")
    Person(admin, "Despachador", "Gestiona rutas")
    
    System_Boundary(c1, "Plataforma Logistica") {
        Container(spa, "Single Page App", "React", "Interfaz web PWA para escritorio y movil.")
        Container(api, "API Application", "Node.js Express", "Maneja logica core logistica y agente LLM.")
        ContainerDb(db, "Base de Datos", "PostgreSQL", "Almacena rutas, logs y embeddings.")
    }
    
    System_Ext(llm, "API IA", "LLM")
    
    Rel(cliente, spa, "Rastreo", "HTTPS")
    Rel(operador, spa, "Vista PWA", "HTTPS")
    Rel(admin, spa, "Dashboard", "HTTPS")
    
    Rel(spa, api, "Llamadas REST/WS", "JSON/HTTPS")
    Rel(api, db, "Lee/Escribe", "TCP/IP")
    Rel(api, llm, "Prompts", "HTTPS")
""",

    "C4_Component_Logistica_Mermaid.png": """
C4Component
    title Diagrama de Componentes (Nivel 3) - Backend API
    
    Container(spa, "SPA (React)", "Frontend web")
    ContainerDb(db, "PostgreSQL", "Persistencia")
    System_Ext(llm, "Ext LLM", "Servicio IA")
    
    Container_Boundary(api, "API Backend") {
        Component(auth_mw, "Seguridad", "JWT", "Valida sesion y roles")
        Component(logistics_svc, "Core Logistico", "Servicio", "Rutas y Guias")
        Component(tracking_svc, "Trazabilidad", "Servicio", "Registra hitos movimiento")
        Component(agent_ai, "Agente AI", "LangChain.js", "Traductor NLP a SQL Tools")
    }
    
    Rel(spa, auth_mw, "HTTP", "REST")
    Rel(spa, agent_ai, "Chat", "Websocket")
    
    Rel(auth_mw, logistics_svc, "Autoriza", "")
    Rel(logistics_svc, tracking_svc, "Genera eventos", "")
    Rel(agent_ai, tracking_svc, "Lee history", "Solo Lectura")
    
    Rel(logistics_svc, db, "CRUD", "SQL")
    Rel(tracking_svc, db, "Inserts", "SQL")
    Rel(agent_ai, llm, "Inferencia", "REST")
""",

    "C4_Component_Frontend_Mermaid.png": """
C4Component
    title Diagrama de Componentes (Nivel 3) - Frontend React
    
    Container_Boundary(spa, "React SPA") {
        Component(ui_shell, "UI Shell / Router", "React Router", "Layout principal")
        Component(auth_ctx, "Auth Provider", "React Context", "Estado global sesión JWT")
        
        Component(dashboard, "Dashboard", "React Component", "Métricas en tiempo real")
        Component(routes_mgr, "Gestor Rutas", "React Component", "Asignación de guías a choferes")
        Component(driver_app, "Mobile App", "React Component", "PWA escáner chofer")
        Component(chat_ui, "Chat Inteligente", "React Component", "Consultas NLP")
        
        Rel(ui_shell, auth_ctx, "Verifica rol", "")
        Rel(ui_shell, dashboard, "Renderiza base rol", "")
        Rel(ui_shell, routes_mgr, "Renderiza base rol", "")
        Rel(ui_shell, driver_app, "Renderiza base rol", "")
        Rel(ui_shell, chat_ui, "Renderiza global", "")
    }
    
    Container(api, "Node API", "Backend", "Servicios REST")
    
    Rel(auth_ctx, api, "Login", "HTTPS")
    Rel(dashboard, api, "Fetch Data", "HTTPS")
    Rel(chat_ui, api, "Websocket NLP", "WSS")
""",

    "C4_Sequence_IA_Mermaid.png": """
sequenceDiagram
    autonumber
    actor C as Cliente
    participant SPA as Frontend React
    participant API as AgentController
    participant LLM as LangChainAgent
    participant DB as Base de Datos (Tool)
    participant O as OpenAI API
    
    C->>SPA: "¿Donde esta mi paquete 123?"
    SPA->>API: POST /chat {msg}
    API->>LLM: handleQuery()
    LLM->>O: generate(prompt + tools)
    
    O-->>LLM: Llama tool 'query_tracking'
    LLM->>DB: SELECT status, loc FROM tracking
    DB-->>LLM: {status: 'En transito'}
    
    LLM->>O: generate(db_result)
    O-->>LLM: "Tu paquete esta en transito"
    
    LLM-->>API: Respuesta string
    API-->>SPA: {reply}
    SPA-->>C: Muestra chat
""",

    "WAE_UML_Logistica_Mermaid.png": """
classDiagram
    direction LR
    class TrackingSPA~Client Page~ {
        +useEffect()
        +renderMap()
    }
    class SearchForm~Form~ {
        +tracking_code: string
        +onSubmit()
    }
    class ChatInterface~Client Component~ {
        +sendMessage()
    }
    
    class NodeServer~Server Page~ {
        +/api/tracking/:code
        +/api/chat
    }
    class LangChainService~Server Component~ {
        +invokeLLM()
        +queryDB()
    }
    class SupabaseDB~Database~ {
        +tracking_logs
        +packages
    }

    TrackingSPA *-- SearchForm : builds
    TrackingSPA *-- ChatInterface : builds
    
    SearchForm ..> NodeServer : submits
    ChatInterface ..> NodeServer : WSS submits
    
    NodeServer ..> SupabaseDB : queries
    NodeServer ..> LangChainService : delegates
    LangChainService ..> SupabaseDB : SQL Tool
"""
}

def generate_all_mermaid():
    for filename, code in diagrams_mermaid.items():
        print(f"Generando {filename} con Mermaid...")
        
        payload = {
            "code": code.strip(),
            "mermaid": {
                "theme": "base",
                "themeVariables": {
                    "fontFamily": "arial"
                }
            }
        }
        
        json_str = json.dumps(payload)
        b64_str = base64.urlsafe_b64encode(json_str.encode('utf-8')).decode('utf-8')
        url = f"https://mermaid.ink/img/{b64_str}"
        
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        try:
            with urllib.request.urlopen(req) as res, open(filename, 'wb') as f:
                f.write(res.read())
            print(f"[OK] {filename}")
        except Exception as e:
            print(f"[FALLO] {filename} - {e}")

if __name__ == "__main__":
    generate_all_mermaid()
