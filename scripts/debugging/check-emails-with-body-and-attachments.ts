import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function checkEmailsWithBodyAndAttachments() {
  // Check emails that have BOTH body text AND attachments
  const { data: withBoth, error } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text, has_attachments, attachment_count')
    .eq('has_attachments', true)
    .not('body_text', 'is', null)
    .neq('body_text', '');

  console.log('\n=== EMAILS WITH BOTH BODY TEXT AND ATTACHMENTS ===');
  console.log(`Total: ${withBoth?.length || 0}`);

  if (withBoth && withBoth.length > 0) {
    console.log('\nSample emails:');
    withBoth.slice(0, 5).forEach((email, i) => {
      console.log(`\n${i + 1}. ${email.subject?.substring(0, 60)}`);
      console.log(`   Body length: ${email.body_text?.length} chars`);
      console.log(`   Has attachments: ${email.has_attachments}`);
      console.log(`   Attachment count: ${email.attachment_count}`);
    });
  }

  // Check how many of these emails have their attachments saved
  if (withBoth && withBoth.length > 0) {
    const emailIds = withBoth.map(e => e.id);

    const { count: savedAttachments } = await supabase
      .from('raw_attachments')
      .select('*', { count: 'exact', head: true })
      .in('email_id', emailIds);

    console.log(`\n=== ATTACHMENT STATUS ===`);
    console.log(`Emails with body + attachments: ${withBoth.length}`);
    console.log(`Attachments saved in database: ${savedAttachments || 0}`);
    console.log(`Missing attachments: ${(withBoth.length * 2) - (savedAttachments || 0)} (approx)`);
  }
}

checkEmailsWithBodyAndAttachments().catch(console.error);
