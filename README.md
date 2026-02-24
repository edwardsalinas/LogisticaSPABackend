# 🎓 Plataforma Generadora de Tesis: Logística Full Stack & IA
**Manual Técnico para Asistentes de Inteligencia Artificial**

> **🛑 INSTRUCCIÓN CRÍTICA PARA EL AGENTE DE IA LECTOR:** 
> Tienes el contexto activo de un repositorio que no es de código fuente tradicional, sino una **infraestructura Python Generadora de Tesis Académica** (formato MS Word `.docx`) orientada a la Ingeniería de Software (Arquitectura, Diagramas UML/C4, BPMN). 
> 
> Tu objetivo principal como Agente es continuar iterando sobre el contenido teórico de la Tesis, generando o modificando diagramas y recompilando el documento `docx` definitivo para el Usuario (`ESalinasCh`).

---

## 1. Contexto Global del Proyecto (Para el LLM)
El Tema de la Tesis que se está redactando es:
**"PLATAFORMA FULL STACK WEB INTEGRADA PARA LA GESTIÓN LOGÍSTICA DE BIENES Y SERVICIOS, ASISTIDA POR UN AGENTE CONVERSACIONAL DE INTELIGENCIA ARTIFICIAL"**

*   **Pila Tecnológica Teórica:** Frontend en React (LogisticaSPA), Backend en Node.js (NodeServer API), Agente IA en LangChain, Base de Datos PostgreSQL (Supabase DB).
*   **Archivos Base Proporcionados:** No debes modificar los PDFs de origen a menos que el Usuario lo pida. El documento de salida final que se evalúa se llama **`Perfil_Tesis_Capitulos_2_5.docx`**.

---

## 2. Arquitectura de los Scripts Generadores
Para realizar modificaciones a la Tesis, **NUNCA modifiques el `.docx` directamente**. Debes modificar los scripts `.py` que inyectan el contenido, y luego ejecutarlos.

### 2.1 Orquestador Principal
*   📄 **`generate_thesis_profile.py`**
    *   **Propósito:** Es el script madre. Contiene toda la redacción teórica dura (Capítulos 1 al 8) estructurada usando la librería `docx`.
    *   **Comportamiento:** Embebidas dentro del código están las rutas hacia las imágenes generadas (`.png`). Si el usuario te pide "*Añadir un nuevo capítulo*" o "*Modificar la redacción sobre el WAE*", debes modificar este archivo y ejecutarlo mediante la terminal: `python generate_thesis_profile.py`.

### 2.2 Constructores de Diagramas (Imágenes)
Al usuario o al tribunal de tesis le importan mucho los estándares arquitectónicos. Antes de inyectar una imagen nueva en el documento Word, primero debes usar los scripts para generarla desde código generativo (PlantUML, Mermaid o Graphviz).

1.  **Modelo WAE UML Clásico (El más importante)** ✅
    *   **Script:** `generate_wae_uml.py`
    *   **Uso:** Produce `WAE_UML_Logistica.png` usando la API de PlantUML. Emplea la sintaxis ortodoxa de Jim Conallen (`<<build>>`, `<<submit>>`, `<<link>>`) con los sprites visuales "vintage" en escala de grises de Rational Rose inyectados en código. *¡No modifiques este diagrama a menos que explícitamente se te pida salir del estándar WAE ortodoxo!*
2.  **Modelos C4 (Contexto, Contenedores, Componentes)**
    *   **Scripts:** `generate_c4_context.py` (y sus derivados).
    *   **Uso:** Producen archivos como `C4_Context_Logistica.png` y `C4_Container_Logistica.png` usando la librería Python `diagrams`. Detallan la arquitectura de software.
3.  **Diagramas Entidad-Relación (Mermaid)**
    *   **Script:** `generate_mermaid_er.py`
    *   **Uso:** Utiliza la API de `mermaid.ink` para generar un PNG con el esquema de Base de Datos relacional usando sintaxis de Ingeniería de Información (IE). Produce `ER_Diagram_Logistica_Mermaid.png`.
4.  **Flujos de Trabajo Empresarial (BPMN / IDEF0)**
    *   **Scripts:** `generate_bpmn.py` y `generate_idef0.py`.
    *   **Uso:** Explican logísticas de negocio, actores organizacionales (Chofer, Operador, Despacho) y flujos conversacionales IA en formato PlantUML y Mermaid.

---

## 3. Flujo de Trabajo (Workflow) Obligatorio para el Agente

Cuando el Usuario te diga *"Quiero agregar el Capítulo 9 sobre Pruebas"* o *"Cambia la imagen B por la C"*, este es el ciclo riguroso que debes seguir:

1.  **Abre y Analiza:** Revisa `generate_thesis_profile.py` para entender dónde irá el contenido nuevo usando tu herramienta `view_file`.
2.  **Modifica/Genera Diagramas (Si aplica):**
    *   Si se requiere una imagen nueva, crea o modifica el script `.py` pertinente (ej. PlantUML).
    *   Ejecuta el script en terminal (`python generate_nuevo_diagrama.py`) y asegúrate de que el `.png` se haya guardado exitosamente leyendo el output de la terminal.
3.  **Inyecta el Texto en el Orquestador:**
    *   Usa `replace_file_content` sobre `generate_thesis_profile.py` para añadir los `thesis.add_heading()`, `thesis.add_paragraph()` o `thesis.add_image()` en el flujo deseado.
4.  **Compila la Tesis:**
    *   Ejecuta inexcusablemente `python generate_thesis_profile.py`.
    *   Verifica que la salida sea `Documento guardado: Perfil_Tesis_Capitulos_2_5.docx`
5.  **Refleja en Git (Si se requiere):**
    *   Recuerda el comando `git add . && git commit -m "update" && git push` si el usuario desea guardar permanentemente el avance en GitHub.

## 4. Estilo y Redacción
El documento no es un simple programa de software; es un **Artefacto Académico de Maestría**. 
*   Usa siempre tono formal, en tercera persona o pasiva (ej. "Se desarrolla", "La arquitectura contempla", "El modelo de componentes establece").
*   Prioriza términos como "Trazabilidad", "Agente Cognitivo Algorítmico", "Gramática Relacional WAE", "Paradigma Single Page Application", "Arquitectura Full Stack".

¡Buena suerte, Agente! La Tesis depende de tu rigor arquitectónico.
