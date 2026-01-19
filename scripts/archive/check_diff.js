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

  // Original logic - what would have been OUTBOUND before COSCO/CMA fix
  const coscoPattern = /^cosco\s+shipping\s+line\s+booking\s+confirmation/i;
  const cmaPattern = /^cma\s*cgm\s*-\s*booking\s+confirmation\s+available/i;

  const originalOutbound = new Set();
  const newOutbound = new Set();
  const movedToInbound = new Set(); // Was outbound, now inbound

  for (const doc of bcDocs) {
    const email = emailMap.get(doc.email_id);
    if (!email) continue;

    const sender = (email.sender_email || "").toLowerCase();
    const subject = email.subject || "";

    // Current direction from DB
    const currentDir = email.email_direction;

    // Would original logic have marked this outbound?
    // Original: Intoglo sender without carrier pattern = outbound
    let originalDir = "inbound";
    if (sender.includes("@intoglo.com") || sender.includes("@intoglo.in")) {
      if (sender.includes(" via ")) {
        originalDir = "inbound";
      } else if (sender === "ops@intoglo.com" && /^booking\s+(confirmation|amendment)\s*:/i.test(subject)) {
        originalDir = "inbound";
      } else {
        originalDir = "outbound"; // Original would have been outbound
      }
    }

    if (originalDir === "outbound") {
      originalOutbound.add(doc.shipment_id);
    }
    if (currentDir === "outbound") {
      newOutbound.add(doc.shipment_id);
    }
    if (originalDir === "outbound" && currentDir === "inbound") {
      movedToInbound.add(doc.shipment_id);
    }
  }

  console.log("=== BC Shared (Outbound) Analysis ===");
  console.log("Original logic would give:", originalOutbound.size, "shipments");
  console.log("Current DB gives:", newOutbound.size, "shipments");
  console.log("Moved from outbound to inbound:", movedToInbound.size, "shipments");

  // Show which shipments moved
  if (movedToInbound.size > 0) {
    console.log("\n=== Shipments moved to INBOUND (COSCO/CMA BC) ===");
    for (const shipmentId of [...movedToInbound].slice(0, 10)) {
      const docs = bcDocs.filter(d => d.shipment_id === shipmentId);
      for (const doc of docs.slice(0, 2)) {
        const email = emailMap.get(doc.email_id);
        if (email && email.email_direction === "inbound") {
          const sender = (email.sender_email || "").toLowerCase();
          if ((sender.includes("@intoglo") && !sender.includes(" via "))) {
            console.log("  -", email.subject?.substring(0, 70));
          }
        }
      }
    }
  }
}

check().catch(console.error);
