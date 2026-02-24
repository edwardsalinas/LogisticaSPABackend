import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

// Mock client if keys are missing (for POC resilience)
const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'placeholder-key';

let supabase;

if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log("Supabase Client: Connected");
} else {
    // Mock Interface
    console.log("Supabase Client: Running in MOCK Mode (No Keys Provided)");
    supabase = {
        from: (table) => ({
            select: () => Promise.resolve({ data: [], error: null }),
            insert: () => Promise.resolve({ data: [], error: null })
        })
    };
}

export default supabase;
