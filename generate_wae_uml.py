import urllib.request
import base64
import zlib
import os
import string

# Algoritmo de codificación oficial de PlantUML
def plantuml_encode(plantuml_text):
    zlibbed_str = zlib.compress(plantuml_text.encode('utf-8'))
    compressed_string = zlibbed_str[2:-4]
    plantuml_alphabet = string.digits + string.ascii_uppercase + string.ascii_lowercase + '-_'
    base64_alphabet   = string.ascii_uppercase + string.ascii_lowercase + string.digits + '+/'
    b64_to_plantuml = str.maketrans(base64_alphabet, plantuml_alphabet)
    return base64.b64encode(compressed_string).decode('utf-8').translate(b64_to_plantuml)

# Usaremos imágenes referenciales codificadas en PlantUML sprite format (16 color grayscale)
# En lugar de FontAwesome, se inyectan los iconos "vintage" exactos de Rational Rose WAE
wae_puml_visual = """
@startuml
skinparam style strictuml
skinparam class {
    BackgroundColor White
    BorderColor #2C3E50
    ArrowColor #2C3E50
    HeaderBackgroundColor White
    stereo {
       FontSize 14
       FontColor #005A9C
    }
}

' Iconos custom (Sprites 16x16 / 32x32 generados desde los originales de Conallen)
sprite $server_page [32x32/16] {
00000000000000000000000000000000
00000000000479A99500000000000000
000000000049DDDD9400000000000000
00000000009DDDDDD900000000000000
00000000009DDDDDD900000000000000
00000000009DDDDDD900000000000000
00000000009D444DD900000000000000
00000000009D004DD900000000000000
00000000009DDDDDD900000000000000
00000000009DDDDDD900000000000000
00000000009DDDDDD900000000000000
00000000009DDDDDD900000000000000
0000000499AADDDDAA99400000000000
00000049DDDDDDDDDDDD940000000000
0000049DDDDDDDDDDDDDD94000000000
000049DDDDDDDDDDDDDDDD9400000000
00009AAAAAAAAAAAAAAAAAA900000000
00009ADDDDDDDDDDDDDDDDA900000000
00009AD44DAAAAA44444DDA900000000
00009AD44DAAAAA44444DDA900000000
00009ADDDDDDDDDDDDDDDDA900000000
00009AAAAAAAAAAAAAAAAAA900000000
00000000000000000000000000000000
00000000000000000000000000000000
}

sprite $client_page [32x32/16] {
00000000000000000000000000000000
00000499999999999999999999999400
000009DDDDDDDDDDDDDDDDDDDDDDD900
000009DDDDDDDDDDDDDDDDDDDDDDD900
000009AAAAAAAAAAAAAAAAAAAAAAA900
000009ADDDDDDDDDDDDDDDDDDDDDA900
000009ADDD4999A995000000DDDDA900
000009ADDD9DDDDDD9000000DDDDA900
000009ADDD9DDDDDD9000000DDDDA900
000009ADDD9DDDDDD9000000DDDDA900
000009ADDD9D444DD9000000DDDDA900
000009ADDD9D004DD9000000DDDDA900
000009ADDD9DDDDDD9000000DDDDA900
000009ADDD9DDDDDD9000000DDDDA900
000009ADDD9DDDDDD9000000DDDDA900
000009ADDD9DDDDDD9000000DDDDA900
000009ADDDAAAAAAA5000000DDDDA900
000009ADDDDDDDDDDDDDDDDDDDDDA900
000009AAAAAAAAAAAAAAAAAAAAAAA900
00000000000000000000000000000000
00000000000000000000000000000000
}

sprite $form_page [32x32/16] {
00000000000000000000000000000000
00000499999999999999999999999400
000009DDDDDDDDDDDDDDDDDDDDDDD900
000009DDDDDDDDDDDDDDDDDDDDDDD900
000009AAAAAAAAAAAAAAAAAAAAAAA900
000009ADDDDDDDDDDDDDDDDDDDDDA900
000009AD49999999999999995DDDA900
000009AD9DDDDDDDDDDDDDDD9DDDA900
000009AD5AAAAAAAAAAAAAAA0DDDA900
000009ADDDDDDDDDDDDDDDDDDDDDA900
000009AD49999999999999995DDDA900
000009AD9DDDDDDDDDDDDDDD9DDDA900
000009AD5AAAAAAAAAAAAAAA0DDDA900
000009ADDDDDDDDDDDDDDDDDDDDDA900
000009AD499999995DDDDDDDDDDDA900
000009AD9DDDDDDD9DDDDDDDDDDDA900
000009AD5AAAAAAA0DDDDDDDDDDDA900
000009ADDDDDDDDDDDDDDDDDDDDDA900
000009AAAAAAAAAAAAAAAAAAAAAAA900
00000000000000000000000000000000
00000000000000000000000000000000
}


title Modelo WAE UML

class "<color:#005A9C><$client_page,scale=1.5></color>\\n<color:#005A9C>«Client Page»</color>\\nLogisticaSPA" as ClientPage {
  + useEffect()
  + renderDashboard()
}

class "<color:#005A9C><$form_page,scale=1.5></color>\\n<color:#005A9C>«Form»</color>\\nTrackingForm" as Form {
  + package_id: string
  + onSubmit()
}

class "<color:#005A9C><$client_page,scale=1.5></color>\\n<color:#005A9C>«Client Component»</color>\\nAIChatBot" as Chat {
  + messages: array
  + sendMessage(text)
}

class "<color:#005A9C><$server_page,scale=1.5></color>\\n<color:#005A9C>«Server Page»</color>\\nNodeServer API" as Server {
  + /api/tracking/:id
  + /api/chat
}

class "<color:#005A9C><$server_page,scale=1.5></color>\\n<color:#005A9C>«Server Component»</color>\\nLangChainService" as Agent {
  + invokeLLM(prompt)
  + queryDB(sql)
}

class "Supabase DB" as DB <<Database>> {
  + transport_routes
  + packages_status
}

' Relaciones (Gramática Estricta WAE - Conallen)
Server ..> ClientPage : <color:#005A9C><<build>></color>
Server ..> Chat : <color:#005A9C><<build>></color>

Form ..> Server : <color:#005A9C><<submit>></color>
Chat ..> Server : <color:#005A9C><<submit>></color>

ClientPage ..> Server : <color:#005A9C><<link>></color>

Server ..> DB : <<queries>>
Server ..> Agent : <<delegates>>
Agent ..> DB : <<SQL Tool>>

@enduml
"""

def generate_wae_diagram():
    print("Generando Diagrama WAE UML Orientado a SPA...")
    
    encoded = plantuml_encode(wae_puml_visual)
    url = f"http://www.plantuml.com/plantuml/png/{encoded}"
    
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as res, open("WAE_UML_Logistica.png", 'wb') as f:
            f.write(res.read())
        print("[OK] Diagrama WAE UML (Vintage SPA) generado exitosamente.")
    except Exception as e:
        print(f"[FALLO] Error generando WAE UML visual: {e}")

if __name__ == "__main__":
    generate_wae_diagram()
