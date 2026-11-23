# Diagramas de la arquitectura

Diagramas del sistema (C4, UML, BPMN y ER) con el asistente de IA actual: balanceador de modelos, respuesta en vivo, historial y auditoría, lectura de guías por foto y acciones con confirmación.

| Archivo | Contenido | Figura de la tesis |
|---|---|---|
| `fig03_bpmn.png` | Procesos logísticos asistidos por IA (carriles) | 3 |
| `fig04_wae.png` | Modelo WAE UML | 4 |
| `fig05_c4_contexto.png` | C4 nivel 1: contexto | 5 |
| `fig06_c4_contenedores.png` | C4 nivel 2: contenedores | 6 |
| `fig07_c4_backend.png` | C4 nivel 3: componentes del backend | 7 |
| `fig08_c4_frontend.png` | C4 nivel 3: componentes del frontend | 8 |
| `fig10_secuencia.png` | Secuencia: consulta al asistente y acción con confirmación | 10 |
| `fig11_componentes_uml.png` | Modelo de componentes UML 2.5 | 11 |
| `fig13_er.png` | Modelo relacional (esquema `public` de Supabase) | 12/13 |
| `fig22_tecnologico.png` | Arquitectura tecnológica | 22 |

El código fuente está en `fuentes-plantuml/` (`.puml`). Para regenerar un diagrama hace falta PlantUML y Java:

```
java -jar plantuml.jar -charset UTF-8 -tpng -Sdpi=170 fuentes-plantuml/fig05_c4_contexto.puml
```

Los diagramas con `!pragma layout smetana` no necesitan Graphviz.
