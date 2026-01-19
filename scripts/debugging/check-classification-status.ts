import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const ALLOWED = new Set([
  "quotation_request", "rate_inquiry", "rate_quote", "space_availability",
  "booking_request", "booking_confirmation", "booking_amendment", "booking_cancellation", "equipment_release",
  "shipping_instruction", "si_draft", "si_submission", "bl_instruction", "vgm_submission", "vgm_confirmation", "vgm_reminder", "sob_confirmation", "checklist", "forwarding_note", "commercial_invoice", "packing_list", "cutoff_reminder", "cutoff_advisory",
  "bl_draft", "bill_of_lading", "bl_released", "hbl_draft", "hbl_released", "telex_release",
  "isf_filing", "duty_entry", "customs_clearance", "customs_hold", "customs_document", "ams_filing",
  "vessel_schedule", "shipment_notice", "tracking_update", "exception_report", "rollover_notice",
  "arrival_notice", "delivery_order",
  "pickup_notification", "pickup_coordination", "delivery_scheduling", "delivery_coordination", "pod_confirmation", "container_return", "trucking_arrangement",
  "invoice", "proforma_invoice", "tax_invoice", "credit_note", "debit_note", "payment_confirmation", "payment_request", "detention_invoice", "demurrage_invoice",
  "customer_case", "rate_advisory", "general_correspondence", "newsletter", "authentication"
]);

async function check() {
  const { data } = await supabase
    .from("document_classifications")
    .select("document_type, classified_at")
    .like("model_version", "v2|%")
    .order("classified_at", { ascending: false })
    .limit(1500);

  const invalidTypes: Record<string, number> = {};
  let recentValid = 0, recentInvalid = 0;
  let oldValid = 0, oldInvalid = 0;

  const cutoff = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago

  for (const d of data!) {
    const isRecent = new Date(d.classified_at) > cutoff;
    const isValid = ALLOWED.has(d.document_type);

    if (isRecent) {
      if (isValid) recentValid++;
      else recentInvalid++;
    } else {
      if (isValid) oldValid++;
      else oldInvalid++;
    }

    if (!isValid) {
      invalidTypes[d.document_type] = (invalidTypes[d.document_type] || 0) + 1;
    }
  }

  console.log("RECENT (last 30 min - NEW reclassification):");
  console.log("  Valid:", recentValid, "| Invalid:", recentInvalid);
  console.log("");
  console.log("OLDER (before 30 min - OLD reclassification):");
  console.log("  Valid:", oldValid, "| Invalid:", oldInvalid);
  console.log("");

  if (Object.keys(invalidTypes).length > 0) {
    console.log("Invalid types (top 10):");
    Object.entries(invalidTypes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([t, c]) => console.log("  -", t, ":", c));
  }
}

check();
