import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Sistema de Gestión Logística API',
      version: '1.0.0',
      description: 'Documentación interactiva de la API para el Monolito Modular de Logística (Tarea 6/US-10)',
    },
    servers: [
      {
        url: '/',
        description: 'Servidor Local (Relativo)',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
  apis: ['./src/modules/**/*.routes.js'], // Escanear todos los archivos de rutas para JSDoc
};

const specs = swaggerJsdoc(options);

export const setupSwagger = (app) => {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));
};
