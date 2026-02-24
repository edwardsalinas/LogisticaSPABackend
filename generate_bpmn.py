import sys
import subprocess
import os

try:
    from plantuml import PlantUML
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "plantuml"])
    from plantuml import PlantUML

puml_text = """
@startuml
skinparam style strictuml
skinparam ActivityBackgroundColor #E3F2FD
skinparam ActivityBorderColor #1565C0
skinparam ActivityDiamondBackgroundColor #FFF8E1
skinparam ActivityDiamondBorderColor #FF8F00
skinparam SwimlaneBorderColor #90A4AE
skinparam SwimlaneBorderThickness 2
skinparam SwimlaneTitleBackgroundColor #CFD8DC
skinparam SwimlaneTitleFontColor #263238
skinparam DefaultFontName Arial

|Usuario Final|
start
:Ingresa Solicitud de\\nBien/Servicio;

|Plataforma Web / IA|
:Registra Solicitud en BD;
:Verifica Stock Disponible;

if (¿Stock\\nSuficiente?) then (Sí)
    |Operador de Almacén|
    :Prepara Despacho;
    :Confirma Salida;
    
    |Plataforma Web / IA|
    :Actualiza Inventario BD;
    :Envía Notificación;
else (No)
    |Plataforma Web / IA|
    :Genera Alerta de\\nStock Crítico;
    
    |Administrador de Logística|
    :Aprueba Orden\\nde Compra;
    
    |Plataforma Web / IA|
    :Emite Orden a\\nProveedor;
    
    |Operador de Almacén|
    :Recibe Nueva Mercadería;
    :Ingresa Items al Sistema;
    
    |Plataforma Web / IA|
    :Actualiza Inventario BD;
    :Notifica Disponibilidad;
    
    |Operador de Almacén|
    :Prepara Despacho de\\nReserva;
endif

|Usuario Final|
:Recepción de\\nBien/Servicio;
stop
@enduml
"""

with open("bpmn_diagram.puml", "w", encoding="utf-8") as f:
    f.write(puml_text)

print("Generando diagrama a través del servidor PlantUML...")
server = PlantUML(url='http://www.plantuml.com/plantuml/img/',
                  basic_auth={},
                  form_auth={}, http_opts={}, request_opts={})

server.processes_file('bpmn_diagram.puml', outfile='BPMN_Plataforma_Logistica.png')
print("Diagrama guardado exitosamente como BPMN_Plataforma_Logistica.png")
