/**
 * Chronicle Date Quality Report
 *
 * Comprehensive analysis of all date fields in chronicle and shipments.
 * Identifies:
 * - Impossible date combinations (LFD < ETA, ETA < ETD, etc.)
 * - Year anomalies (dates that appear to have wrong year)
 * - Stale dates (old dates with wrong stage)
 * - Format issues
 * - Missing critical dates
 *
 * Run: npx tsx scripts/analysis/chronicle-date-quality-report.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface DateIssue {
  table: string;
  record_id: string;
  reference: string | null;
  issue_type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  field1: string;
  value1: string | null;
  field2?: string;
  value2?: string | null;
  details: string;
}

const issues: DateIssue[] = [];

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║           CHRONICLE DATE QUALITY REPORT                        ║');
  console.log('║           ' + new Date().toISOString().slice(0, 19) + '                          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Run all checks
  await checkImpossibleDateCombinations();
  await checkYearAnomalies();
  await checkStaleDates();
  await checkChronicleSpecificDates();
  await checkCutoffDateLogic();
  await checkMissingCriticalDates();

  // Generate summary
  generateSummary();

  // Generate detailed report
  generateDetailedReport();

  console.log('\n✅ Report complete!');
}

// ============================================================================
// CHECK 1: Impossible Date Combinations
// ============================================================================

async function checkImpossibleDateCombinations() {
  console.log('\n📋 CHECK 1: Impossible Date Combinations\n');
  console.log('-'.repeat(60));

  // 1a. Last Free Day before ETA
  const { data: lfdBeforeEta } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        s.id::text as record_id,
        s.intoglo_reference as reference,
        s.eta::text as eta,
        c.last_free_day::text as last_free_day,
        s.stage,
        (c.last_free_day::date - s.eta::date) as diff_days
      FROM shipments s
      JOIN v_shipment_cutoff_dates c ON c.shipment_id = s.id
      WHERE c.last_free_day IS NOT NULL
        AND s.eta IS NOT NULL
        AND c.last_free_day::date < s.eta::date
      ORDER BY diff_days ASC
      LIMIT 100
    `
  });

  if (lfdBeforeEta && lfdBeforeEta.length > 0) {
    console.log(`❌ Found ${lfdBeforeEta.length} cases: Last Free Day BEFORE ETA`);
    for (const row of lfdBeforeEta) {
      issues.push({
        table: 'shipments+chronicle',
        record_id: row.record_id,
        reference: row.reference,
        issue_type: 'LFD_BEFORE_ETA',
        severity: 'CRITICAL',
        field1: 'last_free_day',
        value1: row.last_free_day,
        field2: 'eta',
        value2: row.eta,
        details: `LFD ${row.diff_days} days before ETA (stage: ${row.stage})`
      });
    }
  } else {
    console.log('✅ No Last Free Day before ETA issues');
  }

  // 1b. ETA before ETD (in shipments table)
  const { data: etaBeforeEtd } = await supabase
    .from('shipments')
    .select('id, intoglo_reference, etd, eta, stage')
    .not('eta', 'is', null)
    .not('etd', 'is', null)
    .lt('eta', supabase.rpc('get_etd_ref'));

  // Use raw SQL instead
  const { data: etaBeforeEtdRaw } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        id::text as record_id,
        intoglo_reference as reference,
        etd::text,
        eta::text,
        stage,
        (eta::date - etd::date) as diff_days
      FROM shipments
      WHERE eta IS NOT NULL AND etd IS NOT NULL AND eta < etd
      LIMIT 100
    `
  });

  if (etaBeforeEtdRaw && etaBeforeEtdRaw.length > 0) {
    console.log(`❌ Found ${etaBeforeEtdRaw.length} cases: ETA BEFORE ETD`);
    for (const row of etaBeforeEtdRaw) {
      issues.push({
        table: 'shipments',
        record_id: row.record_id,
        reference: row.reference,
        issue_type: 'ETA_BEFORE_ETD',
        severity: 'CRITICAL',
        field1: 'eta',
        value1: row.eta,
        field2: 'etd',
        value2: row.etd,
        details: `ETA ${Math.abs(row.diff_days)} days before ETD`
      });
    }
  } else {
    console.log('✅ No ETA before ETD issues');
  }

  // 1c. Actual Arrival before Actual Departure
  const { data: ataBeforeAtd } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        shipment_id::text as record_id,
        MAX(atd)::text as atd,
        MAX(ata)::text as ata
      FROM chronicle
      WHERE shipment_id IS NOT NULL
        AND atd IS NOT NULL AND ata IS NOT NULL
      GROUP BY shipment_id
      HAVING MAX(ata) < MAX(atd)
      LIMIT 100
    `
  });

  if (ataBeforeAtd && ataBeforeAtd.length > 0) {
    console.log(`❌ Found ${ataBeforeAtd.length} cases: ATA BEFORE ATD`);
    for (const row of ataBeforeAtd) {
      issues.push({
        table: 'chronicle',
        record_id: row.record_id,
        reference: null,
        issue_type: 'ATA_BEFORE_ATD',
        severity: 'CRITICAL',
        field1: 'ata',
        value1: row.ata,
        field2: 'atd',
        value2: row.atd,
        details: 'Actual arrival before actual departure'
      });
    }
  } else {
    console.log('✅ No ATA before ATD issues');
  }

  // 1d. Cutoff dates after ETD
  const { data: cutoffAfterEtd } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        c.shipment_id::text as record_id,
        s.intoglo_reference as reference,
        s.etd::text,
        c.si_cutoff::text,
        c.vgm_cutoff::text,
        c.cargo_cutoff::text
      FROM v_shipment_cutoff_dates c
      JOIN shipments s ON s.id = c.shipment_id
      WHERE s.etd IS NOT NULL
        AND (
          (c.si_cutoff IS NOT NULL AND c.si_cutoff::date > s.etd::date) OR
          (c.vgm_cutoff IS NOT NULL AND c.vgm_cutoff::date > s.etd::date) OR
          (c.cargo_cutoff IS NOT NULL AND c.cargo_cutoff::date > s.etd::date)
        )
      LIMIT 100
    `
  });

  if (cutoffAfterEtd && cutoffAfterEtd.length > 0) {
    console.log(`⚠️  Found ${cutoffAfterEtd.length} cases: Cutoff dates AFTER ETD`);
    for (const row of cutoffAfterEtd) {
      const badCutoffs = [];
      if (row.si_cutoff && new Date(row.si_cutoff) > new Date(row.etd)) badCutoffs.push('SI');
      if (row.vgm_cutoff && new Date(row.vgm_cutoff) > new Date(row.etd)) badCutoffs.push('VGM');
      if (row.cargo_cutoff && new Date(row.cargo_cutoff) > new Date(row.etd)) badCutoffs.push('Cargo');

      issues.push({
        table: 'chronicle',
        record_id: row.record_id,
        reference: row.reference,
        issue_type: 'CUTOFF_AFTER_ETD',
        severity: 'HIGH',
        field1: badCutoffs.join(', ') + ' cutoff',
        value1: row.si_cutoff || row.vgm_cutoff || row.cargo_cutoff,
        field2: 'etd',
        value2: row.etd,
        details: `${badCutoffs.join(', ')} cutoff(s) after ETD`
      });
    }
  } else {
    console.log('✅ No cutoff after ETD issues');
  }
}

// ============================================================================
// CHECK 2: Year Anomalies
// ============================================================================

async function checkYearAnomalies() {
  console.log('\n📋 CHECK 2: Year Anomalies\n');
  console.log('-'.repeat(60));

  const currentYear = new Date().getFullYear();

  // 2a. Dates too far in the past (likely year errors)
  const { data: oldDates } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        'shipments' as source,
        id::text as record_id,
        intoglo_reference as reference,
        'etd' as field,
        etd::text as value,
        EXTRACT(YEAR FROM etd) as year
      FROM shipments
      WHERE etd IS NOT NULL AND EXTRACT(YEAR FROM etd) < 2024

      UNION ALL

      SELECT
        'shipments' as source,
        id::text as record_id,
        intoglo_reference as reference,
        'eta' as field,
        eta::text as value,
        EXTRACT(YEAR FROM eta) as year
      FROM shipments
      WHERE eta IS NOT NULL AND EXTRACT(YEAR FROM eta) < 2024

      UNION ALL

      SELECT
        'chronicle' as source,
        id::text as record_id,
        booking_number as reference,
        'etd' as field,
        etd::text as value,
        EXTRACT(YEAR FROM etd) as year
      FROM chronicle
      WHERE etd IS NOT NULL AND EXTRACT(YEAR FROM etd) < 2024

      LIMIT 100
    `
  });

  if (oldDates && oldDates.length > 0) {
    console.log(`⚠️  Found ${oldDates.length} dates with year < 2024`);
    for (const row of oldDates) {
      issues.push({
        table: row.source,
        record_id: row.record_id,
        reference: row.reference,
        issue_type: 'YEAR_TOO_OLD',
        severity: 'HIGH',
        field1: row.field,
        value1: row.value,
        details: `Year ${row.year} seems incorrect (expected 2024-2026)`
      });
    }
  } else {
    console.log('✅ No dates with year < 2024');
  }

  // 2b. Dates too far in the future
  const { data: futureDates } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        'shipments' as source,
        id::text as record_id,
        intoglo_reference as reference,
        'etd' as field,
        etd::text as value,
        EXTRACT(YEAR FROM etd) as year
      FROM shipments
      WHERE etd IS NOT NULL AND EXTRACT(YEAR FROM etd) > 2027

      UNION ALL

      SELECT
        'shipments' as source,
        id::text as record_id,
        intoglo_reference as reference,
        'eta' as field,
        eta::text as value,
        EXTRACT(YEAR FROM eta) as year
      FROM shipments
      WHERE eta IS NOT NULL AND EXTRACT(YEAR FROM eta) > 2027

      LIMIT 100
    `
  });

  if (futureDates && futureDates.length > 0) {
    console.log(`⚠️  Found ${futureDates.length} dates with year > 2027`);
    for (const row of futureDates) {
      issues.push({
        table: row.source,
        record_id: row.record_id,
        reference: row.reference,
        issue_type: 'YEAR_TOO_FUTURE',
        severity: 'MEDIUM',
        field1: row.field,
        value1: row.value,
        details: `Year ${row.year} seems too far in future`
      });
    }
  } else {
    console.log('✅ No dates with year > 2027');
  }

  // 2c. January dates that might be year-off-by-one
  const { data: janDates } = await supabase.rpc('exec_sql', {
    sql: `
      WITH jan_dates AS (
        SELECT
          c.shipment_id::text as record_id,
          s.intoglo_reference as reference,
          c.last_free_day::text as lfd,
          EXTRACT(YEAR FROM c.last_free_day) as lfd_year,
          s.eta::text as eta,
          EXTRACT(YEAR FROM s.eta) as eta_year
        FROM v_shipment_cutoff_dates c
        JOIN shipments s ON s.id = c.shipment_id
        WHERE c.last_free_day IS NOT NULL
          AND s.eta IS NOT NULL
          AND EXTRACT(MONTH FROM c.last_free_day) = 1
          AND c.last_free_day::date < s.eta::date
      )
      SELECT * FROM jan_dates
      WHERE lfd_year = eta_year - 1
      LIMIT 50
    `
  });

  if (janDates && janDates.length > 0) {
    console.log(`🔴 Found ${janDates.length} January dates with suspected year-off-by-one error`);
    for (const row of janDates) {
      issues.push({
        table: 'chronicle',
        record_id: row.record_id,
        reference: row.reference,
        issue_type: 'JANUARY_YEAR_ERROR',
        severity: 'CRITICAL',
        field1: 'last_free_day',
        value1: row.lfd,
        field2: 'eta',
        value2: row.eta,
        details: `LFD year ${row.lfd_year} should likely be ${row.eta_year}`
      });
    }
  } else {
    console.log('✅ No January year-off-by-one issues detected');
  }
}

// ============================================================================
// CHECK 3: Stale Dates (wrong stage)
// ============================================================================

async function checkStaleDates() {
  console.log('\n📋 CHECK 3: Stale Dates (Stage Mismatch)\n');
  console.log('-'.repeat(60));

  // 3a. ETD in past but still pre-departure stage
  const { data: stalePreDep } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        id::text as record_id,
        intoglo_reference as reference,
        stage,
        etd::text,
        (NOW()::date - etd::date) as days_past_etd
      FROM shipments
      WHERE etd < NOW()::date - INTERVAL '30 days'
        AND stage IN ('PENDING', 'BOOKED', 'REQUESTED')
      ORDER BY days_past_etd DESC
      LIMIT 100
    `
  });

  if (stalePreDep && stalePreDep.length > 0) {
    console.log(`⚠️  Found ${stalePreDep.length} pre-departure shipments with ETD > 30 days past`);
    for (const row of stalePreDep) {
      issues.push({
        table: 'shipments',
        record_id: row.record_id,
        reference: row.reference,
        issue_type: 'STALE_PRE_DEPARTURE',
        severity: row.days_past_etd > 90 ? 'HIGH' : 'MEDIUM',
        field1: 'etd',
        value1: row.etd,
        field2: 'stage',
        value2: row.stage,
        details: `ETD ${row.days_past_etd} days past but still ${row.stage}`
      });
    }
  } else {
    console.log('✅ No stale pre-departure shipments');
  }

  // 3b. ETD way past but still at BL_ISSUED (should be DEPARTED)
  const { data: staleBl } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        id::text as record_id,
        intoglo_reference as reference,
        stage,
        etd::text,
        eta::text,
        (NOW()::date - etd::date) as days_past_etd
      FROM shipments
      WHERE etd < NOW()::date - INTERVAL '90 days'
        AND stage IN ('SI_SUBMITTED', 'SI_STAGE', 'BL_ISSUED', 'DRAFT_BL')
      ORDER BY days_past_etd DESC
      LIMIT 100
    `
  });

  if (staleBl && staleBl.length > 0) {
    console.log(`⚠️  Found ${staleBl.length} BL-stage shipments with ETD > 90 days past`);
    for (const row of staleBl) {
      issues.push({
        table: 'shipments',
        record_id: row.record_id,
        reference: row.reference,
        issue_type: 'STALE_BL_STAGE',
        severity: 'HIGH',
        field1: 'etd',
        value1: row.etd,
        field2: 'stage',
        value2: row.stage,
        details: `ETD ${row.days_past_etd} days past but still ${row.stage} - should be DEPARTED/ARRIVED?`
      });
    }
  } else {
    console.log('✅ No stale BL-stage shipments');
  }

  // 3c. ETA way past but still DEPARTED (should be ARRIVED)
  const { data: staleDeparted } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        id::text as record_id,
        intoglo_reference as reference,
        stage,
        eta::text,
        (NOW()::date - eta::date) as days_past_eta
      FROM shipments
      WHERE eta < NOW()::date - INTERVAL '30 days'
        AND stage = 'DEPARTED'
      ORDER BY days_past_eta DESC
      LIMIT 100
    `
  });

  if (staleDeparted && staleDeparted.length > 0) {
    console.log(`⚠️  Found ${staleDeparted.length} DEPARTED shipments with ETA > 30 days past`);
    for (const row of staleDeparted) {
      issues.push({
        table: 'shipments',
        record_id: row.record_id,
        reference: row.reference,
        issue_type: 'STALE_DEPARTED',
        severity: 'MEDIUM',
        field1: 'eta',
        value1: row.eta,
        field2: 'stage',
        value2: row.stage,
        details: `ETA ${row.days_past_eta} days past but still DEPARTED - should be ARRIVED?`
      });
    }
  } else {
    console.log('✅ No stale DEPARTED shipments');
  }
}

// ============================================================================
// CHECK 4: Chronicle-Specific Date Issues
// ============================================================================

async function checkChronicleSpecificDates() {
  console.log('\n📋 CHECK 4: Chronicle-Specific Date Issues\n');
  console.log('-'.repeat(60));

  // 4a. Check for date consistency within same shipment across documents
  const { data: inconsistentDates } = await supabase.rpc('exec_sql', {
    sql: `
      WITH shipment_date_ranges AS (
        SELECT
          shipment_id,
          MIN(etd) as min_etd,
          MAX(etd) as max_etd,
          MIN(eta) as min_eta,
          MAX(eta) as max_eta,
          COUNT(DISTINCT etd) as etd_variations,
          COUNT(DISTINCT eta) as eta_variations
        FROM chronicle
        WHERE shipment_id IS NOT NULL
          AND (etd IS NOT NULL OR eta IS NOT NULL)
        GROUP BY shipment_id
        HAVING COUNT(DISTINCT etd) > 3 OR COUNT(DISTINCT eta) > 3
      )
      SELECT
        sdr.shipment_id::text as record_id,
        s.intoglo_reference as reference,
        sdr.min_etd::text,
        sdr.max_etd::text,
        sdr.etd_variations,
        sdr.min_eta::text,
        sdr.max_eta::text,
        sdr.eta_variations,
        (sdr.max_etd::date - sdr.min_etd::date) as etd_spread_days,
        (sdr.max_eta::date - sdr.min_eta::date) as eta_spread_days
      FROM shipment_date_ranges sdr
      LEFT JOIN shipments s ON s.id = sdr.shipment_id
      ORDER BY GREATEST(
        COALESCE(sdr.max_etd::date - sdr.min_etd::date, 0),
        COALESCE(sdr.max_eta::date - sdr.min_eta::date, 0)
      ) DESC
      LIMIT 50
    `
  });

  if (inconsistentDates && inconsistentDates.length > 0) {
    console.log(`⚠️  Found ${inconsistentDates.length} shipments with >3 date variations`);
    for (const row of inconsistentDates) {
      if (row.etd_spread_days > 30 || row.eta_spread_days > 30) {
        issues.push({
          table: 'chronicle',
          record_id: row.record_id,
          reference: row.reference,
          issue_type: 'INCONSISTENT_DATES',
          severity: 'MEDIUM',
          field1: 'etd_range',
          value1: `${row.min_etd} to ${row.max_etd} (${row.etd_variations} variations)`,
          field2: 'eta_range',
          value2: `${row.min_eta} to ${row.max_eta} (${row.eta_variations} variations)`,
          details: `ETD spread: ${row.etd_spread_days || 0} days, ETA spread: ${row.eta_spread_days || 0} days`
        });
      }
    }
  } else {
    console.log('✅ No excessive date inconsistencies');
  }

  // 4b. Check for null dates where document type should have them
  const { data: missingDates } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        document_type,
        COUNT(*) as total,
        SUM(CASE WHEN etd IS NULL THEN 1 ELSE 0 END) as missing_etd,
        SUM(CASE WHEN eta IS NULL THEN 1 ELSE 0 END) as missing_eta,
        ROUND(100.0 * SUM(CASE WHEN etd IS NULL THEN 1 ELSE 0 END) / COUNT(*), 1) as pct_missing_etd,
        ROUND(100.0 * SUM(CASE WHEN eta IS NULL THEN 1 ELSE 0 END) / COUNT(*), 1) as pct_missing_eta
      FROM chronicle
      WHERE document_type IN ('booking_confirmation', 'arrival_notice', 'draft_bl', 'final_bl')
      GROUP BY document_type
      ORDER BY document_type
    `
  });

  if (missingDates) {
    console.log('\nDate coverage by document type:');
    for (const row of missingDates) {
      const etdStatus = row.pct_missing_etd > 50 ? '⚠️' : '✅';
      const etaStatus = row.pct_missing_eta > 50 ? '⚠️' : '✅';
      console.log(`  ${row.document_type}: ${etdStatus} ETD (${100-row.pct_missing_etd}% filled), ${etaStatus} ETA (${100-row.pct_missing_eta}% filled)`);
    }
  }
}

// ============================================================================
// CHECK 5: Cutoff Date Logic
// ============================================================================

async function checkCutoffDateLogic() {
  console.log('\n📋 CHECK 5: Cutoff Date Logic\n');
  console.log('-'.repeat(60));

  // 5a. SI cutoff should be before VGM cutoff (usually)
  const { data: cutoffOrder } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        shipment_id::text as record_id,
        si_cutoff::text,
        vgm_cutoff::text,
        cargo_cutoff::text,
        (vgm_cutoff::date - si_cutoff::date) as si_to_vgm_days,
        (cargo_cutoff::date - vgm_cutoff::date) as vgm_to_cargo_days
      FROM v_shipment_cutoff_dates
      WHERE si_cutoff IS NOT NULL
        AND vgm_cutoff IS NOT NULL
        AND si_cutoff > vgm_cutoff
      LIMIT 50
    `
  });

  if (cutoffOrder && cutoffOrder.length > 0) {
    console.log(`⚠️  Found ${cutoffOrder.length} cases: SI cutoff AFTER VGM cutoff (unusual)`);
    // This might be intentional in some cases, so just log, don't add as critical issue
  } else {
    console.log('✅ Cutoff date order looks correct (SI < VGM < Cargo typically)');
  }

  // 5b. Cutoffs with unusual gaps
  const { data: cutoffGaps } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        c.shipment_id::text as record_id,
        s.intoglo_reference as reference,
        c.si_cutoff::text,
        c.vgm_cutoff::text,
        c.cargo_cutoff::text,
        s.etd::text,
        (s.etd::date - c.si_cutoff::date) as si_to_etd_days
      FROM v_shipment_cutoff_dates c
      JOIN shipments s ON s.id = c.shipment_id
      WHERE c.si_cutoff IS NOT NULL
        AND s.etd IS NOT NULL
        AND (s.etd::date - c.si_cutoff::date) > 14
      ORDER BY (s.etd::date - c.si_cutoff::date) DESC
      LIMIT 20
    `
  });

  if (cutoffGaps && cutoffGaps.length > 0) {
    console.log(`📝 Found ${cutoffGaps.length} cases: SI cutoff >14 days before ETD (reviewing...)`);
    // Large gaps might indicate date entry issues
    for (const row of cutoffGaps) {
      if (row.si_to_etd_days > 30) {
        issues.push({
          table: 'chronicle',
          record_id: row.record_id,
          reference: row.reference,
          issue_type: 'LARGE_CUTOFF_GAP',
          severity: 'LOW',
          field1: 'si_cutoff',
          value1: row.si_cutoff,
          field2: 'etd',
          value2: row.etd,
          details: `SI cutoff ${row.si_to_etd_days} days before ETD (unusually large gap)`
        });
      }
    }
  } else {
    console.log('✅ Cutoff to ETD gaps are reasonable');
  }
}

// ============================================================================
// CHECK 6: Missing Critical Dates
// ============================================================================

async function checkMissingCriticalDates() {
  console.log('\n📋 CHECK 6: Missing Critical Dates\n');
  console.log('-'.repeat(60));

  // 6a. Active shipments without ETD
  const { data: noEtd } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        id::text as record_id,
        intoglo_reference as reference,
        stage,
        created_at::text
      FROM shipments
      WHERE etd IS NULL
        AND stage NOT IN ('COMPLETED', 'CANCELLED', 'CLOSED', 'DELIVERED')
      ORDER BY created_at DESC
      LIMIT 100
    `
  });

  if (noEtd && noEtd.length > 0) {
    console.log(`⚠️  Found ${noEtd.length} active shipments without ETD`);
    // Don't add all as issues, just note the count
    console.log(`   (First 5: ${noEtd.slice(0, 5).map(r => r.reference || r.record_id.slice(0, 8)).join(', ')})`);
  } else {
    console.log('✅ All active shipments have ETD');
  }

  // 6b. ARRIVED shipments without ETA
  const { data: arrivedNoEta } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        id::text as record_id,
        intoglo_reference as reference,
        stage,
        etd::text
      FROM shipments
      WHERE eta IS NULL
        AND stage IN ('ARRIVED', 'DELIVERED')
      LIMIT 50
    `
  });

  if (arrivedNoEta && arrivedNoEta.length > 0) {
    console.log(`⚠️  Found ${arrivedNoEta.length} ARRIVED/DELIVERED shipments without ETA`);
    for (const row of arrivedNoEta) {
      issues.push({
        table: 'shipments',
        record_id: row.record_id,
        reference: row.reference,
        issue_type: 'ARRIVED_NO_ETA',
        severity: 'MEDIUM',
        field1: 'eta',
        value1: null,
        field2: 'stage',
        value2: row.stage,
        details: 'Shipment arrived but no ETA recorded'
      });
    }
  } else {
    console.log('✅ All arrived shipments have ETA');
  }
}

// ============================================================================
// SUMMARY & REPORT GENERATION
// ============================================================================

function generateSummary() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                    SUMMARY                                     ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const critical = issues.filter(i => i.severity === 'CRITICAL').length;
  const high = issues.filter(i => i.severity === 'HIGH').length;
  const medium = issues.filter(i => i.severity === 'MEDIUM').length;
  const low = issues.filter(i => i.severity === 'LOW').length;

  console.log(`Total Issues Found: ${issues.length}`);
  console.log('');
  console.log(`  🔴 CRITICAL: ${critical}`);
  console.log(`  🟠 HIGH:     ${high}`);
  console.log(`  🟡 MEDIUM:   ${medium}`);
  console.log(`  🟢 LOW:      ${low}`);
  console.log('');

  // Group by issue type
  const byType: Record<string, number> = {};
  for (const issue of issues) {
    byType[issue.issue_type] = (byType[issue.issue_type] || 0) + 1;
  }

  console.log('By Issue Type:');
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }
}

function generateDetailedReport() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║              CRITICAL ISSUES (Require Fix)                     ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const criticalIssues = issues.filter(i => i.severity === 'CRITICAL');

  if (criticalIssues.length === 0) {
    console.log('  No critical issues found! 🎉');
    return;
  }

  // Group critical issues by type
  const byType: Record<string, DateIssue[]> = {};
  for (const issue of criticalIssues) {
    if (!byType[issue.issue_type]) byType[issue.issue_type] = [];
    byType[issue.issue_type].push(issue);
  }

  for (const [type, typeIssues] of Object.entries(byType)) {
    console.log(`\n📌 ${type} (${typeIssues.length} cases)`);
    console.log('-'.repeat(60));

    // Show first 5 examples
    for (const issue of typeIssues.slice(0, 5)) {
      console.log(`  ID: ${issue.record_id.slice(0, 8)}... | Ref: ${issue.reference || 'N/A'}`);
      console.log(`    ${issue.field1}: ${issue.value1}`);
      if (issue.field2) {
        console.log(`    ${issue.field2}: ${issue.value2}`);
      }
      console.log(`    → ${issue.details}`);
      console.log('');
    }

    if (typeIssues.length > 5) {
      console.log(`  ... and ${typeIssues.length - 5} more`);
    }
  }

  // Output SQL for fixing common issues
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║              SUGGESTED FIX QUERIES                             ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  if (byType['JANUARY_YEAR_ERROR']) {
    console.log('-- Fix January year-off-by-one errors in chronicle:');
    console.log(`-- Review these ${byType['JANUARY_YEAR_ERROR'].length} records and update year from 2025 to 2026`);
    console.log('-- NOTE: Manual review required before running!');
    console.log(`
UPDATE chronicle
SET last_free_day = last_free_day + INTERVAL '1 year'
WHERE id IN (
  -- List specific IDs after review
);
`);
  }

  if (byType['LFD_BEFORE_ETA']) {
    console.log('-- Records where Last Free Day is before ETA (need investigation):');
    console.log(`
SELECT c.id, c.shipment_id, s.intoglo_reference,
       c.last_free_day, s.eta,
       c.document_type, c.received_at
FROM chronicle c
JOIN shipments s ON s.id = c.shipment_id
WHERE c.last_free_day IS NOT NULL
  AND s.eta IS NOT NULL
  AND c.last_free_day < s.eta
ORDER BY c.last_free_day;
`);
  }
}

main().catch(console.error);
