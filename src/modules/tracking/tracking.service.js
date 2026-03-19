import supabase from '../../shared/config/supabase.js';
import eventBus from '../../shared/utils/eventBus.js';

export const logEvent = async (data) => {
  const { package_id, lat, lng, status } = data;

  const { data: insertedData, error } = await supabase
    .from('tracking_logs')
    .insert([
      {
        package_id,
        lat,
        lng,
        status,
        timestamp: new Date().toISOString()
      }
    ])
    .select();

  if (error) {
    throw error;
  }

  if (status.toLowerCase() === 'delivered' || status.toLowerCase() === 'entregado') {
    eventBus.publish('tracking:package_delivered', { packageId: package_id });
  } else {
    eventBus.publish('tracking:event_registered', { packageId: package_id, status });
  }

  return insertedData[0];
};
