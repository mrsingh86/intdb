require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  // Get BC documents
  const { data: bcDocs } = await supabase
    .from("shipment_documents")
    .select("shipment_id, document_type, email_id")
    .in("document_type", ["booking_confirmation", "booking_amendment"]);

  const emailIds = [...new Set(bcDocs?.map(d => d.email_id).filter(Boolean))];

  // Get emails
  const emailMap = new Map();
  for (let i = 0; i < emailIds.length; i += 300) {
    const batch = emailIds.slice(i, i + 300);
    const { data: emails } = await supabase
      .from("raw_emails")
      .select("id, email_direction, sender_email, subject")
      .in("id", batch);
    if (emails) emails.forEach(e => emailMap.set(e.id, e));
  }

  // Check outbound emails
  const outboundEmails = [];
  const invalidOutbound = []; // Not from Intoglo

  for (const email of emailMap.values()) {
    if (email.email_direction === "outbound") {
      outboundEmails.push(email);

      const sender = (email.sender_email || "").toLowerCase();
      const isIntoglo = sender.includes("@intoglo.com") || sender.includes("@intoglo.in");

      if (!isIntoglo) {
        invalidOutbound.push(email);
      }
    }
  }

  console.log("=== Outbound BC Email Verification ===");
  console.log("Total outbound emails:", outboundEmails.length);
  console.log("From Intoglo:", outboundEmails.length - invalidOutbound.length);
  console.log("NOT from Intoglo (INVALID):", invalidOutbound.length);

  if (invalidOutbound.length > 0) {
    console.log("\n=== INVALID Outbound (not from Intoglo) ===");
    invalidOutbound.forEach(e => {
      console.log("From:", e.sender_email);
      console.log("Subj:", e.subject?.substring(0, 60));
      console.log("");
    });
  }

  // Check if all outbound are replies or original from Intoglo
  const replies = outboundEmails.filter(e => /^(re|fw|fwd):/i.test((e.subject || "").trim()));
  const original = outboundEmails.filter(e => !/^(re|fw|fwd):/i.test((e.subject || "").trim()));

  console.log("\n=== Outbound Email Types ===");
  console.log("Replies (Re:, Fwd:):", replies.length);
  console.log("Original (not reply):", original.length);

  // Sample original outbound (not replies)
  console.log("\n=== Sample Original Outbound (not replies) ===");
  original.slice(0, 15).forEach(e => {
    console.log("From:", e.sender_email?.substring(0, 40));
    console.log("Subj:", e.subject?.substring(0, 60));
    console.log("");
  });
}

check().catch(console.error);
