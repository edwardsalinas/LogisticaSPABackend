import { z } from 'zod';

const envSchema = z.object({
  PORT: z.string().default('3000'),
  SUPABASE_URL: z.string().url('SUPABASE_URL debe ser una URL valida'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY es requerida'),
});

const { data: env, error } = envSchema.safeParse(process.env);

if (error) {
  console.error('[Config] Variables de entorno invalidas:');
  console.error(error.flatten().fieldErrors);
  process.exit(1);
}

export default env;
