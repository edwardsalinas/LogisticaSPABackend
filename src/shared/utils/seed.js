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

    // 2. Limpiar datos previos (Orden inverso de dependencias)
    console.log('Limpiando datos previos...');
    await supabase.from('checkpoint_visits').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('route_checkpoints').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('tracking_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('packages').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('transport_routes').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('vehicles').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    console.log('✅ Base de datos limpia.');

    // 3. Crear Rutas de Transporte BASE
    console.log('Creando rutas de transporte de prueba...');
    const routesData = [
      { origin: 'La Paz', destination: 'Cochabamba', status: 'planeada' },
      { origin: 'Santa Cruz', destination: 'Tarija', status: 'planeada' }
    ];

    const { data: routes, error: rError } = await supabase
      .from('transport_routes')
      .insert(routesData)
      .select();
    if (rError) throw rError;
    console.log(`✅ ${routes.length} Rutas preparadas.`);

    const lpCochRoute = routes.find(r => r.origin === 'La Paz');

    // 4. Crear Checkpoints para la ruta La Paz -> Cochabamba
    if (lpCochRoute) {
      console.log('Creando checkpoints para la ruta La Paz -> Cochabamba...');
      const checkpointsData = [
        { route_id: lpCochRoute.id, name: 'Checkpoint El Alto', lat: -16.5100, lng: -68.1500, sequence_order: 1, radius_meters: 1000 },
        { route_id: lpCochRoute.id, name: 'Puesto Viacha', lat: -16.6500, lng: -68.3100, sequence_order: 2, radius_meters: 500 },
        { route_id: lpCochRoute.id, name: 'Terminal Oruro (Punto Intermedio)', lat: -17.9833, lng: -67.1500, sequence_order: 3, radius_meters: 2000 }
      ];

      const { error: cpError } = await supabase
        .from('route_checkpoints')
        .insert(checkpointsData);
      
      if (cpError) throw cpError;
      console.log('✅ Checkpoints de prueba creados.');
    }

    // 5. Crear Vehículos
    console.log('Creando vehículos de prueba...');
    const vehiclesData = [
      { plate: 'ABC-123', model: 'Volvo FH16', type: 'trailer', capacity_kg: 20000, status: 'disponible' },
      { plate: 'XYZ-789', model: 'Mercedes Sprinter', type: 'van', capacity_kg: 1500, status: 'disponible' },
      { plate: 'TRACK-01', model: 'Isuzu Forward', type: 'camion', capacity_kg: 5000, status: 'disponible' }
    ];

    const { data: vehicles, error: vError } = await supabase
      .from('vehicles')
      .insert(vehiclesData)
      .select();
    if (vError) throw vError;
    console.log(`✅ ${vehicles.length} Vehículos preparados.`);

    // 6. Crear Paquetes Base
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
      .insert(packagesData)
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
