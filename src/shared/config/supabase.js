const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'placeholder-key';

if (supabaseUrl === 'https://placeholder.supabase.co') {
  console.warn('[Supabase Config] Warning: SUPABASE_URL not found in environment variables. Using placeholder.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
