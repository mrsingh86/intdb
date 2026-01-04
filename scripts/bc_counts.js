require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  // Get all BC documents with linked emails
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

  // Count by direction
  const inboundShipments = new Set();
  const outboundShipments = new Set();

  for (const doc of bcDocs) {
    const email = emailMap.get(doc.email_id);
    if (!email) continue;

    if (email.email_direction === "inbound") {
      inboundShipments.add(doc.shipment_id);
    } else if (email.email_direction === "outbound") {
      outboundShipments.add(doc.shipment_id);
    }
  }

  console.log("=== BC Workflow State Counts ===");
  console.log("BC Received (inbound from carriers):", inboundShipments.size);
  console.log("BC Shared (outbound to customers):", outboundShipments.size);
  console.log("");
  console.log("Total unique shipments with BC:", new Set([...inboundShipments, ...outboundShipments]).size);
}

check().catch(console.error);
