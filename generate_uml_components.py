import urllib.request
import base64
import zlib
import os
import string

def plantuml_encode(plantuml_text):
    zlibbed_str = zlib.compress(plantuml_text.encode('utf-8'))
    compressed_string = zlibbed_str[2:-4]
    plantuml_alphabet = string.digits + string.ascii_uppercase + string.ascii_lowercase + '-_'
    base64_alphabet   = string.ascii_uppercase + string.ascii_lowercase + string.digits + '+/'
    b64_to_plantuml = str.maketrans(base64_alphabet, plantuml_alphabet)
    return base64.b64encode(compressed_string).decode('utf-8').translate(b64_to_plantuml)

uml_components_puml = """
@startuml
skinparam componentStyle uml2
skinparam backgroundColor white
skinparam padding 2

' Configuración visual del Perfil UML Personalizado
skinparam component {
    BackgroundColor<<spa>> #E3F2FD
    BackgroundColor<<react component>> #BBDEFB
    BackgroundColor<<express controller>> #C8E6C9
    BackgroundColor<<rest endpoint>> #A5D6A7
    BackgroundColor<<llm service>> #E1BEE7
    BackgroundColor<<database>> #FFF9C4
    BackgroundColor<<external api>> #F5F5F5
    BorderColor #2C3E50
    ArrowColor #2C3E50
}

title Modelo de Componentes UML 2.5 - Plataforma Logística LogisticaSPA

package "Frontend (Navegador/Cliente)" {
    component "LogisticaSPA" <<spa>> as SPA {
        component "TrackingDashboard" <<react component>> as Dashboard
        component "TrackingForm" <<react component>> as Form
        component "AIChatBot" <<react component>> as ChatUI
    }
}

package "Backend (Node.js Server)" {
    component "API Gateway / Router" <<rest endpoint>> as Gateway
    
    component "LogisticsController" <<express controller>> as TrackingCtrl
    component "LangChainAgent" <<llm service>> as LLAgent
    component "AuthMiddleware" <<express controller>> as Auth
}

database "Supabase / PostgreSQL" <<database>> as DB {
    component "transport_routes" <<table>>
    component "packages_status" <<table>>
}

cloud "OpenAI LLM" <<external api>> as OpenAI

' Relaciones con protocolos estrictos
Form ..> Gateway : <<HTTP POST>> / JSON \n[Submit Tracking]
Dashboard ..> Gateway : <<HTTP GET>> / JSON \n[Fetch Routes]
ChatUI ..> Gateway : <<WebSocket>> / WSS \n[Real-time Chat]

Gateway --> Auth : <<Intercept>> 
Auth --> TrackingCtrl : <<Route>> / Internal
Auth --> LLAgent : <<Route>> / Internal

TrackingCtrl ..> DB : <<Postgres Wire Protocol>> / TCP \n[SQL/ORM]
LLAgent ..> DB : <<SQL Tool>> / TCP \n[Read/Extract Data]

LLAgent ..> OpenAI : <<HTTP POST>> / JSON \n[Prompt/Completion]

@enduml
"""

def generate_uml_components_diagram():
    print("Generando Diagrama de Componentes UML 2.5...")
    
    encoded = plantuml_encode(uml_components_puml)
    url = f"http://www.plantuml.com/plantuml/png/{encoded}"
    
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as res, open("UML_Componentes_Logistica.png", 'wb') as f:
            f.write(res.read())
        print("[OK] Diagrama Componentes UML 2.5 generado exitosamente.")
    except Exception as e:
        print(f"[FALLO] Error generando Diagrama UML 2.5: {e}")

if __name__ == "__main__":
    generate_uml_components_diagram()
