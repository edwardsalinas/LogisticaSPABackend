import json
import base64
import urllib.request

mermaid_code = """
erDiagram
    AUTH_USERS ||--o{ TRANSPORT_ROUTES : "despacha / conduce"
    AUTH_USERS ||--o{ TRACKING_LOGS : "registra hito"
    TRANSPORT_ROUTES ||--o{ PACKAGES : "contiene paquetes"
    PACKAGES ||--|{ TRACKING_LOGS : "historial estados"

    AUTH_USERS {
        uuid user_id PK "UUID Único"
        string email "Correo Electrónico"
        string role "Admin, Chofer, Cliente"
        timestamp created_at "Fecha creación"
    }

    TRANSPORT_ROUTES {
        uuid route_id PK
        uuid dispatcher_id FK "Usuario despachador"
        uuid driver_id FK "Usuario chofer"
        string status "Pendiente, Transito, Completado"
        timestamp departure_time
    }

    PACKAGES {
        uuid package_id PK
        string tracking_number UK "Código Guía único"
        uuid route_id FK "Ruta asignada"
        float weight_kg "Peso del bulto"
        string current_status "Estado actual"
    }

    TRACKING_LOGS {
        uuid log_id PK
        uuid package_id FK "Guía referenciada"
        uuid updated_by FK "Usuario que actualizó"
        string status_from "Estado anterior"
        string status_to "Estado nuevo"
        string gps_geo "Punto o Coordenadas opcionales"
        timestamp recorded_at "Fecha y Hora"
    }
"""

def generate_mermaid_er():
    # Mermaid Ink payload setup
    # A base64 URL safe string representing JSON config & code
    payload = {
        "code": mermaid_code,
        "mermaid": {
            "theme": "base",
            "themeVariables": {
                "background": "#ffffff",
                "primaryColor": "#eef2ff",
                "primaryTextColor": "#1e40af",
                "primaryBorderColor": "#3b82f6",
                "lineColor": "#1e3a8a",
                "tertiaryColor": "#f8fafc"
            }
        },
        "autoSync": True,
        "updateDiagram": True
    }
    
    json_str = json.dumps(payload)
    b64_str = base64.urlsafe_b64encode(json_str.encode('utf-8')).decode('utf-8')
    url = f"https://mermaid.ink/img/{b64_str}"
    
    print(f"Solicitando imagen ER a mermaid.ink...")
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
    
    output_filename = "ER_Diagram_Logistica_Mermaid.png"
    try:
        with urllib.request.urlopen(req) as response, open(output_filename, 'wb') as f:
            f.write(response.read())
        print(f"[EXITO] Diagrama guardado en: {output_filename}")
    except Exception as e:
        print(f"[ERROR] No se pudo generar el diagrama Mermaid: {e}")

if __name__ == "__main__":
    generate_mermaid_er()
