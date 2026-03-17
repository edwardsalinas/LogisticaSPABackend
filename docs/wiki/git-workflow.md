# Git Workflow

Este proyecto adopta **Git Flow** como modelo de ramificación y **Conventional Commits** como estándar de mensajes, enforzado automáticamente por Husky + Commitlint.

---

## Ramas

| Rama | Propósito | Recibe PR de | Se fusiona hacia |
|------|-----------|-------------|------------------|
| `main` | Producción estable | `release/*`, `hotfix/*` | - |
| `develop` | Integración y QA | `feature/*`, `bugfix/*` | `release/*` |
| `feature/*` | Nuevas funcionalidades | - | `develop` |
| `bugfix/*` | Correcciones no críticas | - | `develop` |
| `hotfix/*` | Correcciones urgentes en producción | - | `main` + `develop` |

No se permite hacer commit directo sobre `main` ni `develop`.

### Nomenclatura de ramas

Formato: `tipo/id-descripcion-breve`

```
feature/1-setup-base-structure
feature/15-modulo-iam-auth
bugfix/22-corregir-validacion-jwt
hotfix/30-fallo-critico-tracking
```

El `id` corresponde al numero del Issue en GitHub Projects.

---

## Conventional Commits

### Formato

```
<tipo>(<alcance>): <descripcion>
```

### Tipos permitidos

| Tipo | Uso |
|------|-----|
| `feat` | Nueva funcionalidad |
| `fix` | Corrección de bug |
| `docs` | Cambios en documentación |
| `chore` | Mantenimiento, dependencias, configuración |
| `refactor` | Reestructuración sin cambio funcional |
| `test` | Pruebas |
| `style` | Formato de código |
| `ci` | Integración continua |

### Alcances obligatorios (scopes)

Corresponden a los módulos del Monolito Modular:

| Scope | Módulo |
|-------|--------|
| `core` | Servidor principal, configuración global |
| `shared` | Middlewares, utilidades, EventBus |
| `iam` | Autenticación e identidad |
| `fleet` | Gestión de flota |
| `logistics` | Despacho y ruteo |
| `tracking` | Rastreo y geolocalización |
| `ai-agent` | Agente conversacional IA |

### Ejemplos

```
feat(fleet): crear endpoint POST para registrar choferes
fix(tracking): corregir desfase de zona horaria en logs GPS
docs(core): agregar wiki sobre git flow
chore(core): actualizar version de supabase-js
```

Para cerrar Issues automáticamente desde el commit, agregar en el cuerpo:   
`Closes #4`

---

## Flujo del desarrollador

```
git checkout develop && git pull origin develop
git checkout -b feature/<id>-<descripcion>
# ... desarrollo ...
git add .
git commit -m "feat(<scope>): <descripcion>"
git push -u origin feature/<id>-<descripcion>
# Abrir Pull Request en GitHub hacia develop
```

Husky validará el mensaje del commit antes de permitirlo. Si el formato es incorrecto, el commit será rechazado.
