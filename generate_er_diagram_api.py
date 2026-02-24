import subprocess
import os
import urllib.request

puml_content = """
@startuml
skinparam style strictuml
skinparam classBackgroundColor #E3F2FD
skinparam classBorderColor #1565C0
skinparam defaultFontName Arial

title Modelo Relacional (ER) - Plataforma de Logística y Transporte

entity "Usuarios" as users {
  * user_id : uuid <<PK>>
  --
  email : varchar
  role : enum (admin, dispatcher, driver, client)
  created_at : timestamp
}

entity "Entidades (Clientes/Hubs)" as entities {
  * entity_id : serial <<PK>>
  --
  user_id : uuid <<FK>> (opcional)
  name : varchar
  address : varchar
  phone : varchar
}

entity "Rutas / Fletes (Servicios)" as routes {
  * route_id : serial <<PK>>
  --
  dispatcher_id : uuid <<FK>>
  driver_id : uuid <<FK>>
  status : enum (pending, in_transit, completed)
  start_date : timestamp
  end_date : timestamp
}

entity "Guías de Remisión (Bienes/Paquetes)" as packages {
  * package_id : serial <<PK>>
  --
  tracking_code : varchar <<UNIQUE>>
  sender_id : int <<FK>>
  receiver_id : int <<FK>>
  route_id : int <<FK>> (opcional)
  description : text
  weight : decimal
  status : enum (received, assigned, in_transit, delivered, exception)
  created_at : timestamp
}

entity "Trazabilidad (Tracking Log)" as tracking_logs {
  * log_id : serial <<PK>>
  --
  package_id : int <<FK>>
  user_id : uuid <<FK>> (actor_who_changed)
  previous_status : varchar
  new_status : varchar
  location_note : varchar
  changed_at : timestamp
}

users ||--o{ entities : "has profile"
users ||--o{ routes : "dispatcher creates"
users ||--o{ routes : "driver assigned to"
users ||--o{ tracking_logs : "records event"

entities ||--o{ packages : "sends"
entities ||--o{ packages : "receives"

routes ||--o{ packages : "contains multiple"

packages ||--o{ tracking_logs : "has history"

@enduml
"""

def generate_er():
    puml_file = "ER_Diagram_Logistica.puml"
    img_file = "ER_Diagram_Logistica.png"
    
    with open(puml_file, "w", encoding="utf-8") as f:
        f.write(puml_content)
        
    print("Enviando a PlantUML Server...")
    try:
        # Enviar el archivo puml usando la API web publica de plantuml para no depender del JAR local
        import urllib.parse
        import zlib
        import base64
        import string

        # PlantUML encoding logic
        def plantuml_encode(data):
            zlibbed_str = zlib.compress(data.encode('utf-8'))
            compressed_string = zlibbed_str[2:-4]
            b64_str = base64.b64encode(compressed_string).decode('utf-8')
            b64_str = b64_str.translate(str.maketrans('+/', '-_'))
            return b64_str
            
        encoded = plantuml_encode(puml_content)
        url = f"http://www.plantuml.com/plantuml/png/{encoded}"
        
        urllib.request.urlretrieve(url, img_file)
        print(f"Diagrama guardado exitosamente en: {img_file}")
    except Exception as e:
        print(f"Error generando diagrama ER con la API web: {e}")

if __name__ == "__main__":
    generate_er()
