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

  // Categorize INBOUND emails by sender type
  const carrierDomains = [
    "maersk", "hlag", "hapag", "cma-cgm", "cosco", "msc",
    "evergreen", "one-line", "yangming", "oocl", "zim"
  ];

  let carrierInbound = 0;
  let intogloViaInbound = 0;
  let intogloPatternInbound = 0;
  let externalInbound = 0;

  const externalEmails = [];

  for (const email of emailMap.values()) {
    if (email.email_direction !== "inbound") continue;

    const sender = (email.sender_email || "").toLowerCase();

    // Carrier domain
    if (carrierDomains.some(c => sender.includes(c))) {
      carrierInbound++;
    }
    // Intoglo with "via"
    else if (sender.includes(" via ") && (sender.includes("@intoglo") || sender.includes("intoglo"))) {
      intogloViaInbound++;
    }
    // Intoglo without "via" (pattern match)
    else if (sender.includes("@intoglo.com") || sender.includes("@intoglo.in")) {
      intogloPatternInbound++;
    }
    // External (not carrier, not Intoglo)
    else {
      externalInbound++;
      externalEmails.push(email);
    }
  }

  console.log("=== INBOUND Emails by Source ===");
  console.log("Carrier domains:", carrierInbound);
  console.log("Intoglo via:", intogloViaInbound);
  console.log("Intoglo pattern:", intogloPatternInbound);
  console.log("EXTERNAL (not carrier, not Intoglo):", externalInbound);
  console.log("");
  console.log("Total INBOUND:", carrierInbound + intogloViaInbound + intogloPatternInbound + externalInbound);

  // Show external emails - these might be customers wrongly marked as BC
  console.log("\n=== EXTERNAL INBOUND Emails (potential issue) ===");
  externalEmails.slice(0, 20).forEach(e => {
    console.log("  -", e.sender_email?.substring(0, 40), "|", e.subject?.substring(0, 45));
  });
}

check().catch(console.error);
