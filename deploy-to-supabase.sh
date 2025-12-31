#!/bin/bash

# ============================================================================
# SUPABASE DEPLOYMENT SCRIPT
# ============================================================================
# Deploys freight intelligence schema to Supabase INTDB project
# ============================================================================

set -e  # Exit on error

echo "🚀 Starting Supabase INTDB deployment..."
echo ""

# Supabase project details
SUPABASE_PROJECT_URL="https://fdmcdbvkfdmrdowfjrcz.supabase.com"
SUPABASE_ANON_KEY="sb_publishable_v9RFIqbeitIgL4y6MXPLNg_CyC2YwRm"

# Check if psql is installed
if ! command -v psql &> /dev/null; then
    echo "❌ PostgreSQL client (psql) is not installed"
    echo "   Install via: brew install postgresql"
    exit 1
fi

echo "📋 Deployment Plan:"
echo "   1. Deploy base freight intelligence schema (27 tables)"
echo "   2. Deploy stakeholder intelligence extension (9 tables)"
echo "   3. Verify deployment"
echo ""

read -p "Continue with deployment? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Deployment cancelled"
    exit 1
fi

echo ""
echo "🔐 Please enter your Supabase database password:"
echo "   (Found in: Supabase Dashboard > Settings > Database > Connection string)"
read -s DB_PASSWORD
echo ""

# Connection string
DB_CONNECTION="postgresql://postgres:${DB_PASSWORD}@db.fdmcdbvkfdmrdowfjrcz.supabase.co:5432/postgres"

echo "📦 Step 1: Deploying base schema..."
if psql "$DB_CONNECTION" -f freight-intelligence-schema.sql > /tmp/supabase-deploy-1.log 2>&1; then
    echo "   ✅ Base schema deployed successfully"
else
    echo "   ❌ Base schema deployment failed. Check logs:"
    tail -20 /tmp/supabase-deploy-1.log
    exit 1
fi

echo ""
echo "📦 Step 2: Deploying stakeholder intelligence extension..."
if psql "$DB_CONNECTION" -f stakeholder-intelligence-extension.sql > /tmp/supabase-deploy-2.log 2>&1; then
    echo "   ✅ Stakeholder extension deployed successfully"
else
    echo "   ❌ Extension deployment failed. Check logs:"
    tail -20 /tmp/supabase-deploy-2.log
    exit 1
fi

echo ""
echo "🔍 Step 3: Verifying deployment..."

# Count tables
TABLE_COUNT=$(psql "$DB_CONNECTION" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name NOT LIKE 'pg_%';")

if [ "$TABLE_COUNT" -ge 35 ]; then
    echo "   ✅ Deployment verified: $TABLE_COUNT tables created"
else
    echo "   ⚠️  Warning: Only $TABLE_COUNT tables found (expected 35+)"
fi

echo ""
echo "✨ Deployment complete!"
echo ""
echo "📊 Database Statistics:"
psql "$DB_CONNECTION" -c "
SELECT
  'Tables' as metric,
  COUNT(*) FILTER (WHERE table_type = 'BASE TABLE') as count
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name NOT LIKE 'pg_%'
UNION ALL
SELECT
  'Views' as metric,
  COUNT(*) FILTER (WHERE table_type = 'VIEW') as count
FROM information_schema.tables
WHERE table_schema = 'public'
UNION ALL
SELECT
  'Functions' as metric,
  COUNT(*) as count
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace;
"

echo ""
echo "🎯 Next Steps:"
echo "   1. View your database: $SUPABASE_PROJECT_URL/project/_/editor"
echo "   2. Run test queries in SQL Editor"
echo "   3. Set up Row Level Security (RLS) policies"
echo "   4. Build AI agents to populate data"
echo ""
echo "📚 Documentation: FREIGHT-INTELLIGENCE-README.md"
echo ""
