import supabase from '../config/supabase.js';

/**
 * Script de Semilla (Seed) para Poblar Datos de Prueba
 * Ejecutar con: node --env-file=.env src/shared/utils/seed.js
 */
async function seed() {
  console.log('--- Iniciando Poblamiento de Datos (Seed) ---');

  try {
    // 1. Verificar Usuario Admin (admin@test.com)
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) throw listError;
    
    let admin = users.find(u => u.email === 'admin@test.com');
    if (!admin) {
      console.log('Creando usuario administrador...');
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: 'admin@test.com',
        password: 'Password123!',
        email_confirm: true,
        user_metadata: { role: 'admin' }
      });
      if (createError) throw createError;
      admin = newUser.user;
    }
    const adminId = admin.id;
    console.log('✅ Admin listo:', adminId);

    // 2. Crear Vehículos
    console.log('Creando vehículos de prueba...');
    const vehiclesData = [
      { plate: 'ABC-123', model: 'Volvo FH16', type: 'trailer', capacity_kg: 20000, status: 'disponible' },
      { plate: 'XYZ-789', model: 'Mercedes Sprinter', type: 'van', capacity_kg: 1500, status: 'disponible' },
      { plate: 'TRACK-01', model: 'Isuzu Forward', type: 'camion', capacity_kg: 5000, status: 'disponible' }
    ];

    const { data: vehicles, error: vError } = await supabase
      .from('vehicles')
      .upsert(vehiclesData, { onConflict: 'plate' })
      .select();
    if (vError) throw vError;
    console.log(`✅ ${vehicles.length} Vehículos preparados.`);

    // 3. Crear Paquetes Base
    console.log('Creando paquetes de prueba...');
    const packagesData = [
      { 
        sender_id: adminId, 
        origen: 'La Paz', 
        destino: 'Cochabamba', 
        peso: 50, 
        description: 'Equipos Médicos', 
        status: 'pendiente',
        tracking_code: `TRK-SEED-01`
      },
      { 
        sender_id: adminId, 
        origen: 'Santa Cruz', 
        destino: 'Tarija', 
        peso: 1500, 
        description: 'Suministros Agrícolas', 
        status: 'pendiente',
        tracking_code: `TRK-SEED-02`
      }
    ];

    const { data: pkgs, error: pError } = await supabase
      .from('packages')
      .upsert(packagesData, { onConflict: 'tracking_code' })
      .select();
    if (pError) throw pError;
    console.log(`✅ ${pkgs.length} Paquetes preparados.`);

    console.log('--- Seed completado con éxito ---');
  } catch (error) {
    console.error('❌ Error en Seed:', error.message || error);
  } finally {
    process.exit(0);
  }
}

seed();
