# Task Generation Scripts

## Overview

This directory contains a comprehensive task generation pipeline that creates action items for the Action Center based on various triggers and conditions. The scripts analyze shipments, documents, notifications, and workflow states to automatically generate relevant tasks.

## Results Summary

**Initial State:**
- Total shipments: 204
- Tasks: 54
- Coverage: 13 shipments (6.4%)

**Final State:**
- Total shipments: 204
- Tasks: 444
- Coverage: 198 shipments (97.1%)

**Impact:**
- Tasks added: 390
- Coverage increase: 90.7%
- Goal achieved: 97.1% (target was 50%)

## Task Distribution

### By Priority
- Critical: 76 tasks (17.1%)
- High: 166 tasks (37.4%)
- Medium: 202 tasks (45.5%)

### By Category
- Operational: 185 tasks (41.7%)
- Document: 143 tasks (32.2%)
- Communication: 55 tasks (12.4%)
- Deadline: 54 tasks (12.2%)
- Notification: 6 tasks (1.4%)
- Compliance: 1 task (0.2%)

## Available Scripts

### 1. Master Pipeline
**File:** `generate-all-tasks.ts`

Runs all task generation scripts in sequence and provides comprehensive statistics.

```bash
source .env && npx tsx scripts/generate-all-tasks.ts
```

### 2. Deadline Tasks
**File:** `generate-deadline-tasks.ts`

Generates tasks for upcoming deadlines within 7 days:
- SI cutoff deadlines
- VGM cutoff deadlines
- Cargo cutoff deadlines
- Gate cutoff deadlines

**Triggers:** Deadlines between now and 7 days from now
**Priority:** High to Critical based on proximity

```bash
source .env && npx tsx scripts/generate-deadline-tasks.ts
```

### 3. Overdue Deadline Tasks
**File:** `generate-overdue-deadline-tasks.ts`

Generates verification tasks for past deadlines:
- Verify SI submission (if SI cutoff passed)
- Verify VGM submission (if VGM cutoff passed)
- Verify cargo delivery (if cargo cutoff passed)
- Verify gate-in (if gate cutoff passed)

**Triggers:** Past deadlines without verification documents
**Priority:** Critical (especially if no verification document found)

```bash
source .env && npx tsx scripts/generate-overdue-deadline-tasks.ts
```

### 4. Document Tasks
**File:** `generate-document-tasks.ts`

Generates review tasks when documents are received:
- Review SI drafts
- Verify final shipping instructions
- Review bills of lading
- Share arrival notices
- Review commercial invoices
- Respond to detention notices
- Verify VGM confirmations

**Triggers:** Document receipt
**Priority:** Based on document type and age

```bash
source .env && npx tsx scripts/generate-document-tasks.ts
```

### 5. Notification Tasks
**File:** `generate-notification-tasks.ts`

Generates response tasks for notifications:
- Respond to customs holds
- Address detention alerts
- Handle vessel delays
- Respond to rollovers
- Address equipment shortages
- Handle cargo cutoff changes
- Respond to vessel omissions

**Triggers:** Unread/pending notifications
**Priority:** Critical for customs/detention, high for others

```bash
source .env && npx tsx scripts/generate-notification-tasks.ts
```

### 6. Workflow State Tasks
**File:** `generate-workflow-tasks.ts`

Generates tasks based on shipment workflow state:

**Booked shipments:**
- Prepare cargo
- Arrange cargo delivery (if ETD within 7 days)

**In-transit shipments:**
- Prepare for arrival (if ETA within 7 days)
- Notify consignee (if ETA within 3 days)
- Follow up on missing BL

**Arrived shipments:**
- Arrange customs clearance
- Track delivery to final destination

**Triggers:** Shipment status and milestone proximity
**Priority:** Critical for arrived, high for approaching milestones

```bash
source .env && npx tsx scripts/generate-workflow-tasks.ts
```

### 7. Missing Document Tasks
**File:** `generate-missing-document-tasks.ts`

Generates tasks to obtain missing documents:
- Booking confirmation (for all shipments)
- Shipping instructions (for in-transit/arrived)
- Bill of lading (for in-transit/arrived)
- Arrival notice (for in-transit/arrived)
- VGM confirmation (for booked/in-transit)
- Commercial invoice (for in-transit/arrived)

**Triggers:** Shipment status + document absence + grace period
**Priority:** Critical for BL, high for SI/booking confirmation

```bash
source .env && npx tsx scripts/generate-missing-document-tasks.ts
```

### 8. Coverage Analysis
**File:** `analyze-task-coverage.ts`

Analyzes current task coverage and identifies opportunities.

```bash
source .env && npx tsx scripts/analyze-task-coverage.ts
```

## Task Priority Scoring

All scripts use a weighted priority scoring system (0-100 points):

### Priority Score Factors

1. **Deadline Urgency** (0-35 points)
   - Overdue: 35 points
   - Within 24h: 30 points
   - Within 48h: 25 points
   - Within 7 days: 15 points

