import * as LogisticsService from '../src/modules/logistics/logistics.service.js';

async function testIsolation() {
  const clienteId = '8a1d2a5d-33b8-4785-908a-ae17aec76ec3'; // cliente@logistica.bo
  
  console.log('--- Probando aislamiento para cliente@logistica.bo ---');
  const filters = { sender_id: clienteId };
  const packages = await LogisticsService.getPackages(filters);
  
  console.log(`Paquetes encontrados: ${packages.length}`);
  packages.forEach(p => {
    console.log(`Code: ${p.tracking_code} | Sender: ${p.sender_id}`);
  });
  
  if (packages.every(p => p.sender_id === clienteId)) {
    console.log(' AISLAMIENTO EXITOSO: Solo se ven sus propios paquetes.');
  } else {
    console.error(' ERROR DE AISLAMIENTO: Se ven paquetes de otros clientes.');
  }
}

testIsolation();
