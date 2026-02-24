from thesis_builder import ThesisDocument
from generate_ishikawa import generate_ishikawa_diagram
import os

def generate_profile():
    # Generar diagrama Ishikawa
    is_diagram_path = "ishikawa_diagram.png"
    if not os.path.exists(is_diagram_path):
        print("Generando diagrama de Ishikawa...")
        generate_ishikawa_diagram(is_diagram_path)

    # Inicializar documento
    thesis = ThesisDocument("Perfil_Tesis_Capitulos_2_5.docx")

    # ==========================================
    # CARÁTULA (Modelo Jorge Siles)
    # ==========================================
    # Nota: Los saltos de línea y espaciados son aproximados para simular la portada
    thesis.add_heading("UNIVERSIDAD AUTÓNOMA “GABRIEL RENÉ MORENO”", level=1)
    thesis.add_heading("FACULTAD DE INGENIERÍA EN CIENCIAS DE LA", level=1)
    thesis.add_heading("COMPUTACIÓN Y TELECOMUNICACIONES", level=1)
    thesis.add_heading("UNIDAD DE POSGRADO", level=1)
    
    # Espacio para logo (si existiera imagen)
    thesis.add_paragraph("", align=1) 
    thesis.add_paragraph("", align=1)
    
    thesis.add_heading("PERFIL DE TESIS", level=2)
    thesis.add_paragraph("MAESTRÍA EN INGENIERÍA DE SOFTWARE", align=1) # Center
    
    thesis.add_paragraph("", align=1) # Espacio
    
    thesis.add_heading("“PLATAFORMA FULL STACK WEB INTEGRADA PARA LA GESTIÓN LOGÍSTICA DE BIENES Y SERVICIOS, ASISTIDA POR UN AGENTE CONVERSACIONAL DE INTELIGENCIA ARTIFICIAL”", level=2)
    
    thesis.add_paragraph("", align=1) # Espacio
    
    thesis.add_paragraph("Postulante: Ing. [Tu Nombre]", align=1)
    thesis.add_paragraph("Tutor: [Nombre del Tutor]", align=1)
    
    thesis.add_paragraph("", align=1) # Espacio
    
    thesis.add_paragraph("Santa Cruz - Bolivia", align=1)
    thesis.add_paragraph("2026", align=1)
    
    thesis.add_page_break()

    # ==========================================
    # CAPÍTULO 2: MARCO REFERENCIAL
    # ==========================================
    thesis.add_heading("2. MARCO REFERENCIAL", level=1)

    thesis.add_heading("2.1. Introducción", level=2)
    thesis.add_paragraph("La logística moderna de transporte y distribución, entendida como la columna vertebral del comercio y la cadena de suministro, enfrenta desafíos críticos en la era digital. La gestión eficiente del envío de bienes y la prestación de servicios de transporte (fletes, encomiendas, última milla) ya no puede depender de procesos manuales o sistemas legados monolíticos que carecen de interoperabilidad y trazabilidad en tiempo real.")
    thesis.add_paragraph("El presente proyecto propone el diseño y desarrollo de una Plataforma Web Full Stack integrada para la gestión logística de bienes (carga/encomiendas) y servicios (transporte), potenciada por un Agente Conversacional de Inteligencia Artificial. Esta solución busca transformar la interacción usuario-sistema, permitiendo a los clientes rastrear sus envíos y a los operadores gestionar la flota mediante consultas en lenguaje natural orquestadas con LangChain.")
    thesis.add_paragraph("Desde una perspectiva técnica, la propuesta arquitectónica se basa en un monolito modular, una estrategia que equilibra la simplicidad del despliegue con la mantenibilidad del código. La separación de responsabilidades mediante procesamiento asíncrono garantiza que las operaciones intensivas de la IA no degraden el rendimiento del núcleo operativo (creación de guías de remisión, asignación de rutas). Este documento detalla el marco teórico, los antecedentes y la problemática que justifican esta implementación.")

    thesis.add_heading("2.2. Antecedentes", level=2)
    thesis.add_paragraph("La evolución de los Sistemas de Gestión Logística (LMS) en empresas de transporte ha transitado desde registros físicos y llamadas telefónicas interminables hacia portales web estáticos. Tradicionalmente, rastrear un paquete requería que el cliente ingresara un código alfanumérico complejo, o que un operador de la empresa de transporte navegara por múltiples menús para conocer el estado de un camión o una ruta.")
    thesis.add_paragraph("En años recientes, la introducción de la Inteligencia Artificial Generativa ha marcado un hito disruptivo en la atención al cliente y la visibilidad operativa. Investigaciones demuestran cómo la integración de agentes conversacionales permite realizar consultas naturales, como \"¿Dónde está el paquete que envié ayer a La Paz?\" o \"¿Qué envíos están retrasados en la ruta Sur?\", en lugar de depender de filtros manuales. Este proyecto se fundamenta en estas tendencias para cerrar la brecha entre las operaciones de transporte estructuradas y la interacción humana.")

    thesis.add_heading("2.3. Descripción del objeto de estudio", level=2)
    thesis.add_paragraph("El objeto de estudio es el Sistema de Información Logístico Integrado, concebido como una plataforma web que centraliza las operaciones de recepción de encomiendas (bienes), asignación de vehículos/rutas (servicios de transporte), rastreo en tiempo real y entrega final (última milla).")
    thesis.add_paragraph("El sistema interactúa con tres actores principales:")
    thesis.add_bullet_paragraph("Administradores / Despachadores: Responsables de la asignación de rutas, gestión de flotas y supervisión operativa global.")
    thesis.add_bullet_paragraph("Operadores / Transportistas (Choferes): Encargados del registro de recolección, tránsito y confirmación de entrega (Proof of Delivery).")
    thesis.add_bullet_paragraph("Clientes / Remitentes: Usuarios finales que envían bienes y necesitan visibilidad del estado de sus servicios logísticos contratados.")
    thesis.add_paragraph("La innovación central reside en su módulo de asistencia inteligente, capaz de interpretar intenciones del cliente y del operador para brindar información instantánea sobre estados de envío y resúmenes de flota, reduciendo drásticamente la carga sobre los centros de atención telefónica.")

    thesis.add_heading("2.4. Identificación y formulación del problema de investigación", level=2)
    thesis.add_paragraph("A pesar de la disponibilidad de herramientas de gestión de flotas en el mercado, muchas empresas de transporte continúan operando con procesos fragmentados y \"ceguera operativa\" en la última milla. Los clientes experimentan frustración al no tener información clara sobre sus envíos, y los despachadores carecen de interfaces ágiles para gestionar excepciones en las rutas de servicio.")
    thesis.add_paragraph("La brecha identificada es la falta de integración entre las operaciones transaccionales de transporte (creación de guías, asignación de cargas) y las capacidades cognitivas de la IA moderna. Existe una necesidad no satisfecha de un sistema que automatice la atención al cliente respecto al rastreo de encomiendas y asista a los operadores en la visibilidad logística.")

    thesis.add_heading("2.5. Planteamiento y Formulación del Problema", level=2)
    
    thesis.add_heading("2.5.1. Situación actual", level=3)
    thesis.add_paragraph("Actualmente, el proceso operativo en empresas medianas de transporte y logística se caracteriza por:")
    thesis.add_bullet_paragraph("Saturación de canales de atención: Exceso de consultas telefónicas o por WhatsApp de clientes preguntando \"¿Dónde está mi paquete?\".")
    thesis.add_bullet_paragraph("Trazabilidad Deficiente: Retraso en la actualización de estados de los envíos (bienes), lo que genera incertidumbre durante la prestación del servicio de transporte.")
    thesis.add_bullet_paragraph("Interfaces Obsoletas: Herramientas poco intuitivas para los despachadores, dificultando la consolidación de cargas y la generación de reportes de rutas.")

    thesis.add_heading("2.5.2. Problema central", level=3)
    thesis.add_paragraph("Las empresas de logística carecen de una plataforma tecnológica unificada y proactiva para la gestión de envíos (bienes) y transporte (servicios), lo que resulta en altos costos de atención al cliente, pérdida de trazabilidad de la carga y retrasos en la respuesta ante incidencias operativas.")

    thesis.add_heading("2.5.3. Pregunta de Formulación", level=3)
    thesis.add_paragraph("¿De qué manera el diseño e implementación de una plataforma web Full Stack, basada en una arquitectura de monolito modular e integrada con un agente conversacional de Inteligencia Artificial, optimizará la gestión logística de transporte de bienes y servicios, mejorando la trazabilidad operativa y reduciendo la carga de atención al cliente?")

    thesis.add_heading("Diagrama de Causa-Efecto (Ishikawa)", level=3)
    thesis.add_paragraph("A continuación se presenta el diagrama de Ishikawa (1985) que detalla las causas raíz del problema central identificado:")
    
    # Insertar imagen generada
    if os.path.exists(is_diagram_path):
        thesis.add_image(is_diagram_path, width_inches=6.5, caption="Diagrama de Causa-Efecto (Ishikawa)")
    else:
        thesis.add_paragraph("[Error: No se encontró la imagen del diagrama de Ishikawa]")

    thesis.add_paragraph("El diagrama anterior ilustra la relación de causa y efecto que origina el problema central de la investigación. Se han categorizado las causas raíces en cuatro dimensiones principales:")
    thesis.add_bullet_paragraph("Tecnología: Sistemas de rastreo (tracking) deficientes o sin integración en tiempo real.")
    thesis.add_bullet_paragraph("Procesos: Dependencia de intervenciones manuales para actualizar el estado de los servicios de entrega.")
    thesis.add_bullet_paragraph("Personas: Personal de servicio al cliente saturado respondiendo consultas repetitivas de rastreo.")
    thesis.add_bullet_paragraph("Información: Dispersión de datos entre almacenes (hubs), vehículos en ruta y comprobantes físicos que imposibilita una gestión ágil.")
    thesis.add_paragraph("Esta estructura causal evidencia que la solución no puede ser únicamente tecnológica, sino que requiere un enfoque integral que automatice procesos y asista al cliente, tal como se propone con el sistema asistido por IA.")
    
    thesis.add_page_break()

    # ==========================================
    # CAPÍTULO 3: OBJETIVOS
    # ==========================================
    thesis.add_heading("3. OBJETIVOS", level=1)

    thesis.add_heading("3.1. Objetivo General", level=2)
    thesis.add_paragraph("Diseñar, desarrollar e implementar un sistema web Full Stack escalable bajo una arquitectura de monolito modular, integrando un agente conversacional de Inteligencia Artificial, para automatizar, optimizar y facilitar la gestión logística de bienes y servicios, garantizando la integridad de los datos, la seguridad de la información y una experiencia de usuario eficiente.")

    thesis.add_heading("3.2. Objetivos Específicos", level=2)
    thesis.add_bullet_paragraph("Diseñar la arquitectura del software basada en el patrón de monolito modular y el uso de contenedores Docker, para garantizar la escalabilidad, mantenibilidad y portabilidad del sistema en diferentes entornos.")
    thesis.add_bullet_paragraph("Desarrollar la interfaz de usuario (Frontend) utilizando tecnologías web modernas y componentes reutilizables, para proporcionar una experiencia de usuario intuitiva y responsiva que facilite la operación logística.")
    thesis.add_bullet_paragraph("Implementar la lógica de negocio y los servicios de backend mediante una API RESTful segura, para centralizar el procesamiento de datos y permitir la integración eficiente con el motor de Inteligencia Artificial.")
    thesis.add_bullet_paragraph("Establecer un esquema de seguridad multicapa con autenticación y control de acceso basado en roles (RBAC), para proteger la integridad de la información y prevenir accesos no autorizados.")
    thesis.add_bullet_paragraph("Integrar un agente conversacional basado en Modelos de Lenguaje Grande (LLMs), para asistir a los usuarios en consultas complejas y la toma de decisiones mediante lenguaje natural.")
    thesis.add_bullet_paragraph("Ejecutar un plan de pruebas integral (unitarias, integración y aceptación), para asegurar la calidad del software y la fiabilidad de las respuestas generadas por el agente inteligente.")
    thesis.add_bullet_paragraph("Elaborar la documentación técnica y manuales de usuario, para facilitar la transferencia de conocimiento, el despliegue y el mantenimiento futuro de la plataforma.")
    
    thesis.add_heading("3.3. Validación de objetivos", level=2)
    thesis.add_paragraph("Para garantizar la calidad y viabilidad de los objetivos planteados, se aplica la metodología SMART (Doran, 1981) al objetivo general y el método PART a los objetivos específicos.")

    # --- Validación SMART Objetivo General ---
    thesis.add_heading("3.3.1. Validación del Objetivo General (SMART)", level=3)
    thesis.add_paragraph("Objetivo General: Diseñar, desarrollar e implementar un sistema web Full Stack escalable bajo una arquitectura de monolito modular...", bold=False)
    
    thesis.add_bullet_paragraph("Specific (Específico): El objetivo delimita claramente la construcción de una plataforma web Full Stack con arquitectura de monolito modular e integración de un agente de IA, acotando el alcance tecnológico y funcional.")
    thesis.add_bullet_paragraph("Measurable (Medible): El éxito del proyecto se evidencia con la implementación funcional del sistema, la automatización de los reportes logísticos y la operatividad del asistente conversacional.")
    thesis.add_bullet_paragraph("Attainable (Alcanzable): La propuesta es viable dado que se utilizan tecnologías maduras (React, Node.js/Python, PostgreSQL) y servicios de IA accesibles vía API, acordes a la capacidad técnica del postulante.")
    thesis.add_bullet_paragraph("Relevant (Relevante): Soluciona la problemática crítica de falta de visibilidad y eficiencia en la gestión logística, aportando valor directo a la toma de decisiones estratégicas.")
    thesis.add_bullet_paragraph("Time-based (Temporal): El desarrollo e implementación se completará dentro del periodo académico establecido para la Maestría (6 meses).")

    # --- Validación PART Objetivos Específicos ---
    thesis.add_heading("3.3.2. Validación de Objetivos Específicos (PART)", level=3)
    thesis.add_paragraph("Se utiliza la estructura Process, Action, Result, Time para validar la operatividad de cada objetivo específico:")

    # O1
    thesis.add_paragraph("Objetivo 1: Diseño de Arquitectura", bold=True)
    thesis.add_bullet_paragraph("Process (Proceso): Ingeniería de Software y Diseño Arquitectónico.")
    thesis.add_bullet_paragraph("Action (Acción): Definir patrones de diseño, componentes y diagramas C4.")
    thesis.add_bullet_paragraph("Result (Resultado): Documento de Diseño de Arquitectura (ADD) validado.")
    thesis.add_bullet_paragraph("Time (Tiempo): Primer mes.")

    # O2
    thesis.add_paragraph("Objetivo 2: Desarrollo Frontend", bold=True)
    thesis.add_bullet_paragraph("Process (Proceso): Desarrollo Web Frontend.")
    thesis.add_bullet_paragraph("Action (Acción): Implementar interfaces responsivas con React.")
    thesis.add_bullet_paragraph("Result (Resultado): Interfaz de usuario intuitiva desplegada.")
    thesis.add_bullet_paragraph("Time (Tiempo): Meses 2 y 3.")

    # O3
    thesis.add_paragraph("Objetivo 3: Desarrollo Backend", bold=True)
    thesis.add_bullet_paragraph("Process (Proceso): Ingeniería Backend.")
    thesis.add_bullet_paragraph("Action (Acción): Desarrollar API RESTful y lógica de negocio.")
    thesis.add_bullet_paragraph("Result (Resultado): Servicios funcionales e integrados.")
    thesis.add_bullet_paragraph("Time (Tiempo): Meses 2, 3 y 4.")

    # O4
    thesis.add_paragraph("Objetivo 4: Seguridad", bold=True)
    thesis.add_bullet_paragraph("Process (Proceso): Gestión de Seguridad de la Información.")
    thesis.add_bullet_paragraph("Action (Acción): Configurar autenticación JWT y controles RBAC.")
    thesis.add_bullet_paragraph("Result (Resultado): Sistema seguro y protegido.")
    thesis.add_bullet_paragraph("Time (Tiempo): Transversal al desarrollo.")

    # O5
    thesis.add_paragraph("Objetivo 5: Integración IA", bold=True)
    thesis.add_bullet_paragraph("Process (Proceso): Integración de Sistemas Inteligentes.")
    thesis.add_bullet_paragraph("Action (Acción): Conectar LLMs mediante LangChain.")
    thesis.add_bullet_paragraph("Result (Resultado): Agente conversacional operativo.")
    thesis.add_bullet_paragraph("Time (Tiempo): Mes 4.")

    # O6
    thesis.add_paragraph("Objetivo 6: Pruebas y Despliegue", bold=True)
    thesis.add_bullet_paragraph("Process (Proceso): Aseguramiento de Calidad y DevOps.")
    thesis.add_bullet_paragraph("Action (Acción): Ejecutar test suites y orquestar contenedores.")
    thesis.add_bullet_paragraph("Result (Resultado): Software validado en producción.")
    thesis.add_bullet_paragraph("Time (Tiempo): Mes 5 y 6.")

    # O7
    thesis.add_paragraph("Objetivo 7: Documentación", bold=True)
    thesis.add_bullet_paragraph("Process (Proceso): Gestión del Conocimiento.")
    thesis.add_bullet_paragraph("Action (Acción): Redactar manuales técnicos y de usuario.")
    thesis.add_bullet_paragraph("Result (Resultado): Documentación final entregada.")
    thesis.add_bullet_paragraph("Time (Tiempo): Al finalizar el proyecto.")

    thesis.add_page_break()

    # ==========================================
    # CAPÍTULO 4: JUSTIFICACIÓN
    # ==========================================
    thesis.add_heading("4. JUSTIFICACIÓN", level=1)

    thesis.add_heading("4.1. Justificación Técnica", level=2)
    thesis.add_paragraph("La elección de una arquitectura de monolito modular permite equilibrar la mantenibilidad con la complejidad transaccional propia del registro de guías y movimientos geográficos. Al utilizar contenedores Docker y Supabase (PostgreSQL), la solución garantiza la consistencia ACID necesaria al transferir responsabilidades de carga (ej. un paquete pasa de la responsabilidad del almacén a la del chofer).")
    thesis.add_paragraph("La incorporación del agente conversacional (LangChain) desacopla la carga cognitiva del usuario. El procesamiento asíncrono permite que las complejas inferencias de NLP (Procesamiento de Lenguaje Natural) para responder a clientes no bloqueen el intenso flujo transaccional de los despachos logísticos en el núcleo del sistema, logrando una justificación arquitectónica sólida para el negocio de transporte de alta concurrencia.")

    thesis.add_heading("4.2. Justificación Institucional/Empresarial", level=2)
    thesis.add_paragraph("Desde una perspectiva de negocio, optimizar la gestión del transporte y las encomiendas incide directamente en los márgenes de rentabilidad. Automatizar la información de rastreo a través de un asistente de IA reduce drásticamente las llamadas al call center (costos operativos) y mejora sustancialmente la experiencia del cliente final.")
    thesis.add_paragraph("Paralelamente, otorgar a los despachadores y supervisores la capacidad de obtener \"insights\" logísticos al instante mediante lenguaje natural (ej. \"Cuántos despachos fallaron hoy por dirección incorrecta\") empodera la toma de decisiones basada en datos, vital en el entorno logístico donde el tiempo es el factor más crítico.")

    thesis.add_heading("4.3. Justificación Académica", level=2)
    thesis.add_paragraph("El desarrollo de este proyecto consolida las competencias clave de un Ingeniero Full Stack y Arquitecto de Software. Permite aplicar en un escenario real conceptos avanzados como:")
    thesis.add_bullet_paragraph("Diseño de patrones de arquitectura.")
    thesis.add_bullet_paragraph("Seguridad en aplicaciones web modernas.")
    thesis.add_bullet_paragraph("Integración de sistemas heterogéneos.")
    thesis.add_bullet_paragraph("Gestión del ciclo de vida del software.")
    thesis.add_paragraph("Este trabajo sirve como un referente académico sobre cómo integrar tecnologías emergentes en sistemas empresariales tradicionales, aportando al cuerpo de conocimiento de la universidad sobre arquitecturas híbridas.")
    
    thesis.add_heading("4.4. Justificación Metodológica", level=2)
    thesis.add_paragraph("El proyecto adoptará una metodología de desarrollo ágil adaptada a un contexto académico, permitiendo iteraciones rápidas y validación continua de los módulos. Se seguirán estándares de ingeniería de software para el control de versiones, documentación de código y pruebas automatizadas, asegurando que el producto final no sea solo un prototipo, sino un software con calidad de producción, auditable y sostenible en el tiempo.")

    thesis.add_page_break()

    # ==========================================
    # CAPÍTULO 5: ALCANCE Y DELIMITACIÓN
    # ==========================================
    thesis.add_heading("5. ALCANCE Y DELIMITACIÓN", level=1)

    thesis.add_heading("5.1. Alcance (Lo que SÍ se hará)", level=2)
    thesis.add_paragraph("El proyecto contempla el diseño, desarrollo y puesta en marcha de una plataforma web operativa que incluye los siguientes módulos funcionales:")
    
    thesis.add_paragraph("1. Módulo de Seguridad y Usuarios:", bold=True)
    thesis.add_bullet_paragraph("Autenticación segura y Control de Acceso (RBAC) diferenciando Administradores/Despachadores, Choferes/Operadores y Clientes.")

    thesis.add_paragraph("2. Módulo Core de Transporte y Encomiendas:", bold=True)
    thesis.add_bullet_paragraph("Gestión de Envíos (Bienes): Registro, generación de guías y códigos de seguimiento para carga o paquetería.")
    thesis.add_bullet_paragraph("Gestión de Rutas/Fletes (Servicios): Asignación de vehículos/choferes a hojas de ruta específicas.")
    thesis.add_bullet_paragraph("Tracking (Trazabilidad): Registro cronológico de hitos operativos (Recibido, En Tránsito, Entregado, Incidencia).")

    thesis.add_paragraph("3. Módulo de Asistente IA (Agente Conversacional):", bold=True)
    thesis.add_bullet_paragraph("Interfaz de chat en la aplicación web para clientes y personal.")
    thesis.add_bullet_paragraph("Traducción segura de lenguaje natural a consultas de BD para informar el estado o ubicación aproximada del envío.")
    thesis.add_bullet_paragraph("Capacidad de resumir datos operativos básicos para uso gerencial.")

    thesis.add_paragraph("4. Módulo de Operador/Transportista:", bold=True)
    thesis.add_bullet_paragraph("Interfaz simplificada para que los choferes o bodegueros puedan cambiar el estado de las guías y registrar entregas de manera rápida.")

    thesis.add_paragraph("5. Infraestructura y Despliegue:", bold=True)
    thesis.add_bullet_paragraph("Contenerización completa de la aplicación mediante Docker Compose.")
    thesis.add_bullet_paragraph("Scripts de inicialización y migración de base de datos automatizados.")

    thesis.add_heading("5.2. Limitaciones (Lo que NO se hará)", level=2)
    thesis.add_paragraph("Para garantizar la viabilidad del proyecto dentro de los plazos establecidos, se definen las siguientes restricciones:")

    thesis.add_paragraph("1. Limitaciones de Tiempo:", bold=True)
    thesis.add_paragraph("El desarrollo se circunscribe al calendario académico del programa de posgrado. Funcionalidades \"deseables\" que no sean críticas para el MVP (Producto Mínimo Viable) quedarán documentadas como trabajo futuro.")

    thesis.add_paragraph("2. Limitaciones de Infraestructura y Costos IA:", bold=True)
    thesis.add_paragraph("El sistema utilizará modelos de lenguaje accesibles vía API dentro de los límites de las capas gratuitas o de bajo costo. No se realizará entrenamiento profundo de modelos fundacionales debido a los altos requerimientos de GPU, sino que se utilizará ingeniería de prompts.")

    thesis.add_paragraph("3. Limitaciones de Integración Externa:", bold=True)
    thesis.add_paragraph("No se contempla la integración automática con sistemas de proveedores externos, facturación electrónica gubernamental, ni pasarelas de pago bancarias. El alcance logístico no incluye la geolocalización automatizada vía GPS físico de los camiones, sino que la ubicación se deduce del último hito registrado manualmente (ej. 'Recibido en Almacén X').")

    thesis.add_paragraph("4. Recursos Humanos:", bold=True)
    thesis.add_paragraph("El proyecto será ejecutado por un único desarrollador, asumiendo todos los roles del ciclo de desarrollo.")

    thesis.add_paragraph("5. Acceso a Datos Reales:", bold=True)
    thesis.add_paragraph("Por motivos de confidencialidad, las pruebas y demostraciones se realizarán con datos sintéticos o anonimizados, simulando la operación real de una empresa tipo, sin comprometer información sensible de ninguna organización específica.")

    # ==========================================
    # CAPÍTULO 6: MARCO TECNOLÓGICO Y CONCEPTUAL
    # ==========================================
    thesis.add_heading("6. MARCO TECNOLÓGICO Y CONCEPTUAL", level=1)
    thesis.add_paragraph("Este capítulo fundamenta las decisiones tecnológicas del proyecto a partir de la descomposición del título de la investigación: “PLATAFORMA FULL STACK WEB INTEGRADA PARA LA GESTIÓN LOGÍSTICA DE BIENES Y SERVICIOS, ASISTIDA POR UN AGENTE CONVERSACIONAL DE INTELIGENCIA ARTIFICIAL”. A continuación, se detalla el enfoque hacia el transporte de paquetería y gestión de flota:")

    thesis.add_paragraph("1. “Plataforma Full Stack Web Integrada”", bold=True)
    thesis.add_bullet_paragraph("Justificación: Una interfaz Web garantiza el acceso ubicuo tanto para despachadores en la oficina (Desktop) como para choferes en el campo (Mobile web). Supabase consolida la base de datos y la autenticación, reduciendo silos y unificando el ecosistema.")

    thesis.add_paragraph("2. “Para la Gestión Logística de Bienes y Servicios”", bold=True)
    thesis.add_bullet_paragraph("Justificación: Se interpreta \"Bienes\" como las encomiendas, paquetes o carga física de terceros en tránsito. Se interpreta \"Servicios\" como el servicio de transporte, la ruta o el flete en sí mismo. PostgreSQL garantiza la integridad relacional estricta requerida para vincular un paquete único con una hoja de ruta, un chofer y un histórico inmutable de estados.")

    thesis.add_paragraph("3. “Asistida por un Agente Conversacional de Inteligencia Artificial”", bold=True)
    thesis.add_bullet_paragraph("Justificación: El volumen de interacción con el cliente por el \"tracking\" o rastreo es altísimo en empresas de logística de transporte. Los LLMs orquestados con LangChain permiten crear un asistente cognitivo capaz de reemplazar el rastreo estructurado rígido por una asistencia natural 24/7.")

    # 6.1 Arquitectura
    thesis.add_heading("6.1. Arquitectura de Software", level=2)
    thesis.add_paragraph("Se confirma el patrón de **Monolito Modular** (Newman, 2015). Para mantener la coherencia y simplicidad arquitectónica, se implementará un único servidor backend en **Node.js (Express)**. Este servidor actuará como el orquestador central, conteniendo módulos internos claramente definidos para la lógica logística y el agente de IA.", bold=False)
    thesis.add_bullet_paragraph("Justificación Técnica: Al utilizar JavaScript tanto en el Frontend (React) como en el Backend (Node.js), se logra un 'isomorfismo' que reduce la carga cognitiva y facilita el mantenimiento. Evitar la fragmentación en microservicios prematuros elimina la latencia de red entre componentes y garantiza una consistencia transaccional robusta.")

    # 6.2 Stack Tecnológico
    thesis.add_heading("6.2. Stack Tecnológico", level=2)
    
    thesis.add_paragraph("Frontend:", bold=True)
    thesis.add_bullet_paragraph("React: Biblioteca para construir interfaces de usuario interactivas y basadas en componentes, aprovechando su ecosistema maduro (Meta Platforms Inc., 2024).")
    thesis.add_bullet_paragraph("Tailwind CSS: Framework para un diseño ágil y consistente.")

    thesis.add_paragraph("Plataforma de Backend, Datos e Infraestructura (BaaS):", bold=True)
    thesis.add_bullet_paragraph("Supabase: Base de datos y Autenticación gestionada (Supabase Inc., 2024).")
    thesis.add_bullet_paragraph("PostgreSQL: Motor de persistencia.")

    thesis.add_paragraph("Backend y Motor de Inteligencia Artificial (Monolito):", bold=True)
    thesis.add_bullet_paragraph("Node.js + Express: Entorno de ejecución y framework minimalista para construir la API y la lógica del agente. Permite unificar el lenguaje de desarrollo (JavaScript/TypeScript) en todo el stack.")
    thesis.add_bullet_paragraph("LangChain.js: Versión JavaScript del framework de orquestación de LLMs, permitiendo integrar la inteligencia artificial directamente en el flujo de Node.js sin requerir servicios externos en Python (Chase, 2022).")

    # 6.3 Seguridad
    thesis.add_heading("6.3. Seguridad", level=2)
    thesis.add_paragraph("La estrategia de seguridad se apoya en las capacidades nativas de Supabase y estándares modernos:", bold=False)
    thesis.add_bullet_paragraph("Autenticación: Supabase Auth para gestión de identidad segura (JWT), soportando login social y correo/contraseña.")
    thesis.add_bullet_paragraph("Autorización (RLS): Implementación de Row Level Security (RLS) en PostgreSQL para asegurar que cada usuario acceda solo a los datos permitidos según su rol.")
    thesis.add_bullet_paragraph("Protección de Datos: Cifrado en reposo y en tránsito (TLS/SSL).")
    thesis.add_bullet_paragraph("Buenas Prácticas OWASP: Prevención de inyecciones SQL mediante el uso de ORMs/Query Builders y validación de esquemas con Zod/Pydantic (OWASP Foundation, 2024).")
    
    thesis.add_page_break()

    thesis.add_page_break()

    # ==========================================
    # CAPÍTULO 7: ANÁLISIS DEL SISTEMA
    # ==========================================
    thesis.add_heading("7. ANÁLISIS DEL SISTEMA", level=1)

    thesis.add_heading("7.1. Actores del sistema", level=2)
    thesis.add_paragraph("A continuación se describen los principales actores que interactúan con la plataforma.")
    actores_headers = ["Actor", "Descripción", "Responsabilidades"]
    actores_rows = [
        ["Despachador / Administrador", "Usuario operativo central que supervisa la logística.", "Gestión de tarifas, creación de guías/rutas, monitoreo de la flota y asignación de despachos."],
        ["Transportista / Operador", "Personal en campo (chofer) o almacén (bodeguero).", "Recepción de ítems, actualización de estados de tránsito, confirmación de entregas (Proof of Delivery)."],
        ["Cliente / Remitente", "Actor externo que envía carga o contrata el servicio.", "Rastreo de encomiendas, interacción con la IA, consulta de estados."]
    ]
    thesis.add_table_with_data(actores_headers, actores_rows, caption="Actores del Sistema Logístico")

    thesis.add_heading("7.2. Requerimientos", level=2)
    thesis.add_heading("7.2.1. Requerimientos Funcionales", level=3)
    thesis.add_bullet_paragraph("RF01: El sistema debe permitir el registro completo de guías de remisión (identificando el bien) y hojas de ruta (identificando el servicio de transporte).")
    thesis.add_bullet_paragraph("RF02: El sistema debe permitir la actualización de estados transaccionales (Recibido, En Tránsito, En Agencia, Entregado, Siniestro) con marca de tiempo precisa.")
    thesis.add_bullet_paragraph("RF03: El sistema debe garantizar la trazabilidad de la cadena de custodia al vincular cada estado con un usuario responsable.")
    thesis.add_bullet_paragraph("RF04: El Agente IA debe ser capaz de consultar en lenguaje natural el estado logístico de una guía específica proporcionada por el cliente.")
    thesis.add_bullet_paragraph("RF05: El sistema debe proveer de un panel o dashboard de monitoreo para que los administradores identifiquen excepciones logísticas.")

    thesis.add_heading("7.2.2. Requerimientos No funcionales", level=3)
    thesis.add_bullet_paragraph("RNF01 (Rendimiento): Las consultas de trazabilidad desde el chat de IA no deben afectar la velocidad de inserción de nuevas guías por parte de los despachadores.")
    thesis.add_bullet_paragraph("RNF02 (Usabilidad Mobile): La interfaz del 'Transportista/Operador' debe ser responsiva y óptima para su uso en teléfonos móviles.")
    thesis.add_bullet_paragraph("RNF03 (Concurrencia): El sistema debe soportar lecturas concurrentes elevadas originadas por cientos de clientes intentando rastrear sus paquetes al mismo tiempo.")

    thesis.add_heading("7.3. Historias de Usuario", level=2)
    thesis.add_paragraph("A continuación se presentan Historias de Usuario reenfocadas en el ecosistema de entrega de última milla/transporte:")
    
    thesis.add_paragraph("HU01: Trazabilidad Natural de Paquetes", bold=True)
    thesis.add_paragraph("Como Cliente, quiero preguntar al Agente Chatbot sobre el estado de mi envío en lenguaje natural, para evitar tener que navegar por portales de tracking confusos o llamar por teléfono.")
    thesis.add_paragraph("Criterios de Aceptación Técnicos:", bold=False)
    thesis.add_bullet_paragraph("Dado que el usuario pregunta '¿Dónde está mi caja a nombre de Juan Pérez?' o da su código, Cuando el motor NLP lo procesa, Entonces ejecuta una consulta filtrada a la tabla de trazabilidad en PostgreSQL para ese identificador y devuelve el estado actual y el último punto geográfico conocido/hub.")

    thesis.add_paragraph("HU02: Confirmación de Entrega Operativa", bold=True)
    thesis.add_paragraph("Como Transportista, quiero registrar la entrega exitosa del paquete de forma rápida desde mi dispositivo, para actualizar el estado del servicio de logística en tiempo real.")
    thesis.add_paragraph("Criterios de Aceptación Técnicos:", bold=False)
    thesis.add_bullet_paragraph("Dado que el chofer tiene el paquete, Cuando presiona 'Confirmar Entrega' y añade una nota opcional, Entonces el backend inserta el registro transaccional validando el JWT del conductor y cerrando el ciclo del servicio asignado.")

    thesis.add_heading("7.4. Modelado del sistema", level=2)
    
    thesis.add_heading("7.4.1. Modelo IDEF0 (Producto)", level=3)
    thesis.add_paragraph("El modelo IDEF0 permite visualizar las funciones del sistema de información logístico, identificando sus Entradas, Controles, Salidas y Mecanismos (ICOMs).")
    idef_path = "IDEF0_Plataforma_Logistica.png"
    if os.path.exists(idef_path):
        thesis.add_image(idef_path, width_inches=6.0, caption="Modelo IDEF0 del Sistema Logístico")
    else:
        thesis.add_paragraph("[La imagen del modelo IDEF0 no se encuentra disponible]")

    thesis.add_heading("7.4.2. Business Process Model and Notation (BPMN)", level=3)
    thesis.add_paragraph("El modelado de procesos de negocio proporciona una visión detallada del flujo de actividades, eventos y compuertas de decisión desde la solicitud de un bien o servicio hasta su finalización.")
    thesis.add_paragraph("A través de estos carriles (swimlanes) se identifican las responsabilidades de cada actor (Usuario final, Operador de Almacén, Administrador y la Plataforma Web/IA), evidenciando los puntos de interacción e integración entre los procesos humanos y las tareas asíncronas automatizadas.")
    
    bpmn_path = "BPMN_Plataforma_Logistica.png"
    if os.path.exists(bpmn_path):
        thesis.add_image(bpmn_path, width_inches=6.0, caption="Diagrama de Procesos Logísticos Asistidos por IA (Notación BPMN/Swimlane)")
    else:
        import subprocess
        print("Diagrama BPMN no encontrado. Generando con PlantUML...")
        try:
            subprocess.run(["python", "generate_bpmn.py"], check=True)
            if os.path.exists(bpmn_path):
                thesis.add_image(bpmn_path, width_inches=6.0, caption="Diagrama de Procesos Logísticos Asistidos por IA (Notación BPMN/Swimlane)")
        except Exception as e:
            thesis.add_paragraph(f"[La imagen del modelo BPMN no se pudo cargar. Error: {e}]")
            
    thesis.add_page_break()

    # ==========================================
    # CAPÍTULO 8: DISEÑO DEL SISTEMA
    # ==========================================
    thesis.add_heading("8. DISEÑO DEL SISTEMA", level=1)
    thesis.add_paragraph("Este capítulo detalla la estructura principal del sistema, considerado el núcleo de la especialidad técnica. Se abordan las decisiones de diseño arquitectónico y el modelo de datos relacional que soportará la operativa logística y la trazabilidad de los paquetes.")

    thesis.add_heading("8.1. Arquitectura General", level=2)
    thesis.add_paragraph("Para comprender la interacción detallada de los componentes del software en todas sus capas, la arquitectura de la solución se modela combinando el estándar WAE UML (Web Application Extension) para las interacciones web cliente-servidor, y el modelo C4 para la visualización estructural por niveles de abstracción.")

    thesis.add_heading("8.1.1. Modelo WAE UML", level=3)
    thesis.add_paragraph("La arquitectura de la solución ha sido modelada conceptualmente basándose en el estándar Web Application Extension (WAE) propuesto por Jim Conallen. Este framework permite estructurar rigurosamente las fronteras de los componentes web a través de estereotipos funcionales.")

    wae_path = "WAE_UML_Logistica.png"
    if os.path.exists(wae_path):
        thesis.add_image(wae_path, width_inches=6.0, caption="Modelo WAE UML")
    else:
        thesis.add_paragraph("[El diagrama WAE UML no se encuentra disponible]")

    thesis.add_paragraph("Como se observa en el modelo, el ciclo de vida de la plataforma logística se rige por la estricta gramática relacional de interacciones dictada por WAE, la cual estructura la delegación de responsabilidades entre el Cliente y el Servidor:")
    
    thesis.doc.add_paragraph("1. Relación <<build>> (Server API a LogisticaSPA y Componentes): El servidor Backend («Server Page») inicializa, construye y envía el modelo lógico hacia el navegador del cliente. Esto conforma la vista principal 'LogisticaSPA' y sus componentes interactivos (Chat y Formulario).", style='List Bullet')
    thesis.doc.add_paragraph("2. Relación <<submit>> (TrackingForm a Server API): El Operador o el Cliente ingresa comandos (como el código de una guía) y la interfaz los empaqueta para forzar un envío explícito (submit) u operación transaccional hacia el 'NodeServer API'.", style='List Bullet')
    thesis.doc.add_paragraph("3. Relación <<submit>> (AIChatBot a Server API): De idéntica forma, el usuario despacha intenciones y contexto natural al chat, siendo el componente cliente el encargado de tramitar estos payloads hacia el endpoint /api/chat del backend para su procesamiento inteligente.", style='List Bullet')
    thesis.doc.add_paragraph("4. Relación <<link>> (LogisticaSPA a Server API): Cumpliendo la gramática clásica WAE, esta relación ilustra la capacidad del cliente web para navegar o enlazar programáticamente con las diversas rutas (endpoints) expuestas por el servidor Backend.", style='List Bullet')
    thesis.doc.add_paragraph("5. Relación <<queries>> (API a Database): Establece la conexión directa y unidireccional entre el Backend ('NodeServer API') y el repositorio físico 'Supabase DB' para afectar transaccionalmente las tablas logísticas de interés.", style='List Bullet')
    thesis.doc.add_paragraph("6. Relaciones <<delegates>> y <<SQL Tool>>: Son fundamentales para la integración de Inteligencia Artificial en el modelo WAE. El servidor clásico delega la interpretación del lenguaje a su par 'LangChainService', y es este último («Server Component») quien ostenta la autonomía para formular consultas a la base de datos armando secuencias SQL dinámicas para el rastreo.", style='List Bullet')

    thesis.add_paragraph("Mediante esta disposición WAE, la frontera de despliegue queda sólidamente justificada ante cualquier auditoría. Se garantiza la protección transaccional separando por completo las interfaces inseguras que corren en el navegador, de los potentes componentes servidores de Inteligencia Artificial y persistencia de bases de datos que habitan en la capa Backend.")

    # C4 Nivel 1 Contexto
    thesis.add_heading("8.1.2. Diagrama C4 - Nivel de Contexto", level=3)
    thesis.add_paragraph("El diagrama de contexto ilustra cómo los distintos actores del sistema interactúan con la plataforma central y cómo esta última se comunica con el servicio externo de Inteligencia Artificial.")
    
    c4_l1_path = "C4_Context_Logistica.png"
    if os.path.exists(c4_l1_path):
        thesis.add_image(c4_l1_path, width_inches=6.0, caption="Diagrama C4 Nivel 1: Contexto de la Plataforma")
    else:
        thesis.add_paragraph("[La imagen del diagrama C4 de Contexto no se encuentra disponible]")

    thesis.add_paragraph("Como se observa en el diagrama, el Cliente interactúa predominante a través del módulo de chat asistido (procesamiento NLP), mientras que el Despachador y el Chofer interactúan con las interfaces transaccionales para la gestión de rutas y confirmación de entregas.")

    # C4 Nivel 2 Contenedores
    thesis.add_heading("8.1.3. Diagrama C4 - Nivel de Contenedores", level=3)
    thesis.add_paragraph("El diagrama de contenedores desglosa la 'Plataforma Logística' en sus macro-partes desplegables: el Frontend (Single Page Application web/móvil), el Backend Monolítico (API de Node.js donde reside la lógica LangChain) y la Base de Datos Relacional (Supabase).")

    c4_l2_path = "C4_Container_Logistica.png"
    if os.path.exists(c4_l2_path):
        thesis.add_image(c4_l2_path, width_inches=6.0, caption="Diagrama C4 Nivel 2: Contenedores Desplegables")
    else:
        thesis.add_paragraph("[El diagrama C4 Nivel 2 no se encuentra disponible]")

    # C4 Nivel 3 Componentes Backend
    thesis.add_heading("8.1.4. Diagrama C4 - Nivel de Componentes (Backend)", level=3)
    thesis.add_paragraph("Realizando un zoom dentro del Backend API, el diagrama de componentes muestra los servicios internos: Seguridad (Auth), Core Logístico (Rutas y Guías), Trazabilidad Histórica y el Agente Conversacional, ilustrando cómo la IA solo interacciona en modo lectura con las tablas logísticas.")

    c4_l3_path = "C4_Component_Logistica.png"
    if os.path.exists(c4_l3_path):
        thesis.add_image(c4_l3_path, width_inches=6.0, caption="Diagrama C4 Nivel 3: Componentes del Backend API")
    else:
        thesis.add_paragraph("[El diagrama C4 Nivel 3 no se encuentra disponible]")

    # C4 Nivel 3 Componentes Frontend
    thesis.add_heading("8.1.5. Diagrama C4 - Nivel de Componentes (Frontend SPA)", level=3)
    thesis.add_paragraph("Del mismo modo, enfocándonos en el contenedor Single Page Application, se ilustran los componentes principales de React: Auth Context, Gestor de Rutas, Vista Móvil del Chofer y la Interfaz de Chat Inteligente.")

    c4_fe_path = "C4_Component_Frontend.png"
    if os.path.exists(c4_fe_path):
        thesis.add_image(c4_fe_path, width_inches=6.0, caption="Diagrama C4 Nivel 3: Componentes del Frontend React")
    else:
        thesis.add_paragraph("[El diagrama C4 de Frontend no se encuentra disponible]")

    # C4 Nivel 4 Código (Secuencia NLP)
    thesis.add_heading("8.1.6. Diagrama de Secuencia (Flujo Rastreo IA)", level=3)
    thesis.add_paragraph("Para comprender el caso de uso principal (Rastreo mediante NLP), el siguiente diagrama de secuencia detalla cómo la petición del usuario viaja desde el Frontend, al orquestador LangChain, interroga la base de datos como una \"Herramienta (Tool)\" y finalmente el LLM (OpenAI) genera una respuesta semántica.")

    c4_seq_path = "C4_Sequence_IA.png"
    if os.path.exists(c4_seq_path):
        thesis.add_image(c4_seq_path, width_inches=6.0, caption="Diagrama de Secuencia: Flujo de Consulta IA al Motor Relacional")

    # UML 2.5 Componentes con Perfil Personalizado
    thesis.add_heading("8.1.7. Modelo de Componentes UML 2.5 (Perfil Personalizado)", level=3)
    thesis.add_paragraph("Para complementar la visión arquitectónica y proporcionar un detalle técnico más riguroso de las tecnologías implementadas, se ha elaborado un Modelo de Componentes bajo el estándar UML 2.5. Dado que el UML clásico no siempre posee las nomenclaturas web modernas por defecto, se ha creado e inyectado un Perfil UML Personalizado con estereotipos específicos.")
    
    thesis.add_paragraph("Glosario del Perfil UML Personalizado:", bold=True)
    thesis.doc.add_paragraph("• «spa»: Single Page Application, representa la aplicación web estática que corre enteramente en el navegador del usuario.", style='List Bullet')
    thesis.doc.add_paragraph("• «react component»: Componente reutilizable de interfaz de usuario construido de forma reactiva en el Frontend virtual.", style='List Bullet')
    thesis.doc.add_paragraph("• «express controller»: Controlador del backend en Node.js encargado de sanear solicitudes, aplicar middleware y ejecutar lógica de negocio.", style='List Bullet')
    thesis.doc.add_paragraph("• «rest endpoint»: Punto de enrutamiento que expone las capacidades HTTP (o puertos WSS) hacia el frontend.", style='List Bullet')
    thesis.doc.add_paragraph("• «llm service»: Servicio de Backend especializado en la integración semántica y orquestación dinámica (como LangChain).", style='List Bullet')
    thesis.doc.add_paragraph("• «database»: Repositorio remoto para la persistencia transaccional y el mapeo objeto-relacional (ORM).", style='List Bullet')
    thesis.doc.add_paragraph("• «external api»: Servicio de terceros consumido a nivel Cloud (ej. las llamadas de inferencia de OpenAI).", style='List Bullet')

    uml_comp_path = "UML_Componentes_Logistica.png"
    if os.path.exists(uml_comp_path):
        thesis.add_image(uml_comp_path, width_inches=6.0, caption="Modelo de Componentes UML 2.5 (Perfil Personalizado SPA/API)")
    else:
        thesis.add_paragraph("[El diagrama de Componentes UML no se encuentra disponible]")

    thesis.add_heading("8.2. Modelo de Datos", level=2)
    thesis.add_paragraph("La estructura de la base de datos es fundamental para garantizar la integridad histórica de la trazabilidad. Se ha diseñado un esquema relacional optimizado para consultas de agregación y filtros nativos.")

    thesis.add_heading("8.2.1. Diagrama de Entidad Relación (ER)", level=3)
    thesis.add_paragraph("El siguiente diagrama expone las entidades del dominio, sus llaves primarias, foráneas y multiplicidad estricta, representadas mediante la notación de Ingeniería de Información (IE) de Mermaid.")

    er_path = "ER_Diagram_Logistica_Mermaid.png"
    if os.path.exists(er_path):
        thesis.add_image(er_path, width_inches=6.0, caption="Modelo Relacional (ER) de la Base de Datos")
    else:
        thesis.add_paragraph("[La imagen del diagrama ER no se encuentra disponible]")

    thesis.add_paragraph("Entidades Core:", bold=True)
    thesis.add_bullet_paragraph("auth_users: Sistema de cuentas de Supabase (Admin, Choferes, Clientes).")
    thesis.add_bullet_paragraph("packages (Guías de Remisión): Almacena la carga física, el peso y el código único de tracking.")
    thesis.add_bullet_paragraph("transport_routes (Rutas/Fletes): Agrupa paquetes bajo la responsabilidad de un conductor específico para un trayecto.")
    thesis.add_bullet_paragraph("tracking_logs (Trazabilidad): Entidad principal del modelo. Guarda inmutablemente cada cambio de estado, quién lo realizó, fecha precisa y opcionalmente coordenadas GPS de la entrega.")

    thesis.add_page_break()
    thesis.add_heading("8. REFERENCIAS BIBLIOGRÁFICAS", level=1)
    
    # Lista alfabética
    thesis.add_paragraph("Chase, H. (2022). LangChain: Building applications with LLMs through composability. Recuperado de https://python.langchain.com/")
    thesis.add_paragraph("Chopra, S., & Meindl, P. (2016). Supply Chain Management: Strategy, Planning, and Operation (6th ed.). Pearson.")
    thesis.add_paragraph("Docker Inc. (2024). Docker Overview. Recuperado de https://docs.docker.com/get-started/overview/")
    thesis.add_paragraph("Doran, G. T. (1981). There's a S.M.A.R.T. way to write management's goals and objectives. Management Review, 70(11), 35-36.")
    thesis.add_paragraph("Ishikawa, K. (1985). What Is Total Quality Control? The Japanese Way. Prentice-Hall.")
    thesis.add_paragraph("Meta Platforms Inc. (2024). React - The library for web and native user interfaces. Recuperado de https://react.dev/")
    thesis.add_paragraph("Min, H. (2010). Artificial intelligence in supply chain management: theory and applications. International Journal of Logistics Research and Applications, 13(1), 13-39.")
    thesis.add_paragraph("Newman, S. (2015). Building Microservices: Designing Fine-Grained Systems. O'Reilly Media.")
    thesis.add_paragraph("OWASP Foundation. (2024). OWASP Top Ten Web Application Security Risks. Recuperado de https://owasp.org/www-project-top-ten/")
    thesis.add_paragraph("Supabase Inc. (2024). Supabase Documentation. Recuperado de https://supabase.com/docs")

    # Guardar documento
    thesis.save()
    print("Documento guardado: Perfil_Tesis_Capitulos_2_5.docx")

if __name__ == "__main__":
    generate_profile()