2. **Financial Impact** (0-20 points)
   - Detention/customs: 15-20 points
   - Rollover/delays: 10 points
   - Standard: 5 points

3. **Notification Severity** (0-15 points)
   - Critical notifications: 15 points
   - High priority: 11 points
   - Medium priority: 7 points
   - Low priority: 3 points

4. **Document Criticality** (0-30 points)
   - Critical docs (BL, VGM): 30 points
   - High docs (SI, arrival notice): 20-25 points
   - Standard docs: 10-15 points

5. **Stakeholder Importance** (0-15 points)
   - Platinum customers: 15 points
   - Gold customers: 10 points
   - Standard: 5 points

### Priority Levels

- **Critical** (score >= 70): Immediate action required
- **High** (score >= 50): Address within 24-48 hours
- **Medium** (score >= 35): Address within a few days
- **Low** (score < 35): Address as time permits

## Idempotency

All scripts are designed to be idempotent:
- Check for existing tasks before creating new ones
- Use `shipment_id:template_code` as unique key
- Safe to run multiple times
- Won't create duplicate tasks

## Running in Production

### Recommended Schedule (Cron Jobs)

```bash
# Run deadline tasks daily at 6 AM
0 6 * * * cd /path/to/intdb && source .env && npx tsx scripts/generate-deadline-tasks.ts

# Run all tasks weekly on Monday at 3 AM
0 3 * * 1 cd /path/to/intdb && source .env && npx tsx scripts/generate-all-tasks.ts

# Run document/notification tasks every 4 hours
0 */4 * * * cd /path/to/intdb && source .env && npx tsx scripts/generate-document-tasks.ts
0 */4 * * * cd /path/to/intdb && source .env && npx tsx scripts/generate-notification-tasks.ts
```

### Manual Execution

To generate all tasks immediately:

```bash
cd /path/to/intdb
source .env
npx tsx scripts/generate-all-tasks.ts
```

## Environment Variables Required

```bash
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_service_key
# or
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_key
```

## Database Schema Requirements

Scripts expect the following tables:
- `shipments` - Core shipment data
- `shipment_documents` - Document tracking
- `notifications` - Notification tracking
- `action_tasks` - Generated tasks
- `task_templates` - Task configuration (optional)
- `carriers` - Carrier information
- `parties` - Stakeholder information

## Task Categories

1. **deadline** - Time-sensitive cutoffs and deadlines
2. **document** - Document review and verification
3. **notification** - Response to notifications
4. **operational** - Workflow-based operational tasks
5. **communication** - Stakeholder communication tasks
6. **compliance** - Regulatory and compliance tasks
7. **financial** - Payment and invoice tasks

## Extending the Scripts

### Adding New Task Types

1. Add configuration to appropriate config array
2. Define trigger conditions
3. Set priority scoring rules
4. Add template code and description

Example:
```typescript
{
  documentType: 'packing_list',
  templateCode: 'review_packing_list',
  title: (booking: string) => `Review Packing List for ${booking}`,
  description: 'Verify packing list accuracy',
  category: 'document',
  basePriority: 'medium',
  daysToReview: 3,
}
```

### Customizing Priority Scoring

Edit the `calculatePriorityScore` function in each script to adjust weights and thresholds.

## Troubleshooting

### No tasks created
- Check if shipments exist in database
- Verify grace periods haven't excluded all shipments
- Check if tasks already exist (scripts are idempotent)

### Foreign key constraint errors
- Ensure referenced tables exist
- Check that `document_lifecycle_id` is only set when document_lifecycle exists
- Verify `notification_id` references valid notifications

### Low priority scores
- Review priority scoring factors
- Adjust weights in `calculatePriorityScore` functions
- Check if base priority is set correctly

## Performance

- Document tasks: ~1-2 seconds for 150 documents
- Workflow tasks: ~2-3 seconds for 200 shipments
- All tasks: ~10-15 seconds total
- Database queries are optimized with proper indexes

## Monitoring

Each script outputs:
- Tasks created count
- Tasks skipped (duplicates)
- Total tasks in system
- Priority distribution
- Category distribution
- Coverage percentage

Monitor these metrics to ensure task generation is working correctly.

## Architecture Compliance

These scripts follow the CLAUDE.md principles:

1. **DRY**: Shared priority scoring logic extracted to functions
2. **Single Responsibility**: Each script handles one trigger type
3. **Configuration Over Code**: Task templates in database (optional)
4. **Idempotency**: Safe to run multiple times
5. **Database-Driven**: All decisions based on database state
6. **Deep Modules**: Simple interface, complex implementation
7. **Fail Fast**: Errors logged but don't stop batch processing
8. **Audit Trail**: All tasks tracked with metadata

## Version History

- **v1.0** (2025-12-27): Initial comprehensive task generation pipeline
  - 6 specialized scripts + 1 master pipeline
  - 97% shipment coverage achieved
  - 390 tasks generated across all categories
