import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Helper para esperar
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runFullFlowTest() {
  console.log('🚀 Iniciando prueba de flujo completo...');

  try {
    // 0. Autenticación (Login)
    console.log('\n🔐 0. Autenticando como Admin...');
    const loginResponse = await fetch('http://localhost:3000/api/iam/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@test.com',
        password: 'Password123!'
      })
    });
    
    if (!loginResponse.ok) throw new Error('Error de autenticación');
    const loginResult = await loginResponse.json();
    const token = loginResult.data.session.access_token;
    console.log('✅ Autenticación exitosa');

    const authHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
    // 1. Crear un paquete (Logistics)
    console.log('\n📦 1. Creando paquete...');
    const { data: pkg, error: pkgError } = await supabase
      .from('packages')
      .insert({
        description: 'Paquete de Prueba Integrada',
        peso: 10.5,
        origen: 'Bodega Central',
        destino: 'Punto de Entrega A',
        status: 'pendiente',
        sender_id: loginResult.data.user.id,
        tracking_code: `TRK-TEST-${Date.now()}`
      })
      .select()
      .single();

    if (pkgError) throw pkgError;
    console.log(`✅ Paquete creado: ${pkg.id}`);

    // 2. Crear una ruta (Logistics)
    console.log('\n🛣️ 2. Creando ruta de transporte...');
    const { data: route, error: routeError } = await supabase
      .from('transport_routes')
      .insert({
        origin: 'Bodega Central',
        destination: 'Punto de Entrega A',
        status: 'planeada'
      })
      .select()
      .single();

    if (routeError) throw routeError;
    console.log(`✅ Ruta creada: ${route.id}`);

    // 3. Asignar paquete a ruta (Logistics)
    console.log('\n🔗 3. Asignando paquete a la ruta...');
    const { error: assignError } = await supabase
      .from('packages')
      .update({ route_id: route.id, status: 'asignado' })
      .eq('id', pkg.id);

    if (assignError) throw assignError;
    console.log('✅ Asignación completada');

    // 4. Crear Checkpoints para la ruta del test
    console.log('\n📍 4. Agregando checkpoint de monitoreo...');
    const { data: cp, error: cpError } = await supabase
      .from('route_checkpoints')
      .insert({
        route_id: route.id,
        name: 'Punto de Control Alfa',
        lat: -16.5123,
        lng: -68.1545,
        radius_meters: 500,
        sequence_order: 1
      })
      .select()
      .single();
    if (cpError) throw cpError;
    console.log(`✅ Checkpoint creado: ${cp.name}`);

    // 5. Reportar evento de tracking vía API (Simular Driver llegando al checkpoint)
    console.log('\n🚛 5. Reportando ubicación vía API (Dentro del radio del checkpoint)...');
    const trackResponse = await fetch('http://localhost:3000/api/tracking/events', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        package_id: pkg.id,
        status: 'en_transito',
        lat: -16.5124, // Muy cerca del checkpoint
        lng: -68.1546
      })
    });

    if (!trackResponse.ok) {
      const errData = await trackResponse.json();
      throw new Error(`Error reportando tracking: ${JSON.stringify(errData)}`);
    }
    const trackResult = await trackResponse.json();
    console.log('✅ Evento registrado vía API');

    // 6. Verificar visita al checkpoint en la DB
    console.log('\n🔎 6. Verificando detección de checkpoint...');
    await wait(1000); // Esperar a que la lógica asíncrona termine
    const { data: visits, error: visitError } = await supabase
      .from('checkpoint_visits')
      .select('*, route_checkpoints(name)')
      .eq('checkpoint_id', cp.id);

    if (visitError) throw visitError;
    if (visits.length > 0) {
      console.log(`🎊 ¡ÉXITO! Visita detectada al checkpoint: ${visits[0].route_checkpoints.name}`);
      console.log(`   Distancia calculada: ${visits[0].distance_meters.toFixed(2)} metros`);
    } else {
      console.log('⚠️ Visita no detectada. Verificando logs del servidor...');
    }

    // 7. Entregar el paquete (Verificar automatización de cierre de ruta)
    console.log('\n🏁 7. Entregando paquete vía API...');
    const deliverResponse = await fetch('http://localhost:3000/api/tracking/events', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        package_id: pkg.id,
        status: 'entregado',
        lat: -16.6000,
        lng: -68.3000
      })
    });

    if (!deliverResponse.ok) throw new Error('Error al entregar paquete');
    console.log('✅ Paquete entregado vía API');

    // 8. Verificar cierre automático de ruta
    console.log('\n🔄 8. Verificando cierre automático de ruta...');
    await wait(1000);
    const { data: finalRoute, error: finalRouteError } = await supabase
      .from('transport_routes')
      .select('status')
      .eq('id', route.id)
      .single();

    if (finalRouteError) throw finalRouteError;
    console.log(`✅ Estado final de la ruta: ${finalRoute.status}`);

    console.log('\n✨ PRUEBA DE FLUJO COMPLETO FINALIZADA CON ÉXITO ✨');

  } catch (error) {
    console.error('\n❌ ERROR DURANTE LA PRUEBA:', error.message);
    process.exit(1);
  }
}

runFullFlowTest();
