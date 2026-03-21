import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspectDrivers() {
  const { data, error } = await supabase.rpc('get_table_columns', { table_name: 'drivers' });
  
  if (error) {
    // Si la RPC no existe, intentar una query directa a information_schema (si hay permisos)
    console.log('RPC falló, intentando query directa...');
    const { data: cols, error: err2 } = await supabase
      .from('drivers')
      .select('*')
      .limit(0); // Esto devuelve la estructura en el header
      
    if (err2) {
      console.error('Error:', err2.message);
    } else {
      // En postgrest, a veces se puede ver el esquema así o simplemente probando columnas
      console.log('No se pudo obtener columnas directamente sin datos.');
    }
  } else {
    console.log('Columnas:', data);
  }
}

// Alternativa: Ver el error de una inserción fallida a propósito
async function probeColumns() {
  const { error } = await supabase.from('drivers').insert({ non_existent_column_xyz: 'test' });
  console.log('Error de prueba (ayuda a ver columnas sugeridas):', error?.message);
}

probeColumns();
