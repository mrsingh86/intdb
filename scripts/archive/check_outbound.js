require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  // Get BC documents with their emails
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

  // Count outbound emails
  const outboundEmails = [];
  for (const email of emailMap.values()) {
    if (email.email_direction === "outbound") {
      outboundEmails.push(email);
    }
  }

  console.log("=== OUTBOUND BC Emails ===");
  console.log("Total outbound emails:", outboundEmails.length);

  // Categorize by sender
  const bySender = {};
  for (const e of outboundEmails) {
    const sender = (e.sender_email || "unknown").toLowerCase();
    // Extract just the email part or first part
    const key = sender.includes("<") ? sender.split("<")[1]?.replace(">", "") : sender;
    const domain = key?.split("@")[1] || "unknown";
    bySender[domain] = (bySender[domain] || 0) + 1;
  }

  console.log("\nBy sender domain:");
  Object.entries(bySender).sort((a,b) => b[1] - a[1]).forEach(([domain, count]) => {
    console.log(`  ${domain}: ${count}`);
  });

  // Count unique shipments with outbound BC
  const shipmentOutbound = new Set();
  for (const doc of bcDocs) {
    const email = emailMap.get(doc.email_id);
    if (email?.email_direction === "outbound") {
      shipmentOutbound.add(doc.shipment_id);
    }
  }
  console.log("\nUnique shipments with outbound BC:", shipmentOutbound.size);

  // Sample outbound emails
  console.log("\n=== Sample OUTBOUND BC Emails ===");
  outboundEmails.slice(0, 15).forEach(e => {
    console.log("From:", e.sender_email?.substring(0, 50));
    console.log("Subj:", e.subject?.substring(0, 60));
    console.log("");
  });
}

check().catch(console.error);
