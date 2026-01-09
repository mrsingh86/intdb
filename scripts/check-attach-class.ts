import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

import { AttachmentClassificationRepository } from '../lib/repositories';

const repo = new AttachmentClassificationRepository(supabase);

async function check() {
  const emailId = 'cf4f8650-89d2-4a8a-90cb-6c11d27de757';

  const existingAttachClasses = await repo.findByEmailId(emailId);

  console.log('existingAttachClasses length:', existingAttachClasses?.length);
  console.log('First record:', JSON.stringify(existingAttachClasses?.[0], null, 2));
  console.log('');
  console.log('document_type from first:', existingAttachClasses?.[0]?.document_type);
  console.log('confidence from first:', existingAttachClasses?.[0]?.confidence);
}

check().catch(console.error);
