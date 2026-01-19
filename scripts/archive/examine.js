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

  // Count emails by direction in DB
  let dbInbound = 0, dbOutbound = 0, dbNull = 0;
  for (const email of emailMap.values()) {
    if (email.email_direction === "inbound") dbInbound++;
    else if (email.email_direction === "outbound") dbOutbound++;
    else dbNull++;
  }

  console.log("=== BC Email Directions in Database ===");
  console.log("Inbound:", dbInbound);
  console.log("Outbound:", dbOutbound);
  console.log("Null:", dbNull);
  console.log("Total:", emailMap.size);

  // Check Intoglo emails marked inbound (potential over-correction)
  const intogloInbound = [];
  for (const email of emailMap.values()) {
    if (email.email_direction === "inbound") {
      const sender = (email.sender_email || "").toLowerCase();
      if ((sender.includes("@intoglo.com") || sender.includes("@intoglo.in")) &&
          sender.indexOf(" via ") === -1) {
        intogloInbound.push(email);
      }
    }
  }

  console.log("\n=== Intoglo Emails Marked INBOUND (no 'via') ===");
  console.log("Count:", intogloInbound.length);

  // Categorize these
  const maerskBC = intogloInbound.filter(e =>
    e.sender_email === "ops@intoglo.com" &&
    /^booking\s+(confirmation|amendment)\s*:/i.test(e.subject || "")
  );
  const coscoBC = intogloInbound.filter(e =>
    /^cosco\s+shipping\s+line\s+booking\s+confirmation/i.test(e.subject || "")
  );
  const cmaBC = intogloInbound.filter(e =>
    /^cma\s*cgm\s*-\s*booking\s+confirmation\s+available/i.test(e.subject || "")
  );
  const other = intogloInbound.filter(e => {
    const subj = e.subject || "";
    const isKnownPattern =
      /^booking\s+(confirmation|amendment)\s*:/i.test(subj) ||
      /^cosco\s+shipping\s+line\s+booking\s+confirmation/i.test(subj) ||
      /^cma\s*cgm\s*-\s*booking\s+confirmation\s+available/i.test(subj);
    return !isKnownPattern;
  });

  console.log("\nBreakdown:");
  console.log("  Maersk BC (ops@ + ^Booking Conf:):", maerskBC.length);
  console.log("  COSCO BC:", coscoBC.length);
  console.log("  CMA CGM BC:", cmaBC.length);
  console.log("  OTHER (potentially wrong):", other.length);

  // Show OTHER emails
  console.log("\n=== OTHER Intoglo INBOUND (should be OUTBOUND?) ===");
  other.slice(0, 20).forEach(e => {
    console.log("  -", e.sender_email?.substring(0, 35), "|", e.subject?.substring(0, 55));
  });
}

check().catch(console.error);
