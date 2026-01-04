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

  // Count unique shipments with inbound vs outbound BC
  const shipmentInbound = new Set();
  const shipmentOutbound = new Set();

  for (const doc of bcDocs) {
    const email = emailMap.get(doc.email_id);
    if (email?.email_direction === "inbound") {
      shipmentInbound.add(doc.shipment_id);
    } else if (email?.email_direction === "outbound") {
      shipmentOutbound.add(doc.shipment_id);
    }
  }

  console.log("=== Unique SHIPMENTS with BC ===");
  console.log("Shipments with INBOUND BC (BC Received):", shipmentInbound.size);
  console.log("Shipments with OUTBOUND BC (BC Shared):", shipmentOutbound.size);
  console.log("");
  console.log("Target was: BC Received=109, BC Shared=97");
  console.log("Gap: BC Received", shipmentInbound.size - 109, ", BC Shared", shipmentOutbound.size - 97);

  // Let's check what the original SQL counted
  // The original checked for CARRIER sender patterns specifically
  const carrierPatterns = [
    /maersk/i, /hlag/i, /hapag/i, /cma-cgm/i, /cosco/i,
    /in\.export.*via/i, /maersk.*via/i, /cma.?cgm.*via/i, /hapag.*via|hlag.*via/i,
    /IRIS.*via/i
  ];

  const opsMailBC = /^booking\s+(confirmation|amendment)\s*:/i;

  // Recount using ORIGINAL carrier detection logic
  const originalInbound = new Set();
  const originalOutbound = new Set();

  for (const doc of bcDocs) {
    const email = emailMap.get(doc.email_id);
    if (!email) continue;

    const sender = (email.sender_email || "").toLowerCase();
    const subject = email.subject || "";

    // Original carrier detection logic
    let isCarrierBC = false;

    // Direct carrier domain
    if (carrierPatterns.some(p => p.test(sender))) {
      isCarrierBC = true;
    }
    // ops@intoglo.com with exact BC subject format
    else if (sender === "ops@intoglo.com" && opsMailBC.test(subject)) {
      isCarrierBC = true;
    }

    if (isCarrierBC) {
      originalInbound.add(doc.shipment_id);
    } else {
      // Check if it's Intoglo outbound (sharing with customer)
      if (sender.includes("@intoglo.com") || sender.includes("@intoglo.in")) {
        originalOutbound.add(doc.shipment_id);
      }
    }
  }

  console.log("\n=== Using ORIGINAL Carrier Detection Logic ===");
  console.log("BC Received (from carriers):", originalInbound.size);
  console.log("BC Shared (Intoglo to customers):", originalOutbound.size);
}

check().catch(console.error);
