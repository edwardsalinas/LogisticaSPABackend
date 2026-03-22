import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from the root .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the .env file.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testDuplicateEvents() {
  console.log('--- Testing Duplicate Package Events Fix ---');

  // 1. Find a completed trip
  const { data: trip } = await supabase
    .from('driver_trips')
    .select('*, transport_routes(*)')
    .eq('status', 'completed')
    .not('transport_routes.dest_lat', 'is', null)
    .limit(1)
    .maybeSingle();

  if (!trip) {
     console.log('No completed trip found with destination coordinates to test with. Run a full flow first.');
     return;
  }

  console.log(`Found completed trip ID: ${trip.id}`);

  // 2. Simulate a ping from the driver at the destination
  console.log(`Simulating a driver ping at the destination (${trip.transport_routes.dest_lat}, ${trip.transport_routes.dest_lng})...`);
  
  try {
     const response = await fetch(`http://localhost:3000/api/tracking/trip/${trip.id}/event`, {
         method: 'POST',
         headers: {
             'Content-Type': 'application/json',
             // We need a valid driver token here, but the controller just checks trip status from DB. 
             // Service role key might not bypass the requireAuth middleware. 
             // Let's test the logic directly or ensure the endpoint responds with 400.
         },
         body: JSON.stringify({
             lat: trip.transport_routes.dest_lat,
             lng: trip.transport_routes.dest_lng
         })
     });

     const data = await response.json();
     console.log('Endpoint Response:', response.status, data);

     if (response.status === 400 && data.message.includes('completado')) {
         console.log('✅ Success: The endpoint correctly rejected the event for a completed trip.');
     } else {
         console.log('❌ Failure: The endpoint did not reject the event as expected (400 Bad Request).');
     }

  } catch (error) {
     console.error('Error testing endpoint:', error);
  }
}

testDuplicateEvents();
