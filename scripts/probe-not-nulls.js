import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkNotNulls() {
  const { data, error } = await supabase.from('drivers').select('*').limit(0);
  if (error) {
    console.error('Error:', error.message);
  } else {
    console.log('La tabla existe.');
  }
  
  // Script para ver qué columnas son NOT NULL
  const query = `
    SELECT column_name, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'drivers'
  `;
  // No puedo correr SQL arbitrario vía supabase-js fácilmente sin una RPC, 
  // así que probaremos de nuevo con una inserción fallida descriptiva.
  const { error: err } = await supabase.from('drivers').insert({ id: '00000000-0000-0000-0000-000000000001' });
  console.log('Error de NOT NULL:', err?.message);
}

checkNotNulls();
