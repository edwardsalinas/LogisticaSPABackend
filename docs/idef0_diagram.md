# Diagrama IDEF0: Sistema de Generación de Monografías Asistido por IA (GMA-IA)

Este documento describe el funcionamiento técnico del sistema GMA-IA, estructurado bajo el estándar IDEF0 para mostrar la jerarquía funcional y flujos de datos.

## Nivel A-0: Contexto del Sistema

El sistema GMA-IA integra tecnologías web, procesamiento de lenguaje natural y scripts de automatización para producir documentos académicos.

```mermaid
graph TD
    %% Controles (Top)
    C1[Prompt Engineering Guidelines] --- |Control| A0
    C2[Límites de API Gemini] --- |Control| A0
    C3[Normativa Académica/APA] --- |Control| A0

    %% Entradas (Left)
    I1[Solicitudes del Usuario] --> |Input| A0
    I2[Referencias Bibliográficas .pdf] --> |Input| A0
    I3[Configuración de Perfil] --> |Input| A0

    %% Función Principal
    A0(A-0: Operar Sistema de Generación de Monografías Asistido por IA)

    %% Salidas (Right)
    A0 --> |Output| O1[Documento Final .docx]
    A0 --> |Output| O2[Diagramas Generados .png]
    A0 --> |Output| O3[Logs y Reportes de Error]

    %% Mecanismos (Bottom)
    M1[Backend Node.js / Express] --- |Mechanism| A0
    M2[Agentes de IA - Gemini 1.5/2.0] --- |Mechanism| A0
    M3[Scripts de Python - Thesis Builder] --- |Mechanism| A0
    M4[Infraestructura Supabase] --- |Mechanism| A0

    style A0 fill:#f9f,stroke:#333,stroke-width:4px
```

---

## Nivel A0: Descomposición Funcional del Sistema

Se detallan los módulos técnicos y su interacción interna.

```mermaid
graph LR
    %% Actividades
    A1[A1: Gestionar Interfaz y Peticiones]
    A2[A2: Procesar Contenido con IA]
    A3[A3: Ejecutar Motores de Generación]
    A4[A4: Sincronizar Persistencia]

    %% Flujos de Información
    I1[Input Usuario] --> A1
    A1 --> |Tokens/Instrucciones| A2
    A2 --> |Textos Estructurados| A3
    A3 --> |Status / Resultados| A1
    A3 --> O1[Docx / Imgs]
    
    %% Base de datos interaction
    A1 <--> |Fetch/Save| A4
    A2 --> |Contexto Histórico| A4
    A3 --> |Metadata Documento| A4

    %% Controles
    C1[API Limits/Quota] --> A2
    C2[Reglas Académicas] --> A3

    %% Mecanismos
    M1[React / Node] --> A1
    M2[Gemini API] --> A2
    M3[Python Engines] --> A3
    M4[Supabase] --> A4

    style A1 fill:#e3f2fd,stroke:#1e88e5
    style A2 fill:#e3f2fd,stroke:#1e88e5
    style A3 fill:#e3f2fd,stroke:#1e88e5
    style A4 fill:#e3f2fd,stroke:#1e88e5
```

## Glosario Técnico (ICOM)

| Sigla | Nombre | Descripción Técnica |
| :--- | :--- | :--- |
| **I** | Inputs | Datos crudos, archivos PDF para RAG, prompts del usuario y parámetros de la tesis. |
| **C** | Controles | Restricciones de tokens de la API, librerías de validación de formato (docx-templates), y configuración del sistema. |
| **O** | Outputs | Archivos Microsoft Word generados, diagramas Ishikawa/IDEF en PNG, y el estado de la base de datos. |
| **M** | Mecanismos | Stack tecnológico: React (Frontend), Node.js (Backend), Python (Generación de archivos), Supabase (Base de Datos) y Gemini (IA). |
