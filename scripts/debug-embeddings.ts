/**
 * Debug embedding service
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { createEmbeddingService } from '../lib/chronicle/embedding-service';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const embeddingService = createEmbeddingService(supabase);

async function test() {
  console.log('Testing embedding generation...');

  const testText = 'Please respond to this request urgently. We need your confirmation.';
  console.log('Input:', testText);

  const result = await embeddingService.generateEmbeddingFromText(testText);

  console.log('Success:', result.success);
  console.log('Embedding length:', result.embedding?.length || 0);

  if (result.success && result.embedding) {
    console.log('First 5 values:', result.embedding.slice(0, 5));
  } else {
    console.log('Error:', result.error);
  }
}

test().catch(e => console.error('Error:', e));
