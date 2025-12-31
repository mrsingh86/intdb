const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkEmail() {
  // Get a few emails to check their data
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text, has_attachments, attachment_count')
    .order('received_at', { ascending: false })
    .limit(5)

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log('Sample emails data:')
  emails?.forEach((email, i) => {
    console.log(`\nEmail ${i + 1}:`)
    console.log('  ID:', email.id)
    console.log('  Subject:', email.subject?.substring(0, 50))
    console.log('  Body text:', email.body_text ? `${email.body_text.length} chars` : 'NULL or empty')
    console.log('  Body preview:', email.body_text?.substring(0, 100) || 'NONE')
    console.log('  Has attachments:', email.has_attachments)
    console.log('  Attachment count:', email.attachment_count)
  })
}

checkEmail().catch(console.error)
