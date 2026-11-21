// Variables de entorno de prueba. Debe importarse ANTES que cualquier módulo de src/ (env.js valida al cargar).
process.env.SUPABASE_URL = 'http://127.0.0.1:9'; // puerto cerrado: ninguna prueba toca la red real
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.RATE_LIMIT_LOGIN_MAX = '3';
process.env.RATE_LIMIT_PUBLIC_MAX = '2';
delete process.env.TURNSTILE_SECRET_KEY;
delete process.env.SUPABASE_ANON_KEY;
