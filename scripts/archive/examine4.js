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

  // What patterns did we add?
  const coscoPattern = /^cosco\s+shipping\s+line\s+booking\s+confirmation/i;
  const cmaPattern = /^cma\s*cgm\s*-\s*booking\s+confirmation\s+available/i;
  const maerskOriginal = /^booking\s+(confirmation|amendment)\s*:/i;

  // Count shipments that match each NEW pattern
  const coscoShipments = new Set();
  const cmaShipments = new Set();
  const maerskShipments = new Set();
  const viaShipments = new Set();
  const carrierDomainShipments = new Set();

  const carrierDomains = ["maersk", "hlag", "hapag", "cma-cgm", "cosco", "msc", "evergreen"];

  for (const doc of bcDocs) {
    const email = emailMap.get(doc.email_id);
    if (!email) continue;

    const sender = (email.sender_email || "").toLowerCase();
    const subject = email.subject || "";

    // Check what pattern matches
    if (carrierDomains.some(c => sender.includes(c))) {
      carrierDomainShipments.add(doc.shipment_id);
    } else if (sender.includes(" via ")) {
      viaShipments.add(doc.shipment_id);
    } else if (sender === "ops@intoglo.com" && maerskOriginal.test(subject)) {
      maerskShipments.add(doc.shipment_id);
    } else if (coscoPattern.test(subject)) {
      coscoShipments.add(doc.shipment_id);
    } else if (cmaPattern.test(subject)) {
      cmaShipments.add(doc.shipment_id);
    }
  }

  console.log("=== Shipments by Detection Pattern ===");
  console.log("Carrier domains:", carrierDomainShipments.size);
  console.log("Via pattern:", viaShipments.size);
  console.log("Maersk BC (original pattern):", maerskShipments.size);
  console.log("COSCO BC (NEW pattern):", coscoShipments.size);
  console.log("CMA CGM BC (NEW pattern):", cmaShipments.size);

  // Original would have: carrier domains + maersk BC
  // But carrier domains already include maersk forwards with "via"
  const originalInbound = new Set([
    ...carrierDomainShipments,
    ...viaShipments,
    ...maerskShipments
  ]);
  console.log("\n=== Original Logic ===");
  console.log("BC Received (carrier + via + maersk ops@):", originalInbound.size);

  // New includes COSCO and CMA
  const newInbound = new Set([
    ...carrierDomainShipments,
    ...viaShipments,
    ...maerskShipments,
    ...coscoShipments,
    ...cmaShipments
  ]);
  console.log("BC Received (+ COSCO + CMA):", newInbound.size);
  console.log("\nDifference:", newInbound.size - originalInbound.size);
}

check().catch(console.error);
