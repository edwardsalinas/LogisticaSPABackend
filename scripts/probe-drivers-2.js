import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkColumns() {
  const { data, error } = await supabase.from('drivers').select('*').limit(1);
  if (data && data.length > 0) {
    console.log('Columnas encontradas:', Object.keys(data[0]));
  } else {
    // Si la tabla está vacía, no podemos ver las columnas por Object.keys
    // Probamos insertar una fila con solo 'id' para ver si falla por NOT NULLs de otras columnas
    console.log('Tabla vacía. Intentando inserción mínima...');
    const { error: insError } = await supabase.from('drivers').insert({ id: '00000000-0000-0000-0000-000000000000' });
    console.log('Error de inserción mínima:', insError?.message);
  }
}

checkColumns();
