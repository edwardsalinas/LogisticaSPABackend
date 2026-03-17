module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Definimos qué tipo de commits permitimos (Standard Conventional Commits)
    'type-enum': [
      2,
      'always',
      [
        'feat',     // Nueva funcionalidad (MINOR)
        'fix',      // Corrección de bug (PATCH)
        'docs',     // Cambio exclusivo de documentación
        'chore',    // Tareas de mantenimiento, configuraciones, dependencias
        'style',    // Cambios de formato de código (prettier, eslint)
        'refactor', // Refactorización sin cambio funcional
        'test',     // Agregar/modificar pruebas
        'revert',   // Revertir un commit previo
        'ci'        // Cambios en los archivos de Integración Continua (GitHub Actions)
      ],
    ],
    // Obligamos a usar SIEMPRE scopes de nuestros modulos definidos
    'scope-enum': [
      2,
      'always',
      [
        'core',       // Iniciación, DB, server.js, globales
        'shared',     // Middlewares, utilities, eventBus
        'iam',        // Módulo IAM
        'fleet',      // Módulo Fleet
        'logistics',  // Módulo Logistics
        'tracking',   // Módulo Tracking
        'ai-agent'    // Módulo AI
      ]
    ],
    // Obligatorio usar scope
    'scope-empty': [2, 'never'],
    // El asunto no debe terminar en punto
    'subject-full-stop': [2, 'never', '.'],
    // Todo en minúsculas para estandarización
    'subject-case': [2, 'always', 'lower-case']
  }
};
