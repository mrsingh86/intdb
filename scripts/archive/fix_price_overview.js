require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fix() {
  // Fix Price overview - booking confirmation emails
  const { data: confirmations, error: err1 } = await supabase
    .from("raw_emails")
    .update({ email_direction: "inbound" })
    .ilike("subject", "Price overview - booking confirmation%")
    .eq("email_direction", "outbound")
    .select("id, subject");

  console.log("Fixed Price overview confirmations:", confirmations?.length || 0);
  if (err1) console.error("Error:", err1);

  // Fix Price overview - booking amendment emails
  const { data: amendments, error: err2 } = await supabase
    .from("raw_emails")
    .update({ email_direction: "inbound" })
    .ilike("subject", "Price overview - booking amendment%")
    .eq("email_direction", "outbound")
    .select("id, subject");

  console.log("Fixed Price overview amendments:", amendments?.length || 0);
  if (err2) console.error("Error:", err2);

  console.log("\nTotal fixed:", (confirmations?.length || 0) + (amendments?.length || 0));
}

fix().catch(console.error);
