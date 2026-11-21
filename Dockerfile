# ---- Backend LogisticaSPA (Node.js + Express) ----
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependencias de producción. --ignore-scripts evita ejecutar "husky" (solo sirve en desarrollo).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Código de la aplicación (Swagger lee ./src/modules/**/*.routes.js)
COPY src ./src

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/health || exit 1

# Las variables de entorno llegan desde docker-compose (env_file), no desde un archivo .env
CMD ["node", "src/server.js"]
