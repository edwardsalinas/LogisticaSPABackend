import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function probe3() {
  console.log('Probando con license_number...');
  const { error } = await supabase.from('drivers').insert({ 
    id: '00000000-0000-0000-0000-000000000000',
    license_number: 'PROBE-123' 
  });
  console.log('Resultado:', error?.message);
}

probe3();
