# Thesis POC: Logistics AI Platform

Esta Prueba de Concepto (POC) demuestra la arquitectura **Monolito Modular** utilizando Node.js/Express y React.

## Requisitos
- Node.js (v18+)
- NPM

## Estructura
- `backend/`: Servidor Express (API + Agente Mock).
- `frontend/`: Aplicación React + Vite + Tailwind.

## Cómo Ejecutar

### 1. Iniciar Backend
```bash
cd backend
npm install
npm start
```
El servidor correrá en `http://localhost:3001`.

### 2. Iniciar Frontend
```bash
cd frontend
npm install
npm run dev
```
La aplicación estará disponible en `http://localhost:5173`.

## Funcionalidades Demo
1. **Dashboard de Inventario**: Visualiza datos simulados que vendrían de Supabase.
2. **Chat con Agente**: Interactúa con el agente (mock de LangChain). Prueba preguntar:
   - "Hola"
   - "¿Cómo está el stock de monitores?"
   - "Quiero crear una orden"

## Notas Técnicas
- **Base de Datos**: Usa un cliente Supabase mock (si no hay llaves reales en `.env`).
- **IA**: Simula respuestas de LLM con `setTimeout` para demostrar la asincronía.
