import urllib.request
import urllib.parse
import zlib
import base64

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
    import string
    
    # Simple base64 encode for PlantUML format (defalte + custom b64)
    # This matches the PlantUML standard
    
    encoded = base64.b64encode(zlib.compress(puml_content.encode('utf-8'))).decode('utf-8')
    trans = str.maketrans('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
                          '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_')
    encoded = encoded.translate(trans)
    
    # Or just use the alternative plantuml-encoded endpoint from Python plantuml lib logic which is simpler:
    import plantuml
    try:
        pl = plantuml.PlantUML("http://www.plantuml.com/plantuml/img/")
        success = pl.processes(puml_content)
        if success:
           with open("ER_Diagram_Logistica.png", "wb") as w:
               w.write(success)
           print("ER Diagram guardado!")
           return
    except Exception as e:
        print(f"Error con libreria plantuml externa: {e}")
        pass

if __name__ == "__main__":
    generate_er()
