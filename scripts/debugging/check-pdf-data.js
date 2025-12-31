const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkData() {
  // Check pdf_extractions table
  console.log('=== PDF EXTRACTIONS ===')
  const { data: pdfs, error: pdfError } = await supabase
    .from('pdf_extractions')
    .select('*')
    .limit(5)

  if (pdfError) {
    console.error('PDF Extractions error:', pdfError)
  } else {
    console.log(`Found ${pdfs?.length || 0} PDF extractions`)
    pdfs?.forEach((pdf, i) => {
      console.log(`\nPDF ${i + 1}:`)
      console.log('  Email ID:', pdf.email_id)
      console.log('  Filename:', pdf.filename)
      console.log('  File size:', pdf.file_size)
      console.log('  Extraction status:', pdf.extraction_status)
      console.log('  Extracted text length:', pdf.extracted_text?.length || 0)
      console.log('  Storage path:', pdf.storage_path)
    })
  }

  // Check emails with entities
  console.log('\n\n=== EMAILS WITH ENTITIES ===')
  const { data: withEntities } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_type, entity_value')
    .limit(10)

  console.log(`Found ${withEntities?.length || 0} entity extractions`)

  // Group by email
  const byEmail = {}
  withEntities?.forEach(e => {
    if (!byEmail[e.email_id]) byEmail[e.email_id] = []
    byEmail[e.email_id].push(`${e.entity_type}: ${e.entity_value}`)
  })

  Object.entries(byEmail).forEach(([emailId, entities]) => {
    console.log(`\nEmail ${emailId.substring(0, 8)}:`)
    entities.forEach(e => console.log(`  - ${e}`))
  })
}

checkData().catch(console.error)
